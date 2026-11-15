import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProfileDataDir, TEST_PROFILE_ID } from '../testHelpers/profile.js';

/**
 * Uploaded books, against a real data folder.
 *
 * The invariants worth a test here are the ones a route test cannot see: a book
 * is parsed before anything is written, two books of the same title both
 * survive, and a book belongs to one profile.
 */

let root: string;

async function useDataFolder(): Promise<typeof import('../storage/paths.js')> {
    const paths = await import('../storage/paths.js');
    paths.setActiveScope(path.join(root, 'profiles', TEST_PROFILE_ID));
    await paths.ensureDataDirs();
    return paths;
}

const novel = 'Chapter 1\nMira lit the lamp.\n\nChapter 2\nBram arrived.';

beforeEach(async () => {
    vi.resetModules();
    root = await createProfileDataDir('catcup-books-');
    process.env.CATCUP_DATA_DIR = root;
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    delete process.env.CATCUP_DATA_DIR;
});

describe('book storage', () => {
    it('stores a book and lists it with its sections but not its text', async () => {
        await useDataFolder();
        const books = await import('../storage/books.js');

        const created = await books.createBook('novel.txt', Buffer.from(novel, 'utf8'));
        expect(created.format).toBe('txt');
        expect(created.sections.map((section) => section.title)).toEqual(['Chapter 1', 'Chapter 2']);

        const listed = await books.listBooks();
        expect(listed).toHaveLength(1);
        expect(listed[0]?.id).toBe('novel');
        // Section sizes are recorded; the section text is not.
        expect(listed[0]?.sections[0]?.chars).toBeGreaterThan(0);
        expect(JSON.stringify(listed[0])).not.toContain('Mira lit');
    });

    it('re-reads the sections from the stored source file', async () => {
        await useDataFolder();
        const books = await import('../storage/books.js');
        const created = await books.createBook('novel.txt', Buffer.from(novel, 'utf8'));

        const sections = await books.readBookSections(created.id);
        expect(sections[1]?.title).toBe('Chapter 2');
        expect(sections[1]?.text).toBe('Bram arrived.');
    });

    it('gives a second book of the same title its own id', async () => {
        await useDataFolder();
        const books = await import('../storage/books.js');

        const first = await books.createBook('novel.txt', Buffer.from(novel, 'utf8'));
        const second = await books.createBook('novel.txt', Buffer.from(novel, 'utf8'));

        expect(first.id).toBe('novel');
        expect(second.id).toBe('novel (2)');
        expect(await books.listBooks()).toHaveLength(2);
    });

    it('leaves nothing behind when the file cannot be read', async () => {
        const paths = await useDataFolder();
        const books = await import('../storage/books.js');

        await expect(books.createBook('novel.pdf', Buffer.from('x'))).rejects.toThrow(/\.txt, \.md or \.epub/);
        // A failed parse must not create a folder the list would then show.
        expect(await books.listBooks()).toEqual([]);
        expect(await readdir(paths.paths.books)).toEqual([]);
    });

    it('deletes the book and its source file', async () => {
        const paths = await useDataFolder();
        const books = await import('../storage/books.js');
        const created = await books.createBook('novel.txt', Buffer.from(novel, 'utf8'));

        expect(await books.deleteBook(created.id)).toBe(true);
        expect(await books.listBooks()).toEqual([]);
        expect(await readdir(paths.paths.books)).toEqual([]);
    });

    it('reports a missing book rather than throwing', async () => {
        await useDataFolder();
        const books = await import('../storage/books.js');

        expect(await books.readBook('nothing')).toBeNull();
        expect(await books.readBookSections('nothing')).toEqual([]);
        expect(await books.deleteBook('nothing')).toBe(false);
    });

    it('keeps the books of one profile out of another', async () => {
        const paths = await useDataFolder();
        const books = await import('../storage/books.js');
        await books.createBook('novel.txt', Buffer.from(novel, 'utf8'));

        const other = path.join(root, 'profiles', 'mystery');
        paths.setActiveScope(other);
        await paths.ensureDataDirs();

        expect(await books.listBooks()).toEqual([]);
    });
});
