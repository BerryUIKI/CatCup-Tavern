import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * The Telegram import, end to end through the API.
 *
 * The parser has its own unit tests; what this file proves is that the written
 * chat is a *real* chat — the same JSONL header and message shape the app
 * writes, in the character's chat folder, readable back through the normal API.
 * An import that produced something only this importer understood would defeat
 * the point.
 */

let root: string;
let app: FastifyInstance;
let cookie: string;

const EXPORT = {
    name: 'Eldoria nights',
    type: 'personal_chat',
    messages: [
        { id: 1, type: 'message', date: '2026-01-01T10:00:00', from: 'Aurelia', text: 'The gate is warded.' },
        { id: 2, type: 'message', date: '2026-01-01T10:01:00', from: 'You', text: 'I touch it anyway.' },
        { id: 3, type: 'service', date: '2026-01-01T10:02:00', actor: 'You', action: 'join_group_by_link' },
        { id: 4, type: 'message', date: '2026-01-01T10:03:00', from: 'Aurelia', text: 'It hums.' },
    ],
};

async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-telegram-import-');
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
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';
}, 60_000);

afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('the Telegram import routes', () => {
    const raw = JSON.stringify(EXPORT);

    it('scans without writing anything', async () => {
        const response = await call('POST', '/api/import/telegram/scan', { raw });
        expect(response.statusCode).toBe(200);

        const { scan } = response.json() as {
            scan: { messages: unknown[]; participants: unknown[]; title: string };
        };
        expect(scan.title).toBe('Eldoria nights');
        expect(scan.messages).toHaveLength(3);
        expect(scan.participants).toEqual([
            { name: 'Aurelia', count: 2 },
            { name: 'You', count: 1 },
        ]);

        // Nothing was written: the character has no chat folder at all yet.
        const chats = await readdir(fixturePath(root, 'chats')).catch(() => [] as string[]);
        expect(chats).toEqual([]);
    });

    it('rejects a file that is not JSON, with a message naming the fix', async () => {
        const response = await call('POST', '/api/import/telegram/scan', { raw: 'not json at all' });
        expect(response.statusCode).toBe(400);
        expect((response.json() as { error: string }).error).toMatch(/JSON format/);
    });

    it('writes a chat the app can read back through its own API', async () => {
        const response = await call('POST', '/api/import/telegram', {
            raw,
            characterId: 'Aurelia',
            owner: 'You',
        });
        expect(response.statusCode).toBe(200);

        const body = response.json() as { chat: { chatId: string }; imported: number };
        expect(body.imported).toBe(3);

        // Read it back the ordinary way: if this works, the import wrote a real
        // chat rather than something only the importer understands.
        const chat = await call('GET', `/api/chats/Aurelia/${encodeURIComponent(body.chat.chatId)}`);
        expect(chat.statusCode).toBe(200);

        const detail = chat.json().chat as {
            header: { user_name: string; character_name: string };
            messages: Array<{ name: string; is_user: boolean; mes: string }>;
        };
        expect(detail.header.user_name).toBe('You');
        expect(detail.header.character_name).toBe('Aurelia');
        expect(detail.messages.map((message) => [message.is_user, message.mes])).toEqual([
            [false, 'The gate is warded.'],
            [true, 'I touch it anyway.'],
            [false, 'It hums.'],
        ]);
    });

    it('names the chat after the export and adds a copy on a second import', async () => {
        const again = await call('POST', '/api/import/telegram', { raw, characterId: 'Aurelia', owner: 'You' });
        expect(again.statusCode).toBe(200);

        const first = 'Eldoria nights.jsonl';
        const files = await readdir(fixturePath(root, 'chats', 'Aurelia'));
        expect(files).toContain(first);
        // A repeat import adds rather than overwrites, as the ST folder import
        // does, so a mistake costs a duplicate rather than the original.
        expect(files.filter((name) => name.startsWith('Eldoria nights')).length).toBeGreaterThan(1);
    });

    it('writes the file as JSONL with a header line and one message per line', async () => {
        const files = await readdir(fixturePath(root, 'chats', 'Aurelia'));
        const file = files.find((name) => name.endsWith('.jsonl'));
        expect(file).toBeDefined();

        const content = await readFile(fixturePath(root, 'chats', 'Aurelia', file ?? ''), 'utf8');
        const lines = content.trimEnd().split('\n');
        const header = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;

        expect(header).toHaveProperty('chat_metadata');
        expect(header).toHaveProperty('user_name');
        expect(header).toHaveProperty('character_name');
        // One header plus three messages, and the service row is not among them.
        expect(lines).toHaveLength(4);
        expect(content).not.toContain('join_group_by_link');
    });

    it('refuses an owner who never speaks, rather than importing an empty user side', async () => {
        const response = await call('POST', '/api/import/telegram', {
            raw,
            characterId: 'Aurelia',
            owner: 'Nobody',
        });
        expect(response.statusCode).toBe(400);
        expect((response.json() as { error: string }).error).toContain('Nobody');
    });

    it('refuses a group export instead of collapsing its speakers', async () => {
        const group = JSON.stringify({
            name: 'Table',
            messages: [
                { id: 1, type: 'message', from: 'You', text: 'One.' },
                { id: 2, type: 'message', from: 'Ana', text: 'Two.' },
                { id: 3, type: 'message', from: 'Bo', text: 'Three.' },
            ],
        });

        const response = await call('POST', '/api/import/telegram', {
            raw: group,
            characterId: 'Aurelia',
            owner: 'You',
        });
        expect(response.statusCode).toBe(400);
        expect((response.json() as { error: string }).error).toMatch(/group/i);
    });

    it('404s a character that does not exist', async () => {
        const response = await call('POST', '/api/import/telegram', {
            raw,
            characterId: 'Nobody',
            owner: 'You',
        });
        expect(response.statusCode).toBe(404);
    });
});
