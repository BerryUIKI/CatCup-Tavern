import type { CharacterBook } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { convertCharacterBook } from './characterBook.js';

type BookEntry = CharacterBook['entries'][number];

/** A card entry with the defaults the schema would fill in. */
function entry(overrides: Partial<BookEntry> = {}): BookEntry {
    return {
        keys: [],
        content: '',
        extensions: {},
        enabled: true,
        insertion_order: 100,
        ...overrides,
    } as BookEntry;
}

function book(entries: BookEntry[]): CharacterBook {
    return { name: 'Eldoria', extensions: {}, entries };
}

describe('convertCharacterBook', () => {
    it('maps card entry fields to world info fields', () => {
        const converted = convertCharacterBook(
            book([
                entry({
                    id: 7,
                    keys: ['forest', 'glade'],
                    secondary_keys: ['night'],
                    content: 'The glade is old.',
                    comment: 'Glade lore',
                    enabled: true,
                    insertion_order: 42,
                    selective: true,
                    constant: true,
                    position: 'after_char',
                }),
            ]),
        );

        expect(converted.entries['7']).toMatchObject({
            uid: 7,
            key: ['forest', 'glade'],
            keysecondary: ['night'],
            content: 'The glade is old.',
            comment: 'Glade lore',
            order: 42,
            position: 1,
            disable: false,
            constant: true,
            selective: true,
            addMemo: true,
        });
    });

    it('falls back to the entry index for a missing id', () => {
        const converted = convertCharacterBook(book([entry({ keys: ['a'], content: 'first' })]));

        expect(converted.entries['0']?.uid).toBe(0);
    });

    it('treats a disabled entry as disabled and defaults selective to false', () => {
        const converted = convertCharacterBook(book([entry({ id: 1, keys: ['a'], content: 'x', enabled: false })]));

        expect(converted.entries['1']).toMatchObject({ disable: true, selective: false });
    });

    it('reads the card extension overrides', () => {
        const converted = convertCharacterBook(
            book([
                entry({
                    id: 1,
                    keys: ['a'],
                    content: 'x',
                    position: 'before_char',
                    extensions: {
                        position: 4,
                        depth: 2,
                        probability: 60,
                        group: 'weather',
                        group_weight: 30,
                        group_override: true,
                        sticky: 3,
                        scan_depth: 6,
                        case_sensitive: true,
                        triggers: ['rose', 3],
                        role: 2,
                    },
                }),
            ]),
        );

        expect(converted.entries['1']).toMatchObject({
            position: 4,
            depth: 2,
            probability: 60,
            group: 'weather',
            groupWeight: 30,
            groupOverride: true,
            sticky: 3,
            scanDepth: 6,
            caseSensitive: true,
            triggers: ['rose'],
            role: 2,
        });
    });

    it('keeps the original book for an export round trip', () => {
        const source = book([entry({ id: 1, keys: ['a'], content: 'x' })]);

        expect(convertCharacterBook(source).originalData).toBe(source);
    });
});
