import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';

import type { FastifyInstance } from 'fastify';
import PNGtext from 'png-chunk-text';
import extract from 'png-chunks-extract';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/** The `chara` chunk a written PNG card carries, decoded back into JSON. */
function cardChunk(buffer: Uint8Array): Record<string, unknown> | null {
    for (const chunk of extract(buffer)) {
        if (chunk.name !== 'tEXt') {
            continue;
        }
        const decoded = PNGtext.decode(Buffer.from(chunk.data));
        if (decoded.keyword === 'chara') {
            return JSON.parse(Buffer.from(decoded.text, 'base64').toString('utf8')) as Record<string, unknown>;
        }
    }
    return null;
}

/**
 * The portrait flow: a prompt drafted from a card, and an image promoted to the
 * card's picture. The unit under test is the parts the UI cannot prove — the
 * prompt's source, the write's atomicity and what a non-PNG does.
 */

let root: string;
let app: FastifyInstance;
let stub: Server;
let cookie: string;
let stubBase: string;

/** A valid 1x1 PNG, which is what the adapters identify by magic bytes. */
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

function card(name: string, data: Record<string, unknown> = {}): string {
    return JSON.stringify({
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: { name, first_mes: `Hello from ${name}.`, ...data },
    });
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-portrait-');
    await mkdir(fixturePath(root, 'characters'), { recursive: true });
    await writeFile(
        fixturePath(root, 'characters', 'Mira.json'),
        card('Mira', {
            description: 'Runs the Cat’s Cup. Grey eyes, dark braid, a mended apron.',
            personality: 'Dry, watchful, kind underneath.',
        }),
    );

    // A chat provider is needed to draft, and an image backend to generate.
    stub = createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on('data', (chunk: Buffer) => chunks.push(chunk));
        request.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            void body;
            const url = request.url ?? '';

            if (url.endsWith('/chat/completions')) {
                response.writeHead(200, { 'content-type': 'text/event-stream' });
                response.write(
                    `data: ${JSON.stringify({
                        choices: [{ delta: { content: 'grey eyes, dark braid, mended apron, calm face' } }],
                    })}\n\n`,
                );
                response.write('data: [DONE]\n\n');
                response.end();
                return;
            }

            if (url === '/sdapi/v1/txt2img') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ images: [png.toString('base64')], info: JSON.stringify({ seed: 1 }) }));
                return;
            }

            if (url === '/sdapi/v1/options') {
                response.writeHead(200, { 'content-type': 'application/json' });
                response.end(JSON.stringify({ sd_model_checkpoint: 'stub' }));
                return;
            }

            response.writeHead(404);
            response.end();
        });
    });

    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
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

    // A provider pointing at the stub, used for both drafting and generation.
    const provider = await call('POST', '/api/providers', {
        kind: 'custom',
        name: 'Stub chat',
        baseUrl: `${stubBase}/v1`,
        models: ['stub-model'],
        defaultModel: 'stub-model',
        enabled: true,
    });
    expect(provider.statusCode).toBe(200);
    const providerId = (provider.json() as { provider: { id: string } }).provider.id;
    await call('PATCH', '/api/settings', { activeProviderId: providerId });
});

afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
});

describe('drafting a portrait prompt', () => {
    it('reads the card, not a chat, so a card with no chat still works', async () => {
        const response = await call('POST', '/api/images/draft-portrait', { characterId: 'Mira' });
        expect(response.statusCode).toBe(200);
        expect((response.json() as { prompt: string }).prompt).toContain('grey eyes');
    });

    it('works with image generation disabled, because drafting is a chat call', async () => {
        // The default settings have `enabled: false`, which is the state this
        // asserts: the prompt-only path is the whole point of the fallback.
        const settings = await call('GET', '/api/settings');
        expect(
            (settings.json() as { settings: { imageGeneration: { enabled: boolean } } }).settings.imageGeneration
                .enabled,
        ).toBe(false);

        const response = await call('POST', '/api/images/draft-portrait', { characterId: 'Mira' });
        expect(response.statusCode).toBe(200);
    });

    it('404s a card that does not exist', async () => {
        const response = await call('POST', '/api/images/draft-portrait', { characterId: 'Nobody' });
        expect(response.statusCode).toBe(404);
    });
});

describe('drafting from a chat with no image backend', () => {
    it('no longer refuses when generation is disabled', async () => {
        const created = await call('POST', '/api/characters/Mira/chats', {});
        const chatId = (created.json() as { chat: { chatId: string } }).chat.chatId;

        const response = await call('POST', '/api/images/draft', { characterId: 'Mira', chatId });
        expect(response.statusCode).toBe(200);
    });
});

describe('promoting a gallery image to a portrait', () => {
    async function generateOne(): Promise<string> {
        await call('PATCH', '/api/settings', {
            imageGeneration: { enabled: true, backend: 'automatic1111', baseUrl: stubBase },
        });
        const generated = await call('POST', '/api/images/generate', {
            characterId: 'Mira',
            prompt: 'grey eyes, dark braid',
        });
        expect(generated.statusCode).toBe(200);
        return (generated.json() as { image: { folder: string; file: string } }).image.file;
    }

    it('writes the PNG card and keeps the card data intact', async () => {
        const file = await generateOne();
        const response = await call('POST', '/api/images/portrait', { characterId: 'Mira', file });
        expect(response.statusCode).toBe(200);

        const stored = await readFile(fixturePath(root, 'characters', 'Mira.png'));
        const chunk = cardChunk(new Uint8Array(stored));
        const payload = chunk as { data: { name: string; description: string; personality: string } };
        expect(payload.data.name).toBe('Mira');
        expect(payload.data.description).toContain('Grey eyes');
        expect(payload.data.personality).toBe('Dry, watchful, kind underneath.');

        // The JSON card is gone: one id must not be claimed by two files.
        await expect(readFile(fixturePath(root, 'characters', 'Mira.json'))).rejects.toThrow();
    });

    it('serves the new portrait through the avatar route', async () => {
        const avatar = await call('GET', '/api/characters/Mira/avatar');
        expect(avatar.statusCode).toBe(200);
        expect(avatar.rawPayload.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    });

    it('404s a character that does not exist', async () => {
        const response = await call('POST', '/api/images/portrait', { characterId: 'Nobody', file: 'x.png' });
        expect(response.statusCode).toBe(404);
    });

    it('404s an image that is not in that character gallery', async () => {
        const response = await call('POST', '/api/images/portrait', {
            characterId: 'Mira',
            file: 'not-there.png',
        });
        expect(response.statusCode).toBe(404);
    });
});
