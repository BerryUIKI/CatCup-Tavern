import { type CharacterDetail, isRecord, type QuickReplySetView, resolvePersona } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { resolveMembers } from '../group/members.js';
import { lastAssistantSpeaker } from '../group/selection.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { executeQuickReply, type QuickReplyTarget } from '../quickreplies/execute.js';
import { appendMessage, chatPersonaId, readChat } from '../storage/chats.js';
import { appendGroupMessage, getGroup, readGroupChat } from '../storage/groups.js';
import {
    createQuickReplySet,
    deleteQuickReplySet,
    importQuickReplySet,
    listQuickReplySets,
    type QuickReplySetWriteResult,
    readQuickReplySet,
    saveQuickReplySet,
} from '../storage/quickReplies.js';
import { getSettings, removeQuickReplySetReference, renameQuickReplySetReference } from '../storage/settings.js';
import { requireCharacter } from './helpers.js';

const idParams = z.object({
    id: z
        .string()
        .min(1)
        .max(200)
        .refine(
            (value) => value !== '.' && value !== '..' && !value.includes('\0') && !/[\\/]/.test(value),
            'Invalid quick reply set id',
        ),
});

const chatParamsSchema = z.object({
    characterId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(300),
});

const groupChatParamsSchema = z.object({
    groupId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(300),
});

const createSchema = z.object({
    name: z.string().trim().min(1).max(120),
    /** `shared` creates the set reusable in every profile. */
    scope: z.enum(['profile', 'shared']).default('profile'),
});

const importSchema = z.object({
    data: z.unknown(),
    name: z.string().trim().min(1).max(120).optional(),
    scope: z.enum(['profile', 'shared']).default('profile'),
});

const executeSchema = z.object({
    setId: z.string().min(1).max(200),
    qrId: z.number().int().min(0),
});

function unwrap(result: QuickReplySetWriteResult): QuickReplySetView {
    if (result.status === 'missing') {
        throw notFound('Quick reply set not found');
    }
    if (result.status === 'name-taken') {
        throw conflict('A quick reply set with that name already exists');
    }
    if (result.status === 'invalid') {
        throw badRequest(result.message);
    }
    return result.set;
}

/** The API views carry the file id; it is not part of the stored set body. */
function stripId(raw: unknown): unknown {
    if (!isRecord(raw)) {
        return raw;
    }
    const { id: _id, ...body } = raw;
    return body;
}

/** Target for quick reply execution in a single-character chat. */
async function characterTarget(character: CharacterDetail, chatId: string): Promise<QuickReplyTarget> {
    const chat = await readChat(character, chatId);
    if (!chat) {
        throw notFound('Chat not found');
    }
    const settings = await getSettings();

    return {
        kind: 'character',
        character,
        persona: resolvePersona(settings, chatPersonaId(chat)),
        metadata: chat.header.chat_metadata,
        read: async () => {
            const fresh = await readChat(character, chatId);
            return fresh ? fresh.messages : null;
        },
        append: (message) => appendMessage(character, chatId, message),
    };
}

/** Target for quick reply execution in a group chat, using its latest speaker's card. */
async function groupTarget(groupId: string, chatId: string): Promise<QuickReplyTarget> {
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
        kind: 'group',
        character,
        persona: resolvePersona(settings, chatPersonaId(chat)),
        group: {
            members: members.map((member) => member.speaker.name),
            enabled: members.filter((member) => member.enabled).map((member) => member.speaker.name),
        },
        speakers: members.map((member) => ({ name: member.speaker.name, fileName: member.speaker.fileName })),
        metadata: chat.header.chat_metadata,
        read: async () => {
            const fresh = await readGroupChat(found.group, chatId);
            return fresh ? fresh.messages : null;
        },
        append: (message) => appendGroupMessage(found.group, chatId, message),
    };
}

export async function registerQuickReplyRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/quick-replies', async () => ({ sets: await listQuickReplySets() }));

    app.post('/api/quick-replies', async (request, reply) => {
        const body = createSchema.parse(request.body ?? {});
        reply.code(201);
        return { set: unwrap(await createQuickReplySet(body.name, body.scope)) };
    });

    app.post('/api/quick-replies/import', async (request, reply) => {
        const body = importSchema.parse(request.body ?? {});
        reply.code(201);
        return { set: unwrap(await importQuickReplySet(body.data, body.name, body.scope)) };
    });

    app.get('/api/quick-replies/:id/export', async (request, reply) => {
        const { id } = idParams.parse(request.params);
        const set = await readQuickReplySet(id);
        if (!set) {
            throw notFound('Quick reply set not found');
        }
        const { id: _id, ...body } = set;
        reply
            .header('Content-Type', 'application/json; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${encodeURIComponent(set.name)}.json"`);
        return `${JSON.stringify(body, null, 4)}\n`;
    });

    app.put('/api/quick-replies/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const result = await saveQuickReplySet(id, stripId(request.body ?? {}));
        const set = unwrap(result);
        if (result.status === 'ok' && result.renamedFrom) {
            await renameQuickReplySetReference(result.renamedFrom, set.name);
        }
        return {
            set,
            ...(result.status === 'ok' && result.renamedFrom ? { renamedFrom: result.renamedFrom } : {}),
        };
    });

    app.delete('/api/quick-replies/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const removed = await deleteQuickReplySet(id);
        if (!removed) {
            throw notFound('Quick reply set not found');
        }
        await removeQuickReplySetReference(removed.name);
        return { ok: true };
    });

    app.post('/api/chats/:characterId/:chatId/quick-replies/execute', async (request) => {
        const { characterId, chatId } = chatParamsSchema.parse(request.params);
        const body = executeSchema.parse(request.body ?? {});
        const character = await requireCharacter(characterId);
        return executeQuickReply(await characterTarget(character, chatId), body.setId, body.qrId);
    });

    app.post('/api/groups/:groupId/chats/:chatId/quick-replies/execute', async (request) => {
        const { groupId, chatId } = groupChatParamsSchema.parse(request.params);
        const body = executeSchema.parse(request.body ?? {});
        return executeQuickReply(await groupTarget(groupId, chatId), body.setId, body.qrId);
    });
}
