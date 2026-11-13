import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';
import { requiresTtsKey } from '../tts/openaiCompatible.js';

let root: string;
let app: FastifyInstance;
let stub: Server;
let cookie: string;
let baseUrl: string;

const audioBytes = Buffer.from('ID3-fake-mp3-bytes');

interface StubRequest {
    body: Record<string, unknown>;
    authorization?: string;
}

const requests: StubRequest[] = [];

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

async function speak(payload: Record<string, unknown>) {
    return app.inject({
        method: 'POST',
        url: '/api/tts/speak',
        payload,
        headers: { cookie },
    });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-tts-routes-');
    await mkdir(fixturePath(root, 'characters'), { recursive: true });
    await writeFile(fixturePath(root, 'characters', 'Aria.json'), card('Aria'));

    stub = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            if (request.method !== 'POST' || !request.url?.endsWith('/audio/speech')) {
                response.writeHead(404);
                response.end();
                return;
            }
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
            requests.push({ body, authorization: request.headers.authorization });
            if (body.input === 'fail') {
                response.writeHead(500, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: { message: 'stub failed' } }));
                return;
            }
            if (body.input === 'json-error') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: 'no speech for you' }));
                return;
            }
            if (body.input === 'object-error') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ error: { message: 'model not loaded' } }));
                return;
            }
            if (body.input === 'truncated') {
                response.writeHead(200, { 'content-type': 'audio/mpeg' });
                response.write(audioBytes.subarray(0, 4));
                response.destroy();
                return;
            }
            response.writeHead(200, { 'content-type': 'audio/mpeg' });
            response.end(audioBytes);
        });
    });
    await new Promise<void>((resolve) => {
        stub.listen(0, '127.0.0.1', resolve);
    });
    const address = stub.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}/v1`;

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
    await new Promise<void>((resolve) => {
        stub.close(() => resolve());
    });
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('TTS routes', () => {
    it('stores the TTS key without returning it', async () => {
        const before = await call('GET', '/api/settings');
        expect(before.json().settings.ttsHasKey).toBe(false);

        const patched = await call('PATCH', '/api/settings', {
            tts: {
                enabled: true,
                backend: 'openai-compatible',
                baseUrl,
                model: 'tts-1',
                voice: 'nova',
                format: 'mp3',
                speed: 1.2,
            },
            ttsApiKey: 'secret-tts-key',
        });
        expect(patched.statusCode).toBe(200);
        expect(patched.json().settings.ttsHasKey).toBe(true);
        expect(patched.body).not.toContain('secret-tts-key');

        const settings = await call('GET', '/api/settings');
        expect(settings.json().settings.tts).toMatchObject({
            enabled: true,
            backend: 'openai-compatible',
            voice: 'nova',
            speed: 1.2,
        });
        expect(settings.body).not.toContain('secret-tts-key');
    });

    it('relays audio from an OpenAI-compatible endpoint', async () => {
        requests.length = 0;
        const response = await speak({ text: 'Hello from the tavern.' });
        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('audio/mpeg');
        expect(response.headers['cache-control']).toBe('no-store');
        expect(response.rawPayload.equals(audioBytes)).toBe(true);

        expect(requests).toHaveLength(1);
        expect(requests[0]?.body).toMatchObject({
            model: 'tts-1',
            input: 'Hello from the tavern.',
            voice: 'nova',
            response_format: 'mp3',
            speed: 1.2,
        });
        expect(requests[0]?.authorization).toBe('Bearer secret-tts-key');

        const override = await speak({ text: 'Another line.', voice: 'alloy' });
        expect(override.statusCode).toBe(200);
        expect(requests[1]?.body.voice).toBe('alloy');
    });

    it('rejects an empty or oversized script', async () => {
        expect((await speak({ text: '   ' })).statusCode).toBe(400);
        expect((await speak({ text: 'x'.repeat(4000) })).statusCode).toBe(200);
        expect((await speak({ text: 'x'.repeat(4001) })).statusCode).toBe(400);
    });

    it('maps provider failures to a 502', async () => {
        const failed = await speak({ text: 'fail' });
        expect(failed.statusCode).toBe(502);
        expect(failed.json().code).toBe('TTS_FAILED');

        const jsonError = await speak({ text: 'json-error' });
        expect(jsonError.statusCode).toBe(502);
        expect(jsonError.json().code).toBe('TTS_FAILED');

        const objectError = await speak({ text: 'object-error' });
        expect(objectError.statusCode).toBe(502);
        expect(objectError.json().error).toContain('model not loaded');

        const truncated = await speak({ text: 'truncated' });
        expect(truncated.statusCode).toBe(502);
        expect(truncated.json().code).toBe('TTS_FAILED');
    });

    it('refuses the system and disabled backends on the server', async () => {
        await call('PATCH', '/api/settings', { tts: { backend: 'system' } });
        const system = await speak({ text: 'Hello' });
        expect(system.statusCode).toBe(400);
        expect(system.json().code).toBe('TTS_SYSTEM_BACKEND');

        await call('PATCH', '/api/settings', {
            tts: { enabled: false, backend: 'openai-compatible' },
        });
        const disabled = await speak({ text: 'Hello' });
        expect(disabled.statusCode).toBe(400);
        expect(disabled.json().code).toBe('TTS_DISABLED');
    });

    it('reports a missing base URL or model as a configuration error', async () => {
        await call('PATCH', '/api/settings', {
            tts: { enabled: true, baseUrl: 'http://127.0.0.1:1/v1', model: '' },
        });
        const response = await speak({ text: 'Hello' });
        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe('TTS_CONFIG');

        await call('PATCH', '/api/settings', { tts: { baseUrl: 'not a url', model: 'tts-1' } });
        const invalid = await speak({ text: 'Hello' });
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json().code).toBe('TTS_CONFIG');
    });

    it('requires a key only for OpenAI hosts', () => {
        expect(requiresTtsKey('https://api.openai.com/v1')).toBe(true);
        expect(requiresTtsKey('https://eu.api.openai.com/v1')).toBe(true);
        expect(requiresTtsKey('http://127.0.0.1:8880/v1')).toBe(false);
        expect(requiresTtsKey('not a url')).toBe(false);
    });

    it('requires a key for api.openai.com', async () => {
        await call('PATCH', '/api/settings', {
            tts: { enabled: true, baseUrl: 'https://api.openai.com/v1' },
            ttsApiKey: '',
        });
        const settings = await call('GET', '/api/settings');
        expect(settings.json().settings.ttsHasKey).toBe(false);

        const response = await speak({ text: 'Hello' });
        expect(response.statusCode).toBe(400);
        expect(response.json().code).toBe('TTS_KEY_MISSING');
    });
});
