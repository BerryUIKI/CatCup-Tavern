import { mkdtemp, rm, stat } from 'node:fs/promises';
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

async function call(method: 'GET' | 'DELETE', url: string) {
    return app.inject({ method, url, headers: { cookie } });
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
