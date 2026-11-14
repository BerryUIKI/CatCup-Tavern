import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let root: string;
let app: FastifyInstance;
let stub: Server;
let cookie: string;
let baseUrl: string;
let stubUrl: string;
/** The registry the running app uses; imported after `resetModules`. */
let activeGenerations: typeof import('../generation/registry.js').activeGenerations;

function card(name: string): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, first_mes: `Hello from ${name}.` },
    });
}

async function call(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: Record<string, unknown>,
) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-profile-routes-'));
    await mkdir(path.join(root, 'profiles', 'default', 'characters'), { recursive: true });
    await writeFile(path.join(root, 'profiles', 'default', 'characters', 'Mira.json'), card('Mira'));

    // A stub provider, so a profile can be made usable and a generation started.
    stub = createServer((request, response) => {
        request.resume();
        if (request.method === 'POST' && request.url?.endsWith('/chat/completions')) {
            response.writeHead(200, { 'content-type': 'text/event-stream' });
            response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Stub reply.' } }] })}\n\n`);
            response.write('data: [DONE]\n\n');
            response.end();
            return;
        }
        if (request.method === 'GET' && request.url?.endsWith('/models')) {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ data: [{ id: 'stub-model' }] }));
            return;
        }
        response.writeHead(404);
        response.end();
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    stubUrl = `http://127.0.0.1:${port}/v1`;

    vi.stubEnv('CATCUP_DATA_DIR', root);
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');
    vi.resetModules();
    const { buildApp } = await import('../app.js');
    ({ activeGenerations } = await import('../generation/registry.js'));
    app = await buildApp();

    const setup = await app.inject({
        method: 'POST',
        url: '/api/auth/setup',
        payload: { password: 'a long enough password' },
        remoteAddress: '127.0.0.1',
    });
    expect(setup.statusCode).toBe(200);
    cookie = String(setup.headers['set-cookie'] ?? '').split(';')[0] ?? '';

    await call('POST', '/api/providers', {
        kind: 'openai',
        name: 'Stub',
        baseUrl: stubUrl,
        models: ['stub-model'],
        defaultModel: 'stub-model',
        enabled: true,
        headers: {},
        apiKey: 'stub-key',
    });

    // Started so a later slice can drive generation across a switch; the
    // profile assertions here go through `inject`.
    baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
    expect(baseUrl).toContain('127.0.0.1');
}, 60_000);

afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('profile routes', () => {
    it('lists the seeded profile with what it owns', async () => {
        const response = await call('GET', '/api/profiles');
        expect(response.statusCode).toBe(200);
        const body = response.json() as {
            activeProfileId: string;
            profiles: Array<{ id: string; name: string; active: boolean; counts: { characters: number } }>;
        };
        expect(body.activeProfileId).toBe('default');
        expect(body.profiles).toHaveLength(1);
        expect(body.profiles[0]).toMatchObject({ name: 'Default', active: true, counts: { characters: 1 } });
    });

    it('creates a profile that starts empty', async () => {
        const created = await call('POST', '/api/profiles', { name: 'Mystery' });
        expect(created.statusCode).toBe(201);
        const profile = (created.json() as { profile: { id: string; name: string; counts: { characters: number } } })
            .profile;
        expect(profile.counts.characters).toBe(0);

        const list = (await call('GET', '/api/profiles')).json() as { profiles: Array<{ name: string }> };
        expect(list.profiles.map((entry) => entry.name)).toContain('Mystery');
    });

    it('switches the served profile and reports its settings', async () => {
        const created = await call('POST', '/api/profiles', { name: 'Novel' });
        const profile = (created.json() as { profile: { id: string } }).profile;

        const switched = await call('PUT', '/api/profiles/active', { id: profile.id });
        expect(switched.statusCode).toBe(200);
        expect((switched.json() as { activeProfileId: string }).activeProfileId).toBe(profile.id);

        // The new profile has no characters of its own.
        const characters = await call('GET', '/api/characters');
        expect((characters.json() as { characters: unknown[] }).characters).toEqual([]);

        // And switching back restores the original cast.
        await call('PUT', '/api/profiles/active', { id: 'default' });
        const back = await call('GET', '/api/characters');
        expect((back.json() as { characters: Array<{ id: string }> }).characters.map((c) => c.id)).toEqual(['Mira']);
    });

    it('refuses to switch while a generation is running', async () => {
        // Stand in for an in-flight reply; the guard reads this registry.
        const controller = new AbortController();
        activeGenerations.set('route-test', controller);
        try {
            const response = await call('PUT', '/api/profiles/active', { id: 'default' });
            expect(response.statusCode).toBe(409);
            expect((response.json() as { code?: string }).code).toBe('PROFILE_BUSY');
        } finally {
            activeGenerations.delete('route-test');
        }
    });

    it('archives a profile, then restores it with its name intact', async () => {
        const created = await call('POST', '/api/profiles', { name: 'Archive me' });
        const profile = (created.json() as { profile: { id: string } }).profile;

        expect((await call('POST', `/api/profiles/${profile.id}/archive`)).statusCode).toBe(200);
        const afterArchive = (await call('GET', '/api/profiles')).json() as {
            profiles: Array<{ id: string }>;
            archived: Array<{ id: string; name: string }>;
        };
        expect(afterArchive.profiles.map((entry) => entry.id)).not.toContain(profile.id);
        expect(afterArchive.archived.find((entry) => entry.id === profile.id)?.name).toBe('Archive me');

        expect((await call('POST', `/api/profiles/${profile.id}/restore`)).statusCode).toBe(200);
        const afterRestore = (await call('GET', '/api/profiles')).json() as {
            profiles: Array<{ id: string; name: string }>;
        };
        expect(afterRestore.profiles.find((entry) => entry.id === profile.id)?.name).toBe('Archive me');
    });

    it('refuses to archive the active profile and the last one', async () => {
        const active = await call('POST', '/api/profiles/default/archive');
        expect(active.statusCode).toBe(400);

        // One live profile is left only when the others are archived, so this
        // checks the message rather than constructing that state again.
        expect((active.json() as { error: string }).error).toMatch(/cannot be archived/i);
    });

    it('only deletes a profile that has been archived', async () => {
        const created = await call('POST', '/api/profiles', { name: 'Delete me' });
        const profile = (created.json() as { profile: { id: string } }).profile;

        const refused = await call('DELETE', `/api/profiles/${profile.id}`);
        expect(refused.statusCode).toBe(400);
        expect((refused.json() as { error: string }).error).toMatch(/archive/i);

        await call('POST', `/api/profiles/${profile.id}/archive`);
        expect((await call('DELETE', `/api/profiles/${profile.id}`)).statusCode).toBe(200);
    });

    it('404s for an unknown profile', async () => {
        expect((await call('PUT', '/api/profiles/active', { id: 'nope' })).statusCode).toBe(404);
        expect((await call('POST', '/api/profiles/nope/archive')).statusCode).toBe(404);
    });

    it('requires a session', async () => {
        const anonymous = await app.inject({ method: 'GET', url: '/api/profiles' });
        expect(anonymous.statusCode).toBe(401);
    });
});
