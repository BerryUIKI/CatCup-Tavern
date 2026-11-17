import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createProfileDataDir } from '../testHelpers/profile.js';

let root: string;
let app: FastifyInstance;
let cookie: string;

async function call(method: 'GET' | 'PATCH', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

/** The saved world info block, as the API reports it. */
async function worldInfo(): Promise<Record<string, unknown>> {
    const response = await call('GET', '/api/settings');
    return (response.json() as { settings: { worldInfo: Record<string, unknown> } }).settings.worldInfo;
}

/** The saved memory block, as the API reports it. */
async function memory(): Promise<Record<string, unknown>> {
    const response = await call('GET', '/api/settings');
    return (response.json() as { settings: { memory: Record<string, unknown> } }).settings.memory;
}

/**
 * A world info block where every field differs from its default.
 *
 * If a patch silently carries defaults, this is what makes it visible: each
 * value here is distinguishable from `DEFAULT_WORLD_INFO_CONFIG`.
 */
const NON_DEFAULT_WORLD_INFO = {
    globalBooks: ['eldoria'],
    depth: 10,
    budgetPercent: 50,
    budgetCap: 800,
    caseSensitive: true,
    matchWholeWords: true,
    useGroupScoring: true,
    recursive: true,
    minActivations: 5,
    minActivationsDepthMax: 12,
    maxRecursionSteps: 4,
};

beforeAll(async () => {
    root = await createProfileDataDir('catcup-settings-routes-');

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
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
});

describe('PATCH /api/settings world info', () => {
    it('keeps every other scan setting when only the book list changes', async () => {
        // Save a block that differs from the defaults in every field.
        const saved = await call('PATCH', '/api/settings', { worldInfo: NON_DEFAULT_WORLD_INFO });
        expect(saved.statusCode).toBe(200);
        expect(await worldInfo()).toMatchObject(NON_DEFAULT_WORLD_INFO);

        // This is exactly what the settings panel's book checkbox sends.
        const toggled = await call('PATCH', '/api/settings', { worldInfo: { globalBooks: ['other'] } });
        expect(toggled.statusCode).toBe(200);

        // The book list moved; nothing else did. Before the patch schema this
        // reset all ten scan parameters to their defaults.
        expect(await worldInfo()).toEqual({
            ...NON_DEFAULT_WORLD_INFO,
            globalBooks: ['other'],
        });
    });

    it('changes one scan setting without clearing another', async () => {
        await call('PATCH', '/api/settings', { worldInfo: NON_DEFAULT_WORLD_INFO });

        const patched = await call('PATCH', '/api/settings', { worldInfo: { depth: 3 } });
        expect(patched.statusCode).toBe(200);

        expect(await worldInfo()).toMatchObject({
            ...NON_DEFAULT_WORLD_INFO,
            depth: 3,
        });
    });

    it('accepts an explicit false and zero rather than treating them as absent', async () => {
        await call('PATCH', '/api/settings', { worldInfo: NON_DEFAULT_WORLD_INFO });

        // `false` and `0` are meaningful values here, and the no-default patch
        // schema must not drop them the way an `||`-based merge would.
        const patched = await call('PATCH', '/api/settings', {
            worldInfo: { recursive: false, budgetCap: 0, minActivations: 0 },
        });
        expect(patched.statusCode).toBe(200);

        expect(await worldInfo()).toMatchObject({
            ...NON_DEFAULT_WORLD_INFO,
            recursive: false,
            budgetCap: 0,
            minActivations: 0,
        });
    });

    it('rejects an out-of-range value instead of clamping it', async () => {
        const response = await call('PATCH', '/api/settings', { worldInfo: { depth: -1 } });
        expect(response.statusCode).toBe(400);
    });
});

describe('PATCH /api/settings memory', () => {
    it('still keeps every other memory setting when one changes', async () => {
        // The same trap, already worked around with `memorySettingsPatchSchema`.
        await call('PATCH', '/api/settings', {
            memory: { enabled: true, promptWords: 400, promptInterval: 20, depth: 9 },
        });
        await call('PATCH', '/api/settings', { memory: { promptWords: 250 } });

        expect(await memory()).toMatchObject({
            enabled: true,
            promptWords: 250,
            promptInterval: 20,
            depth: 9,
        });
    });
});
