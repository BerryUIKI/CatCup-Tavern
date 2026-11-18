import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

import type { AliasEvent } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * The alias generation routes.
 *
 * The run endpoints are exercised through the same SSE a client follows, so the
 * framing is covered too: a `done` event has to arrive and end the stream, or a
 * dialog would wait forever on a run that finished.
 */

const BOOK = {
    entries: {
        '0': { uid: 0, key: ['公主'], content: 'The princess rules the realm.', comment: 'The Princess' },
        '1': { uid: 1, key: ['knight'], content: 'A knight of the realm.', comment: 'The Knight' },
        '2': { uid: 2, key: [], content: '', comment: 'Blank' },
    },
};

let root: string;
let app: FastifyInstance;
let cookie: string;
let stub: { server: Server; baseUrl: string; close: () => Promise<void> };

async function call(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

/** Follow an SSE run response to its terminal event. */
function eventsOf(body: string): AliasEvent[] {
    return body
        .split('\n\n')
        .map((block) => block.split('\n').find((line) => line.startsWith('data:')))
        .filter((line): line is string => Boolean(line))
        .map((line) => JSON.parse(line.slice(5).trim()) as AliasEvent);
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-alias-routes-');
    await mkdir(fixturePath(root, 'worlds'), { recursive: true });
    await writeFile(fixturePath(root, 'worlds', 'eldoria.json'), `${JSON.stringify(BOOK, null, 2)}\n`, 'utf8');

    stub = await new Promise((resolve) => {
        const server = createServer((request, response) => {
            request.on('data', () => {});
            request.on('end', () => {
                response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
                response.write(
                    `data: ${JSON.stringify({ choices: [{ delta: { content: '{"aliases":["王女"]}' } }] })}\n\n`,
                );
                response.write('data: [DONE]\n\n');
                response.end();
            });
        });
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address ? address.port : 0;
            resolve({
                server,
                baseUrl: `http://127.0.0.1:${port}/v1`,
                close: () => new Promise<void>((done) => server.close(() => done())),
            });
        });
    });

    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');
    vi.resetModules();
    const { buildApp } = await import('../app.js');
    app = await buildApp();

    const setup = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { password: 'a long enough password' },
        remoteAddress: '127.0.0.1',
    });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

    // A provider pointed at the stub, activated through the API so the settings
    // cache is refreshed the way a person's own change would refresh it.
    const created = await call('POST', '/api/providers', {
        name: 'Stub',
        kind: 'openai',
        baseUrl: stub.baseUrl,
        enabled: true,
        models: ['stub-model'],
        defaultModel: 'stub-model',
    });
    // The first usable provider becomes active on its own; the model is this
    // profile's preference, set the way a person would set it.
    const providerId = (created.json() as { provider: { id: string } }).provider.id;
    const patched = await call('PATCH', '/api/settings', {
        activeProviderId: providerId,
        profilePreferredModel: 'stub-model',
    });
    expect(patched.statusCode).toBe(200);
}, 60_000);

afterAll(async () => {
    await app.close();
    await stub.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('alias generation routes', () => {
    it('estimates the requests a run would spend', async () => {
        const response = await call('GET', '/api/worlds/eldoria/aliases/estimate');
        expect(response.statusCode).toBe(200);

        const { estimate } = response.json() as { estimate: { requests: number; empty: number; model: string } };
        // Two readable entries; the blank one is skipped rather than requested.
        expect(estimate.requests).toBe(2);
        expect(estimate.empty).toBe(1);
        expect(estimate.model).toBe('stub-model');
    });

    it('404s an estimate for a book that does not exist', async () => {
        const response = await call('GET', '/api/worlds/nowhere/aliases/estimate');
        expect(response.statusCode).toBe(404);
    });

    it('runs every entry and streams a done event', async () => {
        const response = await call('POST', '/api/worlds/eldoria/aliases/runs', { includeExisting: true });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/event-stream');

        const events = eventsOf(response.body);
        expect(events[0]?.type).toBe('start');

        const done = events.find((event) => event.type === 'done');
        expect(done).toBeDefined();
        if (done?.type !== 'done') {
            throw new Error('expected a done event');
        }
        expect(done.run.status).toBe('done');
        expect(done.run.items.find((item) => item.uid === 0)?.proposed).toEqual(['王女']);
        expect(done.run.items.find((item) => item.uid === 2)?.state).toBe('skipped');
    }, 30_000);

    it('lists the runs recorded for a book', async () => {
        const response = await call('GET', '/api/worlds/eldoria/aliases/runs');
        expect(response.statusCode).toBe(200);
        const { runs } = response.json() as { runs: { worldId: string }[] };
        expect(runs.length).toBeGreaterThan(0);
        expect(runs.every((run) => run.worldId === 'eldoria')).toBe(true);
    });

    it('writes an accepted row and leaves the book file untouched', async () => {
        const before = await readFile(fixturePath(root, 'worlds', 'eldoria.json'), 'utf8');

        const response = await call('POST', '/api/worlds/eldoria/aliases/apply', {
            entries: [
                { uid: 0, aliases: ['王女', 'Aurelia'] },
                { uid: 1, aliases: ['Ser Bram'] },
            ],
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ updated: 2, kept: 0 });

        expect(await readFile(fixturePath(root, 'worlds', 'eldoria.json'), 'utf8')).toBe(before);

        const view = await call('GET', '/api/worlds/eldoria/aliases');
        expect(view.json().aliases).toEqual({ '0': ['王女', 'Aurelia'], '1': ['Ser Bram'] });
    });

    it('skips a row whose entry is gone rather than failing the batch', async () => {
        const response = await call('POST', '/api/worlds/eldoria/aliases/apply', {
            entries: [
                { uid: 0, aliases: ['王女'] },
                { uid: 999, aliases: ['ghost'] },
            ],
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ updated: 1, kept: 1 });
    });

    it('reports a book that does not exist when applying', async () => {
        const response = await call('POST', '/api/worlds/nowhere/aliases/apply', {
            entries: [{ uid: 0, aliases: ['x'] }],
        });
        expect(response.statusCode).toBe(404);
    });

    it('refuses to attach to a run that already finished', async () => {
        const listed = await call('GET', '/api/worlds/eldoria/aliases/runs');
        const run = (listed.json() as { runs: { id: string; status: string }[] }).runs.find(
            (candidate) => candidate.status === 'done',
        );
        expect(run).toBeDefined();

        const response = await call('POST', `/api/worlds/eldoria/aliases/runs/${run?.id}/attach`);
        expect(response.statusCode).toBe(409);
        expect((response.json() as { code?: string }).code).toBe('ALIAS_FINISHED');
    });

    it('404s a run that is not there', async () => {
        expect((await call('GET', '/api/worlds/eldoria/aliases/runs/missing')).statusCode).toBe(404);
        expect((await call('DELETE', '/api/worlds/eldoria/aliases/runs/missing')).statusCode).toBe(200);
    });

    it('reports the stale rows a refresh should target', async () => {
        const response = await call('GET', '/api/worlds/eldoria/aliases/stale');
        expect(response.statusCode).toBe(200);
        expect(Array.isArray(response.json().stale)).toBe(true);
    });
});
