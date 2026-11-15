import { copyFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { ItemScope } from '@catcup/shared';

import { paths } from './paths.js';
import { readProfileIndex } from './profiles.js';

/**
 * The two scopes a library item can live in.
 *
 * A profile owns its own folder; `data/shared/` belongs to the machine. Every
 * lookup asks the profile first and falls back to the shared folder, so an id
 * addresses exactly one item — the profile's, when both have it. That single
 * rule is what keeps a chat, a group membership or an `extensions.world` link
 * pointing at the item the person can actually see.
 *
 * Nothing here ever reaches into another profile's folder: the shared scope is
 * the only second place a profile can read from.
 */

/** The four kinds that are a folder of one file per id. */
export type FileItemKind = 'characters' | 'worlds' | 'presets' | 'quickreplies';

/** The folder each scope keeps a file kind in. */
export function itemDirs(kind: FileItemKind): Record<ItemScope, string> {
    switch (kind) {
        case 'characters':
            return { profile: paths.characters, shared: paths.sharedCharacters };
        case 'worlds':
            return { profile: paths.worlds, shared: paths.sharedWorlds };
        case 'presets':
            return { profile: paths.presets, shared: paths.sharedPresets };
        case 'quickreplies':
            return { profile: paths.quickReplies, shared: paths.sharedQuickReplies };
    }
}

/** Where a plain JSON library file (regex, personas) lives in each scope. */
export function libraryFile(kind: 'regex' | 'personas'): Record<ItemScope, string> {
    return kind === 'regex'
        ? { profile: paths.regex, shared: paths.sharedRegex }
        : { profile: paths.personas, shared: paths.sharedPersonas };
}

/** Create the shared folders, so a first write never meets a missing parent. */
export async function ensureSharedDirs(): Promise<void> {
    await Promise.all(
        (['sharedCharacters', 'sharedWorlds', 'sharedPresets', 'sharedQuickReplies'] as const).map((key) =>
            mkdir(paths[key], { recursive: true }),
        ),
    );
}

/** One item found in one scope. */
export interface LocatedItem {
    id: string;
    scope: ItemScope;
    /** File name with its extension, as it sits on disk. */
    fileName: string;
    /** Absolute path. */
    filePath: string;
}

/** A visible item, with the profile's copy winning over the shared one. */
export interface MergedItem extends LocatedItem {
    /** `true` when a profile item hides a shared item with the same id. */
    shadowed: boolean;
}

async function namesIn(directory: string, extensions: readonly string[]): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && extensions.some((x) => entry.name.toLowerCase().endsWith(x)))
        .map((entry) => entry.name);
}

const idOf = (fileName: string): string => fileName.replace(/\.(png|json)$/i, '');

/**
 * Every item visible to this profile, one entry per id.
 *
 * Ids compare case-insensitively, because a case-insensitive filesystem cannot
 * hold `Mira` and `mira` and a listing must agree with a lookup on every
 * platform.
 */
export async function listMergedItems(kind: FileItemKind, extensions: readonly string[]): Promise<MergedItem[]> {
    const dirs = itemDirs(kind);
    const [profileNames, sharedNames] = await Promise.all([
        namesIn(dirs.profile, extensions),
        namesIn(dirs.shared, extensions),
    ]);

    const merged = new Map<string, MergedItem>();
    for (const scope of ['shared', 'profile'] as const) {
        const names = scope === 'shared' ? sharedNames : profileNames;
        for (const fileName of names) {
            const id = idOf(fileName);
            const existing = merged.get(id.toLowerCase());
            merged.set(id.toLowerCase(), {
                id,
                scope,
                fileName,
                filePath: path.join(dirs[scope], fileName),
                shadowed: scope === 'profile' && existing?.scope === 'shared',
            });
        }
    }
    return [...merged.values()];
}

/**
 * Find one item by id, profile scope first.
 *
 * `extensions` is ordered: a character may be a `.png` or a `.json` card, and
 * the PNG wins because that is the format the library writes on import.
 */
export async function locateItem(
    kind: FileItemKind,
    id: string,
    extensions: readonly string[],
): Promise<LocatedItem | null> {
    const dirs = itemDirs(kind);
    for (const scope of ['profile', 'shared'] as const) {
        for (const extension of extensions) {
            const fileName = `${id}${extension}`;
            const filePath = path.join(dirs[scope], fileName);
            if (await stat(filePath).catch(() => null)) {
                return { id, scope, fileName, filePath };
            }
        }
    }
    return null;
}

/** Names already taken in one scope, lowercased, so a create can pick a free one. */
export async function takenNames(kind: FileItemKind, scope: ItemScope): Promise<Set<string>> {
    return new Set((await readdir(itemDirs(kind)[scope]).catch(() => [])).map((name) => name.toLowerCase()));
}

export interface ScopeMoveResult {
    kind: FileItemKind;
    id: string;
    /** The scope the item ended in. */
    scope: ItemScope;
    /** File name after the move; unchanged for a move. */
    fileName: string;
}

/**
 * Move an item between the two scopes.
 *
 * A move is a single `rename` inside one volume, so it either happens or it does
 * not. The destination must not already hold that id: overwriting would destroy
 * one of two things a person can see at the same time.
 */
export async function moveItemBetweenScopes(
    kind: FileItemKind,
    id: string,
    target: ItemScope,
    extensions: readonly string[],
): Promise<ScopeMoveResult> {
    const found = await locateItem(kind, id, extensions);
    if (!found) {
        throw new Error('Item not found');
    }
    if (found.scope === target) {
        throw new Error('That item is already in this scope');
    }
    if (await findItemInScope(kind, id, target, extensions)) {
        throw new Error('The destination already has an item with that id');
    }

    await mkdir(itemDirs(kind)[target], { recursive: true });
    await rename(found.filePath, path.join(itemDirs(kind)[target], found.fileName));
    return { kind, id, scope: target, fileName: found.fileName };
}

/**
 * Copy an item into the other scope under a free id.
 *
 * Taking a shared item into a profile is a copy on purpose: the profile can
 * then edit its version without changing what every other profile sees. The
 * copy gets `Name (2)` when `Name` is taken, exactly as an import would.
 *
 * The source is the scope the item is *not* being copied into, so a profile
 * that already shadows a shared item still copies the shared original rather
 * than refusing.
 */
export async function copyItemIntoScope(
    kind: FileItemKind,
    id: string,
    target: ItemScope,
    extensions: readonly string[],
): Promise<ScopeMoveResult> {
    const source: ItemScope = target === 'shared' ? 'profile' : 'shared';
    const found = await findItemInScope(kind, id, source, extensions);
    if (!found) {
        throw new Error('Item not found');
    }

    const extension = path.extname(found.fileName);
    const base = found.fileName.slice(0, -extension.length);
    const taken = await takenNames(kind, target);

    let fileName = found.fileName;
    let index = 2;
    while (taken.has(fileName.toLowerCase())) {
        fileName = `${base} (${index})${extension}`;
        index += 1;
    }

    await mkdir(itemDirs(kind)[target], { recursive: true });
    await copyFile(found.filePath, path.join(itemDirs(kind)[target], fileName));
    return { kind, id: idOf(fileName), scope: target, fileName };
}

/**
 * Find one item in a named scope.
 *
 * The plain lookup asks the profile first, which is what an id resolves to;
 * copying needs the opposite question — "is the shared original there?" — even
 * when the profile already shadows it.
 */
export async function findItemInScope(
    kind: FileItemKind,
    id: string,
    scope: ItemScope,
    extensions: readonly string[],
): Promise<LocatedItem | null> {
    const directory = itemDirs(kind)[scope];
    for (const extension of extensions) {
        const fileName = `${id}${extension}`;
        const filePath = path.join(directory, fileName);
        if (await stat(filePath).catch(() => null)) {
            return { id, scope, fileName, filePath };
        }
    }
    return null;
}

/** Remove one file, reporting whether it was there. */
export async function removeIfPresent(filePath: string): Promise<boolean> {
    try {
        await unlink(filePath);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

/**
 * How many live profiles can see a shared item.
 *
 * The confirmation for a move names this number, so nobody turns one campaign's
 * private preset into everyone's by accident. An archived profile does not
 * count: it is not loaded and cannot be switched to.
 */
export async function liveProfileCount(): Promise<number> {
    const index = await readProfileIndex();
    return index?.profiles.filter((entry) => !entry.archived).length ?? 0;
}
