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
    await writeFile(path.join(root, 'characters', 'Cass.json'), card('Cass'));
    await writeFile(
        path.join(root, 'characters', 'Dara.json'),
        JSON.stringify({
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: {
                name: 'Dara',
                scenario: 'the old road',
                first_mes: 'I am {{char}}, of {{scenario}}.',
            },
        }),
    );

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

    it('accepts a muted member by character id on create', async () => {
        const created = await call('POST', '/api/groups', {
            name: 'Muted by id',
            members: ['Aria'],
            disabled_members: ['Aria'],
        });

        expect(created.statusCode).toBe(201);
        expect(created.json().group.disabled_members).toEqual(['Aria.json']);
    });

    it('rejects unknown members', async () => {
        const response = await call('POST', '/api/groups', { members: ['Nobody'] });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('Nobody');
    });

    it('persists a three-character group across reads', async () => {
        const created = await call('POST', '/api/groups', {
            name: 'Full table',
            members: ['Aria', 'Bram', 'Cass'],
        });
        const groupId = created.json().group.id as string;

        const read = await call('GET', `/api/groups/${groupId}`);

        expect(read.statusCode).toBe(200);
        expect(read.json().group.members).toHaveLength(3);
        expect(read.json().group.memberDetails.map((member: { name: string }) => member.name)).toEqual([
            'Aria',
            'Bram',
            'Cass',
        ]);
    });

    it('creates a group chat and lists it', async () => {
        const created = await call('POST', '/api/groups', { name: 'Listed', members: ['Aria'] });
        const groupId = created.json().group.id as string;

        const chatResponse = await call('POST', `/api/groups/${groupId}/chats`, { name: 'opening' });
        expect(chatResponse.statusCode).toBe(201);
        expect(chatResponse.json().chat).toMatchObject({ groupId, chatId: 'opening' });
        expect(chatResponse.json().chat.messages).toMatchObject([
            {
                name: 'Aria',
                original_avatar: 'Aria.json',
                force_avatar: '/thumbnail?type=avatar&file=Aria.json',
                mes: 'Hello from Aria.',
                extra: { gen_id: expect.any(Number) },
            },
        ]);

        const list = await call('GET', `/api/groups/${groupId}/chats`);
        expect(list.json().chats).toMatchObject([{ id: 'opening', messageCount: 1 }]);
    });

    it('expands a seeded greeting with its own member macros', async () => {
        const created = await call('POST', '/api/groups', { name: 'Macro greeting', members: ['Dara'] });
        const groupId = created.json().group.id as string;

        const chatResponse = await call('POST', `/api/groups/${groupId}/chats`, { name: 'macro' });

        expect(chatResponse.json().chat.messages[0].mes).toBe('I am Dara, of the old road.');
        expect(chatResponse.json().chat.messages[0].extra.swipes).toEqual(['I am Dara, of the old road.']);
    });

    it('remembers the opened chat as chat_id', async () => {
        const created = await call('POST', '/api/groups', { name: 'Remember', members: ['Aria'] });
        const groupId = created.json().group.id as string;
        await call('POST', `/api/groups/${groupId}/chats`, { name: 'first' });
        const second = await call('POST', `/api/groups/${groupId}/chats`, { name: 'second' });
        expect(second.json().group.chat_id).toBe('second');

        const opened = await call('PATCH', `/api/groups/${groupId}/chats/first`, { current: true });

        expect(opened.statusCode).toBe(200);
        expect(opened.json().group.chat_id).toBe('first');
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

        const edited = await call('PATCH', `/api/groups/${groupId}/chats/${encodeURIComponent('edit me')}/messages/1`, {
            message: 'Spoken by {{char}}.',
        });

        expect(edited.statusCode).toBe(200);
        expect(edited.json().message.mes).toBe('Spoken by Aria.');
    });

    it('keeps a missing member when the group is edited', async () => {
        const created = await call('POST', '/api/groups', {
            name: 'Missing card',
            members: ['Aria', 'Bram'],
        });
        const groupId = created.json().group.id as string;
        await rm(path.join(root, 'characters', 'Bram.json'));

        const updated = await call('PATCH', `/api/groups/${groupId}`, {
            name: 'Still here',
            members: ['Aria.json', 'Bram.json'],
        });

        expect(updated.statusCode).toBe(200);
        expect(updated.json().group.members).toEqual(['Aria.json', 'Bram.json']);

        // Restore the card for the later tests.
        await writeFile(path.join(root, 'characters', 'Bram.json'), card('Bram'));
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
