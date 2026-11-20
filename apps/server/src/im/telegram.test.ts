import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { TelegramTransport } from './telegram.js';
import { backoffMs, type IncomingMessage } from './transport.js';

/**
 * The parts of the Telegram transport that must not be wrong.
 *
 * A stub stands in for the Bot API, so these exercise the real poll loop, the
 * real `getUpdates` request and the real allowlist — everything except
 * Telegram itself. The two failures that matter most are an unconfigured bot
 * answering strangers and a poll failure taking the server down, so both have a
 * test that would catch them.
 */

let server: Server | null = null;
const originalFetch = globalThis.fetch;

afterEach(async () => {
    globalThis.fetch = originalFetch;
    if (server) {
        await new Promise<void>((resolve) => server?.close(() => resolve()));
        server = null;
    }
});

interface StubOptions {
    /** Updates to return, one array per `getUpdates` call; the last repeats. */
    updates: unknown[][];
    /** Status to answer with, per call; the last repeats. */
    statuses?: number[];
    description?: string;
    onRequest?: (url: URL) => void;
}

/** An HTTP server that answers `getUpdates` the way Telegram's API does. */
async function stubApi(options: StubOptions): Promise<string> {
    let call = 0;
    server = createServer((request, response) => {
        const url = new URL(request.url ?? '/', 'http://127.0.0.1');
        options.onRequest?.(url);

        if (url.pathname.endsWith('/getMe')) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ ok: true, result: { id: 42, username: 'catcup_bot', is_bot: true } }));
            return;
        }

        const index = Math.min(call, options.updates.length - 1);
        const status = options.statuses?.[Math.min(call, (options.statuses.length ?? 1) - 1)] ?? 200;
        // Telegram filters by `offset` itself: it returns only updates whose
        // `update_id` is at or above the offset. A stub that ignored it would
        // redeliver everything and make the offset look broken when it is not.
        const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10);
        const body = (options.updates[index] ?? []).filter(
            (entry) =>
                typeof (entry as { update_id?: number }).update_id !== 'number' ||
                (entry as { update_id: number }).update_id >= offset,
        );
        call += 1;

        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(
            JSON.stringify(
                status === 200
                    ? { ok: true, result: body }
                    : { ok: false, error_code: status, description: options.description ?? 'refused' },
            ),
        );
    });

    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as AddressInfo).port;
    return `http://127.0.0.1:${port}`;
}

/** A message update, shaped like Telegram's. */
function update(id: number, from: number, text: string, chat = from): unknown {
    return { update_id: id, message: { message_id: id, from: { id: from, is_bot: false }, chat: { id: chat }, text } };
}

/** Wait until `predicate` holds, or give up — the loop is asynchronous. */
async function until(predicate: () => boolean, ms = 3000): Promise<void> {
    const started = Date.now();
    while (!predicate()) {
        if (Date.now() - started > ms) {
            throw new Error('timed out waiting for the poll loop');
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

describe('the Telegram allowlist', () => {
    it('drops a message from anyone but the owner, without replying', async () => {
        const apiBase = await stubApi({
            updates: [[update(1, 111, 'from a stranger'), update(2, 999, 'from the owner')]],
        });

        const received: IncomingMessage[] = [];
        const transport = new TelegramTransport({
            token: 'token',
            ownerId: '999',
            apiBase,
            hooks: { onMessage: (message) => received.push(message) },
        });

        await transport.start();
        await until(() => received.length > 0);
        await transport.stop();

        // Exactly one message got through, and it is the owner's.
        expect(received).toHaveLength(1);
        expect(received[0]?.userId).toBe('999');
        expect(received[0]?.text).toBe('from the owner');
    });

    it('answers nobody when no owner is configured', async () => {
        const apiBase = await stubApi({ updates: [[update(1, 999, 'hello')]] });

        const received: IncomingMessage[] = [];
        const transport = new TelegramTransport({
            token: 'token',
            // Empty means nobody, not everybody. Getting this backwards would
            // make an unconfigured bot answer the first stranger who finds it.
            ownerId: '',
            apiBase,
            hooks: { onMessage: (message) => received.push(message) },
        });

        await transport.start();
        await new Promise((resolve) => setTimeout(resolve, 200));
        await transport.stop();

        expect(received).toEqual([]);
    });
});

describe('the polling loop', () => {
    it('advances the offset so a message is delivered once', async () => {
        const offsets: string[] = [];
        const apiBase = await stubApi({
            // The same update arrives twice, as Telegram will do when an offset
            // is not acknowledged.
            updates: [[update(7, 999, 'once')], [update(7, 999, 'once')]],
            // Only `getUpdates` carries an offset; `getMe` is fired alongside
            // it and would otherwise occupy slot 0 of this list.
            onRequest: (url) => {
                if (url.pathname.endsWith('/getUpdates')) {
                    offsets.push(url.searchParams.get('offset') ?? '');
                }
            },
        });

        const received: IncomingMessage[] = [];
        const transport = new TelegramTransport({
            token: 'token',
            ownerId: '999',
            apiBase,
            hooks: { onMessage: (message) => received.push(message) },
        });

        await transport.start();
        await until(() => offsets.length >= 2);
        await transport.stop();

        expect(received).toHaveLength(1);
        // The second request asks for updates after the one it already saw.
        expect(offsets[1]).toBe('8');
    });

    it('keeps polling after a failure and reports the error', async () => {
        const apiBase = await stubApi({
            updates: [[], [update(1, 999, 'after the failure')]],
            statuses: [500, 200],
            description: 'flood control',
        });

        const received: IncomingMessage[] = [];
        const transport = new TelegramTransport({
            token: 'token',
            ownerId: '999',
            apiBase,
            // No real waiting: the backoff would otherwise make this test slow
            // and flaky on a loaded machine.
            sleep: async () => {},
            hooks: { onMessage: (message) => received.push(message) },
        });

        await transport.start();
        await until(() => received.length > 0);
        const recovered = transport.status();
        await transport.stop();

        // The failure did not stop the loop, and the message that came after it
        // arrived. The error is cleared once a poll succeeds, so the status line
        // stops showing a blip the moment it recovers.
        expect(received[0]?.text).toBe('after the failure');
        expect(recovered.error).toBeNull();
        expect(recovered.running).toBe(true);
    });

    it('names the real cause when the token is polling elsewhere', async () => {
        const apiBase = await stubApi({
            updates: [[]],
            statuses: [409],
            description: 'Conflict: terminated by other getUpdates request',
        });

        const transport = new TelegramTransport({
            token: 'token',
            ownerId: '999',
            apiBase,
            sleep: async () => {},
            hooks: { onMessage: () => {} },
        });

        await transport.start();
        await until(() => transport.status().error !== null);
        const status = transport.status();
        await transport.stop();

        // "Another process is polling" sends a person to the right problem;
        // "Telegram refused the poll" would not.
        expect(status.error).toContain('Another process');
    });

    it('stops cleanly and can be started again', async () => {
        const apiBase = await stubApi({ updates: [[]] });
        const transport = new TelegramTransport({
            token: 'token',
            ownerId: '999',
            apiBase,
            sleep: async () => {},
            hooks: { onMessage: () => {} },
        });

        expect(transport.status().running).toBe(false);
        await transport.start();
        expect(transport.status().running).toBe(true);

        // A second start must not create a second loop sharing one offset.
        await transport.start();
        await transport.stop();
        expect(transport.status().running).toBe(false);

        await transport.start();
        expect(transport.status().running).toBe(true);
        await transport.stop();
    });
});

describe('backoffMs', () => {
    it('grows with attempts and stays under a cap', () => {
        // The jitter makes the exact value untestable; the bounds are the point.
        for (let attempt = 0; attempt < 12; attempt += 1) {
            const delay = backoffMs(attempt);
            expect(delay).toBeGreaterThan(0);
            expect(delay).toBeLessThanOrEqual(36_000);
        }
        // A late attempt must not be shorter than an early one by much.
        expect(backoffMs(10)).toBeGreaterThan(backoffMs(0));
    });
});
