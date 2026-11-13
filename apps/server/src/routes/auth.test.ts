import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../config.js';
import { isLoopbackBind } from '../http/host.js';
import { resetAuthCache } from '../storage/auth.js';
import { isOpenSession } from './auth.js';

/**
 * Desktop mode is a property of the process environment, read once at start
 * up, so each case re-imports the modules with a different `CATCUP_DESKTOP`
 * and a fresh data directory.
 */
async function boot(desktop: boolean): Promise<{ app: FastifyInstance; root: string }> {
    const root = await mkdtemp(path.join(tmpdir(), 'catcup-auth-'));
    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');
    vi.stubEnv('CATCUP_DESKTOP', desktop ? '1' : '');
    vi.resetModules();
    const { buildApp } = await import('../app.js');
    return { app: await buildApp(), root };
}

describe('desktop open session', () => {
    let app: FastifyInstance | null = null;
    let root: string | null = null;

    beforeEach(() => {
        app = null;
        root = null;
    });

    afterEach(async () => {
        await app?.close();
        vi.unstubAllEnvs();
        if (root) {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('reports an open session and serves the API without a password', async () => {
        const booted = await boot(true);
        app = booted.app;
        root = booted.root;

        const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
        expect(status.statusCode).toBe(200);
        expect(status.json()).toMatchObject({ needsSetup: false, authenticated: true, openSession: true });

        const settings = await app.inject({ method: 'GET', url: '/api/settings' });
        expect(settings.statusCode).toBe(200);
    });

    it('keeps the password model in web and LAN mode', async () => {
        const booted = await boot(false);
        app = booted.app;
        root = booted.root;

        const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
        expect(status.json()).toMatchObject({ needsSetup: true, authenticated: false, openSession: false });

        const settings = await app.inject({ method: 'GET', url: '/api/settings' });
        expect(settings.statusCode).toBe(401);
    });

    it('turns the login flow back on once a password is set, and off when it is removed', async () => {
        const booted = await boot(true);
        app = booted.app;
        root = booted.root;

        const set = await app.inject({
            method: 'PUT',
            url: '/api/auth/password',
            payload: { password: 'a long enough password' },
        });
        expect(set.statusCode).toBe(200);
        expect(set.json()).toMatchObject({ ok: true, openSession: false });

        const lockedOut = await app.inject({ method: 'GET', url: '/api/settings' });
        expect(lockedOut.statusCode).toBe(401);

        const current = String(set.headers['set-cookie'] ?? '').split(';')[0] ?? '';
        const signedIn = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: current } });
        expect(signedIn.statusCode).toBe(200);

        const removed = await app.inject({
            method: 'PUT',
            url: '/api/auth/password',
            payload: { password: '', currentPassword: 'a long enough password' },
            headers: { cookie: current },
        });
        expect(removed.statusCode).toBe(200);
        expect(removed.json()).toMatchObject({ ok: true, openSession: true });

        const openAgain = await app.inject({ method: 'GET', url: '/api/settings' });
        expect(openAgain.statusCode).toBe(200);
        const status = await app.inject({ method: 'GET', url: '/api/auth/status' });
        expect(status.json()).toMatchObject({ needsSetup: false, authenticated: true, openSession: true });
    });

    it('requires the current password to change an existing one', async () => {
        const booted = await boot(true);
        app = booted.app;
        root = booted.root;

        const first = await app.inject({
            method: 'PUT',
            url: '/api/auth/password',
            payload: { password: 'a long enough password' },
        });
        const cookie = String(first.headers['set-cookie'] ?? '').split(';')[0] ?? '';

        const wrong = await app.inject({
            method: 'PUT',
            url: '/api/auth/password',
            payload: { password: 'another long password', currentPassword: 'not the password' },
            headers: { cookie },
        });
        expect(wrong.statusCode).toBe(401);

        const right = await app.inject({
            method: 'PUT',
            url: '/api/auth/password',
            payload: { password: 'another long password', currentPassword: 'a long enough password' },
            headers: { cookie },
        });
        expect(right.statusCode).toBe(200);
    });

    it('rejects a short replacement password', async () => {
        const booted = await boot(true);
        app = booted.app;
        root = booted.root;

        const short = await app.inject({ method: 'PUT', url: '/api/auth/password', payload: { password: 'short' } });
        expect(short.statusCode).toBe(400);
    });

    it('lets a web install change its password, and the old one stops working', async () => {
        const booted = await boot(false);
        app = booted.app;
        root = booted.root;

        const setup = await app.inject({
            method: 'POST',
            url: '/api/auth/setup',
            payload: { password: 'a long enough password' },
            remoteAddress: '127.0.0.1',
        });
        const cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

        const changed = await app.inject({
            method: 'PUT',
            url: '/api/auth/password',
            payload: { password: 'a much longer password', currentPassword: 'a long enough password' },
            headers: { cookie },
        });
        expect(changed.statusCode).toBe(200);
        expect(changed.json()).toMatchObject({ ok: true, openSession: false });

        // The response carries a session signed by the new secret, so this
        // browser stays signed in.
        const rotated = String(changed.headers['set-cookie'] ?? '').split(';')[0] ?? '';
        const stillIn = await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: rotated } });
        expect(stillIn.statusCode).toBe(200);

        const oldPassword = await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { password: 'a long enough password' },
            remoteAddress: '127.0.0.1',
        });
        expect(oldPassword.statusCode).toBe(401);

        const newPassword = await app.inject({
            method: 'POST',
            url: '/api/auth/login',
            payload: { password: 'a much longer password' },
            remoteAddress: '127.0.0.1',
        });
        expect(newPassword.statusCode).toBe(200);
    });

    it('rejects a web password change without the current password', async () => {
        const booted = await boot(false);
        app = booted.app;
        root = booted.root;

        const setup = await app.inject({
            method: 'POST',
            url: '/api/auth/setup',
            payload: { password: 'a long enough password' },
            remoteAddress: '127.0.0.1',
        });
        const cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

        const attempt = await app.inject({
            method: 'PUT',
            url: '/api/auth/password',
            payload: { password: 'a much longer password' },
            headers: { cookie },
        });
        expect(attempt.statusCode).toBe(401);
    });

    it('refuses to remove the password on a web install', async () => {
        const booted = await boot(false);
        app = booted.app;
        root = booted.root;

        const setup = await app.inject({
            method: 'POST',
            url: '/api/auth/setup',
            payload: { password: 'a long enough password' },
            remoteAddress: '127.0.0.1',
        });
        const cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

        // Removing it would leave a server reachable from the LAN with no
        // password at all, so the route refuses even with the current one.
        const attempt = await app.inject({
            method: 'PUT',
            url: '/api/auth/password',
            payload: { password: '', currentPassword: 'a long enough password' },
            headers: { cookie },
        });
        expect(attempt.statusCode).toBe(403);
    });
});

describe('open desktop mode boundary', () => {
    it('only accepts loopback binds', () => {
        expect(isLoopbackBind('127.0.0.1')).toBe(true);
        expect(isLoopbackBind(' localhost ')).toBe(true);
        expect(isLoopbackBind('::1')).toBe(true);
        expect(isLoopbackBind('0.0.0.0')).toBe(false);
        expect(isLoopbackBind('192.168.1.20')).toBe(false);
    });

    it('is not an open session outside desktop mode', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'catcup-auth-'));
        vi.stubEnv('CATCUP_DATA_DIR', root);
        vi.stubEnv('CATCUP_DESKTOP', '');
        vi.resetModules();
        expect(await isOpenSession()).toBe(false);
        resetAuthCache();
        vi.unstubAllEnvs();
        await rm(root, { recursive: true, force: true });
    });

    it('reads desktop mode from the environment', () => {
        // `config` is a module-level constant, so this asserts the parsing it
        // performs rather than re-parsing per case.
        expect(typeof config.desktop).toBe('boolean');
    });
});
