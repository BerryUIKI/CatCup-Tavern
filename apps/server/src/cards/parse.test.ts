import { describe, expect, it } from 'vitest';

import { normalizeCard, parseJsonCard } from './parse.js';

const v2Card = {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Seraphina',
        description: 'A guardian of Eldoria.',
        first_mes: 'Welcome, traveler.',
        tags: ['fantasy', 'guardian'],
        extensions: { world: 'eldoria' },
    },
};

describe('character card parsing', () => {
    it('normalizes V2 cards', () => {
        const parsed = normalizeCard(v2Card);
        expect(parsed.spec).toBe('v2');
        expect(parsed.card.name).toBe('Seraphina');
        expect(parsed.card.tags).toEqual(['fantasy', 'guardian']);
        expect(parsed.card.extensions).toEqual({ world: 'eldoria' });
    });

    it('normalizes legacy flat cards', () => {
        const parsed = normalizeCard({ name: 'Old Timer', first_mes: 'Hello.' });
        expect(parsed.spec).toBe('legacy');
        expect(parsed.card.first_mes).toBe('Hello.');
    });

    it('prefers V3 cards', () => {
        const parsed = normalizeCard({
            spec: 'chara_card_v3',
            spec_version: '3.0',
            data: { name: 'V3 Hero', first_mes: 'Hey.' },
        });
        expect(parsed.spec).toBe('v3');
        expect(parsed.card.name).toBe('V3 Hero');
    });

    it('parses a JSON buffer', () => {
        const parsed = parseJsonCard(Buffer.from(JSON.stringify(v2Card)));
        expect(parsed.card.name).toBe('Seraphina');
    });

    it('rejects non-object cards', () => {
        expect(() => normalizeCard('not a card')).toThrow();
    });
});
