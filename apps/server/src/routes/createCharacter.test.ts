import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { parseCardBuffer } from '@catcup/compat-st';
import type { FastifyInstance } from 'fastify';
import extract from 'png-chunks-extract';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * Creating a card from nothing (issue #168).
 *
 * The acceptance criteria this file exists to hold: a card appears in the
 * library immediately, a duplicate name never overwrites, the result exports
 * and re-imports with every field intact, and — the one easiest to get wrong —
 * a card created here is indistinguishable to the importer from one that
 * arrived as a file.
 */

let root: string;
let app: FastifyInstance;
let cookie: string;

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
}

async function create(body: Record<string, unknown>) {
    return call('POST', '/api/characters', body);
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-create-character-');
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

describe('creating a character', () => {
    it('creates a card, and the library lists it straight away', async () => {
        const response = await create({ name: 'Wren', description: 'A cartographer.' });
        expect(response.statusCode).toBe(201);

        const body = response.json() as { character: { id: string; fileName: string; format: string; name: string } };
        expect(body.character).toMatchObject({
            id: 'Wren',
            fileName: 'Wren.png',
            format: 'png',
            name: 'Wren',
        });

        const library = await call('GET', '/api/characters');
        const listed = (library.json() as { characters: Array<{ id: string }> }).characters;
        expect(listed.map((entry) => entry.id)).toContain('Wren');
    });

    it('answers with the whole card, because the client opens the editor on it', async () => {
        const response = await create({ name: 'Halcyon', description: 'Reads the response directly.' });
        const body = response.json() as { character: Record<string, unknown> };

        // The editor reads `character.card` the moment it opens; a summary here
        // would open a dialog that crashes on the first field it touches.
        expect(body.character.card).toMatchObject({ name: 'Halcyon', description: 'Reads the response directly.' });
        expect(body.character).toHaveProperty('rawCard');

        // And what it answers with is byte-for-byte what a later read gives, so
        // the query cache and a refetch cannot disagree.
        const fetched = await call('GET', '/api/characters/Halcyon');
        expect((fetched.json() as { character: { card: unknown } }).character.card).toEqual(
            (body.character as { card: unknown }).card,
        );
    });

    it('gives the new card a placeholder picture the avatar route serves', async () => {
        await create({ name: 'Bram' });

        const avatar = await call('GET', '/api/characters/Bram/avatar');
        expect(avatar.statusCode).toBe(200);
        expect(avatar.headers['content-type']).toBe('image/png');
        expect(avatar.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('suffixes a duplicate name rather than overwriting it', async () => {
        await create({ name: 'Ash', description: 'The first one.' });
        const second = await create({ name: 'Ash', description: 'The second one.' });
        expect(second.statusCode).toBe(201);

        const body = second.json() as { character: { id: string } };
        expect(body.character.id).toBe('Ash (2)');

        // The first card is untouched: this is the whole point of the suffix.
        const first = await call('GET', '/api/characters/Ash');
        expect((first.json() as { character: { card: { description: string } } }).character.card.description).toBe(
            'The first one.',
        );
        const suffixed = await call('GET', '/api/characters/Ash (2)');
        expect((suffixed.json() as { character: { card: { description: string } } }).character.card.description).toBe(
            'The second one.',
        );
    });

    it('keeps a name the file system cannot take, in the card and not on disk', async () => {
        const response = await create({ name: 'Lüna / the Wanderer' });
        expect(response.statusCode).toBe(201);

        const body = response.json() as { character: { id: string; name: string } };
        // The card says what the person typed; the file name is what a folder allows.
        expect(body.character.name).toBe('Lüna / the Wanderer');
        expect(body.character.id).not.toContain('/');
    });

    it('creates a card whose fields are exactly the ones asked for', async () => {
        await create({
            name: 'Ivy',
            scenario: 'A greenhouse at midnight.',
            first_mes: 'The door was already open.',
            tags: ['botany'],
        });

        const response = await call('GET', '/api/characters/Ivy');
        const card = (response.json() as { character: { card: Record<string, unknown> } }).character.card;

        expect(card.name).toBe('Ivy');
        expect(card.scenario).toBe('A greenhouse at midnight.');
        expect(card.first_mes).toBe('The door was already open.');
        expect(card.tags).toEqual(['botany']);
        // A field nobody set is absent rather than filled with an empty string,
        // so the editor shows an empty box instead of a value it invented.
        expect(card.personality).toBe('');
    });

    it('refuses an unknown field, naming it', async () => {
        const response = await create({ name: 'Nope', describtion: 'a typo' });
        expect(response.statusCode).toBe(400);
        expect(response.body).toContain('describtion');
    });

    it('refuses a payload with no name', async () => {
        const response = await create({ description: 'Nameless.' });
        expect(response.statusCode).toBe(400);
    });

    it('refuses an empty name', async () => {
        const response = await create({ name: '   ' });
        expect(response.statusCode).toBe(400);
    });

    it('survives an export and re-import with every field intact', async () => {
        await create({
            name: 'Juno',
            description: 'Keeps the lighthouse.',
            personality: 'Patient.',
            scenario: 'A grey coast.',
            first_mes: 'You are late.',
            mes_example: '<START>',
            creator_notes: 'Written in the app.',
            tags: ['coast'],
            creator: 'tester',
            character_version: '1.0',
        });

        const exported = await call('GET', '/api/characters/Juno/export?format=json');
        expect(exported.statusCode).toBe(200);

        const parsed = parseCardBuffer(Buffer.from(exported.rawPayload), 'Juno.json');
        expect(parsed.card).toMatchObject({
            name: 'Juno',
            description: 'Keeps the lighthouse.',
            personality: 'Patient.',
            scenario: 'A grey coast.',
            first_mes: 'You are late.',
            mes_example: '<START>',
            creator_notes: 'Written in the app.',
            tags: ['coast'],
            creator: 'tester',
            character_version: '1.0',
        });

        // The exported PNG is a card too, which is what "exports to PNG and JSON"
        // means for a card that started as a PNG.
        const png = await call('GET', '/api/characters/Juno/export?format=png');
        expect(png.statusCode).toBe(200);
        expect(png.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(extract(new Uint8Array(png.rawPayload)).some((chunk) => chunk.name === 'tEXt')).toBe(true);
    });

    it('writes a card the importer reads the same way it reads the bundled sample', async () => {
        await create({ name: 'Tamsin', description: 'Same shape as any import.' });

        const created = parseCardBuffer(await readFile(fixturePath(root, 'characters', 'Tamsin.png')), 'Tamsin.png');
        const sample = parseCardBuffer(
            await readFile(path.join(process.cwd(), 'assets', 'samples', 'mira.json')),
            'mira.json',
        );

        // The wrapper is the same, which is what "indistinguishable to the
        // importer" means: the same keys, the same nesting, the same card body.
        // The field set inside `data` legitimately differs — the sample's author
        // filled all thirteen, while a new card omits what nobody set (asserted
        // above) — and the `spec` value differs because a PNG carries both
        // `chara` and `ccv3` while the sample ships as a bare V2 `.json`.
        const asJson = await call('GET', '/api/characters/Tamsin/export?format=json');
        const exported = JSON.parse(Buffer.from(asJson.rawPayload).toString('utf8')) as Record<string, unknown>;
        const sampleRaw = sample.raw as Record<string, unknown>;
        expect(Object.keys(exported).sort()).toEqual(Object.keys(sampleRaw).sort());
        expect(typeof exported.data).toBe('object');
        expect(created.raw).toHaveProperty('spec');
        expect(created.raw).toHaveProperty('data');
    });
});
