import { inflateSync } from 'node:zlib';
import { parseCardBuffer } from '@catcup/compat-st';
import extract from 'png-chunks-extract';
import { describe, expect, it } from 'vitest';

import { newCardJson, newCardPayload, newCardPng, placeholderPng } from './created.js';

/**
 * The card a person starts from nothing.
 *
 * The picture is drawn by hand, so the tests here are about the file being a
 * real PNG and a real card rather than about the pixels looking right. A
 * placeholder that only CatCup's own writer can read would create cards that
 * open in the app and fail in every other client.
 */

describe('placeholder avatar', () => {
    it('is a PNG that a third-party chunk reader accepts', async () => {
        const png = await placeholderPng('Lüna the Wanderer');
        const chunks = extract(new Uint8Array(png));
        expect(chunks[0]?.name).toBe('IHDR');
        expect(chunks.at(-1)?.name).toBe('IEND');
        expect(chunks.some((chunk) => chunk.name === 'IDAT')).toBe(true);
    });

    it('encodes the size in the header', async () => {
        const png = await placeholderPng('Mira');
        // 8 bytes of signature, a 4-byte chunk length, then the 4-byte chunk
        // name; IHDR's own data — width, then height — starts at 16.
        const view = new DataView(new Uint8Array(png).buffer, 16);
        expect(view.getUint32(0)).toBe(256);
        expect(view.getUint32(4)).toBe(256);
    });

    it('gives two names different pictures, so a grid of new cards is not identical', async () => {
        const first = await placeholderPng('Mira');
        const second = await placeholderPng('Seraphina');
        expect(Buffer.from(first).equals(Buffer.from(second))).toBe(false);
    });

    it('survives a name with no letters to draw', async () => {
        const png = await placeholderPng('…');
        const chunks = extract(new Uint8Array(png));
        expect(chunks.at(-1)?.name).toBe('IEND');
    });

    it('leaves a margin around the initials rather than filling the tile', async () => {
        // The glyphs are what makes the tile readable, but at full width they
        // read as a texture rather than as a mark, and the border disappears.
        // Measuring the ink is the only way to hold that: the sizes are
        // multiplied constants and a change to any of them is silent otherwise.
        const png = new Uint8Array(await placeholderPng('Wren Halloway'));
        const { pixels, width, height } = decodePng(png);

        let minX = width;
        let maxX = -1;
        for (let y = 2; y < height - 2; y += 1) {
            for (let x = 2; x < width - 2; x += 1) {
                const offset = (y * width + x) * 4;
                const [red, green, blue] = [pixels[offset] ?? 0, pixels[offset + 1] ?? 0, pixels[offset + 2] ?? 0];
                // The ink is near-black or near-white; the tile is neither.
                const dark = red < 60 && green < 60 && blue < 60;
                const light = red > 230 && green > 230 && blue > 230;
                if (!dark && !light) {
                    continue;
                }
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
            }
        }

        expect(maxX).toBeGreaterThan(minX);
        // At least 8% of the tile's width on each side stays background.
        expect(minX).toBeGreaterThanOrEqual(Math.floor(width * 0.08));
        expect(maxX).toBeLessThanOrEqual(Math.ceil(width * 0.92));
    });
});

/**
 * Decode the PNG this module writes.
 *
 * Only ever asked for its own output — one `IDAT`, filter type 0, RGBA — so this
 * is a few lines rather than a decoder. A general one would be a dependency the
 * test does not need.
 */
function decodePng(png: Uint8Array): { pixels: Uint8Array; width: number; height: number } {
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);

    let offset = 8;
    const data: number[] = [];
    while (offset < png.length) {
        const length = view.getUint32(offset);
        const name = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
        if (name === 'IDAT') {
            data.push(...png.subarray(offset + 8, offset + 8 + length));
        }
        offset += 12 + length;
    }

    const raw = inflateSync(Uint8Array.from(data));
    const stride = width * 4;
    const pixels = new Uint8Array(stride * height);
    for (let y = 0; y < height; y += 1) {
        // Byte 0 of each scanline is the filter type; these are written unfiltered.
        pixels.set(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
    }
    return { pixels, width, height };
}

describe('the created card', () => {
    it('writes a PNG card whose embedded payload the parser reads back', async () => {
        const png = await newCardPng({ name: 'Mira', description: 'A herbalist.' });
        const parsed = parseCardBuffer(png, 'Mira.png');

        // `writePngCard` writes both `chara` and `ccv3`, and a reader that knows
        // V3 prefers it — the same answer the sample card gets.
        expect(parsed.spec).toBe('v3');
        expect(parsed.card.name).toBe('Mira');
        expect(parsed.card.description).toBe('A herbalist.');
    });

    it('keeps both the chara and ccv3 chunks, as SillyTavern writes them', async () => {
        const png = await newCardPng({ name: 'Mira' });
        const keywords = extract(new Uint8Array(png)).map((chunk) => chunk.name);
        expect(keywords).toContain('tEXt');
        // `chara` and `ccv3` both ride tEXt; the count is what says both were written.
        expect(keywords.filter((name) => name === 'tEXt')).toHaveLength(2);
    });

    it('omits every field the request did not set, rather than inventing them', () => {
        const payload = newCardPayload({ name: 'Mira' });
        const data = payload.data as Record<string, unknown>;
        expect(data.name).toBe('Mira');
        expect(data.description).toBeUndefined();
        expect(data.first_mes).toBeUndefined();
        expect(data.tags).toBeUndefined();
    });

    it('carries a field the editor can set into the card', () => {
        const payload = newCardPayload({ name: 'Mira', scenario: 'A quiet glade.', tags: ['fantasy'] });
        const data = payload.data as Record<string, unknown>;
        expect(data.scenario).toBe('A quiet glade.');
        expect(data.tags).toEqual(['fantasy']);
    });

    it('writes a JSON fallback with the same payload shape', () => {
        const json = JSON.parse(newCardJson({ name: 'Mira' }).toString('utf8'));
        expect(json.spec).toBe('chara_card_v2');
        expect(json.data.name).toBe('Mira');
    });
});
