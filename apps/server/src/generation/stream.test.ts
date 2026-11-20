import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { ChatMessage, ProviderConfig } from '@catcup/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { type GenerationEvent, generateReply } from './stream.js';

/**
 * The generation core, with no HTTP route and no SSE.
 *
 * `generateReply` exists so a transport other than a browser can run a
 * generation — that is the whole point of extracting it from
 * `runGenerationStream`, and these tests exercise it the way an IM bot would:
 * drain the events, look at the text, and never touch a Fastify reply.
 */

let close: (() => Promise<void>) | null = null;

afterEach(async () => {
    if (close) {
        await close();
        close = null;
    }
});

/** An OpenAI-compatible endpoint that streams the given chunks. */
async function stub(chunks: readonly string[]): Promise<{ provider: ProviderConfig; url: string }> {
    const server = createServer((request, response) => {
        request.on('data', () => {});
        request.on('end', () => {
            response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
            for (const text of chunks) {
                response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
            }
            response.write('data: [DONE]\n\n');
            response.end();
        });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    close = () => new Promise<void>((done) => server.close(() => done()));

    return {
        provider: {
            id: 'stub',
            kind: 'openai',
            name: 'Stub',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            models: ['stub-model'],
            defaultModel: 'stub-model',
            enabled: true,
            headers: {},
        },
        url: `http://127.0.0.1:${port}/v1`,
    };
}

function request(
    provider: ProviderConfig,
    persist: (text: string, reasoning: string, stopped: boolean) => Promise<ChatMessage>,
) {
    return {
        provider,
        model: 'stub-model',
        apiKey: undefined,
        prompt: [{ role: 'user' as const, content: 'Say something.' }],
        temperature: 0.7,
        topP: 1,
        maxTokens: 100,
        generationId: `gen-${Math.random().toString(36).slice(2)}`,
        persist,
    };
}

/** A stored message the persist callback can hand back. */
function saved(text: string, extra: Record<string, unknown> = {}): ChatMessage {
    return { name: 'Aria', is_user: false, mes: text, send_date: 'now', extra } as ChatMessage;
}

async function drain(input: Parameters<typeof generateReply>[0]): Promise<GenerationEvent[]> {
    const events: GenerationEvent[] = [];
    for await (const event of generateReply(input)) {
        events.push(event);
    }
    return events;
}

describe('generateReply', () => {
    it('yields start, every token, then done — with no HTTP in the picture', async () => {
        const { provider } = await stub(['Hello', ' there', '.']);
        const text: string[] = [];

        const events = await drain(
            request(provider, async (reply) => {
                text.push(reply);
                return saved(reply);
            }),
        );

        expect(events[0]).toMatchObject({ type: 'start', model: 'stub-model' });
        expect(events.filter((event) => event.type === 'token').map((event) => 'text' in event && event.text)).toEqual([
            'Hello',
            ' there',
            '.',
        ]);

        const done = events.at(-1);
        expect(done?.type).toBe('done');
        expect(text).toEqual(['Hello there.']);
        // Nothing was marked stopped: the stream finished on its own.
        expect((done as { message: ChatMessage }).message.mes).toBe('Hello there.');
    });

    it('keeps a partial reply when the caller aborts mid-stream', async () => {
        // A slow stub, so the abort lands after some text has arrived — which is
        // the case an IM `/stop` command creates.
        const server = createServer((incoming, response) => {
            incoming.on('data', () => {});
            incoming.on('end', () => {
                response.writeHead(200, { 'content-type': 'text/event-stream' });
                response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Half a ' } }] })}\n\n`);
                // The second chunk never arrives: the client goes away first.
                setTimeout(() => {
                    response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'reply.' } }] })}\n\n`);
                    response.write('data: [DONE]\n\n');
                    response.end();
                }, 5000);
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const port = (server.address() as AddressInfo).port;
        close = () => new Promise<void>((done) => server.close(() => done()));

        const provider: ProviderConfig = {
            id: 'slow',
            kind: 'openai',
            name: 'Slow',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            models: ['stub-model'],
            defaultModel: 'stub-model',
            enabled: true,
            headers: {},
        };

        const abort = new AbortController();
        const calls: Array<{ text: string; stopped: boolean }> = [];

        const events: GenerationEvent[] = [];
        for await (const event of generateReply({
            ...request(provider, async (text, _reasoning, stopped) => {
                calls.push({ text, stopped });
                return saved(text, { stopped });
            }),
            signal: abort.signal,
        })) {
            events.push(event);
            if (event.type === 'token') {
                abort.abort();
            }
        }

        // The part that arrived is stored rather than thrown away, and the
        // caller is told it was stopped rather than shown an error.
        expect(calls).toEqual([{ text: 'Half a ', stopped: true }]);
        expect(events.at(-1)?.type).toBe('done');
    }, 20_000);

    it('reports an error and stores nothing when the model says nothing', async () => {
        const { provider } = await stub([]);
        const calls: string[] = [];

        const events = await drain(
            request(provider, async (text) => {
                calls.push(text);
                return saved(text);
            }),
        );

        expect(events.at(-1)?.type).toBe('error');
        expect(calls).toEqual([]);
    });

    it('surfaces a provider failure as an error rather than throwing', async () => {
        // No stub is listening on this port, so the request itself fails.
        const provider: ProviderConfig = {
            id: 'dead',
            kind: 'openai',
            name: 'Dead',
            baseUrl: 'http://127.0.0.1:1/v1',
            models: ['stub-model'],
            defaultModel: 'stub-model',
            enabled: true,
            headers: {},
        };

        const events = await drain(request(provider, async (text) => saved(text)));

        // An IM transport needs this to be an event: an exception would be a
        // crash, and a silent socket would look like the bot had died.
        const last = events.at(-1);
        expect(last?.type).toBe('error');
        expect((last as { message: string }).message).toBeTruthy();
    }, 20_000);
});
