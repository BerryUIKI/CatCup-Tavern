import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { parsePack } from './catcup.js';

/**
 * A skin's own files. Everything here is about the line between "the host
 * serves what the author declared" and "the host serves whatever is in a
 * folder" — the second is how an asset becomes a way in.
 */

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const WOFF2 = Uint8Array.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x01]);

function skin(overrides: Record<string, unknown> = {}) {
    return {
        format: 'catcup.skin',
        formatVersion: 1,
        id: 'grimoire-night',
        name: 'Grimoire Night',
        version: '1.0.0',
        assets: 'media/index.json',
        ...overrides,
    };
}

function pack(files: Record<string, string | Uint8Array>): Buffer {
    const zippable: Record<string, Uint8Array> = {};
    for (const [name, value] of Object.entries(files)) {
        zippable[name] = typeof value === 'string' ? strToU8(value) : value;
    }
    return Buffer.from(zipSync(zippable, { level: 6 }));
}

describe('a skin with assets', () => {
    it('reads a declared image and font', () => {
        const result = parsePack(
            pack({
                'manifest.json': JSON.stringify(skin()),
                'media/index.json': JSON.stringify({
                    media: {
                        paper: { type: 'image', path: 'media/paper.png' },
                        display: { type: 'font', path: 'media/display.woff2' },
                    },
                }),
                'media/paper.png': PNG,
                'media/display.woff2': WOFF2,
            }),
        );
        expect(result.kind).toBe('skin');
        if (result.kind !== 'skin') {
            return;
        }
        expect(result.assets.map((asset) => asset.id)).toEqual(['paper', 'display']);
        expect(result.assets[0]?.contentType).toBe('image/png');
        expect(result.assets[1]?.contentType).toBe('font/woff2');
    });

    it('refuses an asset the package does not contain, naming it', () => {
        expect(() =>
            parsePack(
                pack({
                    'manifest.json': JSON.stringify(skin()),
                    'media/index.json': JSON.stringify({ media: { paper: { type: 'image', path: 'media/nope.png' } } }),
                }),
            ),
        ).toThrow(/paper.*nope\.png/);
    });

    it('refuses a type the host cannot speak', () => {
        expect(() =>
            parsePack(
                pack({
                    'manifest.json': JSON.stringify(skin()),
                    'media/index.json': JSON.stringify({ media: { doc: { type: 'image', path: 'media/a.exe' } } }),
                    'media/a.exe': 'MZ',
                }),
            ),
        ).toThrow(/\.exe/);
    });

    it('refuses a media type outside the three a skin may carry', () => {
        expect(() =>
            parsePack(
                pack({
                    'manifest.json': JSON.stringify(skin()),
                    'media/index.json': JSON.stringify({ media: { clip: { type: 'video', path: 'media/a.mp4' } } }),
                    'media/a.mp4': 'x',
                }),
            ),
        ).toThrow(/image, audio, font/);
    });

    it('refuses a media index that is missing or not JSON', () => {
        expect(() => parsePack(pack({ 'manifest.json': JSON.stringify(skin()) }))).toThrow(/media\/index\.json/);
        expect(() =>
            parsePack(pack({ 'manifest.json': JSON.stringify(skin()), 'media/index.json': '{not json' })),
        ).toThrow(/not valid JSON/);
    });

    it('accepts a skin with no assets at all', () => {
        const result = parsePack(pack({ 'manifest.json': JSON.stringify(skin({ assets: undefined })) }));
        expect(result.kind).toBe('skin');
        if (result.kind === 'skin') {
            expect(result.assets).toEqual([]);
        }
    });

    it('emits an @font-face for a font the skin carries, pointing at its own route', () => {
        const result = parsePack(
            pack({
                'manifest.json': JSON.stringify({
                    ...skin(),
                    css: 'skin.css',
                    tokens: { font: { display: 'media/display.woff2' } },
                }),
                'media/index.json': JSON.stringify({
                    media: { display: { type: 'font', path: 'media/display.woff2' } },
                }),
                'media/display.woff2': WOFF2,
                'skin.css': '.a { font-family: inherit; }',
            }),
        );
        expect(result.kind).toBe('skin');
        if (result.kind !== 'skin') {
            return;
        }
        // The family is derived from the skin and asset ids, so it cannot collide
        // with a built-in face, and it is the name `tokens.font` resolves to.
        expect(result.css).toContain('@font-face');
        expect(result.css).toContain('CatCupSkin-grimoire-night-display');
        expect(result.css).toContain('/api/skins/grimoire-night/media/media/display.woff2');
    });
});
