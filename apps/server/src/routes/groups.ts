import {
    applyRegexScripts,
    type CharacterDetail,
    type ChatMessage,
    type Group,
    type GroupMember,
    type GroupView,
    groupCreateSchema,
    groupPatchSchema,
    regexPlacementForMessage,
    resolvePersona,
    sanitizeRegexMacro,
} from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, notFound } from '../http/errors.js';
import { substituteMacros } from '../prompt/macros.js';
import { createMacroContext } from '../prompt/worldInfoTurn.js';
import { getCharacter } from '../storage/characters.js';
import { chatPersonaId } from '../storage/chats.js';
import {
    createGroup,
    createGroupChat,
    deleteGroup,
    deleteGroupChat,
    deleteGroupMessage,
    type GroupFile,
    getGroup,
    listGroupChats,
    listGroups,
    patchGroupChatMetadata,
    readGroupChat,
    renameGroupChat,
    updateGroup,
    updateGroupMessage,
} from '../storage/groups.js';
import { listRegexScripts } from '../storage/regex.js';
import { getSettings } from '../storage/settings.js';
import { parseMessageIndex } from './helpers.js';

const groupParamsSchema = z.object({
    groupId: z.string().min(1).max(200),
});

const groupChatParamsSchema = groupParamsSchema.extend({
    chatId: z.string().min(1).max(300),
});

const groupMessageParamsSchema = groupChatParamsSchema.extend({
    index: z.string(),
});

const newGroupChatSchema = z.object({
    name: z.string().trim().max(200).optional(),
});

const renameGroupChatSchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    /** Pin the chat to a persona, or `null` to follow the account default. */
    personaId: z.string().min(1).max(200).nullable().optional(),
});

const updateGroupMessageSchema = z
    .object({
        message: z.string().max(200000).optional(),
        swipeId: z.number().int().min(0).optional(),
    })
    .refine((value) => value.message !== undefined || value.swipeId !== undefined, {
        message: 'Nothing to update',
    });

/**
 * Resolve member avatar file names to cards, rejecting unknown ones.
 *
 * The request may use either a character id or its file name; the group always
 * stores the file name, which is the field SillyTavern calls the avatar.
 */
async function resolveMembers(fileNames: string[]): Promise<CharacterDetail[]> {
    const unique = [...new Set(fileNames)];
    const resolved = await Promise.all(unique.map((fileName) => getCharacter(fileName).catch(() => null)));
    const missing = unique.filter((_, index) => resolved[index] === null);
    if (missing.length > 0) {
        throw badRequest(`Unknown character card: ${missing.join(', ')}`);
    }

    const byFileName = new Map<string, CharacterDetail>();
    for (const character of resolved) {
        if (character) {
            byFileName.set(character.fileName, character);
        }
    }
    return [...byFileName.values()];
}

async function toGroupView(file: GroupFile): Promise<GroupView> {
    const memberDetails = await Promise.all(
        file.group.members.map(async (fileName): Promise<GroupMember> => {
            const character = await getCharacter(fileName).catch(() => null);
            if (!character) {
                return {
                    fileName,
                    id: null,
                    name: fileName.replace(/\.(png|json)$/i, ''),
                    avatarUrl: null,
                };
            }
            return { fileName, id: character.id, name: character.name, avatarUrl: character.avatarUrl };
        }),
    );

    return { ...file.group, memberDetails, updatedAt: file.updatedAt };
}

/**
 * The card a group message belongs to.
 *
 * `original_avatar` is the direct link SillyTavern writes; a name match among
 * the members is the fallback for files written before it was set.
 */
async function resolveSpeaker(group: Group, message: ChatMessage): Promise<CharacterDetail | null> {
    const candidates = new Set<string>();
    if (message.original_avatar) {
        candidates.add(message.original_avatar);
    }
    for (const member of group.members) {
        candidates.add(member);
    }

    const resolved: CharacterDetail[] = [];
    for (const fileName of candidates) {
        const character = await getCharacter(fileName).catch(() => null);
        if (character) {
            resolved.push(character);
        }
    }

    return resolved.find((character) => character.name === message.name) ?? resolved[0] ?? null;
}

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/groups', async () => ({
        groups: await Promise.all((await listGroups()).map(toGroupView)),
    }));

    app.post('/api/groups', async (request, reply) => {
        const body = groupCreateSchema.parse(request.body ?? {});
        const characters = await resolveMembers(body.members);

        try {
            const group = await createGroup({
                ...body,
                name: body.name ?? `Group: ${characters.map((character) => character.name).join(', ')}`,
                members: characters.map((character) => character.fileName),
            });
            reply.code(201);
            return { group: await toGroupView(group) };
        } catch (error) {
            throw badRequest(error instanceof Error ? error.message : 'Could not create the group');
        }
    });

    app.get('/api/groups/:groupId', async (request) => {
        const { groupId } = groupParamsSchema.parse(request.params);
        const group = await getGroup(groupId);
        if (!group) {
            throw notFound('Group not found');
        }
        return { group: await toGroupView(group) };
    });

    app.patch('/api/groups/:groupId', async (request) => {
        const { groupId } = groupParamsSchema.parse(request.params);
        const body = groupPatchSchema.parse(request.body ?? {});
        if (Object.keys(body).length === 0) {
            throw badRequest('Nothing to update');
        }

        let members: string[] | undefined;
        if (body.members) {
            const characters = await resolveMembers(body.members);
            members = characters.map((character) => character.fileName);
        }

        try {
            const group = await updateGroup(groupId, { ...body, ...(members ? { members } : {}) });
            if (!group) {
                throw notFound('Group not found');
            }
            return { group: await toGroupView(group) };
        } catch (error) {
            if (error instanceof Error && error.name === 'HttpError') {
                throw error;
            }
            throw badRequest(error instanceof Error ? error.message : 'Could not update the group');
        }
    });

    app.delete('/api/groups/:groupId', async (request) => {
        const { groupId } = groupParamsSchema.parse(request.params);
        const deleted = await deleteGroup(groupId);
        if (!deleted) {
            throw notFound('Group not found');
        }
        return { ok: true };
    });

    app.get('/api/groups/:groupId/chats', async (request) => {
        const { groupId } = groupParamsSchema.parse(request.params);
        const group = await getGroup(groupId);
        if (!group) {
            throw notFound('Group not found');
        }
        return { chats: await listGroupChats(group.group) };
    });

    app.post('/api/groups/:groupId/chats', async (request, reply) => {
        const { groupId } = groupParamsSchema.parse(request.params);
        const body = newGroupChatSchema.parse(request.body ?? {});

        try {
            const created = await createGroupChat(groupId, body.name);
            if (!created) {
                throw notFound('Group not found');
            }
            reply.code(201);
            return { chat: created.chat, group: await toGroupView(created.group) };
        } catch (error) {
            if (error instanceof Error && error.name === 'HttpError') {
                throw error;
            }
            throw badRequest(error instanceof Error ? error.message : 'Could not create the chat');
        }
    });

    app.get('/api/groups/:groupId/chats/:chatId', async (request) => {
        const { groupId, chatId } = groupChatParamsSchema.parse(request.params);
        const found = await getGroup(groupId);
        if (!found) {
            throw notFound('Group not found');
        }
        const chat = await readGroupChat(found.group, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }
        return { chat };
    });

    app.patch('/api/groups/:groupId/chats/:chatId', async (request) => {
        const { groupId, chatId } = groupChatParamsSchema.parse(request.params);
        const body = renameGroupChatSchema.parse(request.body ?? {});
        if (body.name === undefined && body.personaId === undefined) {
            throw badRequest('Nothing to update');
        }

        try {
            const found = await getGroup(groupId);
            if (!found) {
                throw notFound('Group not found');
            }

            let chat = await readGroupChat(found.group, chatId);
            if (!chat) {
                throw notFound('Chat not found');
            }

            if (body.personaId !== undefined) {
                // An `undefined` value survives the merge as a key that
                // `JSON.stringify` drops, which removes the pin.
                await patchGroupChatMetadata(found.group, chatId, {
                    persona_id: body.personaId === null ? undefined : body.personaId,
                });
                chat = (await readGroupChat(found.group, chatId)) ?? chat;
            }

            if (body.name !== undefined) {
                const updated = await renameGroupChat(groupId, chatId, body.name);
                if (!updated) {
                    throw notFound('Chat not found');
                }
                return { chat: updated.chat, group: await toGroupView(updated.group) };
            }

            return { chat, group: await toGroupView(found) };
        } catch (error) {
            if (error instanceof Error && error.name === 'HttpError') {
                throw error;
            }
            throw badRequest(error instanceof Error ? error.message : 'Could not update the chat');
        }
    });

    app.delete('/api/groups/:groupId/chats/:chatId', async (request) => {
        const { groupId, chatId } = groupChatParamsSchema.parse(request.params);

        try {
            const group = await deleteGroupChat(groupId, chatId);
            if (!group) {
                throw notFound('Chat not found');
            }
            return { ok: true, group: await toGroupView(group) };
        } catch (error) {
            if (error instanceof Error && error.name === 'HttpError') {
                throw error;
            }
            throw badRequest(error instanceof Error ? error.message : 'Could not delete the chat');
        }
    });

    app.patch('/api/groups/:groupId/chats/:chatId/messages/:index', async (request) => {
        const params = groupMessageParamsSchema.parse(request.params);
        const body = updateGroupMessageSchema.parse(request.body ?? {});
        const index = parseMessageIndex(params.index);

        const found = await getGroup(params.groupId);
        if (!found) {
            throw notFound('Group not found');
        }
        const chat = await readGroupChat(found.group, params.chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }
        const existing = chat.messages[index];
        if (!existing) {
            throw notFound('Message not found');
        }

        try {
            if (body.swipeId !== undefined) {
                const swipes = Array.isArray(existing.extra?.swipes)
                    ? existing.extra.swipes.filter((swipe): swipe is string => typeof swipe === 'string')
                    : [];
                const swipe = swipes[body.swipeId];
                if (typeof swipe !== 'string') {
                    throw badRequest('Swipe not found');
                }
                return {
                    message: await updateGroupMessage(found.group, params.chatId, index, {
                        mes: swipe,
                        extra: { swipe_id: body.swipeId },
                    }),
                };
            }

            if (body.message !== undefined) {
                // Match single-character chats: an edit re-runs the source
                // scripts that opt into `runOnEdit`, then expands macros.
                const [settings, regexScripts] = await Promise.all([getSettings(), listRegexScripts()]);
                const speaker = await resolveSpeaker(found.group, existing);
                if (!speaker) {
                    throw badRequest('This message does not belong to a member of the group');
                }
                const macroContext = createMacroContext(speaker, resolvePersona(settings, chatPersonaId(chat)));
                const substitute = (text: string, escapeValues: boolean) =>
                    substituteMacros(text, macroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});

                return {
                    message: await updateGroupMessage(found.group, params.chatId, index, {
                        mes: substituteMacros(
                            applyRegexScripts(
                                regexScripts,
                                body.message,
                                regexPlacementForMessage(Boolean(existing.is_user)),
                                { isEdit: true, substitute },
                            ),
                            macroContext,
                        ),
                    }),
                };
            }

            throw badRequest('Nothing to update');
        } catch (error) {
            if (error instanceof Error && error.name === 'HttpError') {
                throw error;
            }
            throw badRequest(error instanceof Error ? error.message : 'Could not update the message');
        }
    });

    app.delete('/api/groups/:groupId/chats/:chatId/messages/:index', async (request) => {
        const params = groupMessageParamsSchema.parse(request.params);
        const index = parseMessageIndex(params.index);

        const found = await getGroup(params.groupId);
        if (!found) {
            throw notFound('Group not found');
        }

        try {
            return { chat: await deleteGroupMessage(found.group, params.chatId, index) };
        } catch (error) {
            throw badRequest(error instanceof Error ? error.message : 'Could not delete the message');
        }
    });
}
