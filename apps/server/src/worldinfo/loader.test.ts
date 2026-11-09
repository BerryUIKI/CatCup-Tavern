import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { listWorldInfoBooks, parseWorldInfoBook, readWorldInfoBook } from './loader.js';

let tempDir = '';

afterEach(async () => {
    if (tempDir) {
        await rm(tempDir, { recursive: true, force: true });
        tempDir = '';
    }
});

describe('world info loader', () => {
    it('reads the SillyTavern { entries } wrapper', () => {
        const entries = parseWorldInfoBook('eldoria', {
            entries: {
                '0': { key: ['dragon'], content: 'Dragons exist.', comment: 'Dragons' },
                '1': { key: ['kingdom'], content: 'A kingdom.', disable: true },
            },
        });

        expect(entries).toHaveLength(2);
        expect(entries[0]?.id).toBe('eldoria.0');
        expect(entries[0]?.world).toBe('eldoria');
        expect(entries[0]?.key).toEqual(['dragon']);
        expect(entries[1]?.disable).toBe(true);
    });

    it('reads a bare uid-to-entry map', () => {
        const entries = parseWorldInfoBook('legacy', {
            '0': { key: ['dragon'], content: 'Dragons exist.' },
            '1': { key: ['kingdom'], content: 'A kingdom.' },
        });

        expect(entries).toHaveLength(2);
        expect(entries.map((entry) => entry.id)).toEqual(['legacy.0', 'legacy.1']);
    });

    it('assigns a uid from the record key when the entry has none', () => {
        const entries = parseWorldInfoBook('eldoria', {
            entries: { '7': { key: ['x'], content: 'y' } },
        });

        expect(entries[0]?.uid).toBe(7);
    });

    it('strips decorators from the stored content', () => {
        const entries = parseWorldInfoBook('eldoria', {
            entries: { '0': { key: ['x'], content: '@@activate\nAlways on' } },
        });

        expect(entries[0]?.decorators).toEqual(['@@activate']);
        expect(entries[0]?.content).toBe('Always on');
    });

    it('applies schema defaults to missing fields', () => {
        const entries = parseWorldInfoBook('eldoria', {
            entries: { '0': { key: ['x'], content: 'y' } },
        });

        expect(entries[0]?.order).toBe(100);
        expect(entries[0]?.probability).toBe(100);
        expect(entries[0]?.selective).toBe(false);
        expect(entries[0]?.triggers).toEqual([]);
    });

    it('skips records that are not entries', () => {
        const entries = parseWorldInfoBook('eldoria', {
            entries: {
                '0': { key: ['ok'], content: 'kept' },
                '1': 'not an entry',
                '2': ['also', 'not'],
            },
        });

        expect(entries.map((entry) => entry.content)).toEqual(['kept']);
    });

    it('ignores character-book style entry arrays', () => {
        expect(parseWorldInfoBook('book', { entries: [{ keys: ['x'], content: 'y' }] })).toHaveLength(0);
    });

    it('lists books from a directory and skips other files', async () => {
        tempDir = await mkdtemp(path.join(tmpdir(), 'catcup-worlds-'));
        await writeFile(
            path.join(tempDir, 'eldoria.json'),
            JSON.stringify({ entries: { '0': { key: ['a'], content: 'b' } } }),
        );
        await writeFile(path.join(tempDir, 'notes.txt'), 'ignored');

        const books = await listWorldInfoBooks(tempDir);

        expect(books).toHaveLength(1);
        expect(books[0]?.id).toBe('eldoria');
        expect(books[0]?.entryCount).toBe(1);
        expect(books[0]?.updatedAt).toBeGreaterThan(0);
    });

    it('returns null for a missing book', async () => {
        tempDir = await mkdtemp(path.join(tmpdir(), 'catcup-worlds-'));

        await expect(readWorldInfoBook('missing', tempDir)).resolves.toBeNull();
    });

    it('rejects ids that could escape the world directory', async () => {
        tempDir = await mkdtemp(path.join(tmpdir(), 'catcup-worlds-'));

        await expect(readWorldInfoBook('../auth', tempDir)).rejects.toThrow('Invalid name');
    });
});
