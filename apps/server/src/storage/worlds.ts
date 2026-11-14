import { readdir, stat } from 'node:fs/promises';

import {
    type ItemScope,
    isRecord,
    type WorldDetail,
    type WorldInfoEntryPatch,
    type WorldSummary,
} from '@catcup/shared';

import {
    appendEntry,
    applyEntryPatch,
    duplicateEntry,
    ensureEntryContainer,
    findEntryLocation,
    readEntriesForEditor,
    reorderEntries,
} from '../worldinfo/entries.js';
import { parseWorldInfoBook } from '../worldinfo/loader.js';
import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';
import {
    copyItemIntoScope,
    listMergedItems,
    locateItem,
    moveItemBetweenScopes,
    removeIfPresent,
    type ScopeMoveResult,
} from './scopes.js';

const BOOK_EXTENSIONS = ['.json'] as const;

/** Absolute path of a world info book in one scope. */
export function worldFilePath(id: string, scope: ItemScope = 'profile'): string {
    assertSimpleName(id);
    const directory = scope === 'shared' ? paths.sharedWorlds : paths.worlds;
    return resolveInside(directory, `${id}.json`);
}

function normalizeId(candidate: string, fallback = 'world'): string {
    const cleaned = candidate.replace(/\.json$/i, '').trim();
    return safeFileName(cleaned, fallback).slice(0, 120).trim() || fallback;
}

function detailOf(id: string, book: Record<string, unknown>, scope: ItemScope = 'profile'): WorldDetail {
    return { id, book, entries: readEntriesForEditor(book), scope };
}

/**
 * List every book this profile can see.
 *
 * A shared book whose id the profile uses is not listed twice: the profile's
 * book carries `shadowed`, and it is the one a lookup resolves to.
 */
export async function listWorlds(): Promise<WorldSummary[]> {
    const merged = await listMergedItems('worlds', BOOK_EXTENSIONS);

    const summaries = await Promise.all(
        merged.map(async (item): Promise<WorldSummary | null> => {
            try {
                const [stats, raw] = await Promise.all([
                    stat(item.filePath),
                    readJsonFile<unknown>(item.filePath, null),
                ]);
                return {
                    id: item.id,
                    name: item.id,
                    entryCount: parseWorldInfoBook(item.id, raw).length,
                    updatedAt: stats.mtimeMs,
                    scope: item.scope,
                    ...(item.shadowed ? { shadowed: true } : {}),
                };
            } catch {
                return null;
            }
        }),
    );

    return summaries.filter((world): world is WorldSummary => world !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Read one book, the profile's copy first. Returns `null` when neither scope has it. */
export async function readWorld(id: string): Promise<WorldDetail | null> {
    const found = await locateItem('worlds', id, BOOK_EXTENSIONS);
    if (!found) {
        return null;
    }
    const raw = await readJsonFile<unknown>(found.filePath, null);
    if (!isRecord(raw)) {
        return null;
    }
    return detailOf(id, raw, found.scope);
}

/**
 * Store a book under a free name in the requested scope.
 *
 * The body is written verbatim so unknown fields survive an export round trip;
 * the loader normalizes shapes at read time.
 */
export async function createWorld(input: {
    fileName?: string;
    book: unknown;
    scope?: ItemScope;
}): Promise<WorldDetail> {
    if (!isRecord(input.book)) {
        throw new Error('World info must be a JSON object');
    }

    const scope = input.scope ?? 'profile';
    const base = normalizeId(input.fileName?.trim() || 'world');
    const directory = scope === 'shared' ? paths.sharedWorlds : paths.worlds;
    const existing = new Set((await readdir(directory).catch(() => [] as string[])).map((name) => name.toLowerCase()));

    let id = base;
    let index = 2;
    while (existing.has(`${id.toLowerCase()}.json`)) {
        id = `${base} (${index})`;
        index += 1;
    }

    const file = worldFilePath(id, scope);
    await withFileLock(file, () => writeJsonFile(file, input.book));

    return detailOf(id, input.book, scope);
}

/** Outcome of an entry mutation: the refreshed book, or what was missing. */
export type WorldEntryResult =
    | { status: 'ok'; world: WorldDetail; uid?: number }
    | { status: 'missing-book' }
    | { status: 'missing-entry' };

/** What a mutation callback reports back: the entry it touched, or a miss. */
type MutationOutcome = { status: 'ok'; uid?: number } | { status: 'missing-entry' };

/**
 * Serialize a read-modify-write of one book.
 *
 * Every mutation goes through this so a settings save, a generation and an
 * editor save cannot interleave and lose an entry. The book is resolved through
 * both scopes, so editing a shared book edits the shared file and not a copy.
 */
async function mutateBook(
    id: string,
    mutate: (book: Record<string, unknown>) => MutationOutcome,
): Promise<WorldEntryResult> {
    const found = await locateItem('worlds', id, BOOK_EXTENSIONS);
    if (!found) {
        return { status: 'missing-book' } as const;
    }
    const file = found.filePath;

    return withFileLock(file, async () => {
        const raw = await readJsonFile<unknown>(file, null);
        if (!isRecord(raw)) {
            return { status: 'missing-book' } as const;
        }

        const outcome = mutate(raw);
        if (outcome.status !== 'ok') {
            return { status: outcome.status } as const;
        }

        await writeJsonFile(file, raw);
        return {
            status: 'ok',
            world: detailOf(id, raw, found.scope),
            ...(outcome.uid === undefined ? {} : { uid: outcome.uid }),
        } as const;
    });
}

/** Append a blank entry built from SillyTavern's template. */
export async function createWorldEntry(id: string): Promise<WorldEntryResult> {
    return mutateBook(id, (book) => {
        const { uid } = appendEntry(ensureEntryContainer(book));
        return { status: 'ok', uid };
    });
}

/** Copy one entry under a free uid. */
export async function duplicateWorldEntry(id: string, uid: number): Promise<WorldEntryResult> {
    return mutateBook(id, (book) => {
        const copy = duplicateEntry(ensureEntryContainer(book), uid);
        return copy ? { status: 'ok', uid: copy.uid } : { status: 'missing-entry' };
    });
}

/** Merge a patch into one entry, leaving every field it does not mention. */
export async function updateWorldEntry(id: string, uid: number, patch: WorldInfoEntryPatch): Promise<WorldEntryResult> {
    return mutateBook(id, (book) => {
        const location = findEntryLocation(book, uid);
        if (!location) {
            return { status: 'missing-entry' };
        }
        applyEntryPatch(location.value, patch);
        return { status: 'ok', uid };
    });
}

/** Remove one entry. */
export async function deleteWorldEntry(id: string, uid: number): Promise<WorldEntryResult> {
    return mutateBook(id, (book) => {
        const location = findEntryLocation(book, uid);
        if (!location) {
            return { status: 'missing-entry' };
        }
        delete location.container[location.key];
        return { status: 'ok', uid };
    });
}

/** Assign `displayIndex` values in the given order, which is how the list reorders. */
export async function reorderWorldEntries(id: string, uids: readonly number[]): Promise<WorldEntryResult> {
    return mutateBook(id, (book) => {
        reorderEntries(ensureEntryContainer(book), uids);
        return { status: 'ok' };
    });
}

/** Delete a book from whichever scope holds it. Returns false when it did not exist. */
export async function deleteWorld(id: string): Promise<boolean> {
    const found = await locateItem('worlds', id, BOOK_EXTENSIONS);
    if (!found) {
        return false;
    }
    return removeIfPresent(found.filePath);
}

/** Move a book into the shared scope, or take a shared one into this profile. */
export async function changeWorldScope(id: string, target: ItemScope): Promise<ScopeMoveResult> {
    return moveItemBetweenScopes('worlds', id, target, BOOK_EXTENSIONS);
}

/** Copy a book into the other scope under a free name. */
export async function copyWorldIntoScope(id: string, target: ItemScope): Promise<ScopeMoveResult> {
    return copyItemIntoScope('worlds', id, target, BOOK_EXTENSIONS);
}
