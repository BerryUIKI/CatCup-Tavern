import {
    applyRegexScripts,
    REGEX_PLACEMENT,
    regexPlacementForMessage,
    resolvePersona,
    sanitizeRegexMacro,
} from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, notFound } from '../http/errors.js';
import { substituteMacros } from '../prompt/macros.js';
import { createMacroContext } from '../prompt/worldInfoTurn.js';
import {
    branchChat,
    chatPersonaId,
    createChat,
    deleteChat,
    deleteMessage,
    listChats,
    patchChatMetadata,
    readChat,
    renameChat,
    updateMessage,
} from '../storage/chats.js';
import { listRegexScripts } from '../storage/regex.js';
import { getSettings } from '../storage/settings.js';
import { parseMessageIndex, requireCharacter } from './helpers.js';

const chatParamsSchema = z.object({
    characterId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(300),
});

const characterParamsSchema = z.object({
    characterId: z.string().min(1).max(200),
});

const messageParamsSchema = chatParamsSchema.extend({
    index: z.string(),
});

const newChatSchema = z.object({
    name: z.string().trim().max(200).optional(),
    greetingIndex: z.number().int().min(0).max(100).optional(),
});

const renameChatSchema = z.object({
    name: z.string().trim().min(1).max(200).optional(),
    /** Pin the chat to a persona, or `null` to follow the account default. */
    personaId: z.string().min(1).max(200).nullable().optional(),
});

const branchChatSchema = z.object({
    index: z.number().int().min(0),
    name: z.string().trim().max(200).optional(),
});

const updateMessageSchema = z
    .object({
        message: z.string().max(200000).optional(),
        swipeId: z.number().int().min(0).optional(),
    })
    .refine((value) => value.message !== undefined || value.swipeId !== undefined, {
        message: 'Nothing to update',
    });

export async function registerChatRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/characters/:characterId/chats', async (request) => {
        const { characterId } = characterParamsSchema.parse(request.params);
        const character = await requireCharacter(characterId);
        return { chats: await listChats(character) };
    });

    app.post('/api/characters/:characterId/chats', async (request) => {
        const { characterId } = characterParamsSchema.parse(request.params);
        const body = newChatSchema.parse(request.body ?? {});
        const character = await requireCharacter(characterId);

        const [settings, regexScripts] = await Promise.all([getSettings(), listRegexScripts()]);
        const macroContext = createMacroContext(character, resolvePersona(settings));
        const substitute = (text: string, escapeValues: boolean) =>
            substituteMacros(text, macroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});

        return {
            chat: await createChat(character, {
                ...body,
                transformGreeting: (text) =>
                    applyRegexScripts(regexScripts, text, REGEX_PLACEMENT.AI_OUTPUT, { substitute }),
            }),
        };
    });

    app.get('/api/chats/:characterId/:chatId', async (request) => {
        const { characterId, chatId } = chatParamsSchema.parse(request.params);
        const character = await requireCharacter(characterId);
        const chat = await readChat(character, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }
        return { chat };
    });

    app.patch('/api/chats/:characterId/:chatId', async (request) => {
        const { characterId, chatId } = chatParamsSchema.parse(request.params);
        const body = renameChatSchema.parse(request.body ?? {});
        const character = await requireCharacter(characterId);

        if (body.name === undefined && body.personaId === undefined) {
            throw badRequest('Nothing to update');
        }

        try {
            let chat = await readChat(character, chatId);
            if (!chat) {
                throw notFound('Chat not found');
            }

            if (body.personaId !== undefined) {
                // An `undefined` value survives the merge as a key that
                // `JSON.stringify` drops, which removes the pin.
                await patchChatMetadata(character, chatId, {
                    persona_id: body.personaId === null ? undefined : body.personaId,
                });
                chat = (await readChat(character, chatId)) ?? chat;
            }
            if (body.name !== undefined) {
                chat = await renameChat(character, chatId, body.name);
            }

            return { chat };
        } catch (error) {
            if (error instanceof Error && error.name === 'HttpError') {
                throw error;
            }
            throw badRequest(error instanceof Error ? error.message : 'Failed to update chat');
        }
    });

    app.post('/api/chats/:characterId/:chatId/branch', async (request) => {
        const { characterId, chatId } = chatParamsSchema.parse(request.params);
        const body = branchChatSchema.parse(request.body ?? {});
        const character = await requireCharacter(characterId);

        try {
            return { chat: await branchChat(character, chatId, body.index, body.name) };
        } catch (error) {
            throw badRequest(error instanceof Error ? error.message : 'Failed to branch chat');
        }
    });

    app.patch('/api/chats/:characterId/:chatId/messages/:index', async (request) => {
        const params = messageParamsSchema.parse(request.params);
        const body = updateMessageSchema.parse(request.body ?? {});
        const index = parseMessageIndex(params.index);
        const character = await requireCharacter(params.characterId);

        const chat = await readChat(character, params.chatId);
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
                    message: await updateMessage(character, params.chatId, index, {
                        mes: swipe,
                        extra: { swipe_id: body.swipeId },
                    }),
                };
            }

            if (body.message !== undefined) {
                // Editing re-runs the source scripts, but only those with
                // `runOnEdit`; SillyTavern treats an edit as a new source event.
                const [settings, regexScripts] = await Promise.all([getSettings(), listRegexScripts()]);
                const macroContext = createMacroContext(character, resolvePersona(settings, chatPersonaId(chat)));
                const substitute = (text: string, escapeValues: boolean) =>
                    substituteMacros(text, macroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});

                return {
                    message: await updateMessage(character, params.chatId, index, {
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
            throw badRequest(error instanceof Error ? error.message : 'Failed to update message');
        }
    });

    app.delete('/api/chats/:characterId/:chatId/messages/:index', async (request) => {
        const params = messageParamsSchema.parse(request.params);
        const index = parseMessageIndex(params.index);
        const character = await requireCharacter(params.characterId);

        try {
            return { chat: await deleteMessage(character, params.chatId, index) };
        } catch (error) {
            throw badRequest(error instanceof Error ? error.message : 'Failed to delete message');
        }
    });

    app.delete('/api/chats/:characterId/:chatId', async (request) => {
        const { characterId, chatId } = chatParamsSchema.parse(request.params);
        const character = await requireCharacter(characterId);
        const deleted = await deleteChat(character, chatId);
        if (!deleted) {
            throw notFound('Chat not found');
        }
        return { ok: true };
    });
}
