import type {
    AliasEvent,
    ChatMessage,
    DistillEvent,
    GenerateRequest,
    GenerationEvent,
    GenerationSpeaker,
    GroupGenerateRequest,
    UsageInfo,
} from '@catcup/shared';

import { ApiError } from './api';

/**
 * Two streams share one wire format: generation (which a person is reading) and
 * distillation (which a person is waiting on). The reader below is the same for
 * both, so an event shape change cannot make them disagree about framing.
 */
async function readEvents<T>(response: Response, failMessage: string, onEvent: (event: T) => void): Promise<void> {
    if (!response.ok) {
        let message = failMessage;
        try {
            const payload = (await response.json()) as { error?: string };
            if (payload.error) {
                message = payload.error;
            }
        } catch {
            // Keep the fallback message.
        }
        throw new ApiError(message, response.status);
    }

    if (!response.body) {
        throw new Error('The stream is unavailable');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            buffer += decoder.decode(value, { stream: true });
            buffer = buffer.replace(/\r\n/g, '\n');

            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                dispatch(block, onEvent);
                boundary = buffer.indexOf('\n\n');
            }
        }

        const tail = buffer.trim();
        if (tail) {
            dispatch(tail, onEvent);
        }
    } finally {
        reader.releaseLock();
    }
}

function dispatch<T>(block: string, onEvent: (event: T) => void): void {
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
        if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''));
        }
    }
    if (dataLines.length === 0) {
        return;
    }

    try {
        onEvent(JSON.parse(dataLines.join('\n')) as T);
    } catch {
        // A malformed block is dropped; the stream continues.
    }
}

export interface GenerationHandlers {
    onStart?: (generationId: string, speaker?: GenerationSpeaker, model?: string) => void;
    onToken?: (text: string) => void;
    onReasoning?: (text: string) => void;
    onDone?: (message: ChatMessage, usage?: UsageInfo) => void;
    onError?: (message: string) => void;
}

function generationHandlers(handlers: GenerationHandlers): (event: GenerationEvent) => void {
    return (event) => {
        switch (event.type) {
            case 'start':
                handlers.onStart?.(event.generationId, event.speaker, event.model);
                break;
            case 'token':
                handlers.onToken?.(event.text);
                break;
            case 'reasoning':
                handlers.onReasoning?.(event.text);
                break;
            case 'done':
                handlers.onDone?.(event.message, event.usage);
                break;
            case 'error':
                handlers.onError?.(event.message);
                break;
        }
    };
}

export async function streamGeneration(
    path: string,
    body: GenerateRequest | GroupGenerateRequest,
    handlers: GenerationHandlers,
    signal?: AbortSignal,
): Promise<void> {
    const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });

    await readEvents<GenerationEvent>(response, 'Generation failed', generationHandlers(handlers));
}

/** The events a distillation run sends, by type. */
export type DistillHandlers = {
    [K in DistillEvent['type']]?: (event: Extract<DistillEvent, { type: K }>) => void;
};

/** The events an alias generation run sends, by type. */
export type AliasHandlers = {
    [K in AliasEvent['type']]?: (event: Extract<AliasEvent, { type: K }>) => void;
};

/**
 * Start or resume an alias run and follow it.
 *
 * The same SSE framing as generation and distillation, deliberately: one
 * reader handles all three, so an event shape change cannot make them disagree
 * about how a stream is cut into events.
 */
export async function streamAliases(
    path: string,
    body: Record<string, unknown>,
    handlers: AliasHandlers,
    signal?: AbortSignal,
): Promise<void> {
    const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });

    await readEvents<AliasEvent>(response, 'The run could not be started', (event) => {
        const handler = handlers[event.type] as ((value: AliasEvent) => void) | undefined;
        handler?.(event);
    });
}

export async function streamDistill(
    path: string,
    body: Record<string, unknown>,
    handlers: DistillHandlers,
    signal?: AbortSignal,
): Promise<void> {
    const response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
    });

    await readEvents<DistillEvent>(response, 'The run could not be started', (event) => {
        const handler = handlers[event.type] as ((value: DistillEvent) => void) | undefined;
        handler?.(event);
    });
}
