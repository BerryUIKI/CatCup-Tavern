import type { Dirent } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import type { ItemScope } from '@catcup/shared';
import writeFileAtomic from 'write-file-atomic';

import { assertSimpleName, paths, resolveInside } from './paths.js';

/**
 * Character assets extracted from a CharX package.
 *
 * The files are kept verbatim under `<scope>/character-assets/<character id>/`
 * with their archive-relative paths, so exporting the character again can put
 * the same `assets/...` entries back into the package. CatCup does not display
 * them yet; they are preserved for round-tripping.
 *
 * Assets follow their card's scope: a shared card's assets live in
 * `data/shared/character-assets/`, so a profile card of the same id keeps its
 * own instead of inheriting the shared one's files.
 */

const MAX_ASSETS = 200;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_DEPTH = 8;

function assetRoot(scope: ItemScope): string {
    return scope === 'shared' ? paths.sharedCharacterAssets : paths.characterAssets;
}

function segmentsOf(relative: string): string[] {
    const segments = relative.split('/');
    if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error('Invalid asset path');
    }
    return segments;
}

/** Write one character's assets, replacing whatever was there before. */
export async function storeCharacterAssets(
    characterId: string,
    assets: Map<string, Buffer>,
    scope: ItemScope = 'profile',
): Promise<void> {
    if (assets.size === 0) {
        return;
    }
    assertSimpleName(characterId);
    const root = assetRoot(scope);
    await mkdir(root, { recursive: true });

    const target = resolveInside(root, characterId);
    const staging = await mkdtemp(path.join(root, '.import-'));
    try {
        for (const [relative, data] of assets) {
            const filePath = resolveInside(staging, ...segmentsOf(relative));
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeFileAtomic(filePath, data, { mode: 0o644 });
        }
        await rm(target, { recursive: true, force: true });
        await rename(staging, target);
    } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
    }
}

/** Read a character's stored assets; a missing folder is an empty map. */
export async function readCharacterAssets(
    characterId: string,
    scope: ItemScope = 'profile',
): Promise<Map<string, Buffer>> {
    assertSimpleName(characterId);
    const root = resolveInside(assetRoot(scope), characterId);
    const assets = new Map<string, Buffer>();
    let total = 0;

    const walk = async (directory: string, prefix: string, depth: number): Promise<void> => {
        if (depth > MAX_DEPTH || assets.size >= MAX_ASSETS) {
            return;
        }
        let entries: Dirent[];
        try {
            entries = await readdir(directory, { withFileTypes: true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return;
            }
            throw error;
        }

        for (const entry of entries) {
            if (assets.size >= MAX_ASSETS) {
                return;
            }
            const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                await walk(path.join(directory, entry.name), relative, depth + 1);
                continue;
            }
            if (!entry.isFile()) {
                continue;
            }
            const filePath = resolveInside(root, ...segmentsOf(relative));
            const stats = await stat(filePath);
            if (total + stats.size > MAX_TOTAL_BYTES) {
                return;
            }
            const data = await readFile(filePath);
            total += data.byteLength;
            assets.set(relative, data);
        }
    };

    await walk(root, '', 0);
    return assets;
}

/** Remove a character's assets when the character is deleted. */
export async function deleteCharacterAssets(characterId: string, scope: ItemScope = 'profile'): Promise<void> {
    assertSimpleName(characterId);
    await rm(resolveInside(assetRoot(scope), characterId), { recursive: true, force: true });
}
