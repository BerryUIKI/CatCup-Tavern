import { describe, expect, it } from 'vitest';

import {
    appendEntry,
    applyEntryPatch,
    duplicateEntry,
    ensureEntryContainer,
    findEntryLocation,
    NEW_ENTRY_DEFAULTS,
    nextFreeUid,
    readEntriesForEditor,
    reorderEntries,
} from './entries.js';

describe('world info entry editing', () => {
    it('keeps decorators in the content the editor shows', () => {
        const entries = readEntriesForEditor({
            entries: { '0': { key: ['x'], content: '@@activate\nAlways on', comment: 'Always' } },
        });

        expect(entries[0]?.content).toBe('@@activate\nAlways on');
        expect(entries[0]?.uid).toBe(0);
    });

    it('orders entries by displayIndex, then order, then uid', () => {
        const entries = readEntriesForEditor({
            entries: {
                '0': { key: ['a'], content: '', displayIndex: 2, order: 100 },
                '1': { key: ['b'], content: '', displayIndex: 0, order: 50 },
                '2': { key: ['c'], content: '', displayIndex: 0, order: 200 },
                '3': { key: ['d'], content: '', order: 100 },
            },
        });

        // 2 and 1 share a display index; the higher insertion order wins.
        // 3 has no display index, so it falls back to its uid (3) and sorts last.
        expect(entries.map((entry) => entry.key[0])).toEqual(['c', 'b', 'a', 'd']);
    });

    it('creates an entries container for an empty book', () => {
        const book: Record<string, unknown> = {};

        const container = ensureEntryContainer(book);

        expect(book.entries).toBe(container);
        expect(Object.keys(container)).toHaveLength(0);
    });

    it('creates entries with SillyTavern defaults and the lowest free uid', () => {
        const entries: Record<string, unknown> = {
            '0': { key: ['a'], content: '' },
            '2': { key: ['b'], content: '' },
        };
        const book: Record<string, unknown> = { entries };

        const { uid, value } = appendEntry(ensureEntryContainer(book));

        expect(uid).toBe(1);
        expect(value.uid).toBe(1);
        expect(value.selective).toBe(true);
        expect(value.order).toBe(100);
        expect(value.depth).toBe(4);
        expect(value.sticky).toBeNull();
        expect(entries['1']).toBe(value);
    });

    it('does not reuse a uid a name-keyed record already resolves to', () => {
        expect(nextFreeUid({ dragon: { key: ['x'], content: '' } })).toBe(1);
    });

    it('finds an entry whose uid comes from the record key', () => {
        const book = { entries: { '7': { key: ['x'], content: 'y' } } };

        expect(findEntryLocation(book, 7)?.key).toBe('7');
        expect(findEntryLocation(book, 8)).toBeNull();
    });

    it('merges a patch and keeps fields the editor does not show', () => {
        const book = {
            entries: {
                '0': {
                    key: ['a'],
                    content: 'old',
                    vectorized: true,
                    extensions: { display_index: 4 },
                    custom: 'kept',
                },
            },
        };

        const location = findEntryLocation(book, 0);
        expect(location).not.toBeNull();
        if (!location) {
            throw new Error('entry not found');
        }
        applyEntryPatch(location.value, { content: 'new', key: [' a ', '  ', 'b'] });

        expect(location.value.content).toBe('new');
        expect(location.value.key).toEqual(['a', 'b']);
        expect(location.value.vectorized).toBe(true);
        expect(location.value.extensions).toEqual({ display_index: 4 });
        expect(location.value.custom).toBe('kept');
    });

    it('ignores undefined fields in a patch', () => {
        const entry: Record<string, unknown> = { key: ['a'], content: 'keep' };

        applyEntryPatch(entry, { content: undefined, comment: 'Title' });

        expect(entry.content).toBe('keep');
        expect(entry.comment).toBe('Title');
    });

    it('duplicates an entry under a free uid without touching the original', () => {
        const entries: Record<string, Record<string, unknown>> = {
            '0': { key: ['a'], content: 'body', comment: 'A', displayIndex: 0 },
        };

        const copy = duplicateEntry(entries, 0);

        expect(copy?.uid).toBe(1);
        expect(copy?.value.content).toBe('body');
        expect(copy?.value.uid).toBe(1);
        // SillyTavern keeps the source displayIndex, so the copy sorts beside it.
        expect(copy?.value.displayIndex).toBe(0);
        expect(entries['1']).toBe(copy?.value);
        expect(entries['0']?.content).toBe('body');
        expect(duplicateEntry(entries, 99)).toBeNull();
    });

    it('assigns contiguous display indexes on reorder', () => {
        const entries: Record<string, Record<string, unknown>> = {
            '0': { key: ['a'], content: '' },
            '1': { key: ['b'], content: '' },
            '2': { key: ['c'], content: '' },
        };
        const book: Record<string, unknown> = { entries };

        reorderEntries(ensureEntryContainer(book), [2, 0, 1]);

        expect(entries['0']?.displayIndex).toBe(1);
        expect(entries['1']?.displayIndex).toBe(2);
        expect(entries['2']?.displayIndex).toBe(0);
    });

    it('exposes every field SillyTavern creates an entry with', () => {
        expect(Object.keys(NEW_ENTRY_DEFAULTS)).toEqual(
            expect.arrayContaining(['key', 'keysecondary', 'comment', 'content', 'probability', 'triggers']),
        );
    });
});
