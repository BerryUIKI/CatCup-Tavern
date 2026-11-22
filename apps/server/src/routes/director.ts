import { directorConfigPatchSchema, directorConfigSchema, directorOf } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { directorRefusal } from '../director/config.js';
import { resolveMembers } from '../group/members.js';
import { badRequest, notFound } from '../http/errors.js';
import { chatPersonaId, patchChatMetadata, readChat } from '../storage/chats.js';
import { getGroup, patchGroupChatMetadata, readGroupChat } from '../storage/groups.js';
import { requireCharacter } from './helpers.js';

/**
 * The director, per chat.
 *
 * The config lives in `chat_metadata.director`, so it travels with the chat
 * file and SillyTavern ignores a key it does not know. This route reads and
 * writes it, and is the one place the single-chat refusal is enforced — before
 * a save, so a person is corrected while they are still looking at the form
 * rather than at the next reply.
 */

const paramsSchema = z.object({
    characterId: z.string().trim().min(1).max(200),
    chatId: z.string().trim().min(1).max(300),
});

const updateSchema = z.object({
    director: directorConfigPatchSchema,
});

export async function registerDirectorRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/chats/:characterId/:chatId/director', async (request) => {
        const { characterId, chatId } = paramsSchema.parse(request.params);
        const character = await requireCharacter(characterId);
        const chat = await readChat(character, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }

        return {
            // `directorOf` reports `null` for an absent or disabled config, so
            // this answers the same thing for a chat that never had one and a
            // chat whose director is switched off — two states the form treats
            // identically.
            director: directorOf(chat.header.chat_metadata) ?? directorConfigSchema.parse({}),
            enabled: Boolean(directorOf(chat.header.chat_metadata)),
        };
    });

    app.patch('/api/chats/:characterId/:chatId/director', async (request) => {
        const { characterId, chatId } = paramsSchema.parse(request.params);
        const character = await requireCharacter(characterId);
        const chat = await readChat(character, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }

        const { director: patch } = updateSchema.parse(request.body ?? {});

        // Merge onto whatever is stored rather than replacing it, so a form that
        // sends only what changed cannot silently reset the rest.
        const stored = directorConfigSchema.parse(chat.header.chat_metadata.director ?? {});
        const next = directorConfigSchema.parse({ ...stored, ...patch });

        const refusal = directorRefusal({ director: next, character, isGroup: false });
        if (refusal) {
            throw badRequest(refusal, 'DIRECTOR_SELF_PLAY');
        }

        await patchChatMetadata(character, chatId, {
            ...chat.header.chat_metadata,
            director: next,
        });

        return { director: next, personaId: chatPersonaId(chat) };
    });

    /**
     * Who can be played in this chat.
     *
     * A single chat offers its own card — which the PATCH above then refuses if
     * chosen, because a single chat playing its own character contradicts the
     * prompt. Listing it anyway is deliberate: the refusal's message points at
     * a group, and hiding the option would leave the person wondering why it is
     * missing.
     */
    app.get('/api/chats/:characterId/:chatId/director/cast', async (request) => {
        const { characterId, chatId } = paramsSchema.parse(request.params);
        const character = await requireCharacter(characterId);
        const chat = await readChat(character, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }

        return { cast: [{ id: character.id, name: character.name }], isGroup: false };
    });
}

const groupParamsSchema = z.object({
    groupId: z.string().trim().min(1).max(200),
    chatId: z.string().trim().min(1).max(300),
});

/**
 * The director on a group chat.
 *
 * Separate route rather than one that branches on which kind of chat it is: a
 * group chat is addressed by group id, not by character and chat, and the
 * refusal that governs a single chat does not apply — a group has no
 * contradiction between "you are {{char}}" and "never write this member",
 * because the speaker is chosen per turn and a played member is muted for the
 * whole chat.
 */
export async function registerGroupDirectorRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/groups/:groupId/chats/:chatId/director', async (request) => {
        const { groupId, chatId } = groupParamsSchema.parse(request.params);
        const found = await getGroup(groupId);
        if (!found) {
            throw notFound('Group not found');
        }
        const chat = await readGroupChat(found.group, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }

        return {
            director: directorOf(chat.header.chat_metadata) ?? directorConfigSchema.parse({}),
            enabled: Boolean(directorOf(chat.header.chat_metadata)),
        };
    });

    app.patch('/api/groups/:groupId/chats/:chatId/director', async (request) => {
        const { groupId, chatId } = groupParamsSchema.parse(request.params);
        const found = await getGroup(groupId);
        if (!found) {
            throw notFound('Group not found');
        }
        const chat = await readGroupChat(found.group, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }

        const { director: patch } = updateSchema.parse(request.body ?? {});
        const stored = directorConfigSchema.parse(chat.header.chat_metadata.director ?? {});
        const next = directorConfigSchema.parse({ ...stored, ...patch });

        // A played member naming a card that is not in this group is accepted,
        // not refused: the group's cast changes, and a card temporarily out
        // should not block a save that touches something else. The block simply
        // renders nobody for that entry.
        await patchGroupChatMetadata(found.group, chatId, { director: next });

        return { director: next };
    });

    /** The group's members, so a person can choose who they play. */
    app.get('/api/groups/:groupId/chats/:chatId/director/cast', async (request) => {
        const { groupId, chatId } = groupParamsSchema.parse(request.params);
        const found = await getGroup(groupId);
        if (!found) {
            throw notFound('Group not found');
        }
        const chat = await readGroupChat(found.group, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }

        const members = await resolveMembers(found.group).catch(() => []);
        return {
            cast: members.map((member) => ({ id: member.speaker.fileName, name: member.speaker.name })),
            isGroup: true,
        };
    });
}
