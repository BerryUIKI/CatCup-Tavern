import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let root: string;
let app: FastifyInstance;
let cookie: string;

/** A valid 1x1 PNG. */
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

function charx(name: string, icon: Buffer | null = png): Buffer {
    const assets: unknown[] = [];
    const files: Record<string, Uint8Array> = {};
    if (icon) {
        assets.push({ type: 'icon', uri: 'embeded://assets/icon/image/icon.png', name, ext: 'png' });
        files['assets/icon/image/icon.png'] = new Uint8Array(icon);
    }
    assets.push({ type: 'background', uri: 'embeded://assets/background/image/inn.webp', name: 'Inn', ext: 'webp' });
    files['assets/background/image/inn.webp'] = new Uint8Array([1, 2, 3]);
    files['card.json'] = strToU8(
        JSON.stringify({
            spec: 'chara_card_v3',
            spec_version: '3.0',
            data: { name, first_mes: `Hello from ${name}.`, assets },
        }),
    );
    return Buffer.from(zipSync(files, { level: 0 }));
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, headers: { cookie }, ...(payload === undefined ? {} : { payload }) });
}

async function upload(fileName: string, buffer: Buffer) {
    const boundary = '----catcup-charx-test';
    const head = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${fileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    return app.inject({
        method: 'POST',
        url: '/api/characters/import',
        payload: Buffer.concat([head, buffer, tail]),
        headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
}

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-charx-routes-'));
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

describe('CharX routes', () => {
    it('imports a CharX package with its icon and assets', async () => {
        const response = await upload('nova.charx', charx('Nova'));
        expect(response.statusCode).toBe(200);
        const body = response.json() as {
            imported: Array<{ id: string; fileName: string; format: string; spec: string; name: string }>;
            errors: unknown[];
        };
        expect(body.errors).toEqual([]);
        expect(body.imported[0]).toMatchObject({
            id: 'Nova',
            fileName: 'Nova.png',
            format: 'png',
            spec: 'v3',
            name: 'Nova',
        });

        const character = await call('GET', '/api/characters/Nova');
        expect(character.statusCode).toBe(200);
        expect(character.json().character.card.name).toBe('Nova');

        const avatar = await call('GET', '/api/characters/Nova/avatar');
        expect(avatar.statusCode).toBe(200);
        expect(avatar.headers['content-type']).toBe('image/png');
        expect(avatar.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

        const icon = await stat(path.join(root, 'character-assets', 'Nova', 'assets', 'icon', 'image', 'icon.png'));
        expect(icon.isFile()).toBe(true);
        const background = await stat(
            path.join(root, 'character-assets', 'Nova', 'assets', 'background', 'image', 'inn.webp'),
        );
        expect(background.isFile()).toBe(true);
    });

    it('exports a V3 CharX package and round-trips it', async () => {
        const exported = await call('GET', '/api/characters/Nova/export?format=charx');
        expect(exported.statusCode).toBe(200);
        expect(exported.headers['content-type']).toBe('application/zip');
        expect(String(exported.headers['content-disposition'])).toContain('Nova.charx');

        const files = unzipSync(new Uint8Array(exported.rawPayload));
        const card = JSON.parse(strFromU8(files['card.json'] as Uint8Array)) as {
            spec: string;
            data: { name: string; assets: Array<Record<string, unknown>> };
        };
        expect(card.spec).toBe('chara_card_v3');
        expect(card.data.name).toBe('Nova');
        expect(card.data.assets).toHaveLength(2);
        expect(card.data.assets.some((asset) => asset.type === 'icon')).toBe(true);
        expect(card.data.assets.some((asset) => asset.type === 'background')).toBe(true);
        expect(files['assets/background/image/inn.webp']).toEqual(new Uint8Array([1, 2, 3]));
        expect(files['assets/icon/image/icon.png']).toBeDefined();

        const imported = await upload('nova-copy.charx', exported.rawPayload);
        expect(imported.statusCode).toBe(200);
        const body = imported.json() as { imported: Array<{ id: string; fileName: string }>; errors: unknown[] };
        expect(body.errors).toEqual([]);
        expect(body.imported[0]).toMatchObject({ id: 'Nova (2)', fileName: 'Nova (2).png' });
        const copied = await stat(
            path.join(root, 'character-assets', 'Nova (2)', 'assets', 'background', 'image', 'inn.webp'),
        );
        expect(copied.isFile()).toBe(true);
    });

    it('round-trips a CatCup package', async () => {
        const exported = await call('GET', '/api/characters/Nova/export?format=catcup');
        expect(exported.statusCode).toBe(200);
        expect(exported.headers['content-type']).toBe('application/zip');
        expect(String(exported.headers['content-disposition'])).toContain('Nova.catcup');

        // `.catcup` is the same container as CharX, under CatCup's own name.
        const files = unzipSync(new Uint8Array(exported.rawPayload));
        expect(files['card.json']).toBeDefined();
        expect(files['assets/icon/image/icon.png']).toBeDefined();
        expect(files['assets/background/image/inn.webp']).toEqual(new Uint8Array([1, 2, 3]));

        const imported = await upload('nova-copy.catcup', exported.rawPayload);
        expect(imported.statusCode).toBe(200);
        const body = imported.json() as { imported: Array<{ fileName: string }>; errors: unknown[] };
        expect(body.errors).toEqual([]);
        expect(body.imported[0]?.fileName).toMatch(/^Nova.*\.png$/);
    });

    it('imports a package without a PNG icon as a JSON card', async () => {
        const response = await upload('plain.charx', charx('Plain', null));
        expect(response.statusCode).toBe(200);
        const body = response.json() as { imported: Array<{ id: string; fileName: string; format: string }> };
        expect(body.imported[0]).toMatchObject({ id: 'Plain', fileName: 'Plain.json', format: 'json' });

        const avatar = await call('GET', '/api/characters/Plain/avatar');
        expect(avatar.statusCode).toBe(404);

        const background = await stat(
            path.join(root, 'character-assets', 'Plain', 'assets', 'background', 'image', 'inn.webp'),
        );
        expect(background.isFile()).toBe(true);
    });

    it('reports a broken package without failing the request', async () => {
        const broken = Buffer.from(zipSync({ 'readme.txt': strToU8('no card here') }, { level: 0 }));
        const response = await upload('broken.charx', broken);
        expect(response.statusCode).toBe(200);
        const body = response.json() as { imported: unknown[]; errors: Array<{ fileName: string; message: string }> };
        expect(body.imported).toEqual([]);
        expect(body.errors[0]?.fileName).toBe('broken.charx');
        expect(body.errors[0]?.message).toContain('card.json');
    });

    it('removes extracted assets when the character is deleted', async () => {
        const imported = await upload('delete.charx', charx('Delete Me'));
        expect(imported.statusCode).toBe(200);
        const assetPath = path.join(root, 'character-assets', 'Delete Me', 'assets', 'icon', 'image', 'icon.png');
        expect((await stat(assetPath)).isFile()).toBe(true);

        const deleted = await call('DELETE', '/api/characters/Delete%20Me');
        expect(deleted.statusCode).toBe(200);
        await expect(stat(path.join(root, 'character-assets', 'Delete Me'))).rejects.toMatchObject({ code: 'ENOENT' });
    });
});

async function importCharx(name: string): Promise<{ id: string }> {
    const response = await upload(`${name}.charx`, charx(name));
    expect(response.statusCode).toBe(200);
    const body = response.json() as { imported: Array<{ id: string }> };
    const imported = body.imported[0];
    if (!imported) {
        throw new Error(`CharX ${name} was not imported`);
    }
    return imported;
}

describe('character library routes', () => {
    it('lists the favorite flag and creation time in summaries', async () => {
        const imported = await importCharx('LibFav');
        const response = await call('GET', '/api/characters');
        expect(response.statusCode).toBe(200);
        const summary = (response.json().characters as Array<Record<string, unknown>>).find(
            (character) => character.id === imported.id,
        );
        expect(summary).toMatchObject({ id: 'LibFav', fav: false });
        expect(typeof summary?.createdAt).toBe('number');
        expect(typeof summary?.updatedAt).toBe('number');
    });

    it('toggles a favorite and writes it into the card', async () => {
        const imported = await importCharx('LibToggle');
        const set = await call('PATCH', `/api/characters/${imported.id}/favorite`, { favorite: true });
        expect(set.statusCode).toBe(200);
        expect(set.json().character.fav).toBe(true);
        expect(set.json().character.card.extensions.fav).toBe(true);
        const createdAt = set.json().character.createdAt as number;
        const updatedAt = set.json().character.updatedAt as number;

        // A redundant toggle is not a write: neither timestamp moves, and the
        // creation date stamped by the first write survives later writes.
        const again = await call('PATCH', `/api/characters/${imported.id}/favorite`, { favorite: true });
        expect(again.json().character.createdAt).toBe(createdAt);
        expect(again.json().character.updatedAt).toBe(updatedAt);

        const listed = await call('GET', '/api/characters');
        const summary = (listed.json().characters as Array<{ id: string; fav: boolean }>).find(
            (character) => character.id === imported.id,
        );
        expect(summary?.fav).toBe(true);

        const exported = await call('GET', `/api/characters/${imported.id}/export?format=json`);
        const card = JSON.parse(exported.rawPayload.toString('utf8')) as {
            data: { extensions: { fav: boolean } };
        };
        expect(card.data.extensions.fav).toBe(true);

        // Rewriting the PNG for the flag must not damage the image.
        const avatar = await call('GET', `/api/characters/${imported.id}/avatar`);
        expect(avatar.statusCode).toBe(200);
        expect(avatar.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

        const cleared = await call('PATCH', `/api/characters/${imported.id}/favorite`, { favorite: false });
        expect(cleared.json().character.fav).toBe(false);
        expect(cleared.json().character.createdAt).toBe(createdAt);

        expect((await call('PATCH', '/api/characters/Nobody/favorite', { favorite: true })).statusCode).toBe(404);
        expect((await call('PATCH', `/api/characters/${imported.id}/favorite`, { favorite: 'yes' })).statusCode).toBe(
            400,
        );
    });

    it('promotes a legacy card when writing a favorite', async () => {
        await writeFile(
            path.join(root, 'characters', 'Legacy.json'),
            JSON.stringify({ name: 'Legacy', first_mes: 'An old card.', fav: true }),
            'utf8',
        );

        const listed = await call('GET', '/api/characters');
        const summary = (listed.json().characters as Array<{ id: string; fav: boolean }>).find(
            (character) => character.id === 'Legacy',
        );
        expect(summary?.fav).toBe(true);

        const set = await call('PATCH', '/api/characters/Legacy/favorite', { favorite: true });
        expect(set.statusCode).toBe(200);
        expect(set.json().character.spec).toBe('v2');
        expect(set.json().character.fav).toBe(true);

        const raw = JSON.parse(await readFile(path.join(root, 'characters', 'Legacy.json'), 'utf8')) as {
            spec: string;
            data: { extensions: { fav: boolean } };
        };
        expect(raw.spec).toBe('chara_card_v2');
        expect(raw.data.extensions.fav).toBe(true);
    });

    it('applies bulk favorites and tags', async () => {
        const first = await importCharx('BulkA');
        const second = await importCharx('BulkB');

        const favorited = await call('POST', '/api/characters/bulk', {
            action: 'favorite',
            ids: [first.id, second.id],
        });
        expect(favorited.statusCode).toBe(200);
        expect(favorited.json().characters).toHaveLength(2);
        expect((favorited.json().characters as Array<{ fav: boolean }>).every((character) => character.fav)).toBe(true);

        const tagged = await call('POST', '/api/characters/bulk', {
            action: 'add-tags',
            ids: [first.id, first.id, 'Nobody', second.id],
            tags: [' Fantasy ', 'fantasy', 'Cozy'],
        });
        expect(tagged.statusCode).toBe(200);
        expect(tagged.json().characters).toHaveLength(2);
        expect((tagged.json().errors as Array<{ id: string }>).map((error) => error.id)).toEqual(['Nobody']);
        for (const character of tagged.json().characters as Array<{ tags: string[] }>) {
            expect(character.tags).toEqual(['Fantasy', 'Cozy']);
        }

        const removed = await call('POST', '/api/characters/bulk', {
            action: 'remove-tags',
            ids: [first.id, second.id],
            tags: ['FANTASY'],
        });
        expect(removed.statusCode).toBe(200);
        for (const character of removed.json().characters as Array<{ tags: string[] }>) {
            expect(character.tags).toEqual(['Cozy']);
        }

        const unfavorited = await call('POST', '/api/characters/bulk', {
            action: 'unfavorite',
            ids: [first.id, second.id],
        });
        expect(unfavorited.statusCode).toBe(200);
        expect((unfavorited.json().characters as Array<{ fav: boolean }>).every((character) => !character.fav)).toBe(
            true,
        );
    });

    it('preserves existing tag spelling and skips redundant writes', async () => {
        await writeFile(
            path.join(root, 'characters', 'TagKeeper.json'),
            JSON.stringify({
                spec: 'chara_card_v2',
                spec_version: '2.0',
                data: { name: 'TagKeeper', first_mes: 'A card with tags.', tags: ['  Keep  Me  ', 'Fantasy'] },
            }),
            'utf8',
        );

        const added = await call('POST', '/api/characters/bulk', {
            action: 'add-tags',
            ids: ['TagKeeper'],
            tags: ['fantasy', 'Cozy'],
        });
        expect(added.statusCode).toBe(200);
        expect((added.json().characters as Array<{ tags: string[] }>)[0]?.tags).toEqual([
            '  Keep  Me  ',
            'Fantasy',
            'Cozy',
        ]);

        const updatedAt = (added.json().characters as Array<{ updatedAt: number }>)[0]?.updatedAt;
        const again = await call('POST', '/api/characters/bulk', {
            action: 'add-tags',
            ids: ['TagKeeper'],
            tags: ['cozy'],
        });
        expect((again.json().characters as Array<{ updatedAt: number }>)[0]?.updatedAt).toBe(updatedAt);

        const removed = await call('POST', '/api/characters/bulk', {
            action: 'remove-tags',
            ids: ['TagKeeper'],
            tags: ['keep me', 'FANTASY'],
        });
        expect((removed.json().characters as Array<{ tags: string[] }>)[0]?.tags).toEqual(['Cozy']);
    });

    it('validates bulk requests', async () => {
        const imported = await importCharx('BulkValidation');

        expect(
            (await call('POST', '/api/characters/bulk', { action: 'add-tags', ids: [imported.id] })).statusCode,
        ).toBe(400);
        expect((await call('POST', '/api/characters/bulk', { action: 'favorite', ids: [] })).statusCode).toBe(400);
        expect(
            (
                await call('POST', '/api/characters/bulk', {
                    action: 'favorite',
                    ids: Array.from({ length: 501 }, (_, index) => `id-${index}`),
                })
            ).statusCode,
        ).toBe(400);
        expect((await call('POST', '/api/characters/bulk', { action: 'archive', ids: [imported.id] })).statusCode).toBe(
            400,
        );
    });

    it('bulk deletes characters and their assets', async () => {
        const imported = await importCharx('BulkAsset');
        const assetPath = path.join(root, 'character-assets', 'BulkAsset', 'assets', 'icon', 'image', 'icon.png');
        expect((await stat(assetPath)).isFile()).toBe(true);

        const deleted = await call('POST', '/api/characters/bulk', {
            action: 'delete',
            ids: [imported.id, 'Nobody'],
        });
        expect(deleted.statusCode).toBe(200);
        expect(deleted.json().deleted).toEqual(['BulkAsset']);
        expect((deleted.json().errors as Array<{ id: string }>)[0]?.id).toBe('Nobody');
        await expect(stat(path.join(root, 'character-assets', 'BulkAsset'))).rejects.toMatchObject({ code: 'ENOENT' });

        const listed = await call('GET', '/api/characters');
        expect(
            (listed.json().characters as Array<{ id: string }>).some((character) => character.id === 'BulkAsset'),
        ).toBe(false);
    });
});

describe('desktop-only routes', () => {
    it('does not register import-by-path outside desktop mode', async () => {
        // The route reads a path on the machine, so a web or LAN server must
        // not have it at all — a 404, not a 400, so it is not even advertised.
        const response = await call('POST', '/api/characters/import-path', { path: '/tmp/card.png' });
        expect(response.statusCode).toBe(404);
    });
});
