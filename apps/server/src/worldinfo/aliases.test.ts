import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import {
    aliasPathFor,
    copyAliasFile,
    moveAliasFile,
    normalizeAliases,
    readAliases,
    removeAliasFile,
    setAliases,
} from './aliases.js';
import { applyAliases, parseWorldInfoBook, readWorldInfoBook } from './loader.js';
import { scanWorldInfo } from './scanner.js';
import type { ScanEntry, ScanInput } from './types.js';

let dir = '';

beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'catcup-aliases-'));
    return async () => {
        await rm(dir, { recursive: true, force: true });
    };
});

const BOOK = {
    entries: {
        '0': { uid: 0, key: ['公主'], content: 'The princess rules the realm.', comment: 'The Princess' },
        '1': { uid: 1, key: ['knight'], content: 'A knight of the realm.', comment: 'The Knight' },
    },
};

async function writeBook(fileName = 'eldoria.json', book: unknown = BOOK): Promise<string> {
    const file = path.join(dir, fileName);
    await writeFile(file, `${JSON.stringify(book, null, 2)}\n`, 'utf8');
    return file;
}

describe('alias sidecar', () => {
    it('sits beside the book and is derived from its path', () => {
        expect(aliasPathFor('/data/worlds/eldoria.json')).toBe('/data/worlds/eldoria.aliases.json');
    });

    it('reads as empty when there is no sidecar', async () => {
        const file = await writeBook();
        expect(await readAliases(file, 'eldoria')).toEqual({});
    });

    it('stores and reads aliases per uid', async () => {
        const file = await writeBook();
        await setAliases(file, 'eldoria', 0, ['王女', 'the Princess', 'Aurelia']);

        const aliases = await readAliases(file, 'eldoria');
        expect(aliases['0']?.aliases).toEqual(['王女', 'the Princess', 'Aurelia']);
    });

    it('drops an empty list rather than storing it', async () => {
        const file = await writeBook();
        await setAliases(file, 'eldoria', 0, ['王女']);
        await setAliases(file, 'eldoria', 0, []);
        expect(await readAliases(file, 'eldoria')).toEqual({});
    });

    it('trims, deduplicates case-insensitively and keeps the first spelling', () => {
        expect(normalizeAliases(['  王女 ', 'Aurelia', 'aurelia', '', '  '])).toEqual(['王女', 'Aurelia']);
    });

    it('leaves a book with no sidecar byte-identical', async () => {
        const file = await writeBook();
        const before = await readFile(file, 'utf8');

        const book = await readWorldInfoBook('eldoria', dir);
        expect(book?.entries.every((entry) => entry.autoKeys.length === 0)).toBe(true);

        // Reading must not create a sidecar, and must not touch the book.
        expect(await readFile(file, 'utf8')).toBe(before);
        await expect(readFile(aliasPathFor(file), 'utf8')).rejects.toThrow();
    });
});

describe('aliases on entries', () => {
    it('does not change the entry hash, so timed effects keep resolving', async () => {
        const file = await writeBook();
        const before = await readWorldInfoBook('eldoria', dir);
        const hashBefore = before?.entries.map((entry) => entry.hash);

        await setAliases(file, 'eldoria', 0, ['王女']);
        const after = await readWorldInfoBook('eldoria', dir);

        expect(after?.entries.map((entry) => entry.hash)).toEqual(hashBefore);
        // The alias is present, and it came from the sidecar rather than the book.
        expect(after?.entries[0]?.autoKeys).toEqual(['王女']);
        expect(after?.entries[0]?.key).toEqual(['公主']);
    });

    it('drops an alias the authored keys already list', () => {
        const entries = parseWorldInfoBook('eldoria', BOOK) as ScanEntry[];
        const withAliases = applyAliases(entries, {
            '0': { aliases: ['公主', '王女'] },
        });
        expect(withAliases[0]?.autoKeys).toEqual(['王女']);
    });

    it('keys by uid even when the record key disagrees', async () => {
        const file = await writeBook('rekeyed.json', {
            entries: { named: { uid: 7, key: ['x'], content: 'Body.' } },
        });
        await setAliases(file, 'rekeyed', 7, ['alias']);
        const book = await readWorldInfoBook('rekeyed', dir);
        expect(book?.entries[0]?.autoKeys).toEqual(['alias']);
    });
});

describe('aliases in the scan', () => {
    function scan(entries: ScanEntry[], messages: string[]): ReturnType<typeof scanWorldInfo> {
        return scanWorldInfo({
            entries,
            chat: messages.map((text) => ({ text })) as ScanInput['chat'],
            maxContext: 8192,
            settings: { depth: 10 },
        });
    }

    function entriesFor(aliases: Record<string, { aliases: string[] }>): ScanEntry[] {
        return applyAliases(parseWorldInfoBook('eldoria', BOOK) as ScanEntry[], aliases);
    }

    it('activates on an alias the authored keys do not contain', () => {
        const entries = entriesFor({ '0': { aliases: ['王女'] } });

        const withoutAlias = scan(entriesFor({}), ['王女 arrived at court.']);
        expect(withoutAlias.activated).toHaveLength(0);

        const withAlias = scan(entries, ['王女 arrived at court.']);
        expect(withAlias.activated.map((entry) => entry.uid)).toEqual([0]);
        const line = withAlias.trace.find((item) => item.uid === 0);
        expect(line?.reason).toBe('primary-key');
        expect(line?.detail).toBe('alias: 王女');
    });

    it('reports the authored key rather than the alias when both would match', () => {
        const entries = entriesFor({ '0': { aliases: ['王女'] } });
        const result = scan(entries, ['The 公主 met 王女.']);
        const line = result.trace.find((item) => item.uid === 0);
        expect(line?.detail).toBe('公主');
    });

    it('never activates a disabled entry through an alias', () => {
        const book = {
            entries: { '0': { uid: 0, key: ['x'], content: 'Body.', disable: true } },
        };
        const entries = applyAliases(parseWorldInfoBook('eldoria', book) as ScanEntry[], {
            '0': { aliases: ['王女'] },
        });
        expect(scan(entries, ['王女 spoke.']).activated).toHaveLength(0);
    });

    it('makes an alias satisfy the secondary-key gate', () => {
        const book = {
            entries: {
                '0': { uid: 0, key: ['knight'], keysecondary: ['oath'], selective: true, content: 'Body.' },
            },
        };
        const entries = applyAliases(parseWorldInfoBook('eldoria', book) as ScanEntry[], {
            '0': { aliases: ['sworn'] },
        });

        // The alias is a primary key, so the secondary gate still applies.
        expect(scan(entries, ['sworn spoke.']).activated).toHaveLength(0);
        expect(scan(entries, ['sworn spoke the oath.']).activated.map((entry) => entry.uid)).toEqual([0]);
    });
});

describe('sidecar lifecycle', () => {
    it('copies and moves with the book', async () => {
        const file = await writeBook();
        await setAliases(file, 'eldoria', 0, ['王女']);

        const copy = path.join(dir, 'eldoria (2).json');
        await writeBook('eldoria (2).json');
        await copyAliasFile(file, copy, 'eldoria (2)');
        expect(await readAliases(copy, 'eldoria (2)')).toMatchObject({ '0': { aliases: ['王女'] } });

        const moved = path.join(dir, 'moved.json');
        await writeBook('moved.json');
        expect(await moveAliasFile(file, moved)).toBe(true);
        expect(await readAliases(moved, 'moved')).toMatchObject({ '0': { aliases: ['王女'] } });
        // The original no longer has one.
        expect(await readAliases(file, 'eldoria')).toEqual({});
    });

    it('a move with no sidecar is not an error', async () => {
        const file = await writeBook();
        const target = path.join(dir, 'other.json');
        await writeBook('other.json');
        expect(await moveAliasFile(file, target)).toBe(false);
    });

    it('is removed with the book', async () => {
        const file = await writeBook();
        await setAliases(file, 'eldoria', 0, ['王女']);
        expect(await removeAliasFile(file)).toBe(true);
        expect(await removeAliasFile(file)).toBe(false);
    });

    it('a corrupt sidecar does not stop the book loading', async () => {
        const file = await writeBook();
        await writeFile(aliasPathFor(file), '{ not json', 'utf8');
        const book = await readWorldInfoBook('eldoria', dir);
        expect(book?.entries).toHaveLength(2);
        expect(book?.entries[0]?.autoKeys).toEqual([]);
    });
});
