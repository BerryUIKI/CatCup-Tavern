// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/world-info.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import { readdir, stat } from 'node:fs/promises';

import { worldInfoEntrySchema } from '@catcup/shared';

import { readJsonFile } from '../storage/jsonFile.js';
import { assertSimpleName, paths, resolveInside } from '../storage/paths.js';
import { locateItem } from '../storage/scopes.js';
import { getStringHash } from './hash.js';
import { parseDecorators } from './matching.js';
import type { ScanEntry } from './types.js';

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

const ENTRY_HINTS = ['key', 'keysecondary', 'content', 'comment', 'uid'];

function looksLikeEntry(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    return ENTRY_HINTS.some((field) => field in value);
}

function looksLikeEntryMap(value: Record<string, unknown>): boolean {
    const values = Object.values(value);
    return values.length > 0 && values.every(looksLikeEntry);
}

/** Pull the entries map out of the shapes SillyTavern and its exporters produce. */
export function extractEntries(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }

    const root = raw as Record<string, unknown>;
    const nested = root.entries;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
    }

    // Older exports and hand-written files sometimes use a bare `uid -> entry`
    // map with no `entries` wrapper.
    if (looksLikeEntryMap(root)) {
        return root;
    }

    return null;
}

/**
 * Resolve the uid an entry is known by.
 *
 * SillyTavern writes `uid` on every entry it saves; older and hand-written
 * files key the entry map by uid instead. The editor resolves uids through the
 * same function as the loader, so the entry a `PATCH` targets is the entry the
 * scanner read.
 */
export function resolveUid(raw: Record<string, unknown>, key: string, fallback: number): number {
    const candidate = raw.uid;
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
        return candidate;
    }
    const fromKey = Number.parseInt(key, 10);
    return Number.isInteger(fromKey) ? fromKey : fallback;
}

/**
 * Normalize one world info file into scan-ready entries.
 *
 * Unknown fields survive on the entry object; the raw file is kept separately
 * so an export can round-trip anything the schema does not model.
 */
export function parseWorldInfoBook(id: string, raw: unknown): ScanEntry[] {
    const rawEntries = extractEntries(raw);
    if (!rawEntries) {
        return [];
    }

    const entries: ScanEntry[] = [];
    let index = 0;

    for (const [key, value] of Object.entries(rawEntries)) {
        const parsed = worldInfoEntrySchema.safeParse(value);
        if (!parsed.success) {
            index += 1;
            continue;
        }

        const source = value as Record<string, unknown>;
        const uid = resolveUid(source, key, index);
        const { decorators, content } = parseDecorators(parsed.data.content);

        // SillyTavern hashes `{ uid, world, ...entry }` with `decorators` and
        // the stripped `content` appended, then uses that hash to match timed
        // effects stored in imported chats. Key order is part of the payload,
        // so build it the same way instead of hashing the parsed object.
        const { uid: _sourceUid, ...rest } = source;
        const hash = getStringHash(JSON.stringify({ uid, world: id, ...rest, decorators, content }));

        entries.push({
            ...parsed.data,
            uid,
            world: id,
            id: `${id}.${uid}`,
            decorators,
            content,
            hash,
        });
        index += 1;
    }

    return entries;
}

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
    return { id, entries: parseWorldInfoBook(id, raw), raw };
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
