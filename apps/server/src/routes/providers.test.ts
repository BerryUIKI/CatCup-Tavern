import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let root: string;
let app: FastifyInstance;
let stub: Server;
let cookie: string;
let stubBase: string;

interface StubRequest {
    path: string;
    authorization?: string;
    custom?: string;
}

const requests: StubRequest[] = [];

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

function customProvider(baseUrl: string, name = 'Stub provider') {
    return {
        kind: 'custom',
        name,
        baseUrl,
        models: ['stub-model'],
        defaultModel: 'stub-model',
        enabled: true,
        headers: {},
    };
}

beforeAll(async () => {
    stub = createServer((request, response) => {
        requests.push({
            path: request.url ?? '',
            authorization: request.headers.authorization,
            custom: typeof request.headers['x-test'] === 'string' ? request.headers['x-test'] : undefined,
        });

        if (request.url === '/bad/models') {
            response.writeHead(500, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ error: 'stub unavailable' }));
            return;
        }

        if (request.url === '/v1/models') {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(
                JSON.stringify({
                    data: [{ id: 'stub-model', name: 'Stub Model' }, { id: 'stub-model-2' }],
                }),
            );
            return;
        }

        response.writeHead(404, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address();
    if (!address || typeof address === 'string') {
        throw new Error('Stub server did not bind a port');
    }
    stubBase = `http://127.0.0.1:${address.port}`;

    root = await mkdtemp(path.join(tmpdir(), 'catcup-providers-routes-'));
    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');

    const { buildApp } = await import('../app.js');
    app = await buildApp();

    const setup = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { password: 'test-password-123' },
    });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';
}, 60_000);

afterAll(async () => {
    if (app) {
        await app.close();
    }
    if (stub) {
        await new Promise<void>((resolve) => stub.close(() => resolve()));
    }
    if (root) {
        await rm(root, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
}, 30_000);

describe('POST /api/providers/test', () => {
    it('tests an unsaved draft with its own key and headers', async () => {
        const before = await call('GET', '/api/providers');
        const beforeCount = (before.json() as { providers: unknown[] }).providers.length;

        const response = await call('POST', '/api/providers/test', {
            provider: {
                ...customProvider(`${stubBase}/v1`),
                headers: { 'X-Test': 'sent' },
            },
            apiKey: 'draft-key',
        });

        expect(response.statusCode).toBe(200);
        const { result } = response.json() as {
            result: { ok: boolean; message: string; models?: Array<{ id: string; name?: string }> };
        };
        expect(result.ok).toBe(true);
        expect(result.models).toEqual([
            { id: 'stub-model', name: 'Stub Model' },
            { id: 'stub-model-2', name: 'stub-model-2' },
        ]);

        const last = requests.at(-1);
        expect(last?.path).toBe('/v1/models');
        expect(last?.authorization).toBe('Bearer draft-key');
        expect(last?.custom).toBe('sent');

        // Testing must not create or persist a provider.
        const after = await call('GET', '/api/providers');
        expect((after.json() as { providers: unknown[] }).providers).toHaveLength(beforeCount);
    });

    it('reuses the stored key when savedProviderId is given', async () => {
        const created = await call('POST', '/api/providers', {
            ...customProvider(`${stubBase}/v1`, 'Saved key provider'),
            apiKey: 'stored-key',
        });
        expect(created.statusCode).toBe(200);
        const { provider } = created.json() as { provider: { id: string } };

        const response = await call('POST', '/api/providers/test', {
            provider: customProvider(`${stubBase}/v1`, 'Saved key provider'),
            savedProviderId: provider.id,
        });

        expect(response.statusCode).toBe(200);
        expect((response.json() as { result: { ok: boolean } }).result.ok).toBe(true);
        expect(requests.at(-1)?.authorization).toBe('Bearer stored-key');
    });

    it('tests without a key when apiKey is explicitly empty', async () => {
        const created = await call('POST', '/api/providers', {
            ...customProvider(`${stubBase}/v1`, 'Empty key provider'),
            apiKey: 'stored-key',
        });
        const { provider } = created.json() as { provider: { id: string } };

        const response = await call('POST', '/api/providers/test', {
            provider: customProvider(`${stubBase}/v1`, 'Empty key provider'),
            savedProviderId: provider.id,
            apiKey: '',
        });

        expect(response.statusCode).toBe(200);
        expect((response.json() as { result: { ok: boolean } }).result.ok).toBe(true);
        expect(requests.at(-1)?.authorization).toBeUndefined();
    });

    it('refuses to reuse a stored key for a different endpoint', async () => {
        const created = await call('POST', '/api/providers', {
            ...customProvider(`${stubBase}/v1`, 'Reuse guard'),
            apiKey: 'stored-key',
        });
        const { provider } = created.json() as { provider: { id: string } };

        const response = await call('POST', '/api/providers/test', {
            provider: customProvider(`${stubBase}/bad`, 'Reuse guard'),
            savedProviderId: provider.id,
        });

        expect(response.statusCode).toBe(400);
        expect((response.json() as { code?: string }).code).toBe('PROVIDER_KEY_REUSE');
    });

    it('refuses to reuse a stored key for a different provider kind', async () => {
        const created = await call('POST', '/api/providers', {
            ...customProvider(`${stubBase}/v1`, 'Kind guard'),
            apiKey: 'stored-key',
        });
        const { provider } = created.json() as { provider: { id: string } };

        const response = await call('POST', '/api/providers/test', {
            provider: { ...customProvider(`${stubBase}/v1`, 'Kind guard'), kind: 'openai' },
            savedProviderId: provider.id,
        });

        expect(response.statusCode).toBe(400);
        expect((response.json() as { code?: string }).code).toBe('PROVIDER_KEY_REUSE');
    });

    it('rejects a non-http base URL', async () => {
        const response = await call('POST', '/api/providers/test', {
            provider: customProvider('file:///etc/passwd'),
            apiKey: 'anything',
        });

        expect(response.statusCode).toBe(400);
        expect((response.json() as { code?: string }).code).toBe('INVALID_BASE_URL');
    });

    it('requires an authenticated session', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/providers/test',
            payload: { provider: customProvider(`${stubBase}/v1`), apiKey: 'anything' },
        });
        expect(response.statusCode).toBe(401);
    });

    it('returns a failed result instead of throwing when the provider errors', async () => {
        const response = await call('POST', '/api/providers/test', {
            provider: customProvider(`${stubBase}/bad`),
            apiKey: 'anything',
        });

        expect(response.statusCode).toBe(200);
        const { result } = response.json() as { result: { ok: boolean; message: string } };
        expect(result.ok).toBe(false);
        expect(result.message.length).toBeGreaterThan(0);
    });

    it('rejects an unknown saved provider and invalid bodies', async () => {
        const missing = await call('POST', '/api/providers/test', {
            provider: customProvider(`${stubBase}/v1`),
            savedProviderId: 'does-not-exist',
        });
        expect(missing.statusCode).toBe(404);

        const missingWithKey = await call('POST', '/api/providers/test', {
            provider: customProvider(`${stubBase}/v1`),
            savedProviderId: 'does-not-exist',
            apiKey: 'supplied',
        });
        expect(missingWithKey.statusCode).toBe(404);

        const invalid = await call('POST', '/api/providers/test', {
            provider: { kind: 'not-a-provider' },
        });
        expect(invalid.statusCode).toBe(400);
    });
});

describe('active provider invariants', () => {
    it('moves the active provider when the active one is disabled', async () => {
        const settingsResponse = await call('GET', '/api/settings');
        const settings = (
            settingsResponse.json() as {
                settings: {
                    providers: Array<{
                        id: string;
                        kind: string;
                        name: string;
                        baseUrl: string;
                        model: string;
                        enabled: boolean;
                        headers: Record<string, string>;
                    }>;
                    activeProviderId: string;
                };
            }
        ).settings;

        const target = settings.providers[0];
        if (!target) {
            throw new Error('Expected a default provider');
        }
        expect(settings.activeProviderId).toBe(target.id);

        const response = await call('PATCH', `/api/providers/${target.id}`, {
            kind: target.kind,
            name: target.name,
            baseUrl: target.baseUrl,
            model: target.model,
            enabled: false,
            headers: target.headers,
        });
        expect(response.statusCode).toBe(200);

        const after = (
            (await call('GET', '/api/settings')).json() as {
                settings: {
                    providers: Array<{ id: string; enabled: boolean }>;
                    activeProviderId: string | null;
                };
            }
        ).settings;
        expect(after.activeProviderId).not.toBe(target.id);
        expect(after.providers.find((provider) => provider.id === after.activeProviderId)?.enabled).toBe(true);
    });

    it('never leaves a disabled provider active after delete', async () => {
        const created = await call('POST', '/api/providers', customProvider(`${stubBase}/v1`, 'Delete me'));
        const { provider } = created.json() as { provider: { id: string } };

        await call('PATCH', '/api/settings', { activeProviderId: provider.id });
        const deleted = await call('DELETE', `/api/providers/${provider.id}`);
        expect(deleted.statusCode).toBe(200);

        const after = (
            (await call('GET', '/api/settings')).json() as {
                settings: {
                    providers: Array<{ id: string; enabled: boolean }>;
                    activeProviderId: string | null;
                };
            }
        ).settings;
        expect(after.activeProviderId).not.toBe(provider.id);
        expect(after.providers.find((item) => item.id === after.activeProviderId)?.enabled).toBe(true);
    });

    it('rejects activating a disabled provider through the settings patch', async () => {
        const created = await call('POST', '/api/providers', customProvider(`${stubBase}/v1`, 'Disabled candidate'));
        const { provider } = created.json() as { provider: { id: string } };

        const disabled = await call('PATCH', `/api/providers/${provider.id}`, {
            ...customProvider(`${stubBase}/v1`, 'Disabled candidate'),
            enabled: false,
        });
        expect(disabled.statusCode).toBe(200);

        const before = (
            (await call('GET', '/api/settings')).json() as {
                settings: { activeProviderId: string | null };
            }
        ).settings;

        const response = await call('PATCH', '/api/settings', { activeProviderId: provider.id });
        expect(response.statusCode).toBe(400);
        expect((response.json() as { code?: string }).code).toBe('PROVIDER_DISABLED');

        const after = (
            (await call('GET', '/api/settings')).json() as {
                settings: { activeProviderId: string | null };
            }
        ).settings;
        expect(after.activeProviderId).toBe(before.activeProviderId);
    });

    it('returns 404 when activating a provider that does not exist', async () => {
        const response = await call('PATCH', '/api/settings', { activeProviderId: 'missing-provider' });
        expect(response.statusCode).toBe(404);
    });
});

describe('provider model lists', () => {
    it('keeps a list and resolves a default that is not in it', async () => {
        const created = await call('POST', '/api/providers', {
            kind: 'custom',
            name: 'Listed',
            baseUrl: stubBase,
            models: ['alpha', 'beta'],
            defaultModel: 'gamma',
            enabled: true,
            headers: {},
        });
        expect(created.statusCode).toBe(200);
        const provider = (created.json() as { provider: { models: string[]; defaultModel: string } }).provider;
        expect(provider.models).toEqual(['alpha', 'beta']);
        // A default the list does not contain falls back to its first model.
        expect(provider.defaultModel).toBe('alpha');
    });

    it('de-duplicates a list and fills a missing default', async () => {
        const created = await call('POST', '/api/providers', {
            kind: 'custom',
            name: 'Dupes',
            baseUrl: stubBase,
            models: ['alpha', 'alpha', 'beta'],
            enabled: true,
            headers: {},
        });
        const provider = (created.json() as { provider: { models: string[]; defaultModel: string } }).provider;
        expect(provider.models).toEqual(['alpha', 'beta']);
        expect(provider.defaultModel).toBe('alpha');
    });

    it('reads a provider written with the old single model string', async () => {
        // The settings file is loaded once per process; write a legacy shape
        // and ask the settings endpoint, which normalizes and rewrites it.
        const { writeFile, readFile } = await import('node:fs/promises');
        const settingsPath = path.join(root, 'settings.json');
        const current = JSON.parse(await readFile(settingsPath, 'utf8')) as {
            providers: Array<Record<string, unknown>>;
        };
        const legacy = {
            id: 'legacy-provider',
            kind: 'custom',
            name: 'Legacy',
            baseUrl: stubBase,
            model: 'old-model',
            enabled: true,
            headers: {},
        };
        current.providers.push(legacy);
        await writeFile(settingsPath, JSON.stringify(current));

        // A fresh process would normalize on load; here the cache holds the
        // pre-write state, so reload through the storage module directly.
        const settingsStorage = await import('../storage/settings.js');
        settingsStorage.clearSettingsCache();
        const settings = await settingsStorage.getSettings();
        const provider = settings.providers.find((entry) => entry.id === 'legacy-provider');
        expect(provider?.models).toEqual(['old-model']);
        expect(provider?.defaultModel).toBe('old-model');

        const rewritten = JSON.parse(await readFile(settingsPath, 'utf8')) as {
            providers: Array<Record<string, unknown>>;
        };
        const stored = rewritten.providers.find((entry) => entry.id === 'legacy-provider');
        expect(stored?.models).toEqual(['old-model']);
        expect('model' in (stored ?? {})).toBe(false);
    });
});
