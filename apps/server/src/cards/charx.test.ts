import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildCharx, parseCharx, safeAssetPath } from './charx.js';

/** A valid 1x1 PNG. */
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

function card(name: string, assets: unknown[] = []): string {
    return JSON.stringify({
        spec: 'chara_card_v3',
        spec_version: '3.0',
        data: { name, first_mes: `Hello from ${name}.`, assets },
    });
}

function archive(files: Record<string, Uint8Array>): Buffer {
    return Buffer.from(zipSync(files, { level: 0 }));
}

describe('CharX parsing', () => {
    it('reads the card, its icon and every asset', () => {
        const buffer = archive({
            'card.json': strToU8(
                card('Nova', [
                    { type: 'icon', uri: 'embeded://assets/icon/image/nova.png', name: 'Nova', ext: 'png' },
                    {
                        type: 'background',
                        uri: 'embedded://assets/background/image/inn.webp',
                        name: 'Inn',
                        ext: 'webp',
                    },
                ]),
            ),
            'assets/icon/image/nova.png': new Uint8Array(png),
            'assets/background/image/inn.webp': new Uint8Array([1, 2, 3]),
            'module.risum': new Uint8Array([9, 9, 9]),
            '../evil.txt': strToU8('no'),
            'assets/../evil2.txt': strToU8('no'),
            'assets/icon/image/notes.txt': strToU8('not an image'),
        });

        const parsed = parseCharx(buffer);
        expect(parsed.card.card.name).toBe('Nova');
        expect(parsed.icon?.equals(png)).toBe(true);
        expect([...parsed.assets.keys()].sort()).toEqual([
            'assets/background/image/inn.webp',
            'assets/icon/image/notes.txt',
            'assets/icon/image/nova.png',
        ]);
    });

    it('falls back to a PNG under assets/icon when the card has no icon entry', () => {
        const buffer = archive({
            'card.json': strToU8(card('Nova')),
            'assets/icon/image/nova.png': new Uint8Array(png),
        });
        expect(parseCharx(buffer).icon?.equals(png)).toBe(true);
    });

    it('imports a package without a PNG icon as a card without a picture', () => {
        const buffer = archive({
            'card.json': strToU8(card('Plain')),
            'assets/background/image/inn.webp': new Uint8Array([1, 2, 3]),
        });
        const parsed = parseCharx(buffer);
        expect(parsed.icon).toBeNull();
        expect([...parsed.assets.keys()]).toEqual(['assets/background/image/inn.webp']);
    });

    it('rejects packages without a usable card.json', () => {
        expect(() => parseCharx(archive({ 'readme.txt': strToU8('x') }))).toThrow(/card\.json/);
        expect(() => parseCharx(archive({ 'card.json': strToU8('{') }))).toThrow(/not valid JSON/);
        expect(() => parseCharx(archive({ 'card.json': strToU8('[]') }))).toThrow();
        expect(() => parseCharx(archive({ 'card.json': strToU8(JSON.stringify({ hello: 'world' })) }))).toThrow(/spec/);
    });

    it('reads a card.json with a byte-order mark', () => {
        const buffer = archive({ 'card.json': strToU8(`\uFEFF${card('Bom')}`) });
        expect(parseCharx(buffer).card.card.name).toBe('Bom');
    });
});

describe('CharX building', () => {
    it('writes a V3 card, reuses the icon path and keeps other assets', () => {
        const raw = JSON.parse(
            card('Nova', [
                { type: 'icon', uri: 'embeded://assets/icon/image/nova.png', name: 'Nova', ext: 'png' },
                {
                    type: 'background',
                    uri: 'embeded://assets/background/image/inn.webp',
                    name: 'Inn',
                    ext: 'webp',
                },
                { type: 'background', uri: 'embeded://assets/missing.webp', name: 'Missing', ext: 'webp' },
            ]),
        );
        const assets = new Map<string, Buffer>([
            ['assets/icon/image/nova.png', Buffer.from(png)],
            ['assets/background/image/inn.webp', Buffer.from([1, 2, 3])],
        ]);

        const files = unzipSync(
            new Uint8Array(buildCharx({ rawCard: raw, name: 'Nova', id: 'Nova', avatar: png, assets })),
        );
        const output = JSON.parse(strFromU8(files['card.json'] as Uint8Array)) as {
            spec: string;
            data: { assets: Array<Record<string, unknown>> };
        };

        expect(output.spec).toBe('chara_card_v3');
        expect(output.data.assets).toHaveLength(2);
        expect(output.data.assets[0]).toMatchObject({
            type: 'icon',
            uri: 'embeded://assets/icon/image/nova.png',
            ext: 'png',
        });
        expect(output.data.assets[1]).toMatchObject({
            type: 'background',
            uri: 'embeded://assets/background/image/inn.webp',
        });
        expect(Buffer.from(files['assets/icon/image/nova.png'] as Uint8Array).equals(png)).toBe(true);
        expect(files['assets/background/image/inn.webp']).toEqual(new Uint8Array([1, 2, 3]));
    });

    it('adds an icon entry for a card that never had one', () => {
        const raw = JSON.parse(card('Fresh'));
        const files = unzipSync(
            new Uint8Array(
                buildCharx({
                    rawCard: raw,
                    name: 'Fresh',
                    id: 'Fresh',
                    avatar: png,
                    assets: new Map(),
                }),
            ),
        );
        const output = JSON.parse(strFromU8(files['card.json'] as Uint8Array)) as {
            data: { assets: Array<Record<string, unknown>> };
        };
        expect(output.data.assets).toHaveLength(1);
        expect(output.data.assets[0]?.type).toBe('icon');
        expect(output.data.assets[0]?.uri).toMatch(/^embeded:\/\/assets\/icon\/image\/Fresh.*\.png$/);
    });

    it('keeps the stored icon when the card has no image of its own', () => {
        const raw = JSON.parse(
            card('Stored', [
                { type: 'icon', uri: 'embeded://assets/icon/image/stored.png', name: 'Stored', ext: 'png' },
            ]),
        );
        const assets = new Map([['assets/icon/image/stored.png', Buffer.from(png)]]);
        const files = unzipSync(
            new Uint8Array(buildCharx({ rawCard: raw, name: 'Stored', id: 'Stored', avatar: null, assets })),
        );
        const output = JSON.parse(strFromU8(files['card.json'] as Uint8Array)) as {
            data: { assets: Array<Record<string, unknown>> };
        };
        expect(output.data.assets).toMatchObject([{ type: 'icon', uri: 'embeded://assets/icon/image/stored.png' }]);
        expect(files['assets/icon/image/stored.png']).toBeDefined();
    });
});

describe('safeAssetPath', () => {
    it('accepts ordinary asset paths', () => {
        expect(safeAssetPath('assets/icon/image/nova.png')).toBe('assets/icon/image/nova.png');
        expect(safeAssetPath('assets/背景/画像 1.webp')).toBe('assets/背景/画像 1.webp');
    });

    it('rejects paths that could escape or break on Windows', () => {
        expect(safeAssetPath('../evil.png')).toBeNull();
        expect(safeAssetPath('assets/../../evil.png')).toBeNull();
        expect(safeAssetPath('/etc/passwd')).toBeNull();
        expect(safeAssetPath('C:/evil.png')).toBeNull();
        expect(safeAssetPath('assets\\evil.png')).toBe('assets/evil.png');
        expect(safeAssetPath('assets\\..\\evil.png')).toBeNull();
        expect(safeAssetPath('assets/con.png')).toBeNull();
        expect(safeAssetPath('assets/name:stream.png')).toBeNull();
        expect(safeAssetPath('assets/trailing. ')).toBeNull();
        expect(safeAssetPath('')).toBeNull();
    });
});
