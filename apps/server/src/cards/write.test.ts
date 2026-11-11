import extract from 'png-chunks-extract';
import { describe, expect, it } from 'vitest';

import { parsePngCard } from './parse.js';
import { encodePng, withTextChunks } from './png.js';
import { buildCardPayload, writePngCard } from './write.js';

/** A valid 1×1 PNG: IHDR, IDAT, IEND and nothing else. */
const TINY_PNG = new Uint8Array(
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
    ),
);

const CARD = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Seraphina',
        description: 'A herbalist.',
        personality: 'Warm.',
        scenario: 'A glade.',
        first_mes: 'Welcome.',
        mes_example: '<START>',
        creator_notes: 'Notes.',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        tags: ['fantasy'],
        creator: 'tester',
        character_version: '1.0',
        extensions: { world: 'eldoria' },
    },
};

describe('PNG chunk encoding', () => {
    it('round-trips the chunks of a real PNG', () => {
        const original = extract(TINY_PNG).map((chunk) => chunk.name);
        const chunks = extract(TINY_PNG).map((chunk) => ({
            name: chunk.name,
            data: new Uint8Array(chunk.data),
        }));

        const encoded = encodePng(chunks);

        expect(Array.from(encoded)).toEqual(Array.from(TINY_PNG));
        expect(extract(encoded).map((chunk) => chunk.name)).toEqual(original);
    });

    it('replaces a text chunk instead of duplicating it', () => {
        const first = withTextChunks(TINY_PNG, [{ keyword: 'chara', text: 'one' }]);
        const second = withTextChunks(first, [{ keyword: 'chara', text: 'two' }]);

        const texts = extract(second).filter((chunk) => chunk.name === 'tEXt');
        expect(texts).toHaveLength(1);
        expect(new TextDecoder().decode(texts[0]?.data)).toContain('two');
    });

    it('keeps unrelated chunks and puts new ones before IEND', () => {
        const result = withTextChunks(TINY_PNG, [{ keyword: 'chara', text: 'one' }]);
        const names = extract(result).map((chunk) => chunk.name);

        expect(names[0]).toBe('IHDR');
        expect(names).toContain('IDAT');
        expect(names[names.length - 1]).toBe('IEND');
        expect(names[names.length - 2]).toBe('tEXt');
    });
});

describe('card write-back', () => {
    it('writes a card that reads back with every field intact', () => {
        const png = writePngCard(TINY_PNG, CARD);
        const parsed = parsePngCard(png);

        expect(parsed.card.name).toBe('Seraphina');
        expect(parsed.card.first_mes).toBe('Welcome.');
        expect(parsed.card.extensions.world).toBe('eldoria');
        // `ccv3` is written too and wins on read, so the spec becomes v3.
        expect(parsed.spec).toBe('v3');
    });

    it('writes both chunks with the same payload', () => {
        const png = writePngCard(TINY_PNG, CARD);
        const texts = extract(png).filter((chunk) => chunk.name === 'tEXt');

        expect(texts).toHaveLength(2);
        const decoded = texts.map((chunk) => {
            const raw = new TextDecoder().decode(chunk.data);
            const [, payload] = raw.split('\0');
            return JSON.parse(Buffer.from(payload ?? '', 'base64').toString('utf8')) as {
                spec: string;
                data: { name: string };
            };
        });

        expect(decoded.map((chunk) => chunk.spec).sort()).toEqual(['chara_card_v2', 'chara_card_v3']);
        expect(decoded.every((chunk) => chunk.data.name === 'Seraphina')).toBe(true);
    });

    it('keeps the V3 wrapper and unknown root fields when patching a V3 card', () => {
        const raw = { ...CARD, spec: 'chara_card_v3', spec_version: '3.0', assets: [{ type: 'icon' }] };
        const payload = buildCardPayload(raw, { description: 'Edited.' });

        expect(payload.spec).toBe('chara_card_v3');
        expect(payload.assets).toEqual([{ type: 'icon' }]);
        expect((payload.data as Record<string, unknown>).description).toBe('Edited.');
        expect((payload.data as Record<string, unknown>).personality).toBe('Warm.');
    });

    it('promotes a legacy flat card into a V2 wrapper', () => {
        const legacy = { name: 'Flat', description: 'Old style.', extension_field: 'kept' };
        const payload = buildCardPayload(legacy, { scenario: 'New.' });

        expect(payload.spec).toBe('chara_card_v2');
        expect(payload.data).toMatchObject({
            name: 'Flat',
            description: 'Old style.',
            scenario: 'New.',
            extension_field: 'kept',
        });
    });

    it('ignores undefined patch fields', () => {
        const payload = buildCardPayload(CARD, { description: undefined, name: 'Renamed' });
        const data = payload.data as Record<string, unknown>;

        expect(data.name).toBe('Renamed');
        expect(data.description).toBe('A herbalist.');
    });
});
