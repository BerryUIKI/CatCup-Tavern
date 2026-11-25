import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

let root: string;
let app: FastifyInstance;
let cookie: string;

const BOOK = {
    entries: {
        '0': { uid: 0, key: ['公主'], content: 'The princess rules the realm.', comment: 'The Princess' },
        '1': { uid: 1, key: ['knight'], content: 'A knight of the realm.', comment: 'The Knight' },
    },
};

async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-world-alias-routes-');
    await mkdir(fixturePath(root, 'worlds'), { recursive: true });
    await writeFile(fixturePath(root, 'worlds', 'eldoria.json'), `${JSON.stringify(BOOK, null, 2)}\n`, 'utf8');

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

describe('world alias routes', () => {
    it('reports no aliases for a fresh book', async () => {
        const response = await call('GET', '/api/worlds/eldoria/aliases');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ aliases: {}, stale: [], generated: {} });
    });

    it("saves, reads back and removes one entry's aliases", async () => {
        const saved = await call('PUT', '/api/worlds/eldoria/aliases/0', {
            aliases: ['王女', 'the Princess', '王女'],
        });
        expect(saved.statusCode).toBe(200);
        // De-duplicated on the way in.
        expect(saved.json().aliases).toEqual(['王女', 'the Princess']);

        const read = await call('GET', '/api/worlds/eldoria/aliases');
        expect(read.json().aliases).toEqual({ '0': ['王女', 'the Princess'] });
        expect(read.json().stale).toEqual([]);

        const cleared = await call('DELETE', '/api/worlds/eldoria/aliases/0');
        expect(cleared.json().ok).toBe(true);
        expect((await call('GET', '/api/worlds/eldoria/aliases')).json().aliases).toEqual({});
    });

    it('leaves the book file untouched', async () => {
        const before = await readFile(fixturePath(root, 'worlds', 'eldoria.json'), 'utf8');
        await call('PUT', '/api/worlds/eldoria/aliases/1', { aliases: ['sworn'] });
        const after = await readFile(fixturePath(root, 'worlds', 'eldoria.json'), 'utf8');
        expect(after).toBe(before);
        expect(after).not.toContain('aliases');
        expect(after).not.toContain('sworn');
    });

    it('rejects a uid the book does not hold', async () => {
        const response = await call('PUT', '/api/worlds/eldoria/aliases/999', { aliases: ['ghost'] });
        expect(response.statusCode).toBe(404);
    });

    it('404s for a book that does not exist', async () => {
        const response = await call('PUT', '/api/worlds/nowhere/aliases/0', { aliases: ['x'] });
        expect(response.statusCode).toBe(404);
    });
});
