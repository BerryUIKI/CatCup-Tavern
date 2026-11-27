import { rm } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createProfileDataDir } from '../testHelpers/profile.js';

/**
 * Installing a skin is a write of a file a person brought, and the route is the
 * only thing between that file and the disk. These cases are about the parts
 * the schema cannot check on its own: that the stored id is the one the
 * manifest declares, that a skin survives a reload, and that a removal leaves
 * nothing behind.
 */

let root: string;
let app: FastifyInstance;
let cookie: string;

const skin = {
    format: 'catcup.skin',
    formatVersion: 1,
    id: 'grimoire-night',
    name: 'Grimoire Night',
    version: '1.0.0',
    scope: 'app',
    colorScheme: 'dark',
    tokens: { color: { surface: '#16161f', amber: '#c9a227' }, radius: { xl: '8px' } },
};

async function call(method: 'GET' | 'PUT' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-skin-routes-');
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
});

afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

describe('installing a skin', () => {
    it('starts with nothing installed', async () => {
        const response = await call('GET', '/api/skins');
        expect(response.statusCode).toBe(200);
        expect((response.json() as { skins: unknown[] }).skins).toEqual([]);
    });

    it('writes the manifest and returns it on the next read', async () => {
        const put = await call('PUT', `/api/skins/${skin.id}`, { manifest: skin });
        expect(put.statusCode).toBe(200);

        const list = await call('GET', '/api/skins');
        const skins = (list.json() as { skins: Array<{ id: string; tokens: { color?: Record<string, string> } }> })
            .skins;
        expect(skins).toHaveLength(1);
        expect(skins[0]?.id).toBe('grimoire-night');
        // The values come back as written: a skin is stored as the file it
        // arrived as, not flattened, so editing it reaches the theme.
        expect(skins[0]?.tokens.color?.surface).toBe('#16161f');
    });

    it('refuses a manifest whose id is not the one it was sent as', async () => {
        const response = await call('PUT', '/api/skins/some-other-name', {
            manifest: { ...skin, id: 'grimoire-night' },
        });
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(response.statusCode).toBeLessThan(500);
    });

    it('refuses a token the app does not declare', async () => {
        const response = await call('PUT', '/api/skins/typo', {
            manifest: { ...skin, id: 'typo', tokens: { color: { surfce: '#000000' } } },
        });
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(response.body).toContain('surfce');
    });

    it('refuses a manifest for another format', async () => {
        const response = await call('PUT', '/api/skins/not-a-skin', {
            manifest: { ...skin, id: 'not-a-skin', format: 'catcup.game' },
        });
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('keeps an unknown field, because a newer format must survive an older host', async () => {
        const withExtra = { ...skin, id: 'forward-compatible', futureField: 'kept' };
        await call('PUT', '/api/skins/forward-compatible', { manifest: withExtra });

        const read = await call('GET', '/api/skins/forward-compatible');
        expect((read.json() as { skin: Record<string, unknown> }).skin.futureField).toBe('kept');
    });

    it('removes a skin and says whether there was one', async () => {
        const first = await call('DELETE', `/api/skins/${skin.id}`);
        expect((first.json() as { removed: boolean }).removed).toBe(true);

        const again = await call('DELETE', `/api/skins/${skin.id}`);
        expect((again.json() as { removed: boolean }).removed).toBe(false);

        const list = await call('GET', '/api/skins');
        const ids = (list.json() as { skins: Array<{ id: string }> }).skins.map((entry) => entry.id);
        expect(ids).not.toContain('grimoire-night');
    });
});
