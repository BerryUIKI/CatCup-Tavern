import {
    applyRegexScripts,
    type CharacterDetail,
    type ChatMessage,
    type Group,
    type GroupMember,
    type GroupView,
    groupCreateSchema,
    groupPatchSchema,
    REGEX_PLACEMENT,
    regexPlacementForMessage,
    resolvePersona,
    sanitizeRegexMacro,
} from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { stForceAvatarUrl } from '../group/output.js';
import { badRequest, notFound } from '../http/errors.js';
import { substituteMacros } from '../prompt/macros.js';
import { createMacroContext } from '../prompt/worldInfoTurn.js';
import { getCharacter } from '../storage/characters.js';
import { chatPersonaId, greetingOptions } from '../storage/chats.js';
import {
    appendGroupMessages,
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
    setCurrentGroupChat,
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
    /** Mark this chat as the group's last-opened chat (`chat_id`). */
    current: z.boolean().optional(),
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
 * stores the file name, which is the field SillyTavern calls the avatar. On an
 * edit, members whose card is already gone may stay in the group, so opening
 * and saving a group does not silently drop them.
 */
async function resolveMembers(
    fileNames: string[],
    options: { allowedMissing?: ReadonlySet<string> } = {},
): Promise<{ characters: CharacterDetail[]; members: string[] }> {
    const unique = [...new Set(fileNames)];
    const resolved = await Promise.all(unique.map((fileName) => getCharacter(fileName).catch(() => null)));
    const missing = unique.filter(
        (fileName, index) => resolved[index] === null && !options.allowedMissing?.has(fileName),
    );
    if (missing.length > 0) {
        throw badRequest(`Unknown character card: ${missing.join(', ')}`);
    }

    const characters: CharacterDetail[] = [];
    const members: string[] = [];
    for (let index = 0; index < unique.length; index += 1) {
        const requested = unique[index] as string;
        const character = resolved[index];
        if (character) {
            characters.push(character);
            members.push(character.fileName);
        } else {
            members.push(requested);
        }
    }
    return { characters, members: [...new Set(members)] };
}

/**
 * Turn disabled-member references (id, name or file name) into stored file
 * names. A reference that is not one of the group's members is dropped.
 */
async function canonicalDisabledMembers(entries: readonly string[], members: readonly string[]): Promise<string[]> {
    const canonical: string[] = [];
    for (const entry of entries) {
        const character = await getCharacter(entry).catch(() => null);
        if (character) {
            canonical.push(character.fileName);
        } else if (members.includes(entry)) {
            canonical.push(entry);
        }
    }
    return [...new Set(canonical)];
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
                    description: '',
                    personality: '',
                    scenario: '',
                };
            }
            return {
                fileName,
                id: character.id,
                name: character.name,
                avatarUrl: character.avatarUrl,
                description: character.card.description,
                personality: character.card.personality,
                scenario: character.card.scenario,
            };
        }),
    );

    return { ...file.group, memberDetails, updatedAt: file.updatedAt };
}

/** Names for `{{group}}` and `{{groupNotMuted}}` in a group's macros. */
async function groupMacroNames(group: Group): Promise<{ members: string[]; enabled: string[] }> {
    const members: string[] = [];
    const enabled: string[] = [];
    for (const fileName of group.members) {
        const character = await getCharacter(fileName).catch(() => null);
        if (!character) {
            continue;
        }
        members.push(character.name);
        if (!group.disabled_members.includes(fileName)) {
            enabled.push(character.name);
        }
    }
    return { members, enabled };
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

/**
 * Give a new group chat its opening messages.
 *
 * SillyTavern opens a fresh group chat with one first message per member, in
 * member order. CatCup keeps each member's greetings as swipes on that message,
 * as it does for single-character chats, so the opening can be changed without
 * losing the alternatives.
 */
async function seedGroupGreetings(group: Group, chatId: string): Promise<void> {
    const [settings, regexScripts] = await Promise.all([getSettings(), listRegexScripts()]);
    const persona = resolvePersona(settings);

    const resolved: Array<{ fileName: string; character: CharacterDetail; enabled: boolean }> = [];
    for (const fileName of group.members) {
        const character = await getCharacter(fileName).catch(() => null);
        if (character) {
            resolved.push({
                fileName,
                character,
                enabled: !group.disabled_members.includes(fileName),
            });
        }
    }

    // ST seeds every member's greeting, muted ones included, and exposes the
    // full roster to group macros.
    const groupMacros = {
        members: resolved.map((member) => member.character.name),
        enabled: resolved.filter((member) => member.enabled).map((member) => member.character.name),
    };

    const messages: ChatMessage[] = [];
    for (const [index, { fileName, character }] of resolved.entries()) {
        const macroContext = createMacroContext(character, persona, groupMacros);
        const substitute = (text: string, escapeValues: boolean) =>
            substituteMacros(text, macroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});
        const greetings = greetingOptions(character, (text) =>
            applyRegexScripts(regexScripts, text, REGEX_PLACEMENT.AI_OUTPUT, { substitute }),
        ).map((greeting) => ({
            // SillyTavern expands a group greeting with the member who owns it
            // (`name2Override`), so another speaker later cannot rewrite it.
            ...greeting,
            text: substituteMacros(greeting.text, macroContext),
        }));
        const first = greetings[0];
        if (!first) {
            continue;
        }

        const swipes = greetings.map((greeting) => greeting.text);
        messages.push({
            name: character.name,
            is_user: false,
            send_date: new Date().toISOString(),
            mes: first.text,
            original_avatar: fileName,
            force_avatar: stForceAvatarUrl(fileName),
            extra: { swipes, swipe_id: 0, gen_id: Date.now() + index },
        });
    }

    if (messages.length > 0) {
        await appendGroupMessages(group, chatId, messages);
    }
}

export async function registerGroupRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/groups', async () => ({
        groups: await Promise.all((await listGroups()).map(toGroupView)),
    }));

    app.post('/api/groups', async (request, reply) => {
        const body = groupCreateSchema.parse(request.body ?? {});
        const { characters, members } = await resolveMembers(body.members);
        const disabledMembers = body.disabled_members
            ? await canonicalDisabledMembers(body.disabled_members, members)
            : undefined;

        try {
            const group = await createGroup({
                ...body,
                name: body.name ?? `Group: ${characters.map((character) => character.name).join(', ')}`,
                members,
                ...(disabledMembers ? { disabled_members: disabledMembers } : {}),
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

        const existing = await getGroup(groupId);
        if (!existing) {
            throw notFound('Group not found');
        }

        let members: string[] | undefined;
        if (body.members) {
            const resolved = await resolveMembers(body.members, {
                allowedMissing: new Set(existing.group.members),
            });
            members = resolved.members;
        }
        let disabledMembers: string[] | undefined;
        if (body.disabled_members) {
            disabledMembers = await canonicalDisabledMembers(body.disabled_members, members ?? existing.group.members);
        }

        try {
            const group = await updateGroup(groupId, {
                ...body,
                ...(members ? { members } : {}),
                ...(disabledMembers ? { disabled_members: disabledMembers } : {}),
            });
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
            await seedGroupGreetings(created.group.group, created.chat.chatId);
            const chat = (await readGroupChat(created.group.group, created.chat.chatId)) ?? created.chat;
            reply.code(201);
            return { chat, group: await toGroupView(created.group) };
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
        if (body.name === undefined && body.personaId === undefined && body.current === undefined) {
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
            let groupFile = found;

            if (body.personaId !== undefined) {
                // An `undefined` value survives the merge as a key that
                // `JSON.stringify` drops, which removes the pin.
                await patchGroupChatMetadata(found.group, chatId, {
                    persona_id: body.personaId === null ? undefined : body.personaId,
                });
                chat = (await readGroupChat(found.group, chatId)) ?? chat;
            }

            if (body.current) {
                const current = await setCurrentGroupChat(groupId, chatId);
                if (!current) {
                    throw notFound('Chat not found');
                }
                groupFile = current;
            }

            if (body.name !== undefined) {
                const updated = await renameGroupChat(groupId, chatId, body.name);
                if (!updated) {
                    throw notFound('Chat not found');
                }
                return { chat: updated.chat, group: await toGroupView(updated.group) };
            }

            return { chat, group: await toGroupView(groupFile) };
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
                        extraDelete: ['memory'],
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
                const macroContext = createMacroContext(
                    speaker,
                    resolvePersona(settings, chatPersonaId(chat)),
                    await groupMacroNames(found.group),
                );
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
                        extraDelete: ['memory'],
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
