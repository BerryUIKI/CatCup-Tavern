import type { ChatMessage, GenerationSpeaker, ProviderConfig, UsageInfo } from '@catcup/shared';
import { errorMessage } from '@catcup/shared';
import type { FastifyReply } from 'fastify';

import { getAdapter } from '../providers/index.js';
import type { PromptMessage } from '../providers/types.js';
import { endSse, initSse, writeSse, writeSseComment } from '../sse.js';
import { activeGenerations } from './registry.js';

/**
 * What a generation produces, one event at a time.
 *
 * Generation used to exist only as an SSE handler: `runGenerationStream` took a
 * `FastifyReply`, wrote to it, and treated the socket closing as the abort
 * signal. That made every non-browser consumer impossible — an IM bot has no
 * reply object and no long-lived socket, and neither does a script or a test.
 *
 * So the loop is now a plain async generator and the transport is the caller's
 * business: the HTTP route turns events into SSE, the IM transport collects
 * text. Persistence stays here, because "what gets written to the chat" is a
 * property of generation and not of the socket it was delivered over.
 */
export type GenerationEvent =
    | { type: 'start'; generationId: string; model: string; speaker?: GenerationSpeaker }
    | { type: 'token'; text: string }
    | { type: 'reasoning'; text: string }
    /** The reply was stored. `stopped` means it was cut short but is kept. */
    | { type: 'done'; message: ChatMessage; usage?: UsageInfo }
    | { type: 'error'; message: string };

/** Everything a generation needs that does not depend on how it is delivered. */
export interface GenerateReplyInput {
    provider: ProviderConfig;
    /** The model this request sends, already resolved from the provider and the character. */
    model: string;
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
    /**
     * Stop the generation. The HTTP route aborts when its socket closes; an IM
     * transport has no socket and passes a signal from `/stop` instead.
     */
    signal?: AbortSignal;
}

/**
 * Run one completion, yielding what it produces as it produces it.
 *
 * The generator owns the provider call, the abort controller and persistence;
 * it does not know or care where the events go. `activeGenerations` is still
 * keyed by `generationId` for the whole run, so the stop endpoint keeps working
 * for both transports.
 *
 * Partial replies are kept, as they always were: a stream that aborts after
 * some text has arrived stores what it has and reports `done`, because losing a
 * half-written reply the person was watching is worse than keeping a short one.
 */
export async function* generateReply(input: GenerateReplyInput): AsyncGenerator<GenerationEvent> {
    const controller = new AbortController();
    activeGenerations.set(input.generationId, controller);

    // A caller-supplied abort (a stop button over IM) is forwarded to the
    // controller this function owns, so there is still one signal to reason
    // about and one place a generation can be cancelled.
    const forward = (): void => controller.abort();
    input.signal?.addEventListener('abort', forward, { once: true });
    if (input.signal?.aborted) {
        controller.abort();
    }

    try {
        yield {
            type: 'start',
            generationId: input.generationId,
            model: input.model,
            ...(input.speaker ? { speaker: input.speaker } : {}),
        };

        let text = '';
        let reasoning = '';
        let usage: UsageInfo | undefined;

        try {
            const adapter = getAdapter(input.provider);
            for await (const chunk of adapter.streamChat(input.provider, input.apiKey, {
                model: input.model,
                messages: input.prompt,
                temperature: input.temperature,
                topP: input.topP,
                maxTokens: input.maxTokens,
                signal: controller.signal,
                ...(input.assistantPrefill ? { assistantPrefill: input.assistantPrefill } : {}),
            })) {
                if (chunk.type === 'text') {
                    text += chunk.text;
                    yield { type: 'token', text: chunk.text };
                } else if (chunk.type === 'reasoning') {
                    reasoning += chunk.text;
                    yield { type: 'reasoning', text: chunk.text };
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
            yield { type: 'done', message: saved, ...(usage ? { usage } : {}) };
        } catch (streamError) {
            const aborted = controller.signal.aborted;

            if (text.trim()) {
                try {
                    const saved = await input.persist(text, reasoning, true);
                    if (aborted) {
                        yield { type: 'done', message: saved };
                    } else {
                        yield { type: 'error', message: errorMessage(streamError) };
                    }
                } catch {
                    yield { type: 'error', message: errorMessage(streamError) };
                }
            } else {
                yield {
                    type: 'error',
                    message: aborted ? 'Generation stopped' : errorMessage(streamError),
                };
            }
        }
    } finally {
        input.signal?.removeEventListener('abort', forward);
        activeGenerations.delete(input.generationId);
    }
}

export interface GenerationStreamInput extends Omit<GenerateReplyInput, 'signal'> {
    reply: FastifyReply;
}

/**
 * Stream one completion to the client and persist its result.
 *
 * The HTTP face of `generateReply`: it opens SSE, relays every event, writes a
 * keep-alive comment while the model is quiet, and — the reason this wrapper
 * still exists — treats the client closing the socket as "stop generating",
 * because someone who closed the tab is not waiting for the rest of the reply.
 *
 * Shared by single-character and group generation so the SSE contract, stop
 * behaviour and partial-reply handling cannot drift between them.
 */
export async function runGenerationStream(input: GenerationStreamInput): Promise<void> {
    const { reply } = input;
    let finished = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    const abort = new AbortController();
    reply.request.raw.on('close', () => {
        if (!finished) {
            abort.abort();
        }
    });

    // `initSse` can throw before the response is hijacked, and calling `endSse`
    // on a reply that was never hijacked would try to end a response Fastify
    // still owns. Tracked rather than assumed, the same way the pre-extraction
    // code did.
    let initialized = false;

    try {
        initSse(reply);
        initialized = true;
        heartbeat = setInterval(() => writeSseComment(reply, 'ping'), 15000);

        for await (const event of generateReply({ ...input, signal: abort.signal })) {
            writeSse(reply, event);
        }
    } finally {
        finished = true;
        if (heartbeat) {
            clearInterval(heartbeat);
        }
        if (initialized) {
            endSse(reply);
        }
    }
}
