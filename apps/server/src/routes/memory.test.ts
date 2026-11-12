import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let root: string;
let app: FastifyInstance;
let cookie: string;

function card(name: string): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: {
            name,
            first_mes: `Hello from ${name}.`,
            alternate_greetings: [`Another hello from ${name}.`],
        },
    });
}

async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-memory-routes-'));
    await mkdir(path.join(root, 'characters'), { recursive: true });
    await writeFile(path.join(root, 'characters', 'Aria.json'), card('Aria'));
    await writeFile(path.join(root, 'characters', 'Bram.json'), card('Bram'));

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
}, 60_000);

afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('memory routes', () => {
    it('saves and clears a character summary', async () => {
        const created = await call('POST', '/api/characters/Aria/chats', {});
        expect(created.statusCode).toBe(200);
        const chatId = created.json().chat.chatId as string;

        const saved = await call('PUT', `/api/chats/Aria/${chatId}/memory`, {
            text: 'Aria greeted the traveler at the gate.',
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json().summary).toMatchObject({
            value: 'Aria greeted the traveler at the gate.',
            index: 0,
        });

        const chat = await call('GET', `/api/chats/Aria/${chatId}`);
        expect(chat.json().chat.messages[0].extra.memory).toBe('Aria greeted the traveler at the gate.');

        const cleared = await call('DELETE', `/api/chats/Aria/${chatId}/memory`);
        expect(cleared.statusCode).toBe(200);
        expect(cleared.json().summary).toBeNull();

        const after = await call('GET', `/api/chats/Aria/${chatId}`);
        expect(after.json().chat.messages[0].extra).not.toHaveProperty('memory');
    });

    it('rejects an empty summary', async () => {
        const created = await call('POST', '/api/characters/Aria/chats', {});
        const chatId = created.json().chat.chatId as string;

        const response = await call('PUT', `/api/chats/Aria/${chatId}/memory`, { text: '   ' });
        expect(response.statusCode).toBe(400);
    });

    it('clears a summary when the opening greeting changes', async () => {
        const created = await call('POST', '/api/characters/Aria/chats', {});
        const chatId = created.json().chat.chatId as string;
        await call('PUT', `/api/chats/Aria/${chatId}/memory`, { text: 'The opening summary.' });

        const greeting = await call('POST', `/api/chats/Aria/${chatId}/greeting`, { greetingIndex: 1 });
        expect(greeting.statusCode).toBe(200);

        const chat = await call('GET', `/api/chats/Aria/${chatId}`);
        expect(chat.json().chat.messages[0].extra).not.toHaveProperty('memory');
    });

    it('clears a summary when the message swipe changes', async () => {
        const created = await call('POST', '/api/characters/Aria/chats', {});
        const chatId = created.json().chat.chatId as string;
        await call('PUT', `/api/chats/Aria/${chatId}/memory`, { text: 'The opening summary.' });

        const swiped = await call('PATCH', `/api/chats/Aria/${chatId}/messages/0`, { swipeId: 1 });
        expect(swiped.statusCode).toBe(200);
        expect(swiped.json().message.mes).toBe('Another hello from Aria.');

        const chat = await call('GET', `/api/chats/Aria/${chatId}`);
        expect(chat.json().chat.messages[0].extra).not.toHaveProperty('memory');
    });

    it('returns a reason instead of calling the provider when nothing can be summarized', async () => {
        const created = await call('POST', '/api/characters/Aria/chats', {});
        const chatId = created.json().chat.chatId as string;

        const response = await call('POST', `/api/chats/Aria/${chatId}/summarize`);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            summary: null,
            reason: 'No new messages to summarize.',
        });
    });

    it('saves and clears a group summary', async () => {
        const group = await call('POST', '/api/groups', {
            name: 'The Cup',
            members: ['Aria', 'Bram'],
        });
        expect(group.statusCode).toBe(201);
        const groupId = group.json().group.id as string;

        const createdChat = await call('POST', `/api/groups/${groupId}/chats`, {});
        expect(createdChat.statusCode).toBe(201);
        const chatId = createdChat.json().chat.chatId as string;

        const saved = await call('PUT', `/api/groups/${groupId}/chats/${chatId}/memory`, {
            text: 'The group met at the tavern.',
        });
        expect(saved.statusCode).toBe(200);
        expect(saved.json().summary.index).toBe(0);

        const chat = await call('GET', `/api/groups/${groupId}/chats/${chatId}`);
        expect(chat.json().chat.messages[0].extra.memory).toBe('The group met at the tavern.');

        const cleared = await call('DELETE', `/api/groups/${groupId}/chats/${chatId}/memory`);
        expect(cleared.statusCode).toBe(200);
        expect(cleared.json().summary).toBeNull();

        const after = await call('GET', `/api/groups/${groupId}/chats/${chatId}`);
        expect(after.json().chat.messages[0].extra).not.toHaveProperty('memory');
    });
});
