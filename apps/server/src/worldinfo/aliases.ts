import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';

import {
    MAX_ALIAS_LENGTH,
    MAX_ALIASES_PER_ENTRY,
    type WorldInfoAliasFile,
    type WorldInfoAliasMap,
    type WorldInfoAliasRecord,
    worldInfoAliasFileSchema,
} from '@catcup/shared';

import { readJsonFile, writeJsonFile } from '../storage/jsonFile.js';
import { findItemInScope, locateItem } from '../storage/scopes.js';

/**
 * Alias sidecars: the extra names an entry answers to.
 *
 * Aliases live beside the book rather than inside it. An entry's identity hash
 * covers the whole raw record, `extensions` included, and a chat's
 * `timedWorldInfo` records are matched by that hash — so writing an alias group
 * into the entry would silently detach every sticky and cooldown it had.
 *
 * The file is `<book>.aliases.json` in the same folder as `<book>.json`. A book
 * with no sidecar reads as "no aliases" and behaves exactly as it did before
 * this feature existed; nothing here may become a precondition for loading a
 * book.
 */

/** Where a book's sidecar sits, given the book's own path. */
export function aliasPathFor(bookPath: string): string {
    const extension = path.extname(bookPath);
    return `${bookPath.slice(0, bookPath.length - extension.length)}.aliases.json`;
}

/** Where a book's sidecar sits, resolved through the two scopes. */
export async function resolveAliasPath(id: string): Promise<string | null> {
    const found = await locateItem('worlds', id, ['.json']);
    return found ? aliasPathFor(found.filePath) : null;
}

/** The sidecar path in one named scope, whether or not the book is there. */
export async function aliasPathInScope(id: string, scope: 'profile' | 'shared'): Promise<string | null> {
    const found = await findItemInScope('worlds', id, scope, ['.json']);
    return found ? aliasPathFor(found.filePath) : null;
}

/**
 * Normalize an alias list.
 *
 * Aliases are compared case-insensitively when de-duplicating, because a key
 * that differs only by case would fire in exactly the same places — and the
 * first spelling wins, so the list keeps the order the person typed.
 */
export function normalizeAliases(input: readonly string[]): string[] {
    const seen = new Set<string>();
    const aliases: string[] = [];

    for (const raw of input) {
        const alias = raw.trim().slice(0, MAX_ALIAS_LENGTH);
        if (!alias) {
            continue;
        }
        const key = alias.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        aliases.push(alias);
        if (aliases.length >= MAX_ALIASES_PER_ENTRY) {
            break;
        }
    }

    return aliases;
}

/** Read one sidecar, or an empty map when it is missing or unreadable. */
export async function readAliasFile(bookPath: string, id?: string): Promise<WorldInfoAliasFile> {
    const raw = await readJsonFile<unknown>(aliasPathFor(bookPath), null);
    const parsed = worldInfoAliasFileSchema.safeParse(raw);
    if (parsed.success) {
        return parsed.data;
    }
    // A corrupt or hand-edited sidecar must never stop a book from loading.
    return { version: 1, ...(id ? { book: id } : {}), entries: {} };
}

/** Read the aliases a book carries, keyed by uid. */
export async function readAliases(bookPath: string, id?: string): Promise<WorldInfoAliasMap> {
    return (await readAliasFile(bookPath, id)).entries;
}

/** Replace one entry's aliases. An empty list removes the record. */
export async function setAliases(
    bookPath: string,
    id: string,
    uid: number,
    aliases: readonly string[],
): Promise<WorldInfoAliasRecord | null> {
    return writeRecord(bookPath, id, uid, (normalized) => ({ aliases: normalized }), aliases);
}

/**
 * Record a model's proposal, with the content it was generated from.
 *
 * The provenance is what makes "stale" meaningful: `readWorldAliases` compares
 * `generatedFrom` against the entry's content hash now, and a mismatch means the
 * names describe text that has since changed. A hand-typed set has no
 * `generatedFrom` and can never be stale, which is correct — a person wrote it
 * against whatever the entry says today.
 *
 * `generatedWith` is not consulted by anything. It is there so a book filled in
 * over several runs can say which model wrote which row, which is the
 * difference between "these look wrong" and "the cheap model wrote these".
 */
export async function setGeneratedAliases(
    bookPath: string,
    id: string,
    uid: number,
    aliases: readonly string[],
    generatedFrom: string,
    generatedWith = '',
    generatedAt = Date.now(),
): Promise<WorldInfoAliasRecord | null> {
    return writeRecord(
        bookPath,
        id,
        uid,
        (normalized) => ({
            aliases: normalized,
            generatedFrom,
            generatedAt,
            ...(generatedWith ? { generatedWith } : {}),
        }),
        aliases,
    );
}

/**
 * Write one entry's record, or drop it when the list is empty.
 *
 * Shared by the hand-entered and generated paths so the normalization and the
 * empty-list rule cannot drift between them.
 */
async function writeRecord(
    bookPath: string,
    id: string,
    uid: number,
    record: (normalized: string[]) => WorldInfoAliasRecord,
    aliases: readonly string[],
): Promise<WorldInfoAliasRecord | null> {
    const file = await readAliasFile(bookPath, id);
    const normalized = normalizeAliases(aliases);

    if (normalized.length === 0) {
        delete file.entries[String(uid)];
        await writeAliasFile(bookPath, { ...file, book: id });
        return null;
    }

    const next = record(normalized);
    file.entries[String(uid)] = next;
    await writeAliasFile(bookPath, { ...file, book: id });
    return next;
}

/** Drop one entry's aliases. */
export async function deleteAliases(bookPath: string, id: string, uid: number): Promise<boolean> {
    const file = await readAliasFile(bookPath, id);
    if (!(String(uid) in file.entries)) {
        return false;
    }
    delete file.entries[String(uid)];
    await writeAliasFile(bookPath, { ...file, book: id });
    return true;
}

async function writeAliasFile(bookPath: string, file: WorldInfoAliasFile): Promise<void> {
    await writeJsonFile(aliasPathFor(bookPath), file);
}

/** The alias sidecar for a book in the active profile, or in the shared scope. */
export async function aliasPathForBook(id: string): Promise<string | null> {
    return resolveAliasPath(id);
}

/** Copy a book's sidecar to another book path, if it has one. */
export async function copyAliasFile(fromBookPath: string, toBookPath: string, toId: string): Promise<void> {
    const file = await readAliasFile(fromBookPath, undefined);
    if (Object.keys(file.entries).length === 0) {
        return;
    }
    await writeAliasFile(toBookPath, { ...file, book: toId });
}

/**
 * Move a book's sidecar to a new path.
 *
 * A move is a `rename` inside one volume, the same guarantee the book move
 * relies on. A book without a sidecar moves without one, and that is not an
 * error — it simply has no aliases.
 */
export async function moveAliasFile(fromBookPath: string, toBookPath: string): Promise<boolean> {
    const from = aliasPathFor(fromBookPath);
    const to = aliasPathFor(toBookPath);
    if (from === to) {
        return false;
    }
    try {
        await mkdir(path.dirname(to), { recursive: true });
        await rename(from, to);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

/** Remove a book's sidecar, reporting whether one was there. */
export async function removeAliasFile(bookPath: string): Promise<boolean> {
    try {
        await rm(aliasPathFor(bookPath));
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
