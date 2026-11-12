import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { requiresImageKey } from '../images/openaiCompatible.js';

let root: string;
let app: FastifyInstance;
let stub: Server;
let cookie: string;
let stubBase: string;
let chatId: string;

/** A valid 1x1 PNG; the adapters identify images by magic bytes. */
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

interface StubRequest {
    path: string;
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

async function configureImage(patch: Record<string, unknown>, key?: string) {
    return call('PATCH', '/api/settings', {
        imageGeneration: { enabled: true, ...patch },
        ...(key === undefined ? {} : { imageApiKey: key }),
    });
}

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-images-routes-'));
    await mkdir(path.join(root, 'characters'), { recursive: true });
    await writeFile(path.join(root, 'characters', 'Aria.json'), card('Aria'));

    stub = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            const bodyText = Buffer.concat(chunks).toString('utf8');
            const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
            const url = request.url ?? '';
            requests.push({ path: url, body, authorization: request.headers.authorization });

            if (url === '/sdapi/v1/options') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ sd_model_checkpoint: 'stub.safetensors' }));
                return;
            }

            if (url === '/sdapi/v1/txt2img') {
                if (String(body.prompt).includes('stub-fail')) {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: 'sampler exploded' }));
                    return;
                }
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(
                    JSON.stringify({
                        images: [png.toString('base64')],
                        info: JSON.stringify({ seed: 4242 }),
                    }),
                );
                return;
            }

            if (url === '/v1/images/generations') {
                if (String(body.prompt).includes('stub-fail')) {
                    response.writeHead(500, { 'content-type': 'application/json' });
                    response.end(JSON.stringify({ error: { message: 'image model unavailable' } }));
                    return;
                }
                response.writeHead(200, { 'content-type': 'application/json' });
                if (body.model === 'url-model') {
                    response.end(JSON.stringify({ data: [{ url: `${stubBase}/generated.png` }] }));
                } else {
                    response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
                }
                return;
            }

            if (url === '/generated.png') {
                response.writeHead(200, { 'content-type': 'image/png' });
                response.end(png);
                return;
            }

            if (url === '/v1/chat/completions') {
                response.writeHead(200, { 'content-type': 'text/event-stream' });
                response.end(
                    [
                        'data: {"choices":[{"delta":{"content":"\\"a moonlit tavern,\\n two travelers, warm light.\\""}}]}',
                        '',
                        'data: [DONE]',
                        '',
                        '',
                    ].join('\n'),
                );
                return;
            }

            response.writeHead(404);
            response.end();
        });
    });
    await new Promise<void>((resolve) => {
        stub.listen(0, '127.0.0.1', resolve);
    });
    const address = stub.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    stubBase = `http://127.0.0.1:${port}`;

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

    const provider = await call('POST', '/api/providers', {
        kind: 'custom',
        name: 'Stub chat',
        baseUrl: `${stubBase}/v1`,
        model: 'stub-model',
        enabled: true,
    });
    expect(provider.statusCode).toBe(200);
    const providerId = provider.json().provider.id as string;
    const active = await call('PATCH', '/api/settings', { activeProviderId: providerId });
    expect(active.statusCode).toBe(200);

    const chat = await call('POST', '/api/characters/Aria/chats', {});
    expect(chat.statusCode).toBe(200);
    chatId = chat.json().chat.chatId as string;
}, 60_000);

afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => {
        stub.close(() => resolve());
    });
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
});

describe('image generation routes', () => {
    it('stores the image key without returning it', async () => {
        const before = await call('GET', '/api/settings');
        expect(before.json().settings.imageHasKey).toBe(false);

        const patched = await configureImage({ backend: 'automatic1111', baseUrl: stubBase }, 'image-secret');
        expect(patched.statusCode).toBe(200);
        expect(patched.json().settings.imageHasKey).toBe(true);
        expect(patched.body).not.toContain('image-secret');

        const settings = await call('GET', '/api/settings');
        expect(settings.json().settings.imageGeneration).toMatchObject({
            enabled: true,
            backend: 'automatic1111',
            baseUrl: stubBase,
        });
        expect(settings.body).not.toContain('image-secret');
    });

    it('tests the saved backend connection', async () => {
        await configureImage({ backend: 'automatic1111', baseUrl: stubBase });
        const ok = await call('POST', '/api/images/test');
        expect(ok.statusCode).toBe(200);
        expect(ok.json().ok).toBe(true);

        await configureImage({ backend: 'automatic1111', baseUrl: `${stubBase}/missing` });
        const failed = await call('POST', '/api/images/test');
        expect(failed.statusCode).toBe(502);
        expect(failed.json().code).toBe('IMAGE_FAILED');
    });

    it('generates and stores an image through Automatic1111', async () => {
        await configureImage({
            backend: 'automatic1111',
            baseUrl: stubBase,
            width: 768,
            height: 512,
            steps: 28,
            cfgScale: 6.5,
            sampler: 'Euler a',
            seed: 1234,
            promptPrefix: 'best quality,',
            negativePrompt: 'lowres, blurry',
        });
        requests.length = 0;

        const response = await call('POST', '/api/images/generate', {
            characterId: 'Aria',
            chatId,
            prompt: 'a knight in a tavern',
        });
        expect(response.statusCode).toBe(200);
        const image = response.json().image as {
            folder: string;
            file: string;
            url: string;
            seed: number;
            prompt: string;
        };
        expect(image.folder).toBe('Aria');
        expect(image.url).toBe(`user/images/Aria/${image.file}`);
        expect(image.seed).toBe(4242);
        expect(image.prompt).toBe('best quality, a knight in a tavern');

        const request = requests.find((item) => item.path === '/sdapi/v1/txt2img');
        expect(request?.body).toMatchObject({
            prompt: 'best quality, a knight in a tavern',
            negative_prompt: 'lowres, blurry',
            steps: 28,
            cfg_scale: 6.5,
            width: 768,
            height: 512,
            sampler_name: 'Euler a',
            seed: 1234,
            batch_size: 1,
        });
        expect(request?.authorization).toBe(`Basic ${Buffer.from('image-secret').toString('base64')}`);

        const saved = await readFile(path.join(root, 'user', 'images', 'Aria', image.file));
        expect(saved.equals(png)).toBe(true);
        const sidecar = JSON.parse(
            await readFile(path.join(root, 'user', 'images', 'Aria', `${image.file}.json`), 'utf8'),
        ) as Record<string, unknown>;
        expect(sidecar).toMatchObject({ prompt: 'best quality, a knight in a tavern', seed: 4242 });
    });

    it('generates through an OpenAI-compatible endpoint and follows a URL response', async () => {
        await configureImage({
            backend: 'openai-compatible',
            baseUrl: `${stubBase}/v1`,
            model: 'gpt-image-1',
            width: 768,
            height: 512,
        });
        requests.length = 0;

        const response = await call('POST', '/api/images/generate', {
            characterId: 'Aria',
            chatId,
            prompt: 'a quiet library',
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().image.url).toMatch(/^user\/images\/Aria\//);

        const request = requests.find((item) => item.path === '/v1/images/generations');
        expect(request?.authorization).toBe('Bearer image-secret');
        expect(request?.body).toMatchObject({
            model: 'gpt-image-1',
            prompt: 'best quality, a quiet library',
            n: 1,
            size: '1536x1024',
        });
        expect(request?.body.response_format).toBeUndefined();

        await call('PATCH', '/api/settings', { imageGeneration: { model: 'url-model', baseUrl: `${stubBase}/v1` } });
        const urlResponse = await call('POST', '/api/images/generate', {
            characterId: 'Aria',
            chatId,
            prompt: 'a red door',
        });
        expect(urlResponse.statusCode).toBe(200);
        const fetched = await readFile(
            path.join(root, 'user', 'images', 'Aria', urlResponse.json().image.file as string),
        );
        expect(fetched.equals(png)).toBe(true);
    });

    it('drafts a prompt from the chat with the active provider', async () => {
        requests.length = 0;
        const response = await call('POST', '/api/images/draft', { characterId: 'Aria', chatId });
        expect(response.statusCode).toBe(200);
        expect(response.json().prompt).toBe('a moonlit tavern, two travelers, warm light.');

        const request = requests.find((item) => item.path === '/v1/chat/completions');
        expect(request?.body.model).toBe('stub-model');
        expect(request?.body.stream).toBe(true);
        const messages = request?.body.messages as Array<{ role: string; content: string }>;
        expect(messages[0]?.role).toBe('system');
        expect(messages[1]?.content).toContain('Hello from Aria.');
    });

    it('attaches a generated image to the chat as a SillyTavern media message', async () => {
        const generated = await call('POST', '/api/images/generate', {
            characterId: 'Aria',
            chatId,
            prompt: 'a knight',
        });
        expect(generated.statusCode).toBe(200);
        const image = generated.json().image as { file: string };

        const attached = await call('POST', '/api/images/attach', {
            characterId: 'Aria',
            chatId,
            file: image.file,
            prompt: 'a knight',
        });
        expect(attached.statusCode).toBe(200);
        const message = attached.json().message as {
            mes: string;
            extra: { media: Array<Record<string, unknown>>; media_display: string; inline_image: boolean };
        };
        expect(message.mes).toContain('sends a picture');
        expect(message.extra.media_display).toBe('gallery');
        expect(message.extra.inline_image).toBe(false);
        expect(message.extra.media[0]).toMatchObject({
            url: `user/images/Aria/${image.file}`,
            type: 'image',
            title: 'a knight',
            generation_type: -1,
            source: 'generated',
        });

        const chat = await call('GET', `/api/chats/Aria/${chatId}`);
        const messages = chat.json().chat.messages as Array<{ extra?: { media?: unknown[] } }>;
        expect(messages.at(-1)?.extra?.media).toHaveLength(1);
    });

    it('works for a group gallery', async () => {
        await configureImage({ backend: 'automatic1111', baseUrl: stubBase });

        const created = await call('POST', '/api/groups', { members: ['Aria.json'] });
        expect(created.statusCode).toBe(201);
        const groupId = created.json().group.id as string;

        const chat = await call('POST', `/api/groups/${groupId}/chats`, {});
        expect(chat.statusCode).toBe(201);
        const groupChatId = chat.json().chat.chatId as string;

        const generated = await call('POST', '/api/images/generate', {
            groupId,
            prompt: 'the whole table',
        });
        expect(generated.statusCode).toBe(200);
        const image = generated.json().image as { folder: string; file: string };
        expect(image.folder).toBe(groupId);

        const attached = await call('POST', '/api/images/attach', {
            groupId,
            chatId: groupChatId,
            file: image.file,
            prompt: 'the whole table',
        });
        expect(attached.statusCode).toBe(200);

        const list = await call('GET', `/api/images?groupId=${groupId}`);
        expect(list.statusCode).toBe(200);
        expect((list.json().images as Array<{ file: string }>).some((item) => item.file === image.file)).toBe(true);
    });

    it('lists and deletes gallery images', async () => {
        const list = await call('GET', '/api/images?characterId=Aria');
        expect(list.statusCode).toBe(200);
        const images = list.json().images as Array<{ file: string }>;
        expect(images.length).toBeGreaterThanOrEqual(3);

        const target = images[0];
        expect(target).toBeDefined();
        if (!target) {
            throw new Error('No image to delete');
        }

        const served = await call('GET', `/api/images/Aria/${target.file}`);
        expect(served.statusCode).toBe(200);
        expect(served.headers['content-type']).toBe('image/png');
        expect(served.headers['x-content-type-options']).toBe('nosniff');
        expect(served.rawPayload.equals(png)).toBe(true);

        const deleted = await call('DELETE', `/api/images/Aria/${target.file}`);
        expect(deleted.statusCode).toBe(200);
        expect((await call('GET', `/api/images/Aria/${target.file}`)).statusCode).toBe(404);

        const after = await call('GET', '/api/images?characterId=Aria');
        expect((after.json().images as Array<{ file: string }>).some((item) => item.file === target.file)).toBe(false);
    });

    it('maps provider failures to a 502', async () => {
        await configureImage({ backend: 'automatic1111', baseUrl: stubBase });
        const a1111 = await call('POST', '/api/images/generate', {
            characterId: 'Aria',
            chatId,
            prompt: 'stub-fail',
        });
        expect(a1111.statusCode).toBe(502);
        expect(a1111.json().code).toBe('IMAGE_FAILED');
        expect(a1111.json().error).toContain('sampler exploded');

        await configureImage({ backend: 'openai-compatible', baseUrl: `${stubBase}/v1`, model: 'gpt-image-1' });
        const openai = await call('POST', '/api/images/generate', {
            characterId: 'Aria',
            chatId,
            prompt: 'stub-fail',
        });
        expect(openai.statusCode).toBe(502);
        expect(openai.json().code).toBe('IMAGE_FAILED');
        expect(openai.json().error).toContain('image model unavailable');
    });

    it('reports configuration problems without calling a provider', async () => {
        await call('PATCH', '/api/settings', { imageGeneration: { enabled: false } });
        const disabled = await call('POST', '/api/images/generate', {
            characterId: 'Aria',
            chatId,
            prompt: 'anything',
        });
        expect(disabled.statusCode).toBe(400);
        expect(disabled.json().code).toBe('IMAGE_DISABLED');

        await configureImage({ backend: 'automatic1111', baseUrl: 'not a url' });
        const invalid = await call('POST', '/api/images/generate', {
            characterId: 'Aria',
            chatId,
            prompt: 'anything',
        });
        expect(invalid.statusCode).toBe(400);
        expect(invalid.json().code).toBe('IMAGE_CONFIG');

        await call('PATCH', '/api/settings', {
            imageGeneration: {
                baseUrl: 'https://api.openai.com/v1',
                backend: 'openai-compatible',
                model: 'gpt-image-1',
            },
            imageApiKey: '',
        });
        const missing = await call('POST', '/api/images/generate', {
            characterId: 'Aria',
            chatId,
            prompt: 'anything',
        });
        expect(missing.statusCode).toBe(400);
        expect(missing.json().code).toBe('IMAGE_KEY_MISSING');
    });

    it('rejects a folder that tries to escape the gallery', async () => {
        const list = await call('GET', '/api/images?characterId=..');
        expect([400, 404]).toContain(list.statusCode);

        const file = await call('GET', '/api/images/%2E%2E/settings.json');
        expect([400, 404]).toContain(file.statusCode);
    });

    it('requires a key only for OpenAI hosts', () => {
        expect(requiresImageKey('https://api.openai.com/v1')).toBe(true);
        expect(requiresImageKey('https://eu.api.openai.com/v1')).toBe(true);
        expect(requiresImageKey('http://127.0.0.1:7860')).toBe(false);
        expect(requiresImageKey('not a url')).toBe(false);
    });
});
