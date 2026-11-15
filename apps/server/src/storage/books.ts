import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { BookFormat, DistilledBook } from '@catcup/shared';
import writeFileAtomic from 'write-file-atomic';

import { BookParseError, formatOf, parseBook } from '../distill/parse.js';
import type { Section } from '../distill/sections.js';
import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { paths, resolveInside, safeFileName } from './paths.js';

/**
 * Uploaded books.
 *
 * A book lives in its own folder under the profile that uploaded it, holding
 * the file as it arrived and a record of what parsing found. The text is never
 * copied into the record, so a run always reads the file the person actually
 * uploaded, and a re-run after a bad parse cannot disagree with the source.
 */

const RECORD = 'book.json';
const SOURCE = 'source';

/** The record beside the source file. Titles and sizes only — never text. */
interface BookRecord {
    name: string;
    fileName: string;
    format: BookFormat;
    bytes: number;
    addedAt: number;
    sections: DistilledBook['sections'];
}

function bookDir(id: string): string {
    return resolveInside(paths.books, id);
}

/** Absolute path of a book's source file. */
export function bookSourcePath(id: string, format: BookFormat): string {
    return path.join(bookDir(id), `${SOURCE}.${format}`);
}

/** Find a free folder name for a new book, so two copies of one title both survive. */
async function freeBookId(base: string): Promise<string> {
    const existing = new Set(
        (await readdir(paths.books).catch(() => [] as string[])).map((name) => name.toLowerCase()),
    );
    let id = base;
    let index = 2;
    while (existing.has(id.toLowerCase())) {
        id = `${base} (${index})`;
        index += 1;
    }
    return id;
}

function toBook(id: string, record: BookRecord): DistilledBook {
    return { id, ...record };
}

/** Every book this profile has uploaded, newest first. */
export async function listBooks(): Promise<DistilledBook[]> {
    const names = (await readdir(paths.books).catch(() => [] as string[])).sort();

    const books = await Promise.all(
        names.map(async (id): Promise<DistilledBook | null> => {
            const record = await readJsonFile<BookRecord | null>(path.join(bookDir(id), RECORD), null);
            return record ? toBook(id, record) : null;
        }),
    );

    return books.filter((book): book is DistilledBook => book !== null).sort((a, b) => b.addedAt - a.addedAt);
}

/** One book's record, or `null` when it does not exist. */
export async function readBook(id: string): Promise<DistilledBook | null> {
    const record = await readJsonFile<BookRecord | null>(path.join(bookDir(id), RECORD), null);
    return record ? toBook(id, record) : null;
}

/**
 * Read a book's sections, re-parsing the stored file.
 *
 * Parsing is cheap next to the model calls that follow, and doing it on demand
 * means a correction to the heading rules applies to books uploaded before it.
 */
export async function readBookSections(id: string): Promise<Section[]> {
    const book = await readBook(id);
    if (!book) {
        return [];
    }
    const buffer = await readFile(bookSourcePath(id, book.format));
    return parseBook(buffer, book.fileName).sections;
}

/**
 * Store an uploaded book.
 *
 * The file is parsed before anything is written, so an unreadable or DRM-locked
 * EPUB leaves no folder behind. A parse failure is the caller's to report: it
 * carries the error code the route sends.
 */
export async function createBook(fileName: string, buffer: Buffer): Promise<DistilledBook> {
    const format = formatOf(fileName);
    if (!format) {
        throw new BookParseError('Books must be .txt, .md or .epub files');
    }

    const parsed = parseBook(buffer, fileName);
    const name = safeFileName(path.basename(fileName, path.extname(fileName)), 'book');
    const id = await freeBookId(name);
    const directory = bookDir(id);

    const record: BookRecord = {
        name,
        fileName,
        format,
        bytes: buffer.length,
        addedAt: Date.now(),
        sections: parsed.sections.map((section) => ({
            index: section.index,
            title: section.title,
            chars: section.text.length,
        })),
    };

    const source = bookSourcePath(id, format);
    await withFileLock(source, async () => {
        await mkdir(directory, { recursive: true });
        await writeJsonFile(path.join(directory, RECORD), record);
        await writeFileAtomic(source, buffer, { mode: 0o600 });
    });

    return toBook(id, record);
}

/** Delete a book and its source file. Returns false when it did not exist. */
export async function deleteBook(id: string): Promise<boolean> {
    const directory = bookDir(id);
    if (!(await stat(directory).catch(() => null))) {
        return false;
    }
    await rm(directory, { recursive: true, force: true });
    return true;
}
