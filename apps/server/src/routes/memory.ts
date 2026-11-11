import { type CharacterDetail, getLatestSummary, resolvePersona, type SummaryRecord } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { resolveMembers } from '../group/members.js';
import { lastAssistantSpeaker } from '../group/selection.js';
import { badRequest, notFound } from '../http/errors.js';
import { type MemoryChatSource, type MemoryTarget, summarizeNow } from '../memory/service.js';
import { chatPersonaId, readChat, updateMessage } from '../storage/chats.js';
import { getGroup, readGroupChat, updateGroupMessage } from '../storage/groups.js';
import { getSettings } from '../storage/settings.js';
import { requireCharacter } from './helpers.js';

const chatParamsSchema = z.object({
    characterId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(300),
});

const groupChatParamsSchema = z.object({
    groupId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(300),
});

const memoryBodySchema = z.object({
    text: z.string().trim().min(1).max(20000),
});

/** Build the memory target for a single-character chat. */
async function characterTarget(character: CharacterDetail, chatId: string): Promise<MemoryTarget> {
    const settings = await getSettings();
    const chat = await readChat(character, chatId);
    if (!chat) {
        throw notFound('Chat not found');
    }

    return {
        key: `character:${character.id}:${chatId}`,
        character,
        persona: resolvePersona(settings, chatPersonaId(chat)),
        read: async () => {
            const fresh = await readChat(character, chatId);
            if (!fresh) {
                return null;
            }
            return {
                messages: fresh.messages,
                update: (index, patch) => updateMessage(character, chatId, index, patch),
            };
        },
    };
}

/** Build the memory target for a group chat, using its latest speaker's card. */
async function groupTarget(groupId: string, chatId: string): Promise<MemoryTarget> {
    const found = await getGroup(groupId);
    if (!found) {
        throw notFound('Group not found');
    }
    const chat = await readGroupChat(found.group, chatId);
    if (!chat) {
        throw notFound('Chat not found');
    }

    const members = await resolveMembers(found.group);
    if (members.length === 0) {
        throw badRequest('This group has no members with a character card');
    }
    const lastAvatar = lastAssistantSpeaker(chat.messages);
    const current = lastAvatar ? members.find((member) => member.speaker.fileName === lastAvatar) : undefined;
    const character = current?.character ?? (members[0] as (typeof members)[number]).character;
    const settings = await getSettings();

    return {
        key: `group:${found.group.id}:${chatId}`,
        character,
        persona: resolvePersona(settings, chatPersonaId(chat)),
        group: {
            members: members.map((member) => member.speaker.name),
            enabled: members.filter((member) => member.enabled).map((member) => member.speaker.name),
        },
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
    };
}

async function saveMemory(source: MemoryChatSource, text: string): Promise<SummaryRecord> {
    const value = text.trim();
    if (!value) {
        throw badRequest('The summary is empty');
    }
    if (source.messages.length === 0) {
        throw badRequest('This chat has no messages to attach a summary to');
    }

    // Update the existing entry when there is one; otherwise attach the
    // summary to the message before the newest, as SillyTavern does.
    const latest = getLatestSummary(source.messages);
    const index = latest ? latest.index : Math.max(0, source.messages.length - 2);
    await source.update(index, { extra: { memory: value } });
    return { value, index };
}

async function clearMemory(target: MemoryTarget): Promise<SummaryRecord | null> {
    const source = await target.read();
    if (!source) {
        throw notFound('Chat not found');
    }
    const latest = getLatestSummary(source.messages);
    if (!latest) {
        return null;
    }

    await source.update(latest.index, { extraDelete: ['memory'] });

    // SillyTavern's Restore falls back to an older summary when one exists.
    const fresh = await target.read();
    const remaining = fresh ? getLatestSummary(fresh.messages) : null;
    return remaining ? { value: remaining.value, index: remaining.index } : null;
}

export async function registerMemoryRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/chats/:characterId/:chatId/summarize', async (request) => {
        const { characterId, chatId } = chatParamsSchema.parse(request.params);
        const character = await requireCharacter(characterId);
        return summarizeNow(await characterTarget(character, chatId));
    });

    app.put('/api/chats/:characterId/:chatId/memory', async (request) => {
        const { characterId, chatId } = chatParamsSchema.parse(request.params);
        const body = memoryBodySchema.parse(request.body ?? {});
        const character = await requireCharacter(characterId);
        const target = await characterTarget(character, chatId);
        const source = await target.read();
        if (!source) {
            throw notFound('Chat not found');
        }
        return { summary: await saveMemory(source, body.text) };
    });

    app.delete('/api/chats/:characterId/:chatId/memory', async (request) => {
        const { characterId, chatId } = chatParamsSchema.parse(request.params);
        const character = await requireCharacter(characterId);
        return { summary: await clearMemory(await characterTarget(character, chatId)) };
    });

    app.post('/api/groups/:groupId/chats/:chatId/summarize', async (request) => {
        const { groupId, chatId } = groupChatParamsSchema.parse(request.params);
        return summarizeNow(await groupTarget(groupId, chatId));
    });

    app.put('/api/groups/:groupId/chats/:chatId/memory', async (request) => {
        const { groupId, chatId } = groupChatParamsSchema.parse(request.params);
        const body = memoryBodySchema.parse(request.body ?? {});
        const target = await groupTarget(groupId, chatId);
        const source = await target.read();
        if (!source) {
            throw notFound('Chat not found');
        }
        return { summary: await saveMemory(source, body.text) };
    });

    app.delete('/api/groups/:groupId/chats/:chatId/memory', async (request) => {
        const { groupId, chatId } = groupChatParamsSchema.parse(request.params);
        return { summary: await clearMemory(await groupTarget(groupId, chatId)) };
    });
}
