import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { isRecord, type SkinManifest, skinManifestSchema } from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { paths } from './paths.js';

/**
 * Installed skins, one loose file each, in a folder beside the profile.
 *
 * A skin is a file a person brings and may edit, so it is stored as **the
 * manifest it arrived as** rather than flattened into settings. That is what
 * makes editing a skin's JSON reach the theme on the next read, and it is why
 * the selection stores an id rather than a copy of the values.
 *
 * One file per skin rather than one list: a skin is installed and removed
 * independently, a broken one is a broken file rather than a broken list, and
 * the folder is small enough that reading all of them is cheap.
 */

function skinFile(id: string): string {
    // `id` comes from a manifest, which caps it at 120 characters and requires
    // it non-empty; `assertSimpleName` is not used here because a skin id may
    // carry a space and this is a directory we create rather than one a caller
    // navigates. The traversal check is the same one every storage path uses.
    if (!id || id === '.' || id === '..' || id.includes('\0') || /[\\/]/.test(id)) {
        throw new Error('Invalid skin id');
    }
    return path.join(paths.skins, `${id}.json`);
}

/** Every installed skin, newest write last, skipping any file that will not parse. */
export async function listSkins(): Promise<SkinManifest[]> {
    const directory = paths.skins;
    let names: string[];
    try {
        names = await readdir(directory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const skins: SkinManifest[] = [];
    for (const name of names.sort()) {
        if (!name.endsWith('.json')) {
            continue;
        }
        const raw = await readJsonFile<unknown>(path.join(directory, name), null);
        if (!isRecord(raw)) {
            continue;
        }
        const parsed = skinManifestSchema.safeParse(raw);
        // A skin that no longer validates — edited by hand into a shape the
        // format does not allow — is skipped rather than crashing the list. Its
        // file stays, so the author can see what they have.
        if (parsed.success) {
            skins.push(parsed.data);
        }
    }
    return skins;
}

/** One installed skin, or `null`. */
export async function getSkin(id: string): Promise<SkinManifest | null> {
    const raw = await readJsonFile<unknown>(skinFile(id), null);
    if (!isRecord(raw)) {
        return null;
    }
    const parsed = skinManifestSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}

/**
 * Install a skin from a manifest the client already validated.
 *
 * Validated again here rather than trusted: the route is reachable by anything
 * that can speak HTTP, and a manifest is the one thing a skin's whole behaviour
 * is derived from.
 */
export async function installSkin(manifest: unknown): Promise<SkinManifest> {
    const parsed = skinManifestSchema.parse(manifest);
    await withFileLock(skinFile(parsed.id), async () => {
        await writeJsonFile(skinFile(parsed.id), parsed);
    });
    return parsed;
}

/** Remove a skin's file. Returns whether there was one. */
export async function removeSkin(id: string): Promise<boolean> {
    const file = skinFile(id);
    return withFileLock(file, async () => {
        try {
            await rm(file);
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return false;
            }
            throw error;
        }
    });
}
