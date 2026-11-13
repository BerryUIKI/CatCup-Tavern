import type { ChatMessage, GenerationSpeaker, ProviderConfig, UsageInfo } from '@catcup/shared';
import { errorMessage } from '@catcup/shared';
import type { FastifyReply } from 'fastify';

import { getAdapter } from '../providers/index.js';
import type { PromptMessage } from '../providers/types.js';
import { endSse, initSse, writeSse, writeSseComment } from '../sse.js';
import { activeGenerations } from './registry.js';

export interface GenerationStreamInput {
    reply: FastifyReply;
    provider: ProviderConfig;
    apiKey: string | undefined;
    prompt: PromptMessage[];
    temperature: number;
    topP: number;
    maxTokens: number;
    generationId: string;
    /** The character who is speaking, for group chats. */
    speaker?: GenerationSpeaker;
    /**
     * Text the reply continues from. Anthropic receives it as a trailing
     * assistant turn, so the model keeps writing past it; the prefill itself is
     * never part of the reply the client sees or the chat file stores.
     */
    assistantPrefill?: string;
    /**
     * Store the reply. Called once with whatever text was produced; `stopped`
     * is true when the stream aborted after some text had arrived.
     */
    persist: (text: string, reasoning: string, stopped: boolean) => Promise<ChatMessage>;
}

/**
 * Stream one completion to the client and persist its result.
 *
 * Shared by single-character and group generation so the SSE contract, stop
 * behaviour and partial-reply handling cannot drift between them.
 */
export async function runGenerationStream(input: GenerationStreamInput): Promise<void> {
    const { reply, prompt } = input;
    const controller = new AbortController();
    activeGenerations.set(input.generationId, controller);

    let replyInitialized = false;
    let finished = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    reply.request.raw.on('close', () => {
        if (!finished) {
            controller.abort();
        }
    });

    try {
        initSse(reply);
        replyInitialized = true;
        writeSse(reply, {
            type: 'start',
            generationId: input.generationId,
            ...(input.speaker ? { speaker: input.speaker } : {}),
        });
        heartbeat = setInterval(() => writeSseComment(reply, 'ping'), 15000);

        let text = '';
        let reasoning = '';
        let usage: UsageInfo | undefined;

        try {
            const adapter = getAdapter(input.provider);
            for await (const chunk of adapter.streamChat(input.provider, input.apiKey, {
                model: input.provider.model,
                messages: prompt,
                temperature: input.temperature,
                topP: input.topP,
                maxTokens: input.maxTokens,
                signal: controller.signal,
                ...(input.assistantPrefill ? { assistantPrefill: input.assistantPrefill } : {}),
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

            const saved = await input.persist(text, reasoning, false);
            writeSse(reply, {
                type: 'done',
                message: saved,
                ...(usage ? { usage } : {}),
            });
        } catch (streamError) {
            const aborted = controller.signal.aborted;

            if (text.trim()) {
                try {
                    const saved = await input.persist(text, reasoning, true);
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
        activeGenerations.delete(input.generationId);
        if (replyInitialized) {
            endSse(reply);
        }
    }
}
