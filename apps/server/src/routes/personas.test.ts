import { mkdir, rm, writeFile } from 'node:fs/promises';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createProfileDataDir, fixturePath } from '../testHelpers/profile.js';

/**
 * "Play as this character" is the card-to-persona path: the card stays where it
 * is and a persona is made from it, carrying the card's voice.
 */

let root: string;
let app: FastifyInstance;
let cookie: string;

const card = JSON.stringify({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Mira',
        description: 'Runs the Cat’s Cup.',
        personality: 'Dry, watchful.',
        scenario: 'A rain-soaked evening.',
        first_mes: 'You picked a night for it.',
        mes_example: '<START>\n{{user}}: Is there a room?\n{{char}}: One.',
    },
});

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: Record<string, unknown>) {
    return app.inject({ method, url, payload, headers: { cookie } });
}

beforeAll(async () => {
    root = await createProfileDataDir('catcup-persona-routes-');
    await mkdir(fixturePath(root, 'characters'), { recursive: true });
    await writeFile(fixturePath(root, 'characters', 'Mira.json'), card);

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

describe('creating a persona from a card', () => {
    it('copies the card voice and leaves the opening line behind', async () => {
        const response = await call('POST', '/api/personas/from-card', { characterId: 'Mira' });
        expect(response.statusCode).toBe(201);

        const body = response.json() as {
            persona: {
                id: string;
                name: string;
                description: string;
                personality?: string;
                scenario?: string;
                mesExample?: string;
                scope: string;
                first_mes?: string;
            };
            card: string;
        };

        expect(body.persona.name).toBe('Mira');
        expect(body.persona.description).toBe('Runs the Cat’s Cup.');
        expect(body.persona.personality).toBe('Dry, watchful.');
        expect(body.persona.scenario).toBe('A rain-soaked evening.');
        expect(body.persona.mesExample).toContain('Is there a room?');
        expect(body.persona.scope).toBe('profile');
        expect(body.card).toBe('Mira');
        // The card's opening line belongs to the assistant, not to the persona.
        expect(body.persona).not.toHaveProperty('first_mes');
    });

    it('writes the persona where the persona list lives, not into the card', async () => {
        const before = JSON.parse(
            await (await import('node:fs/promises')).readFile(fixturePath(root, 'characters', 'Mira.json'), 'utf8'),
        ) as { data: { name: string } };
        expect(before.data.name).toBe('Mira');

        await call('POST', '/api/personas/from-card', { characterId: 'Mira' });

        const settings = await call('GET', '/api/settings');
        const personas = (settings.json() as { settings: { personas: { name: string }[] } }).settings.personas;
        expect(personas.some((persona) => persona.name === 'Mira')).toBe(true);
    });

    it('404s an unknown card', async () => {
        const response = await call('POST', '/api/personas/from-card', { characterId: 'Nobody' });
        expect(response.statusCode).toBe(404);
    });

    it('creates the persona in the shared scope when asked', async () => {
        const response = await call('POST', '/api/personas/from-card', { characterId: 'Mira', scope: 'shared' });
        expect(response.statusCode).toBe(201);
        expect((response.json() as { persona: { scope: string } }).persona.scope).toBe('shared');
    });
});

describe('creating a persona directly', () => {
    it('accepts the optional voice fields', async () => {
        const response = await call('POST', '/api/personas', {
            name: 'Bram',
            description: 'A traveller.',
            personality: 'Blunt.',
            scenario: 'The road north.',
            mesExample: '{{user}}: Where to?\n{{char}}: North.',
        });
        expect(response.statusCode).toBe(201);

        const persona = (response.json() as { persona: Record<string, unknown> }).persona;
        expect(persona.personality).toBe('Blunt.');
        expect(persona.scenario).toBe('The road north.');
        expect(persona.mesExample).toContain('North.');
    });

    it('still accepts a two-field persona, which is the common case', async () => {
        const response = await call('POST', '/api/personas', { name: 'Alex', description: 'A traveler.' });
        expect(response.statusCode).toBe(201);

        const persona = (response.json() as { persona: Record<string, unknown> }).persona;
        expect(persona.name).toBe('Alex');
        expect(persona.personality).toBeUndefined();
        expect(persona.scenario).toBeUndefined();
        expect(persona.mesExample).toBeUndefined();
    });
});
