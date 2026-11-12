import { randomUUID } from 'node:crypto';

import {
    applyRegexScripts,
    type CharacterDetail,
    type ChatMessage,
    type GenerationSpeaker,
    type Group,
    getLatestSummary,
    REGEX_PLACEMENT,
    type RegexScript,
    resolvePersona,
    sanitizeRegexMacro,
} from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { runGenerationStream } from '../generation/stream.js';
import { type ResolvedMember, resolveMembers } from '../group/members.js';
import { cleanGroupReply, stForceAvatarUrl } from '../group/output.js';
import { findCurrentSpeaker, isNarratorMessage, lastAssistantSpeaker, selectGroupSpeaker } from '../group/selection.js';
import { badRequest, notFound } from '../http/errors.js';
import { buildMemoryInjection, formatMemoryText } from '../memory/inject.js';
import { maybeSummarizeAfterTurn } from '../memory/service.js';
import { buildPrompt } from '../prompt/builder.js';
import type { GenerationType } from '../prompt/definitions.js';
import { substituteMacros } from '../prompt/macros.js';
import { resolvePreset } from '../prompt/preset.js';
import { createTokenCounter } from '../prompt/tokenizer.js';
import { createMacroContext, type GroupMacroMembers, scanWorldInfoForTurn } from '../prompt/worldInfoTurn.js';
import { getCharacter } from '../storage/characters.js';
import { chatPersonaId } from '../storage/chats.js';
import {
    appendGroupMessage,
    getGroup,
    patchGroupChatMetadata,
    readGroupChat,
    updateGroupMessage,
} from '../storage/groups.js';
import { readPresetBody } from '../storage/presets.js';
import { listRegexScripts } from '../storage/regex.js';
import { getActiveProvider, getProviderSecret, getSettings } from '../storage/settings.js';

const groupParamsSchema = z.object({
    groupId: z.string().min(1).max(200),
});

const groupChatParamsSchema = groupParamsSchema.extend({
    chatId: z.string().min(1).max(300),
});

const generateSchema = z.object({
    action: z.enum(['send', 'regenerate', 'continue']),
    message: z.string().max(200000).optional(),
    speaker: z.string().min(1).max(300).optional(),
});

function toGenerationSpeaker(character: CharacterDetail): GenerationSpeaker {
    return {
        id: character.id,
        fileName: character.fileName,
        name: character.name,
        avatarUrl: character.avatarUrl,
    };
}

function groupNewChatPrompt(): string {
    // ST's default `new_group_chat_prompt`; `{{group}}` expands to every member.
    return '[Start a new group chat. Group members: {{group}}]';
}

interface PersistContext {
    group: Group;
    chatId: string;
    speaker: CharacterDetail;
    action: 'send' | 'regenerate' | 'continue';
    regenerateIndex: number | null;
    continueIndex: number | null;
    originalAssistant: ChatMessage | null;
    providerKind: string;
    providerModel: string;
    startedAt: string;
    regexScripts: readonly RegexScript[];
    substitute: (text: string, escapeValues: boolean) => string;
    /** Names of the other members, for trimming a reply that speaks for them. */
    otherNames: string[];
    /** The batch id SillyTavern uses to group one turn's replies. */
    batchId: number;
}

async function saveGroupSwipe(
    context: PersistContext,
    text: string,
    extra: Record<string, unknown>,
): Promise<ChatMessage> {
    if (context.regenerateIndex === null) {
        throw new Error('No message to regenerate');
    }

    const fresh = await readGroupChat(context.group, context.chatId);
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

    // A summary anchored to this reply no longer describes the stored text.
    return updateGroupMessage(context.group, context.chatId, context.regenerateIndex, {
        name: context.speaker.name,
        original_avatar: context.speaker.fileName,
        force_avatar: stForceAvatarUrl(context.speaker.fileName),
        mes: text,
        send_date: new Date().toISOString(),
        extra: {
            ...(existing.extra ?? {}),
            ...extra,
            swipes,
            swipe_id: swipes.length - 1,
            swipe_info: swipeInfo,
        },
        extraDelete: ['memory'],
    });
}

async function persistGroupReply(
    context: PersistContext,
    text: string,
    reasoning: string,
    stopped: boolean,
): Promise<ChatMessage> {
    // Trim a reply that starts speaking for another member before scripts run,
    // as SillyTavern's `cleanGroupMessage` does.
    const cleaned = cleanGroupReply(text, context.speaker.name, context.otherNames);
    const storedText = applyRegexScripts(context.regexScripts, cleaned, REGEX_PLACEMENT.AI_OUTPUT, {
        substitute: context.substitute,
    });
    if (!storedText.trim()) {
        throw new Error('The model reply contained nothing for this speaker; nothing was stored');
    }
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
        return saveGroupSwipe(context, storedText, extra);
    }

    if (context.action === 'continue' && context.continueIndex !== null && context.originalAssistant) {
        const mergedReasoning = [context.originalAssistant.extra?.reasoning, storedReasoning]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .join('\n\n');
        return updateGroupMessage(context.group, context.chatId, context.continueIndex, {
            mes: `${context.originalAssistant.mes}${storedText}`,
            extra: {
                ...extra,
                ...(mergedReasoning ? { reasoning: mergedReasoning } : {}),
            },
            // The message grew, so a summary anchored to it is out of date.
            extraDelete: ['memory'],
        });
    }

    return appendGroupMessage(context.group, context.chatId, {
        name: context.speaker.name,
        is_user: false,
        send_date: new Date().toISOString(),
        mes: storedText,
        original_avatar: context.speaker.fileName,
        force_avatar: stForceAvatarUrl(context.speaker.fileName),
        extra: { ...extra, gen_id: context.batchId },
    });
}

export async function registerGroupGenerateRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/groups/:groupId/chats/:chatId/generate', async (request, reply) => {
        const { groupId, chatId } = groupChatParamsSchema.parse(request.params);
        const body = generateSchema.parse(request.body ?? {});

        const found = await getGroup(groupId);
        if (!found) {
            throw notFound('Group not found');
        }
        const chat = await readGroupChat(found.group, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }

        const resolvedMembers = await resolveMembers(found.group);
        const members = resolvedMembers.filter((member) => member.enabled);
        if (members.length === 0) {
            throw badRequest('This group has no enabled members with a character card');
        }
        const groupMacros: GroupMacroMembers = {
            members: resolvedMembers.map((member) => member.speaker.name),
            enabled: members.map((member) => member.speaker.name),
        };

        if (body.action === 'send' && !body.message?.trim()) {
            throw badRequest('Message is empty');
        }

        const lastMessage = chat.messages[chat.messages.length - 1];
        const lastIsReply =
            lastMessage !== undefined &&
            !lastMessage.is_user &&
            !lastMessage.is_system &&
            !isNarratorMessage(lastMessage);
        const regeneratingReply = body.action === 'regenerate' && lastIsReply;
        if (body.action === 'continue' && !lastIsReply) {
            throw badRequest('There is no group reply to continue');
        }

        // Send uses the activation strategy over enabled members. Regenerate
        // and continue stay on the member who wrote the reply, even when that
        // member is muted; a card that is gone is refused instead of silently
        // handing the message to someone else. Regenerate after a failed or
        // deleted reply has nothing to keep, so it runs activation like a send.
        let chosen: ResolvedMember;
        if (body.action === 'send' || (body.action === 'regenerate' && !lastIsReply)) {
            const selection = selectGroupSpeaker({
                group: found.group,
                members: members.map((member) => member.speaker),
                messages: chat.messages,
                action: 'send',
                ...(body.action === 'send' && body.message !== undefined ? { message: body.message } : {}),
                ...(body.action === 'regenerate' && lastMessage ? { message: lastMessage.mes } : {}),
                ...(body.action === 'send' && body.speaker !== undefined ? { speaker: body.speaker } : {}),
            });
            if (!selection) {
                throw badRequest('No enabled member can reply');
            }
            if (body.action === 'send' && body.speaker !== undefined && selection.reason !== 'explicit') {
                throw badRequest('The selected member is not in this group');
            }
            const selected = members.find((member) => member.speaker.fileName === selection.speaker.fileName);
            if (!selected) {
                throw badRequest('The selected member is not in this group');
            }
            chosen = selected;
        } else {
            // A message from a member who was removed from the group can still
            // be swiped or continued while the card exists, as ST's
            // `activateSwipe` does.
            const lastAvatar = lastAssistantSpeaker(chat.messages);
            const extraCard =
                lastAvatar && !resolvedMembers.some((member) => member.speaker.fileName === lastAvatar)
                    ? await getCharacter(lastAvatar).catch(() => null)
                    : null;
            const currentCandidates = extraCard
                ? [
                      ...resolvedMembers,
                      {
                          speaker: { id: extraCard.id, fileName: lastAvatar as string, name: extraCard.name },
                          character: extraCard,
                          enabled: false,
                      },
                  ]
                : resolvedMembers;
            const current = findCurrentSpeaker(currentCandidates, chat.messages);
            if (current && 'missing' in current) {
                throw badRequest('The member who wrote this reply is no longer in the group');
            }
            if (current) {
                chosen = current.speaker;
            } else {
                const selection = selectGroupSpeaker({
                    group: found.group,
                    members: members.map((member) => member.speaker),
                    messages: chat.messages,
                    action: body.action,
                });
                if (!selection) {
                    throw badRequest('No enabled member can reply');
                }
                const selected = members.find((member) => member.speaker.fileName === selection.speaker.fileName);
                if (!selected) {
                    throw badRequest('The selected member is not in this group');
                }
                chosen = selected;
            }
        }
        const speaker = chosen.character;

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

        const persona = resolvePersona(settings, chatPersonaId(chat));
        const regexScripts = await listRegexScripts();
        const baseMacroContext = createMacroContext(
            speaker,
            persona,
            groupMacros,
            getLatestSummary(chat.messages)?.value,
        );
        const baseSubstitute = (text: string, escapeValues: boolean) =>
            substituteMacros(text, baseMacroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});

        let messages = chat.messages;
        let regenerateIndex: number | null = null;
        let continueIndex: number | null = null;
        let originalAssistant: ChatMessage | null = null;

        if (body.action === 'send') {
            const text = body.message?.trim();
            if (!text) {
                throw badRequest('Message is empty');
            }
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
            await appendGroupMessage(found.group, chatId, userMessage);
            messages = [...messages, userMessage];
        } else if (body.action === 'regenerate') {
            if (regeneratingReply) {
                const last = messages[messages.length - 1];
                if (last) {
                    regenerateIndex = messages.length - 1;
                    originalAssistant = last;
                    messages = messages.slice(0, -1);
                }
            }
            // With nothing to replace, the user message stays in history and a
            // new reply is appended, mirroring the single-character route.
        } else {
            continueIndex = messages.length - 1;
            originalAssistant = messages[messages.length - 1] ?? null;
        }

        const generationType: GenerationType =
            body.action === 'send' || (body.action === 'regenerate' && !regeneratingReply) ? 'normal' : body.action;

        const latestSummary = getLatestSummary(messages);
        const macroContext = createMacroContext(speaker, persona, groupMacros, latestSummary?.value);
        const substitute = (text: string, escapeValues: boolean) =>
            substituteMacros(text, macroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});
        const memoryInjection = buildMemoryInjection(settings.memory, latestSummary, macroContext);
        const memoryText = formatMemoryText(settings.memory, latestSummary, macroContext);

        const activePreset = settings.activePresetId ? await readPresetBody(settings.activePresetId) : null;
        const preset = resolvePreset(activePreset, settings.generation);

        const worldInfoTurn = await scanWorldInfoForTurn({
            character: speaker,
            messages,
            persona,
            config: settings.worldInfo,
            authorNote: settings.authorNote,
            contextSize: preset.generation.contextSize,
            trigger: generationType,
            metadata: chat.header.chat_metadata,
            countTokens: tokenCounter.count,
            regexScripts,
            substitute,
            group: groupMacros,
            ...(latestSummary ? { summary: latestSummary.value } : {}),
            ...(memoryText && settings.memory.scan ? { extraScanText: memoryText } : {}),
        });

        await patchGroupChatMetadata(found.group, chatId, {
            timedWorldInfo: chat.header.chat_metadata.timedWorldInfo,
        });

        const assembled = buildPrompt({
            character: speaker,
            messages,
            persona,
            settings: preset.generation,
            promptSettings: preset.promptSettings,
            formats: preset.formats,
            newChatPrompt: groupNewChatPrompt(),
            newExampleChatPrompt: preset.newExampleChatPrompt,
            continueNudgePrompt: preset.continueNudgePrompt,
            squashSystemMessages: preset.squashSystemMessages,
            worldInfo: worldInfoTurn.prompt,
            generationType,
            countTokens: tokenCounter.count,
            regexScripts,
            substitute,
            prefixCharacterNames: true,
            groupNudge: '[Write the next reply only as {{char}}.]',
            group: groupMacros,
            ...(latestSummary ? { summaryText: latestSummary.value } : {}),
            ...(memoryInjection ? { summaryInjection: memoryInjection } : {}),
        });
        const prompt = assembled.messages;

        if (prompt.length === 0) {
            throw badRequest('The assembled prompt is empty. Check the enabled prompt entries.');
        }

        const generationId = randomUUID();
        const batchId = Date.now();
        const context: PersistContext = {
            group: found.group,
            chatId,
            speaker,
            action: body.action,
            regenerateIndex,
            continueIndex,
            originalAssistant,
            providerKind: provider.kind,
            providerModel: provider.model,
            startedAt: new Date().toISOString(),
            regexScripts,
            substitute,
            otherNames: resolvedMembers
                .filter((member) => member.speaker.fileName !== speaker.fileName)
                .map((member) => member.speaker.name),
            batchId,
        };

        await runGenerationStream({
            reply,
            provider,
            apiKey,
            prompt,
            temperature: preset.generation.temperature,
            topP: preset.generation.topP,
            maxTokens: preset.generation.maxTokens,
            generationId,
            speaker: toGenerationSpeaker(speaker),
            persist: (text, reasoning, stopped) => persistGroupReply(context, text, reasoning, stopped),
        });

        // Fire-and-forget: the memory service re-reads the chat, so a summary
        // only runs when the reply actually landed.
        void maybeSummarizeAfterTurn({
            key: `group:${found.group.id}:${chatId}`,
            character: speaker,
            persona,
            group: groupMacros,
            read: async () => {
                const fresh = await readGroupChat(found.group, chatId);
                if (!fresh) {
                    return null;
                }
                return {
                    messages: fresh.messages,
                    update: (index, patch) => updateGroupMessage(found.group, chatId, index, patch),
                };
            },
        });
    });
}
