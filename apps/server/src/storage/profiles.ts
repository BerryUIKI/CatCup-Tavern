import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import {
    PROFILE_INDEX_VERSION,
    type ProfileCounts,
    type ProfileEntry,
    type ProfileIndex,
    type ProfileSummary,
    profileIndexSchema,
} from '@catcup/shared';

import { config } from '../config.js';
import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { DEFAULT_PROFILE_ID } from './migrate.js';
import { withFileLock } from './mutex.js';
import { assertSimpleName, ensureDataDirs, getActiveScope, paths, setActiveScope } from './paths.js';

/** The folder a live profile's content lives in. */
export function profileDir(id: string): string {
    assertSimpleName(id);
    return path.join(config.dataDir, 'profiles', id);
}

/** The folder an archived profile's content lives in. */
export function archiveDir(id: string): string {
    assertSimpleName(id);
    return path.join(config.dataDir, 'archive', id);
}

function newProfileId(): string {
    return randomUUID();
}

/**
 * Read the profile index.
 *
 * An install that has never been migrated has no index; this function does not
 * create one, because the migration owns that transition. Callers treat a
 * missing index as "migration has not run", which at startup means it runs now.
 */
export async function readProfileIndex(): Promise<ProfileIndex | null> {
    const raw = await readJsonFile<unknown>(paths.globalSettings, null);
    const parsed = profileIndexSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

async function writeProfileIndex(index: ProfileIndex): Promise<void> {
    await writeJsonFile(paths.globalSettings, index);
}

/** Point the server at a profile and make sure its folders exist. */
export async function activateProfile(id: string): Promise<void> {
    const directory = profileDir(id);
    await ensureDataDirs(directory);
    setActiveScope(directory);
}

/** The id of the profile the server is currently serving, from the scope path. */
export function activeProfileId(): string | null {
    const relative = path.relative(path.join(config.dataDir, 'profiles'), getActiveScope());
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        return null;
    }
    return relative.split(path.sep)[0] ?? null;
}

async function listFiles(directory: string): Promise<string[]> {
    try {
        return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile()).map((e) => e.name);
    } catch {
        return [];
    }
}

async function directorySize(directory: string): Promise<number> {
    let total = 0;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            total += await directorySize(full);
            continue;
        }
        try {
            total += (await stat(full)).size;
        } catch {
            // A file that vanished between listing and stat contributes nothing.
        }
    }
    return total;
}

/** What a profile owns, so the interface can say what a switch changes. */
async function countsOf(directory: string): Promise<ProfileCounts> {
    const [characters, chats, groups, books, presets] = await Promise.all([
        listFiles(path.join(directory, 'characters')),
        listFiles(path.join(directory, 'chats')).then((folders) => folders.length),
        listFiles(path.join(directory, 'groups')),
        listFiles(path.join(directory, 'worlds')),
        listFiles(path.join(directory, 'presets')),
    ]);
    return {
        characters: characters.length,
        // A chat is a file inside a per-character folder; the count is of
        // folders here, which is what a person recognises as "characters with
        // chats". The exact figure is not load-bearing.
        chats: chats,
        groups: groups.length,
        books: books.length,
        presets: presets.length,
    };
}

async function summaryOf(entry: ProfileEntry, archived: boolean, activeId: string | null): Promise<ProfileSummary> {
    const directory = archived ? archiveDir(entry.id) : profileDir(entry.id);
    const [counts, sizeBytes] = await Promise.all([countsOf(directory), directorySize(directory)]);
    return {
        ...entry,
        active: !archived && entry.id === activeId,
        archived,
        counts,
        sizeBytes,
    };
}

/**
 * Write the first index for a data folder that has none.
 *
 * When `profiles/default` already exists — a test fixture, a folder copied by
 * hand, or a migration that got as far as moving the tree but not as far as the
 * index — the index adopts it rather than orphaning it under a new id.
 */
export async function seedProfileIndex(name = 'Default'): Promise<ProfileEntry> {
    const existing = await stat(path.join(config.dataDir, 'profiles', DEFAULT_PROFILE_ID)).catch(() => null);
    const entry: ProfileEntry = {
        id: existing?.isDirectory() ? DEFAULT_PROFILE_ID : newProfileId(),
        name,
        description: '',
        archived: false,
    };
    await writeProfileIndex({
        version: PROFILE_INDEX_VERSION,
        activeProfileId: entry.id,
        profiles: [entry],
    });
    return entry;
}

/** Live profiles in index order, with counts and sizes. */
export async function listProfiles(): Promise<{ active: string | null; profiles: ProfileSummary[] }> {
    const index = await readProfileIndex();
    if (!index) {
        return { active: null, profiles: [] };
    }
    const profiles = await Promise.all(
        index.profiles
            .filter((entry) => !entry.archived)
            .map((entry) => summaryOf(entry, false, index.activeProfileId)),
    );
    return { active: index.activeProfileId, profiles };
}

/** Archived profiles, with their names kept in the index. */
export async function listArchivedProfiles(): Promise<ProfileSummary[]> {
    const index = await readProfileIndex();
    if (!index) {
        return [];
    }
    return Promise.all(index.profiles.filter((entry) => entry.archived).map((entry) => summaryOf(entry, true, null)));
}

/**
 * Create a profile.
 *
 * `copyFromId` copies that profile's **configuration** — settings, regex and
 * personas — and never its characters, chats, books or presets. Copying a cast
 * is what card import is for, and doing it implicitly here would double a
 * library without being asked.
 */
export async function createProfile(input: {
    name: string;
    description?: string;
    copyFromId?: string;
}): Promise<ProfileSummary> {
    const created = await withFileLock(paths.globalSettings, async () => {
        const index = await readProfileIndex();
        if (!index) {
            throw new Error('Profile index not found');
        }
        const entry: ProfileEntry = {
            id: newProfileId(),
            name: input.name,
            description: input.description ?? '',
            archived: false,
        };
        index.profiles.push(entry);
        await writeProfileIndex(index);
        return entry;
    });

    await mkdir(profileDir(created.id), { recursive: true });
    await ensureDataDirs(profileDir(created.id));

    if (input.copyFromId) {
        const source = profileDir(input.copyFromId);
        const target = profileDir(created.id);
        for (const file of ['settings.json', 'regex.json']) {
            try {
                await writeJsonFile(
                    path.join(target, file),
                    JSON.parse(await readFile(path.join(source, file), 'utf8')),
                );
            } catch {
                // A profile with no such file simply contributes nothing.
            }
        }
    }

    const index = await readProfileIndex();
    return summaryOf(created, false, index?.activeProfileId ?? null);
}

export async function renameProfile(id: string, patch: { name?: string; description?: string }): Promise<ProfileEntry> {
    return withFileLock(paths.globalSettings, async () => {
        const index = await readProfileIndex();
        if (!index) {
            throw new Error('Profile index not found');
        }
        const entry = index.profiles.find((candidate) => candidate.id === id);
        if (!entry) {
            throw new Error('Profile not found');
        }
        if (patch.name !== undefined) {
            entry.name = patch.name;
        }
        if (patch.description !== undefined) {
            entry.description = patch.description;
        }
        await writeProfileIndex(index);
        return entry;
    });
}

/**
 * Move a live profile's folder to the archive and drop it from the index.
 *
 * Archives are the default removal: nothing is lost, and restoring is a move
 * back. The active profile and the last remaining profile are refused.
 */
export async function archiveProfile(id: string): Promise<void> {
    await withFileLock(paths.globalSettings, async () => {
        const index = await readProfileIndex();
        if (!index) {
            throw new Error('Profile index not found');
        }
        if (index.activeProfileId === id) {
            throw new Error('The active profile cannot be archived');
        }
        if (index.profiles.filter((entry) => !entry.archived).length <= 1) {
            throw new Error('The last profile cannot be archived');
        }
        const entry = index.profiles.find((candidate) => candidate.id === id);
        if (!entry) {
            throw new Error('Profile not found');
        }
        await mkdir(path.join(config.dataDir, 'archive'), { recursive: true });
        await rename(profileDir(id), archiveDir(id));
        entry.archived = true;
        await writeProfileIndex(index);
    });
}

/** Move an archived profile back and list it again. */
export async function restoreProfile(id: string): Promise<void> {
    await withFileLock(paths.globalSettings, async () => {
        const index = await readProfileIndex();
        if (!index) {
            throw new Error('Profile index not found');
        }
        const entry = index.profiles.find((candidate) => candidate.id === id);
        if (!entry) {
            throw new Error('Profile not found');
        }
        if (!entry.archived) {
            throw new Error('Profile is not archived');
        }
        await rename(archiveDir(id), profileDir(id));
        entry.archived = false;
        await writeProfileIndex(index);
    });
}

/**
 * Permanently remove an archived profile.
 *
 * Only an archived profile can be deleted, so the destructive path is always
 * two deliberate steps: archive, then delete.
 */
export async function deleteArchivedProfile(id: string): Promise<void> {
    const index = await readProfileIndex();
    if (!index) {
        throw new Error('Profile index not found');
    }
    const entry = index.profiles.find((candidate) => candidate.id === id);
    if (!entry?.archived) {
        throw new Error('Archive the profile before deleting it');
    }
    await rm(archiveDir(id), { recursive: true, force: true });
}
