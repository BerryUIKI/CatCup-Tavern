import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, notFound } from '../http/errors.js';
import { createChat, deleteChat, deleteMessage, listChats, readChat, updateMessage } from '../storage/chats.js';
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
        return { chat: await createChat(character, body) };
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
                return {
                    message: await updateMessage(character, params.chatId, index, {
                        mes: body.message,
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
