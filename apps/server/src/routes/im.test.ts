import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * The IM routes, and the one rule that matters most: the token never leaves.
 *
 * The transport itself is covered in `im/telegram.test.ts` against a stub; these
 * tests are about the shape of what the API answers and where the token is
 * stored, which is the part a reviewer should be able to verify by reading.
 */

let root: string;
let app: FastifyInstance;
let cookie: string;

async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-im-routes-');
    await mkdir(fixturePath(root, 'worlds'), { recursive: true });
    await writeFile(fixturePath(root, 'worlds', 'eldoria.json'), `${JSON.stringify({ entries: {} })}\n`, 'utf8');

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

describe('the IM routes', () => {
    it('starts with no token and nothing running', async () => {
        const response = await call('GET', '/api/im/status');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            status: { hasToken: false, running: false, error: null, bot: null },
        });
    });

    it('stores the token in secrets.json and never returns it', async () => {
        const response = await call('PUT', '/api/im/telegram/token', { token: '123456:secret-token' });
        expect(response.statusCode).toBe(200);
        expect(response.json().status.hasToken).toBe(true);

        // The response body must not carry the token anywhere.
        expect(response.body).not.toContain('secret-token');

        // Secrets are machine-level, beside the provider keys, not inside a
        // profile: the bot is one per install, and a profile switch must not
        // carry a credential with it.
        const secrets = JSON.parse(await readFile(path.join(root, 'secrets.json'), 'utf8')) as Record<string, string>;
        expect(secrets.telegram).toBe('123456:secret-token');

        // And it is not in the profile's settings, which is served to the client.
        const settings = await readFile(fixturePath(root, 'settings.json'), 'utf8').catch(() => '{}');
        expect(settings).not.toContain('secret-token');
    });

    it('keeps the settings response free of the token', async () => {
        const response = await call('GET', '/api/settings');
        expect(response.statusCode).toBe(200);
        expect(response.body).not.toContain('secret-token');
    });

    it('clears the token with an empty string', async () => {
        const cleared = await call('PUT', '/api/im/telegram/token', { token: '' });
        expect(cleared.json().status.hasToken).toBe(false);

        const secrets = JSON.parse(await readFile(path.join(root, 'secrets.json'), 'utf8')) as Record<string, string>;
        expect(secrets.telegram).toBeUndefined();
    });

    it('saves the allowlist and the enabled flag', async () => {
        const response = await call('PATCH', '/api/im/settings', { enabled: true, ownerId: '12345' });
        expect(response.statusCode).toBe(200);
        expect(response.json().settings).toEqual({ enabled: true, ownerId: '12345', notifyOnReply: false });

        const settings = await call('GET', '/api/settings');
        expect(settings.json().settings.im).toEqual({ enabled: true, ownerId: '12345', notifyOnReply: false });
    });

    it('does not start polling without a token', async () => {
        // Enabled but no token: the settings say "on", the transport cannot be,
        // so it stays off rather than failing every second.
        const status = await call('GET', '/api/im/status');
        expect(status.json().status.running).toBe(false);
        expect(status.json().status.hasToken).toBe(false);
    });

    it('rejects a settings patch with the wrong type rather than coercing it', async () => {
        const response = await call('PATCH', '/api/im/settings', { ownerId: 12345 });
        expect(response.statusCode).toBe(400);
    });
});
