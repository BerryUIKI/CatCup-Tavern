import { mkdir, rm, writeFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * The director's API, and the compatibility promise it rests on.
 *
 * Two things here are worth more than the rest: a chat with no director must
 * round-trip unchanged, and a single chat must be refused for playing its own
 * card — the refusal is the only thing standing between a person and a model
 * that occasionally writes their lines for them.
 */

let root: string;
let app: FastifyInstance;
let cookie: string;
let chatId: string;

async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-director-');
    await mkdir(fixturePath(root, 'characters'), { recursive: true });
    await writeFile(
        fixturePath(root, 'characters', 'Aurelia.json'),
        JSON.stringify({
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: { name: 'Aurelia', description: 'A guardian.', first_mes: 'Welcome.' },
        }),
        'utf8',
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
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

    const created = await call('POST', '/api/characters/Aurelia/chats', {});
    chatId = created.json().chat.chatId as string;
}, 60_000);

afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('the director routes', () => {
    it('reports a default config for a chat that has none', async () => {
        const response = await call('GET', `/api/chats/Aurelia/${encodeURIComponent(chatId)}/director`);
        expect(response.statusCode).toBe(200);

        const body = response.json() as { director: { enabled: boolean }; enabled: boolean };
        expect(body.director.enabled).toBe(false);
        expect(body.enabled).toBe(false);
    });

    it('saves rules and reports them back', async () => {
        const saved = await call('PATCH', `/api/chats/Aurelia/${encodeURIComponent(chatId)}/director`, {
            director: { enabled: true, rules: 'Keep the pace slow.', choices: true, choiceCount: 3 },
        });
        expect(saved.statusCode).toBe(200);

        const read = await call('GET', `/api/chats/Aurelia/${encodeURIComponent(chatId)}/director`);
        expect(read.json().director.rules).toBe('Keep the pace slow.');
        expect(read.json().enabled).toBe(true);
    });

    it('merges a partial patch instead of resetting the rest', async () => {
        // A form that sends only what changed must not wipe the rules — the
        // same trap the memory settings had.
        await call('PATCH', `/api/chats/Aurelia/${encodeURIComponent(chatId)}/director`, {
            director: { choiceCount: 4 },
        });

        const read = await call('GET', `/api/chats/Aurelia/${encodeURIComponent(chatId)}/director`);
        expect(read.json().director.rules).toBe('Keep the pace slow.');
        expect(read.json().director.choiceCount).toBe(4);
    });

    it('refuses a single chat playing its own character, with the way out named', async () => {
        const response = await call('PATCH', `/api/chats/Aurelia/${encodeURIComponent(chatId)}/director`, {
            director: { enabled: true, playedMembers: ['Aurelia'] },
        });

        expect(response.statusCode).toBe(400);
        const body = response.json() as { error: string; code?: string };
        expect(body.code).toBe('DIRECTOR_SELF_PLAY');
        expect(body.error).toContain('Aurelia');
        expect(body.error).toContain('group');
        expect(body.error).toContain('narrator');
    });

    it('leaves the stored config alone when a save is refused', async () => {
        const read = await call('GET', `/api/chats/Aurelia/${encodeURIComponent(chatId)}/director`);
        // The refused save named the card; the stored config must not now hold it.
        expect(read.json().director.playedMembers).toEqual([]);
        expect(read.json().director.rules).toBe('Keep the pace slow.');
    });

    it('lists the chat’s own card as the cast, and says it is not a group', async () => {
        const response = await call('GET', `/api/chats/Aurelia/${encodeURIComponent(chatId)}/director/cast`);
        expect(response.json()).toEqual({
            cast: [{ id: 'Aurelia', name: 'Aurelia' }],
            isGroup: false,
        });
    });

    it('leaves the chat file parseable by a SillyTavern reader', async () => {
        const detail = await call('GET', `/api/chats/Aurelia/${encodeURIComponent(chatId)}`);
        const header = (detail.json().chat as { header: Record<string, unknown> }).header;

        // The director lives in chat_metadata, which is an untyped bag ST
        // preserves and ignores. It must be in the header, not as a top-level key.
        expect(header.chat_metadata).toHaveProperty('director');
        expect(header).not.toHaveProperty('director');
    });

    it('404s a chat that does not exist', async () => {
        const response = await call('GET', '/api/chats/Aurelia/nope/director');
        expect(response.statusCode).toBe(404);
    });
});
