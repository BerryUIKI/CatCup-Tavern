import type {
    ChatMessage,
    GenerateRequest,
    GenerationEvent,
    GenerationSpeaker,
    GroupGenerateRequest,
    UsageInfo,
} from '@catcup/shared';

import { ApiError } from './api';

export interface GenerationHandlers {
    onStart?: (generationId: string, speaker?: GenerationSpeaker) => void;
    onToken?: (text: string) => void;
    onReasoning?: (text: string) => void;
    onDone?: (message: ChatMessage, usage?: UsageInfo) => void;
    onError?: (message: string) => void;
}

function dispatchBlock(block: string, handlers: GenerationHandlers): void {
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
        if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).replace(/^ /, ''));
        }
    }
    if (dataLines.length === 0) {
        return;
    }

    let event: GenerationEvent;
    try {
        event = JSON.parse(dataLines.join('\n')) as GenerationEvent;
    } catch {
        return;
    }

    switch (event.type) {
        case 'start':
            handlers.onStart?.(event.generationId, event.speaker);
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

    if (!response.ok) {
        let message = 'Generation failed';
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
        throw new Error('The generation stream is unavailable');
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
                dispatchBlock(block, handlers);
                boundary = buffer.indexOf('\n\n');
            }
        }

        const tail = buffer.trim();
        if (tail) {
            dispatchBlock(tail, handlers);
        }
    } finally {
        reader.releaseLock();
    }
}
