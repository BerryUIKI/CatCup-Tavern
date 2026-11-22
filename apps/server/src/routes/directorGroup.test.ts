import { mkdir, rm, writeFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * The director on a group chat.
 *
 * The group route is separate from the single-chat one because a group chat is
 * addressed by group id, and because the single-chat refusal must not apply: a
 * group can play any member, including the one who could speak.
 */

let root: string;
let app: FastifyInstance;
let cookie: string;
let groupId: string;
let chatId: string;

async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-group-director-');
    await mkdir(fixturePath(root, 'characters'), { recursive: true });
    for (const name of ['Aurelia', 'Bram']) {
        await writeFile(
            fixturePath(root, 'characters', `${name}.json`),
            JSON.stringify({
                spec: 'chara_card_v2',
                spec_version: '2.0',
                data: { name, description: `${name} stands here.`, first_mes: `I am ${name}.` },
            }),
            'utf8',
        );
    }

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
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

    const group = await call('POST', '/api/groups', { name: 'Eldoria', members: ['Aurelia', 'Bram'] });
    groupId = group.json().group.id as string;

    const chat = await call('POST', `/api/groups/${encodeURIComponent(groupId)}/chats`, {});
    chatId = chat.json().chat.chatId as string;
}, 60_000);

afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('the group director routes', () => {
    const base = () => `/api/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}/director`;

    it('reports a default config for a group chat that has none', async () => {
        const response = await call('GET', base());
        expect(response.statusCode).toBe(200);
        expect(response.json().director.enabled).toBe(false);
    });

    it('lets a group play a member, which a single chat refuses', async () => {
        // The point of the separate route: no contradiction exists here, because
        // the speaker is chosen per turn and the played member is muted.
        const response = await call('PATCH', base(), {
            director: { enabled: true, playedMembers: ['Aurelia'], rules: 'Keep it tense.' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().director.playedMembers).toEqual(['Aurelia']);
    });

    it('reads back what was saved', async () => {
        const read = await call('GET', base());
        expect(read.json().director.rules).toBe('Keep it tense.');
        expect(read.json().enabled).toBe(true);
    });

    it('merges a partial patch rather than resetting the rest', async () => {
        await call('PATCH', base(), { director: { choices: true } });
        const read = await call('GET', base());

        expect(read.json().director.rules).toBe('Keep it tense.');
        expect(read.json().director.choices).toBe(true);
    });

    it('accepts a played member who is not in the group, without blocking the save', async () => {
        // A card temporarily out of a group must not stop a save that touches
        // something else; the block simply renders nobody for that entry.
        const response = await call('PATCH', base(), {
            director: { playedMembers: ['Aurelia', 'Gone'] },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().director.playedMembers).toEqual(['Aurelia', 'Gone']);
    });

    it('lists the group members as the cast', async () => {
        const response = await call('GET', `${base()}/cast`);
        const body = response.json() as { cast: { name: string }[]; isGroup: boolean };

        expect(body.isGroup).toBe(true);
        expect(body.cast.map((member) => member.name).sort()).toEqual(['Aurelia', 'Bram']);
    });

    it('404s a group chat that does not exist', async () => {
        const response = await call('GET', `/api/groups/${encodeURIComponent(groupId)}/chats/nope/director`);
        expect(response.statusCode).toBe(404);
    });

    it('keeps the config in chat_metadata so SillyTavern readers ignore it', async () => {
        const detail = await call(
            'GET',
            `/api/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}`,
        );
        const header = (detail.json().chat as { header: Record<string, unknown> }).header;

        expect(header.chat_metadata).toHaveProperty('director');
        expect(header).not.toHaveProperty('director');
    });
});
