import { randomUUID } from 'node:crypto';

import {
    applyRegexScripts,
    type CharacterDetail,
    type ChatMessage,
    type GenerateAction,
    type GroupDepthPrompt,
    getLatestSummary,
    REGEX_PLACEMENT,
    type RegexScript,
    readCardDepthPrompt,
    resolveModel,
    resolvePersona,
    sanitizeRegexMacro,
} from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { activeGenerations } from '../generation/registry.js';
import { runGenerationStream } from '../generation/stream.js';
import { badRequest, notFound } from '../http/errors.js';
import { buildMemoryInjection, formatMemoryText } from '../memory/inject.js';
import { maybeSummarizeAfterTurn } from '../memory/service.js';
import { buildPrompt } from '../prompt/builder.js';
import type { GenerationType } from '../prompt/definitions.js';
import { substituteMacros } from '../prompt/macros.js';
import { resolvePreset } from '../prompt/preset.js';
import { createTokenCounter } from '../prompt/tokenizer.js';
import { createMacroContext, scanWorldInfoForTurn } from '../prompt/worldInfoTurn.js';
import { appendMessage, chatPersonaId, patchChatMetadata, readChat, updateMessage } from '../storage/chats.js';
import { readPresetBody } from '../storage/presets.js';
import { listRegexScripts } from '../storage/regex.js';
import { getActiveProvider, getProviderSecret, getSettings } from '../storage/settings.js';
import { requireCharacter } from './helpers.js';

const generateSchema = z.object({
    characterId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(300),
    action: z.enum(['send', 'regenerate', 'continue', 'trigger', 'impersonate']),
    message: z.string().max(200000).optional(),
});

const stopParamsSchema = z.object({
    id: z.string().min(1).max(100),
});

interface PersistContext {
    character: CharacterDetail;
    chatId: string;
    action: GenerateAction;
    regenerateIndex: number | null;
    continueIndex: number | null;
    originalAssistant: ChatMessage | null;
    providerKind: string;
    providerModel: string;
    startedAt: string;
    /** Scripts that transform a message before it is stored. */
    regexScripts: readonly RegexScript[];
    substitute: (text: string, escapeValues: boolean) => string;
}

async function saveSwipe(
    context: PersistContext,
    text: string,
    extra: Record<string, unknown>,
    stopped: boolean,
): Promise<ChatMessage> {
    if (context.regenerateIndex === null) {
        throw new Error('No message to regenerate');
    }

    const fresh = await readChat(context.character, context.chatId);
    if (!fresh) {
        throw new Error('Chat not found');
    }
    const existing = fresh.messages[context.regenerateIndex];
    if (!existing) {
        throw new Error('Message not found');
    }

    const existingSwipes = Array.isArray(existing.extra?.swipes)
        ? existing.extra.swipes.filter((swipe): swipe is string => typeof swipe === 'string')
        : [existing.mes];
    const swipes = [...existingSwipes, text];
    const swipeInfo = Array.isArray(existing.extra?.swipe_info) ? [...existing.extra.swipe_info] : [];
    swipeInfo.push({ send_date: new Date().toISOString(), extra });

    // The reply is being rewritten, so a summary anchored to it no longer
    // describes the stored text. `extraDelete` removes the key from the merged
    // extra; merely omitting it would keep the stored value. A completed
    // rewrite also clears the old partial marker.
    return updateMessage(context.character, context.chatId, context.regenerateIndex, {
        mes: text,
        send_date: new Date().toISOString(),
        extra: {
            ...(existing.extra ?? {}),
            ...extra,
            swipes,
            swipe_id: swipes.length - 1,
            swipe_info: swipeInfo,
        },
        extraDelete: stopped ? ['memory'] : ['memory', 'stopped'],
    });
}

async function persistMessage(
    context: PersistContext,
    text: string,
    reasoning: string,
    stopped: boolean,
): Promise<ChatMessage> {
    // Scripts without a markdown/prompt flag run here, once, so the stored
    // message — and therefore the prompt and the view — all read the result.
    const storedText = applyRegexScripts(context.regexScripts, text, REGEX_PLACEMENT.AI_OUTPUT, {
        substitute: context.substitute,
    });
    const storedReasoning = applyRegexScripts(context.regexScripts, reasoning, REGEX_PLACEMENT.REASONING, {
        substitute: context.substitute,
    });

    const extra: Record<string, unknown> = {
        api: context.providerKind,
        model: context.providerModel,
        gen_started: context.startedAt,
        gen_finished: new Date().toISOString(),
        ...(storedReasoning ? { reasoning: storedReasoning } : {}),
        ...(stopped ? { stopped: true } : {}),
    };

    if (context.action === 'regenerate' && context.regenerateIndex !== null) {
        return saveSwipe(context, storedText, extra, stopped);
    }

    if (context.action === 'continue' && context.continueIndex !== null && context.originalAssistant) {
        const mergedReasoning = [context.originalAssistant.extra?.reasoning, storedReasoning]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .join('\n\n');
        return updateMessage(context.character, context.chatId, context.continueIndex, {
            mes: `${context.originalAssistant.mes}${storedText}`,
            extra: {
                ...extra,
                ...(mergedReasoning ? { reasoning: mergedReasoning } : {}),
            },
            // The message grew, so a summary anchored to it is out of date. A
            // completed continuation also clears the old partial marker.
            extraDelete: stopped ? ['memory'] : ['memory', 'stopped'],
        });
    }

    return appendMessage(context.character, context.chatId, {
        name: context.character.name,
        is_user: false,
        send_date: new Date().toISOString(),
        mes: storedText,
        extra,
    });
}

/** The prefill an impersonation request sends, and the prefix a draft inherits. */
function impersonationPrefill(name: string): string {
    return `${name}:`;
}

/**
 * Remove the prefill from the start of a draft.
 *
 * Anthropic continues the assistant turn it was given, so the raw text starts
 * with the prefix. The composer should show only what the model added; a
 * prefix that never arrived (any other provider) is stripped too, so the rule
 * does not depend on which adapter answered.
 */
export function strippedDraft(text: string, prefill: string): string {
    const trimmedStart = text.replace(/^\s+/, '');
    const prefix = prefill.trimEnd();
    if (prefix && trimmedStart.toLowerCase().startsWith(prefix.toLowerCase())) {
        return trimmedStart.slice(prefix.length).replace(/^\s+/, '');
    }
    return trimmedStart;
}

export async function registerGenerateRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/generate', async (request, reply) => {
        const body = generateSchema.parse(request.body ?? {});
        const character = await requireCharacter(body.characterId);
        const chat = await readChat(character, body.chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }

        const settings = await getSettings();
        const provider = await getActiveProvider();
        if (!provider) {
            throw badRequest('No provider is available. Configure one in Settings first.');
        }
        // The character may name its own model; one the active provider does
        // not serve falls back to the provider default, which the response
        // reports so the header can say what happened.
        const resolved = resolveModel(provider, character.model, settings.profilePreferredModel);
        if (!resolved.model) {
            throw badRequest('The active provider has no model selected');
        }
        const apiKey = await getProviderSecret(provider.id);
        const tokenCounter = createTokenCounter(provider.kind, resolved.model);

        // Scripts and the macro context are resolved once per request; the
        // source transforms below and the prompt transform later share them.
        const persona = resolvePersona(settings, chatPersonaId(chat));
        const regexScripts = await listRegexScripts();
        const baseMacroContext = createMacroContext(
            character,
            persona,
            undefined,
            getLatestSummary(chat.messages)?.value,
        );
        const baseSubstitute = (text: string, escapeValues: boolean) =>
            substituteMacros(text, baseMacroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});

        // An active ST preset owns the prompt list, the assembly formats and
        // the sampling parameters; anything it omits falls back to settings.
        const activePreset = settings.activePresetId ? await readPresetBody(settings.activePresetId) : null;
        const preset = resolvePreset(activePreset, settings.generation);

        let messages = chat.messages;
        let regenerateIndex: number | null = null;
        let continueIndex: number | null = null;
        let originalAssistant: ChatMessage | null = null;

        if (body.action === 'send') {
            const text = body.message?.trim();
            if (!text) {
                throw badRequest('Message is empty');
            }
            // USER_INPUT scripts run before the text is stored, so the prompt,
            // the stored chat and any later export all agree. Macros expand
            // next, exactly as SillyTavern's `sendMessageAsUser` does, so the
            // chat file holds the name the user saw.
            const storedText = substituteMacros(
                applyRegexScripts(regexScripts, text, REGEX_PLACEMENT.USER_INPUT, { substitute: baseSubstitute }),
                baseMacroContext,
            );
            const userMessage: ChatMessage = {
                name: persona.name,
                is_user: true,
                send_date: new Date().toISOString(),
                mes: storedText,
                extra: {},
            };
            await appendMessage(character, body.chatId, userMessage);
            messages = [...messages, userMessage];
        } else if (body.action === 'regenerate') {
            const last = messages[messages.length - 1];
            // A narrator note is not a reply to rewrite, matching the group route.
            if (last && !last.is_user && !last.is_system && last.extra?.type !== 'narrator') {
                regenerateIndex = messages.length - 1;
                originalAssistant = last;
                messages = messages.slice(0, -1);
            }
        } else if (body.action === 'continue') {
            const last = messages[messages.length - 1];
            if (!last || last.is_user || last.is_system || last.extra?.type === 'narrator') {
                throw badRequest('There is no assistant reply to continue');
            }
            continueIndex = messages.length - 1;
            originalAssistant = last;
        }
        // `trigger` asks for a fresh reply with no user message, as SillyTavern's
        // `/trigger` does; there is nothing to change in the history.

        const generationType: GenerationType =
            body.action === 'send' || body.action === 'trigger' ? 'normal' : body.action;

        // Summary memory is read after the action so a regenerated reply no
        // longer contributes its own summary, and the user's new message is
        // part of the transcript in the same way a normal send sees it.
        const latestSummary = getLatestSummary(messages);
        const macroContext = createMacroContext(character, persona, undefined, latestSummary?.value);
        const substitute = (text: string, escapeValues: boolean) =>
            substituteMacros(text, macroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});
        const memoryInjection = buildMemoryInjection(settings.memory, latestSummary, macroContext);
        const memoryText = formatMemoryText(settings.memory, latestSummary, macroContext);

        // The card's own in-chat aside, SillyTavern's
        // `data.extensions.depth_prompt`. It is injected at the depth the card
        // asks for, with the card as `{{char}}`.
        const ownDepthPrompt = readCardDepthPrompt(character.card.extensions);
        const cardDepthPrompts: GroupDepthPrompt[] = ownDepthPrompt
            ? [
                  {
                      fileName: character.fileName,
                      charName: character.name,
                      text: substituteMacros(ownDepthPrompt.prompt, macroContext),
                      depth: ownDepthPrompt.depth,
                      role: ownDepthPrompt.role,
                  },
              ]
            : [];

        // The scanner needs the whole non-system conversation as its timed
        // effect clock, so it runs before the prompt is trimmed to context.
        const worldInfoTurn = await scanWorldInfoForTurn({
            character,
            messages,
            persona: persona,
            config: settings.worldInfo,
            authorNote: settings.authorNote,
            contextSize: preset.generation.contextSize,
            trigger: generationType,
            metadata: chat.header.chat_metadata,
            countTokens: tokenCounter.count,
            regexScripts,
            substitute,
            ...(latestSummary ? { summary: latestSummary.value } : {}),
            ...(memoryText && settings.memory.scan ? { extraScanText: memoryText } : {}),
        });

        await patchChatMetadata(character, body.chatId, {
            timedWorldInfo: chat.header.chat_metadata.timedWorldInfo,
        });

        const assembled = buildPrompt({
            character,
            messages,
            persona: persona,
            settings: preset.generation,
            promptSettings: preset.promptSettings,
            formats: preset.formats,
            newChatPrompt: preset.newChatPrompt,
            newExampleChatPrompt: preset.newExampleChatPrompt,
            continueNudgePrompt: preset.continueNudgePrompt,
            impersonationPrompt: preset.impersonationPrompt,
            squashSystemMessages: preset.squashSystemMessages,
            worldInfo: worldInfoTurn.prompt,
            generationType,
            countTokens: tokenCounter.count,
            regexScripts,
            substitute,
            cardDepthPrompts,
            ...(latestSummary ? { summaryText: latestSummary.value } : {}),
            ...(memoryInjection ? { summaryInjection: memoryInjection } : {}),
        });
        const prompt = assembled.messages;

        if (prompt.length === 0) {
            throw badRequest('The assembled prompt is empty. Check the enabled prompt entries.');
        }

        const generationId = randomUUID();
        const startedAt = new Date().toISOString();
        const context: PersistContext = {
            character,
            chatId: body.chatId,
            action: body.action,
            regenerateIndex,
            continueIndex,
            originalAssistant,
            providerKind: provider.kind,
            providerModel: resolved.model,
            startedAt,
            regexScripts,
            substitute,
        };

        // Impersonation produces a draft for the composer, not a message: the
        // text goes back over SSE and only the user's own Send stores it. The
        // reply is returned in the same shape a saved message would have, so
        // the client has one thing to read, but nothing is written and nothing
        // should summarise it.
        const draftOnly = body.action === 'impersonate';
        const personaName = persona.name;
        const prefill = impersonationPrefill(personaName);

        await runGenerationStream({
            reply,
            provider,
            model: resolved.model,
            apiKey,
            prompt,
            temperature: preset.generation.temperature,
            topP: preset.generation.topP,
            maxTokens: preset.generation.maxTokens,
            generationId,
            // Impersonation primes an Anthropic assistant turn with the
            // persona's name, which is what SillyTavern sends as
            // `assistant_impersonation`. Anthropic requires the answer to
            // continue from that turn, so the name is removed again before the
            // draft reaches the composer.
            ...(draftOnly ? { assistantPrefill: prefill } : {}),
            persist: (text, reasoning, stopped) =>
                draftOnly
                    ? Promise.resolve({
                          name: personaName,
                          is_user: true,
                          send_date: new Date().toISOString(),
                          mes: strippedDraft(text, prefill),
                          extra: {},
                      } satisfies ChatMessage)
                    : persistMessage(context, text, reasoning, stopped),
        });

        if (draftOnly) {
            return;
        }

        // Fire-and-forget: a due summary never delays the reply. The memory
        // service reads the chat again, so only a persisted reply counts.
        void maybeSummarizeAfterTurn({
            key: `character:${character.id}:${body.chatId}`,
            character,
            persona,
            read: async () => {
                const fresh = await readChat(character, body.chatId);
                if (!fresh) {
                    return null;
                }
                return {
                    messages: fresh.messages,
                    update: (index, patch) => updateMessage(character, body.chatId, index, patch),
                };
            },
        });
    });

    app.post('/api/generate/:id/stop', async (request) => {
        const { id } = stopParamsSchema.parse(request.params);
        const controller = activeGenerations.get(id);
        if (!controller) {
            return { ok: false };
        }
        controller.abort();
        return { ok: true };
    });
}
