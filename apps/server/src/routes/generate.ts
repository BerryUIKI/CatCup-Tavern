import { randomUUID } from 'node:crypto';

import {
    applyRegexScripts,
    type CharacterDetail,
    type ChatMessage,
    errorMessage,
    type GenerateAction,
    REGEX_PLACEMENT,
    type RegexScript,
    resolvePersona,
    sanitizeRegexMacro,
    type UsageInfo,
} from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, notFound } from '../http/errors.js';
import { buildPrompt } from '../prompt/builder.js';
import type { GenerationType } from '../prompt/definitions.js';
import { substituteMacros } from '../prompt/macros.js';
import { resolvePreset } from '../prompt/preset.js';
import { createTokenCounter } from '../prompt/tokenizer.js';
import { createMacroContext, scanWorldInfoForTurn } from '../prompt/worldInfoTurn.js';
import { getAdapter } from '../providers/index.js';
import { endSse, initSse, writeSse, writeSseComment } from '../sse.js';
import { appendMessage, chatPersonaId, patchChatMetadata, readChat, updateMessage } from '../storage/chats.js';
import { readPresetBody } from '../storage/presets.js';
import { listRegexScripts } from '../storage/regex.js';
import { getActiveProvider, getProviderSecret, getSettings } from '../storage/settings.js';
import { requireCharacter } from './helpers.js';

const generateSchema = z.object({
    characterId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(300),
    action: z.enum(['send', 'regenerate', 'continue']),
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

async function saveSwipe(context: PersistContext, text: string, extra: Record<string, unknown>): Promise<ChatMessage> {
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

    return updateMessage(context.character, context.chatId, context.regenerateIndex, {
        mes: text,
        send_date: new Date().toISOString(),
        extra: {
            ...existing.extra,
            ...extra,
            swipes,
            swipe_id: swipes.length - 1,
            swipe_info: swipeInfo,
        },
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
        return saveSwipe(context, storedText, extra);
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

export async function registerGenerateRoutes(app: FastifyInstance): Promise<void> {
    const activeGenerations = new Map<string, AbortController>();

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
        if (!provider.model.trim()) {
            throw badRequest('The active provider has no model selected');
        }
        const apiKey = await getProviderSecret(provider.id);
        const tokenCounter = createTokenCounter(provider.kind, provider.model);

        // Scripts and the macro context are resolved once per request; the
        // source transforms below and the prompt transform later share them.
        const persona = resolvePersona(settings, chatPersonaId(chat));
        const regexScripts = await listRegexScripts();
        const macroContext = createMacroContext(character, persona);
        const substitute = (text: string, escapeValues: boolean) =>
            substituteMacros(text, macroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});

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
            // the stored chat and any later export all agree.
            const storedText = applyRegexScripts(regexScripts, text, REGEX_PLACEMENT.USER_INPUT, { substitute });
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
            if (last && !last.is_user && !last.is_system) {
                regenerateIndex = messages.length - 1;
                originalAssistant = last;
                messages = messages.slice(0, -1);
            }
        } else {
            const last = messages[messages.length - 1];
            if (!last || last.is_user || last.is_system) {
                throw badRequest('There is no assistant reply to continue');
            }
            continueIndex = messages.length - 1;
            originalAssistant = last;
        }

        const generationType: GenerationType = body.action === 'send' ? 'normal' : body.action;

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
            squashSystemMessages: preset.squashSystemMessages,
            worldInfo: worldInfoTurn.prompt,
            generationType,
            countTokens: tokenCounter.count,
            regexScripts,
            substitute,
        });
        const prompt = assembled.messages;

        if (prompt.length === 0) {
            throw badRequest('The assembled prompt is empty. Check the enabled prompt entries.');
        }

        const generationId = randomUUID();
        const controller = new AbortController();
        activeGenerations.set(generationId, controller);

        const startedAt = new Date().toISOString();
        const context: PersistContext = {
            character,
            chatId: body.chatId,
            action: body.action,
            regenerateIndex,
            continueIndex,
            originalAssistant,
            providerKind: provider.kind,
            providerModel: provider.model,
            startedAt,
            regexScripts,
            substitute,
        };

        let replyInitialized = false;
        let finished = false;
        let heartbeat: ReturnType<typeof setInterval> | undefined;

        request.raw.on('close', () => {
            if (!finished) {
                controller.abort();
            }
        });

        try {
            initSse(reply);
            replyInitialized = true;
            writeSse(reply, { type: 'start', generationId });
            heartbeat = setInterval(() => writeSseComment(reply, 'ping'), 15000);

            let text = '';
            let reasoning = '';
            let usage: UsageInfo | undefined;

            try {
                const adapter = getAdapter(provider);
                for await (const chunk of adapter.streamChat(provider, apiKey, {
                    model: provider.model,
                    messages: prompt,
                    temperature: preset.generation.temperature,
                    topP: preset.generation.topP,
                    maxTokens: preset.generation.maxTokens,
                    signal: controller.signal,
                })) {
                    if (chunk.type === 'text') {
                        text += chunk.text;
                        writeSse(reply, { type: 'token', text: chunk.text });
                    } else if (chunk.type === 'reasoning') {
                        reasoning += chunk.text;
                        writeSse(reply, { type: 'reasoning', text: chunk.text });
                    } else if (chunk.type === 'usage') {
                        usage = {
                            promptTokens: chunk.promptTokens,
                            completionTokens: chunk.completionTokens,
                        };
                    }
                }

                if (!text.trim()) {
                    throw new Error('The model returned no content');
                }

                const saved = await persistMessage(context, text, reasoning, false);
                writeSse(reply, {
                    type: 'done',
                    message: saved,
                    ...(usage ? { usage } : {}),
                });
            } catch (streamError) {
                const aborted = controller.signal.aborted;

                if (text.trim()) {
                    try {
                        const saved = await persistMessage(context, text, reasoning, true);
                        if (aborted) {
                            writeSse(reply, { type: 'done', message: saved });
                        } else {
                            writeSse(reply, { type: 'error', message: errorMessage(streamError) });
                        }
                    } catch {
                        writeSse(reply, { type: 'error', message: errorMessage(streamError) });
                    }
                } else {
                    writeSse(reply, {
                        type: 'error',
                        message: aborted ? 'Generation stopped' : errorMessage(streamError),
                    });
                }
            }
        } finally {
            finished = true;
            if (heartbeat) {
                clearInterval(heartbeat);
            }
            activeGenerations.delete(generationId);
            if (replyInitialized) {
                endSse(reply);
            }
        }
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
