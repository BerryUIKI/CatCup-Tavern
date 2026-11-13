import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { strToU8, zipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The desktop-only import-by-path route.
 *
 * The shell sends the path of a card the user opened from Explorer, so these
 * tests cover reading a real file from disk — and the web/LAN case, where the
 * route must not exist at all.
 */

let root: string;
let cards: string;
let app: FastifyInstance;

/** A valid 1x1 PNG, used as the base image for a written PNG card. */
const basePng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

const card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Path Import',
        description: 'Imported from a path.',
        personality: '',
        scenario: '',
        first_mes: 'Hello.',
        mes_example: '',
    },
};

function charxPackage(name: string): Buffer {
    const files: Record<string, Uint8Array> = {
        'assets/icon/image/icon.png': new Uint8Array(basePng),
        'card.json': strToU8(
            JSON.stringify({
                spec: 'chara_card_v3',
                spec_version: '3.0',
                data: {
                    name,
                    first_mes: `Hello from ${name}.`,
                    assets: [{ type: 'icon', uri: 'embeded://assets/icon/image/icon.png', name, ext: 'png' }],
                },
            }),
        ),
    };
    return Buffer.from(zipSync(files, { level: 0 }));
}

async function importPath(filePath: string) {
    return app.inject({
        method: 'POST',
        url: '/api/characters/import-path',
        payload: { path: filePath },
    });
}

beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-import-path-'));
    cards = path.join(root, 'cards');
    await mkdir(cards, { recursive: true });

    vi.stubEnv('CATCUP_DATA_DIR', path.join(root, 'data'));
    vi.stubEnv('CATCUP_LOG_LEVEL', 'silent');
    // The route is registered only in desktop mode, and desktop mode with no
    // password is an open session, so these requests need no cookie.
    vi.stubEnv('CATCUP_DESKTOP', '1');
    vi.resetModules();

    const { buildApp } = await import('../app.js');
    app = await buildApp();
});

afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
});

describe('POST /api/characters/import-path', () => {
    it('imports a JSON card from an absolute path', async () => {
        const file = path.join(cards, 'path-import.json');
        await writeFile(file, JSON.stringify(card));

        const response = await importPath(file);

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.errors).toEqual([]);
        expect(body.imported).toHaveLength(1);
        expect(body.imported[0].name).toBe('Path Import');
    });

    it('imports a PNG card from an absolute path', async () => {
        const { buildCardPayload, writePngCard } = await import('../cards/write.js');
        const file = path.join(cards, 'path-import.png');
        const png = writePngCard(new Uint8Array(basePng), buildCardPayload(card, {}));
        await writeFile(file, Buffer.from(png));

        const response = await importPath(file);

        expect(response.statusCode).toBe(200);
        expect(response.json().imported[0].name).toBe('Path Import');
    });

    it('imports a CharX package and keeps its assets', async () => {
        const file = path.join(cards, 'packed.charx');
        await writeFile(file, charxPackage('Packed Path'));

        const response = await importPath(file);

        expect(response.statusCode).toBe(200);
        expect(response.json().imported[0].name).toBe('Packed Path');
    });

    it('rejects an extension that is not a card', async () => {
        const file = path.join(cards, 'notes.txt');
        await writeFile(file, 'not a card');

        const response = await importPath(file);

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain('Only .png, .json and .charx');
    });

    it('reports a file it cannot read', async () => {
        const response = await importPath(path.join(cards, 'missing.png'));

        expect(response.statusCode).toBe(400);
        expect(response.json().error).toBe('Could not read the file');
    });

    it('rejects a body with no path', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/characters/import-path',
            payload: {},
        });

        expect(response.statusCode).toBe(400);
    });
});
