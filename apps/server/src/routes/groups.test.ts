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
        data: { name, first_mes: `Hello from ${name}.` },
    });
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-groups-routes-'));
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

describe('group routes', () => {
    it('creates a group from character ids and resolves member details', async () => {
        const response = await call('POST', '/api/groups', {
            name: 'The Cup',
            members: ['Aria', 'Bram'],
        });

        expect(response.statusCode).toBe(201);
        const { group } = response.json();
        expect(group.members).toEqual(['Aria.json', 'Bram.json']);
        expect(group.memberDetails).toMatchObject([
            { fileName: 'Aria.json', id: 'Aria', name: 'Aria' },
            { fileName: 'Bram.json', id: 'Bram', name: 'Bram' },
        ]);
    });

    it('rejects unknown members', async () => {
        const response = await call('POST', '/api/groups', { members: ['Nobody'] });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('Nobody');
    });

    it('creates a group chat and lists it', async () => {
        const created = await call('POST', '/api/groups', { name: 'Listed', members: ['Aria'] });
        const groupId = created.json().group.id as string;

        const chatResponse = await call('POST', `/api/groups/${groupId}/chats`, { name: 'opening' });
        expect(chatResponse.statusCode).toBe(201);
        expect(chatResponse.json().chat).toMatchObject({ groupId, chatId: 'opening', messages: [] });

        const list = await call('GET', `/api/groups/${groupId}/chats`);
        expect(list.json().chats).toMatchObject([{ id: 'opening', messageCount: 0 }]);
    });

    it('edits a group message with the speaker macros', async () => {
        const created = await call('POST', '/api/groups', { name: 'Editing', members: ['Aria'] });
        const groupId = created.json().group.id as string;
        await call('POST', `/api/groups/${groupId}/chats`, { name: 'edit me' });

        const storage = await import('../storage/groups.js');
        const found = await storage.getGroup(groupId);
        if (!found) {
            throw new Error('Group not found');
        }
        await storage.appendGroupMessage(found.group, 'edit me', {
            name: 'Aria',
            is_user: false,
            mes: 'Original.',
            original_avatar: 'Aria.json',
        });

        const edited = await call('PATCH', `/api/groups/${groupId}/chats/${encodeURIComponent('edit me')}/messages/0`, {
            message: 'Spoken by {{char}}.',
        });

        expect(edited.statusCode).toBe(200);
        expect(edited.json().message.mes).toBe('Spoken by Aria.');
    });

    it('deletes a group and its chats', async () => {
        const created = await call('POST', '/api/groups', { name: 'Doomed', members: ['Aria'] });
        const groupId = created.json().group.id as string;
        await call('POST', `/api/groups/${groupId}/chats`, { name: 'doomed chat' });

        const deleted = await call('DELETE', `/api/groups/${groupId}`);
        expect(deleted.statusCode).toBe(200);

        const missing = await call('GET', `/api/groups/${groupId}`);
        expect(missing.statusCode).toBe(404);
    });
});
