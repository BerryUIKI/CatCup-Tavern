import { readdir, stat } from 'node:fs/promises';
import { applyAliases, parseWorldInfoBook, type ScanEntry } from '@catcup/compat-st';
import type { WorldInfoAliasMap } from '@catcup/shared';
import { readJsonFile } from '../storage/jsonFile.js';
import { assertSimpleName, paths, resolveInside } from '../storage/paths.js';
import { locateItem } from '../storage/scopes.js';
import { readAliases } from './aliases.js';

// The pure parsing moved to `@catcup/compat-st`; this file keeps the file I/O
// and re-exports the parsers so the app's import sites do not have to change.
export { applyAliases, extractEntries, parseWorldInfoBook, resolveUid } from '@catcup/compat-st';

export interface WorldInfoBookSummary {
    /** File name without `.json`. */
    id: string;
    entryCount: number;
    updatedAt: number;
}

export interface WorldInfoBook {
    id: string;
    entries: ScanEntry[];
    /** The untouched file contents, preserved for export. */
    raw: unknown;
}

/** Pull the entries map out of the shapes SillyTavern and its exporters produce. */
/** List world info books in one folder (defaults to this profile's `worlds/`). */
export async function listWorldInfoBooks(dir: string = paths.worlds): Promise<WorldInfoBookSummary[]> {
    let names: string[];
    try {
        names = await readdir(dir);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const books = await Promise.all(
        names
            .filter((name) => name.toLowerCase().endsWith('.json'))
            .map(async (fileName): Promise<WorldInfoBookSummary | null> => {
                const id = fileName.slice(0, -'.json'.length);
                try {
                    const file = resolveInside(dir, fileName);
                    const [stats, raw] = await Promise.all([stat(file), readJsonFile<unknown>(file, null)]);
                    return {
                        id,
                        entryCount: parseWorldInfoBook(id, raw).length,
                        updatedAt: stats.mtimeMs,
                    };
                } catch {
                    return null;
                }
            }),
    );

    return books.filter((book): book is WorldInfoBookSummary => book !== null).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Read one book. Returns `null` when the file does not exist.
 *
 * With no `dir`, the book is looked up the way generation looks it up: this
 * profile's folder first, then the shared one. A `dir` is an explicit override
 * for tests and for importing from a folder that is not a scope.
 */
export async function readWorldInfoBook(id: string, dir?: string): Promise<WorldInfoBook | null> {
    assertSimpleName(id);

    let file: string;
    if (dir === undefined) {
        const found = await locateItem('worlds', id, ['.json']);
        if (!found) {
            return null;
        }
        file = found.filePath;
    } else {
        file = resolveInside(dir, `${id}.json`);
    }

    const raw = await readJsonFile<unknown>(file, null);
    if (raw === null) {
        return null;
    }

    const entries = parseWorldInfoBook(id, raw);
    // The sidecar is optional: a missing or unreadable one leaves every entry
    // exactly as `parseWorldInfoBook` produced it.
    const aliases = await readAliases(file, id).catch(() => ({}) as WorldInfoAliasMap);
    return { id, entries: applyAliases(entries, aliases), raw };
}

/**
 * Load entries from several books, skipping missing or unreadable ones.
 *
 * A book that cannot be read is not fatal: the scan proceeds with whatever
 * loaded, and the caller decides whether to surface the gap.
 */
export async function loadWorldInfoEntries(ids: readonly string[], dir?: string): Promise<ScanEntry[]> {
    const books = await Promise.all(ids.map((id) => readWorldInfoBook(id, dir).catch(() => null)));
    return books.flatMap((book) => book?.entries ?? []);
}

/** Absolute path of a book file, used by import/export in a later slice. */
export function worldInfoBookPath(id: string, dir: string = paths.worlds): string {
    assertSimpleName(id);
    return resolveInside(dir, `${id}.json`);
}
