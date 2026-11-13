import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { strippedDraft } from './generate.js';

let root: string;
let app: FastifyInstance;
let stub: Server;
let cookie: string;
let baseUrl: string;

function card(name: string): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, first_mes: `Hello from ${name}.` },
    });
}

async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

async function createChat(): Promise<string> {
    const created = await call('POST', '/api/characters/Aria/chats', {});
    expect(created.statusCode).toBe(200);
    return created.json().chat.chatId as string;
}

/** POST an SSE endpoint through a real socket; `inject` cannot carry a hijacked stream. */
async function generate(url: string, body: Record<string, unknown>): Promise<string> {
    const response = await fetch(`${baseUrl}${url}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return response.text();
}

/** Simulate the partial reply a stopped stream persists. */
async function markLastStopped(chatId: string): Promise<void> {
    const file = path.join(root, 'chats', 'Aria', `${chatId}.jsonl`);
    const lines = (await readFile(file, 'utf8')).trimEnd().split('\n');
    const header = lines[0];
    const messages = lines.slice(1).map((line) => JSON.parse(line) as Record<string, unknown>);
    const last = messages[messages.length - 1];
    if (last) {
        last.extra = { ...(last.extra as Record<string, unknown> | undefined), stopped: true };
    }
    await writeFile(file, `${[header, ...messages.map((message) => JSON.stringify(message))].join('\n')}\n`);
}

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-generate-routes-'));
    await mkdir(path.join(root, 'characters'), { recursive: true });
    await writeFile(path.join(root, 'characters', 'Aria.json'), card('Aria'));
    await writeFile(path.join(root, 'characters', 'Bram.json'), card('Bram'));

    stub = createServer((request, response) => {
        request.resume();
        if (request.method === 'POST' && request.url?.endsWith('/chat/completions')) {
            response.writeHead(200, {
                'content-type': 'text/event-stream',
                'cache-control': 'no-cache',
                connection: 'keep-alive',
            });
            response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Stub reply.' } }] })}\n\n`);
            response.write('data: [DONE]\n\n');
            response.end();
            return;
        }
        if (request.method === 'GET' && request.url?.endsWith('/models')) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
            return;
        }
        response.writeHead(404);
        response.end();
    });
    await new Promise<void>((resolve) => {
        stub.listen(0, '127.0.0.1', resolve);
    });
    const address = stub.address();
    const port = typeof address === 'object' && address ? address.port : 0;

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

    const provider = await call('POST', '/api/providers', {
        kind: 'openai',
        name: 'Stub',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'stub-model',
        enabled: true,
        headers: {},
        apiKey: 'stub-key',
    });
    expect(provider.statusCode).toBe(200);
    const providerId = provider.json().provider.id as string;
    const active = await call('PATCH', '/api/settings', { activeProviderId: providerId });
    expect(active.statusCode).toBe(200);

    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
}, 60_000);

afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => {
        stub.close(() => resolve());
    });
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('generate routes', () => {
    it('answers a trigger without appending a user message', async () => {
        const chatId = await createChat();
        const body = await generate('/api/generate', { characterId: 'Aria', chatId, action: 'trigger' });
        expect(body).toContain('event: done');

        const chat = await call('GET', `/api/chats/Aria/${encodeURIComponent(chatId)}`);
        const messages = chat.json().chat.messages as Array<Record<string, unknown>>;
        expect(messages).toHaveLength(2);
        expect(messages[0]).toMatchObject({ mes: 'Hello from Aria.' });
        expect(messages[1]).toMatchObject({ name: 'Aria', is_user: false, mes: 'Stub reply.' });
    });

    it('answers an impersonation with a draft and stores nothing', async () => {
        const chatId = await createChat();
        const body = await generate('/api/generate', { characterId: 'Aria', chatId, action: 'impersonate' });
        expect(body).toContain('event: done');
        expect(body).toContain('Stub reply.');

        // The draft arrives in the shape a saved message would have, so the
        // client has one thing to read — but the chat file is untouched and
        // only the user's own send creates a message.
        const chat = await call('GET', `/api/chats/Aria/${encodeURIComponent(chatId)}`);
        const messages = chat.json().chat.messages as Array<Record<string, unknown>>;
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ mes: 'Hello from Aria.' });
    });

    it('continues and regenerates the last reply through the same actions', async () => {
        const chatId = await createChat();
        await generate('/api/generate', { characterId: 'Aria', chatId, action: 'trigger' });

        await generate('/api/generate', { characterId: 'Aria', chatId, action: 'continue' });
        let chat = await call('GET', `/api/chats/Aria/${encodeURIComponent(chatId)}`);
        let messages = chat.json().chat.messages as Array<Record<string, unknown>>;
        expect(messages).toHaveLength(2);
        expect(messages[1]).toMatchObject({ mes: 'Stub reply.Stub reply.' });

        await generate('/api/generate', { characterId: 'Aria', chatId, action: 'regenerate' });
        chat = await call('GET', `/api/chats/Aria/${encodeURIComponent(chatId)}`);
        messages = chat.json().chat.messages as Array<Record<string, unknown>>;
        expect(messages).toHaveLength(2);
        expect(messages[1]).toMatchObject({ mes: 'Stub reply.' });
        expect(messages[1].extra).toMatchObject({ swipe_id: 1, swipes: ['Stub reply.Stub reply.', 'Stub reply.'] });
    });

    // Three sequential SSE round-trips plus two unlocked file rewrites; on a
    // machine whose worker pool is saturated this exceeds the 5s default, so
    // give it the same headroom the hooks already get.
    it('clears a stopped marker when continue or regenerate completes the reply', async () => {
        const chatId = await createChat();
        await generate('/api/generate', { characterId: 'Aria', chatId, action: 'trigger' });

        await markLastStopped(chatId);
        await generate('/api/generate', { characterId: 'Aria', chatId, action: 'continue' });
        let chat = await call('GET', `/api/chats/Aria/${encodeURIComponent(chatId)}`);
        let messages = chat.json().chat.messages as Array<Record<string, unknown>>;
        expect((messages[1]?.extra as Record<string, unknown> | undefined)?.stopped).toBeUndefined();

        await markLastStopped(chatId);
        await generate('/api/generate', { characterId: 'Aria', chatId, action: 'regenerate' });
        chat = await call('GET', `/api/chats/Aria/${encodeURIComponent(chatId)}`);
        messages = chat.json().chat.messages as Array<Record<string, unknown>>;
        expect((messages[1]?.extra as Record<string, unknown> | undefined)?.stopped).toBeUndefined();
    }, 20_000);

    it('appends a new reply when regenerating after a narrator note', async () => {
        const chatId = await createChat();
        await generate('/api/generate', { characterId: 'Aria', chatId, action: 'trigger' });

        const created = await call('POST', '/api/quick-replies', { name: 'Note' });
        expect(created.statusCode).toBe(201);
        const set = created.json().set as { id: string };
        const saved = await call('PUT', `/api/quick-replies/${encodeURIComponent(set.id)}`, {
            version: 2,
            name: 'Note',
            qrList: [{ id: 1, label: 'Note', message: '/sys A note.' }],
            idIndex: 1,
        });
        expect(saved.statusCode).toBe(200);
        const executed = await call('POST', `/api/chats/Aria/${encodeURIComponent(chatId)}/quick-replies/execute`, {
            setId: set.id,
            qrId: 1,
        });
        expect(executed.statusCode).toBe(200);

        await generate('/api/generate', { characterId: 'Aria', chatId, action: 'regenerate' });
        const chat = await call('GET', `/api/chats/Aria/${encodeURIComponent(chatId)}`);
        const messages = chat.json().chat.messages as Array<Record<string, unknown>>;
        expect(messages).toHaveLength(4);
        expect(messages[2]).toMatchObject({ name: 'System', mes: 'A note.', extra: { type: 'narrator' } });
        expect(messages[3]).toMatchObject({ name: 'Aria', is_user: false, mes: 'Stub reply.' });
    });

    it('answers a group trigger as the forced member', async () => {
        const group = await call('POST', '/api/groups', { name: 'Stub group', members: ['Aria', 'Bram'] });
        expect(group.statusCode).toBe(201);
        const groupId = group.json().group.id as string;
        const created = await call('POST', `/api/groups/${groupId}/chats`, {});
        expect(created.statusCode).toBe(201);
        const chatId = created.json().chat.chatId as string;

        const body = await generate(`/api/groups/${groupId}/chats/${encodeURIComponent(chatId)}/generate`, {
            action: 'trigger',
            speaker: 'Bram.json',
        });
        expect(body).toContain('event: done');

        const chat = await call('GET', `/api/groups/${groupId}/chats/${encodeURIComponent(chatId)}`);
        const messages = chat.json().chat.messages as Array<Record<string, unknown>>;
        expect(messages).toHaveLength(3);
        expect(messages[2]).toMatchObject({
            name: 'Bram',
            original_avatar: 'Bram.json',
            mes: 'Stub reply.',
        });
    });
});

describe('strippedDraft', () => {
    it('removes the persona prefix the prefill added', () => {
        expect(strippedDraft('Alex: I step inside.', 'Alex:')).toBe('I step inside.');
    });

    it('removes the prefix with surrounding whitespace', () => {
        expect(strippedDraft('  Alex:   I step inside.', 'Alex:  ')).toBe('I step inside.');
        expect(strippedDraft('alex: I step inside.', 'Alex:')).toBe('I step inside.');
    });

    it('leaves a draft alone when the prefix never arrived', () => {
        expect(strippedDraft('I step inside.', 'Alex:')).toBe('I step inside.');
    });

    it('only strips the prefix from the start', () => {
        expect(strippedDraft('I step inside.\nAlex: really?', 'Alex:')).toBe('I step inside.\nAlex: really?');
    });
});
