import { randomUUID } from 'node:crypto';

import {
    type CharacterDetail,
    type ChatMessage,
    errorMessage,
    type GenerateAction,
    type UsageInfo,
} from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, notFound } from '../http/errors.js';
import { buildPrompt } from '../prompt/builder.js';
import { getAdapter } from '../providers/index.js';
import { endSse, initSse, writeSse, writeSseComment } from '../sse.js';
import { appendMessage, readChat, updateMessage } from '../storage/chats.js';
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
    const extra: Record<string, unknown> = {
        api: context.providerKind,
        model: context.providerModel,
        gen_started: context.startedAt,
        gen_finished: new Date().toISOString(),
        ...(reasoning ? { reasoning } : {}),
        ...(stopped ? { stopped: true } : {}),
    };

    if (context.action === 'regenerate' && context.regenerateIndex !== null) {
        return saveSwipe(context, text, extra);
    }

    if (context.action === 'continue' && context.continueIndex !== null && context.originalAssistant) {
        const mergedReasoning = [context.originalAssistant.extra?.reasoning, reasoning]
            .filter((value): value is string => typeof value === 'string' && value.length > 0)
            .join('\n\n');
        return updateMessage(context.character, context.chatId, context.continueIndex, {
            mes: `${context.originalAssistant.mes}${text}`,
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
        mes: text,
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

        let messages = chat.messages;
        let regenerateIndex: number | null = null;
        let continueIndex: number | null = null;
        let originalAssistant: ChatMessage | null = null;

        if (body.action === 'send') {
            const text = body.message?.trim();
            if (!text) {
                throw badRequest('Message is empty');
            }
            const userMessage: ChatMessage = {
                name: settings.persona.name,
                is_user: true,
                send_date: new Date().toISOString(),
                mes: text,
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

        const prompt = buildPrompt({
            character,
            messages,
            persona: settings.persona,
            settings: settings.generation,
        });
        if (body.action === 'continue') {
            prompt.push({
                role: 'system',
                content: '[Continue the last assistant message without repeating it.]',
            });
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
                    temperature: settings.generation.temperature,
                    topP: settings.generation.topP,
                    maxTokens: settings.generation.maxTokens,
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
