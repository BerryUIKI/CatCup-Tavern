import { rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildCard, buildWorldBook, keysFromTitle, sectionsDraft } from '../distill/run.js';
import { createProfileDataDir } from '../testHelpers/profile.js';

let root: string;
let app: FastifyInstance;
let stub: Server;
let cookie: string;
let baseUrl: string;

const novel = [
    'Chapter 1',
    'Mira lit the lamp and waited for the inn to fill.',
    '',
    'Chapter 2',
    'Bram arrived late, soaked through.',
].join('\n');

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

async function upload(fileName: string, body: Buffer) {
    const boundary = '----catcupbookboundary';
    const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
            'Content-Type: application/octet-stream\r\n\r\n',
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

    return app.inject({
        method: 'POST',
        url: '/api/distill/books',
        payload: Buffer.concat([head, body, tail]),
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
}

/**
 * Drive an SSE run through a real socket.
 *
 * `inject` cannot carry a hijacked stream, so this is the same pattern the
 * generation tests use: a real listener, read to completion.
 */
async function streamRun(
    path: string,
): Promise<{ status: number; events: { type: string; [key: string]: unknown }[] }> {
    const response = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({}),
    });
    const text = await response.text();

    const events = text
        .split('\n\n')
        .map((block) => block.split('\n').find((line) => line.startsWith('data:')))
        .filter((line): line is string => Boolean(line))
        .map((line) => JSON.parse(line.slice(5).trim()) as { type: string });

    return { status: response.status, events };
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-distill-sections-');
    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');

    // A provider that answers nothing useful: sections mode must never reach it.
    stub = createServer((_request, response) => {
        response.writeHead(500);
        response.end();
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    vi.resetModules();
    const { buildApp } = await import('../app.js');
    app = await buildApp();
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });

    const setup = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { password: 'a long enough password' },
        remoteAddress: '127.0.0.1',
    });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

    const created = await call('POST', '/api/providers', {
        kind: 'openai',
        name: 'Unused',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        models: ['stub-model'],
        defaultModel: 'stub-model',
        enabled: true,
    });
    // Making it active matters: without this the run would resolve the seeded
    // default provider and reach the real internet from a test.
    await call('PATCH', '/api/settings', {
        activeProviderId: (created.json() as { provider: { id: string } }).provider.id,
    });
});

afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

describe('sections mode', () => {
    it('turns each chapter into an entry and streams its progress', async () => {
        const uploaded = await upload('novel.txt', Buffer.from(novel, 'utf8'));
        const bookId = (uploaded.json() as { book: { id: string } }).book.id;

        const { status, events } = await streamRun('/api/distill/runs');
        // The route reads the body, so this call proves nothing by itself —
        // the real run goes through the helper below.
        expect(status).toBe(400);
        expect(events).toEqual([]);

        const started = await fetch(`${baseUrl}/api/distill/runs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ bookId, mode: 'sections' }),
        });
        expect(started.status).toBe(200);
        const text = await started.text();

        const parsed = text
            .split('\n\n')
            .map((block) => block.split('\n').find((line) => line.startsWith('data:')))
            .filter((line): line is string => Boolean(line))
            .map((line) => JSON.parse(line.slice(5).trim()) as { type: string; [key: string]: unknown });

        expect(parsed[0]?.type).toBe('start');
        expect(parsed.some((event) => event.type === 'chunk')).toBe(true);
        expect(parsed.some((event) => event.type === 'progress')).toBe(true);

        const done = parsed.find((event) => event.type === 'done');
        expect(done).toBeTruthy();
        const run = done?.run as {
            status: string;
            draft: { entries: { comment: string; content: string }[] };
        };
        expect(run.status).toBe('done');
        expect(run.draft.entries.map((entry) => entry.comment)).toEqual(['Chapter 1', 'Chapter 2']);
        expect(run.draft.entries[0]?.content).toContain('Mira lit the lamp');
    });

    it('marks a chapter incomplete when the provider fails, rather than failing the run', async () => {
        const uploaded = await upload('later.txt', Buffer.from(novel, 'utf8'));
        const bookId = (uploaded.json() as { book: { id: string } }).book.id;

        // The fixture's provider answers 500 to everything.
        const started = await fetch(`${baseUrl}/api/distill/runs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ bookId, mode: 'model' }),
        });
        expect(started.status).toBe(200);

        const events = (await started.text())
            .split('\n\n')
            .map((block) => block.split('\n').find((line) => line.startsWith('data:')))
            .filter((line): line is string => Boolean(line))
            .map((line) => JSON.parse(line.slice(5).trim()) as { type: string; run?: Record<string, unknown> });

        const done = events.find((event) => event.type === 'done');
        // One unreadable chapter costs that chapter, not the book.
        const run = done?.run as { status: string; chunks: { state: string }[]; draft: { entries: unknown[] } };
        expect(run.status).toBe('done');
        expect(run.chunks.every((chunk) => chunk.state === 'incomplete')).toBe(true);
        expect(run.draft.entries).toEqual([]);
    });

    it('404s a run for a book that does not exist', async () => {
        const response = await call('POST', '/api/distill/runs', { bookId: 'nothing', mode: 'sections' });
        expect(response.statusCode).toBe(404);
    });

    it('keeps a record of a finished run', async () => {
        const uploaded = await upload('recorded.txt', Buffer.from(novel, 'utf8'));
        const bookId = (uploaded.json() as { book: { id: string } }).book.id;

        const started = await fetch(`${baseUrl}/api/distill/runs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ bookId, mode: 'sections' }),
        });
        await started.text();

        const listed = await call('GET', '/api/distill/runs');
        const runs = (listed.json() as { runs: { status: string; bookId: string }[] }).runs;
        expect(runs.some((run) => run.bookId === bookId && run.status === 'done')).toBe(true);
    });
});

describe('accepting a draft', () => {
    it('writes a world info book and links cards to it', async () => {
        const uploaded = await upload('accepted.txt', Buffer.from(novel, 'utf8'));
        const bookId = (uploaded.json() as { book: { id: string } }).book.id;

        const started = await fetch(`${baseUrl}/api/distill/runs`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: JSON.stringify({ bookId, mode: 'sections' }),
        });
        const text = await started.text();
        const done = text
            .split('\n\n')
            .map((block) => block.split('\n').find((line) => line.startsWith('data:')))
            .filter((line): line is string => Boolean(line))
            .map((line) => JSON.parse(line.slice(5).trim()) as { type: string; run?: { id: string } })
            .find((event) => event.type === 'done');
        const runId = done?.run?.id;
        expect(runId).toBeTruthy();

        const accepted = await call('POST', `/api/distill/runs/${runId}/accept`, {
            entries: [
                {
                    key: ['mira'],
                    comment: 'Chapter 1',
                    content: 'Mira lit the lamp.',
                    chapter: 'Chapter 1',
                    accepted: true,
                },
                // Unticked, so it must not reach the file.
                {
                    key: ['bram'],
                    comment: 'Chapter 2',
                    content: 'Bram arrived.',
                    chapter: 'Chapter 2',
                    accepted: false,
                },
            ],
            characters: [
                {
                    name: 'Mira',
                    description: 'An innkeeper.',
                    personality: 'Careful.',
                    accepted: true,
                },
                { name: 'Bram', description: 'Late.', accepted: false },
            ],
            world: { id: 'the-inn', scope: 'profile' },
            characterScope: 'profile',
            linkWorld: true,
        });

        expect(accepted.statusCode).toBe(200);
        const body = accepted.json() as { worldId: string; characterIds: string[] };
        expect(body.worldId).toBe('the-inn');
        expect(body.characterIds).toHaveLength(1);

        // The book is a real ST book with only the ticked entry.
        const book = await call('GET', `/api/worlds/${encodeURIComponent(body.worldId)}`);
        expect(book.statusCode).toBe(200);
        const entries = (book.json() as { world: { entries: { comment: string }[] } }).world.entries;
        expect(entries.map((entry) => entry.comment)).toEqual(['Chapter 1']);

        // The card is a real card, pointed at the book.
        const card = await call('GET', `/api/characters/${encodeURIComponent(body.characterIds[0] as string)}`);
        const character = (
            card.json() as { character: { name: string; scope: string; card: { extensions: { world: string } } } }
        ).character;
        expect(character.name).toBe('Mira');
        expect(character.card.extensions.world).toBe('the-inn');
    });

    it('refuses a run that is still going', async () => {
        const response = await call('POST', '/api/distill/runs/not-a-run/accept', {
            world: { id: 'x', scope: 'profile' },
        });
        expect(response.statusCode).toBe(404);
    });
});

describe('distill helpers', () => {
    it('derives keys from a chapter title without the filler', () => {
        expect(keysFromTitle('Chapter 12')).toEqual([]);
        expect(keysFromTitle('The Cat’s Cup')).toEqual(['cat', 'cup']);
        expect(keysFromTitle('第一章')).toEqual([]);
        expect(keysFromTitle('The Long Road to Eldoria')).toEqual(['long', 'road', 'eldoria']);
    });

    it('builds entries from SillyTavern defaults so the book opens in ST', () => {
        const entries = sectionsDraft([{ title: 'Chapter 1', text: 'Text.' }]);
        expect(entries[0]?.content).toBe('Text.');
        // Not constant: a chapter is not present in every scan.
        expect(entries[0]?.constant).toBe(false);
    });

    it('builds a book whose entries carry the full ST template', () => {
        const book = buildWorldBook(sectionsDraft([{ title: 'One', text: 'Body.' }]));
        const entry = book.entries['0'] as Record<string, unknown>;
        expect(entry.uid).toBe(0);
        expect(entry.content).toBe('Body.');
        // A field the editor does not show is still written, with ST's default.
        expect(entry.probability).toBe(100);
        expect(entry.useProbability).toBe(true);
    });

    it('builds a V2 card carrying the world link and provenance', () => {
        const card = JSON.parse(
            buildCard(
                {
                    name: 'Mira',
                    aliases: ['the innkeeper'],
                    description: 'An innkeeper.',
                    personality: '',
                    scenario: '',
                    first_mes: '',
                    mes_example: '',
                    tags: [],
                    mentions: 3,
                    confidence: 'high',
                    evidence: '',
                    accepted: true,
                },
                'the-inn',
            ).toString('utf8'),
        ) as { spec: string; data: { name: string; extensions: Record<string, unknown> } };

        expect(card.spec).toBe('chara_card_v2');
        expect(card.data.name).toBe('Mira');
        expect(card.data.extensions.world).toBe('the-inn');
        expect(card.data.extensions.catcup_distill).toMatchObject({ aliases: ['the innkeeper'], mentions: 3 });
    });
});
