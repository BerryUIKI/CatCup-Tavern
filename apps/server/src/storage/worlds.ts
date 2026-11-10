import { readdir, stat, unlink } from 'node:fs/promises';

import { isRecord, type WorldDetail, type WorldSummary } from '@catcup/shared';

import { parseWorldInfoBook } from '../worldinfo/loader.js';
import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';

/** Absolute path of a world info book. */
export function worldFilePath(id: string): string {
    assertSimpleName(id);
    return resolveInside(paths.worlds, `${id}.json`);
}

function normalizeId(candidate: string, fallback = 'world'): string {
    const cleaned = candidate.replace(/\.json$/i, '').trim();
    return safeFileName(cleaned, fallback).slice(0, 120).trim() || fallback;
}

/** List world info books in `data/worlds`, newest first. */
export async function listWorlds(): Promise<WorldSummary[]> {
    let names: string[];
    try {
        names = await readdir(paths.worlds);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const summaries = await Promise.all(
        names
            .filter((name) => name.toLowerCase().endsWith('.json'))
            .map(async (fileName): Promise<WorldSummary | null> => {
                const id = fileName.slice(0, -'.json'.length);
                try {
                    const file = worldFilePath(id);
                    const [stats, raw] = await Promise.all([stat(file), readJsonFile<unknown>(file, null)]);
                    return {
                        id,
                        name: id,
                        entryCount: parseWorldInfoBook(id, raw).length,
                        updatedAt: stats.mtimeMs,
                    };
                } catch {
                    return null;
                }
            }),
    );

    return summaries.filter((world): world is WorldSummary => world !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Read one book. Returns `null` when the file does not exist. */
export async function readWorld(id: string): Promise<WorldDetail | null> {
    const raw = await readJsonFile<unknown>(worldFilePath(id), null);
    if (!isRecord(raw)) {
        return null;
    }
    return { id, book: raw };
}

/**
 * Store a book under a free name.
 *
 * The body is written verbatim so unknown fields survive an export round trip;
 * the loader normalizes shapes at read time.
 */
export async function createWorld(input: { fileName?: string; book: unknown }): Promise<WorldDetail> {
    if (!isRecord(input.book)) {
        throw new Error('World info must be a JSON object');
    }

    const base = normalizeId(input.fileName?.trim() || 'world');
    const existing = new Set(
        (await readdir(paths.worlds).catch(() => [] as string[])).map((name) => name.toLowerCase()),
    );

    let id = base;
    let index = 2;
    while (existing.has(`${id.toLowerCase()}.json`)) {
        id = `${base} (${index})`;
        index += 1;
    }

    const file = worldFilePath(id);
    await withFileLock(file, () => writeJsonFile(file, input.book));

    return { id, book: input.book };
}

/** Delete a book. Returns false when it did not exist. */
export async function deleteWorld(id: string): Promise<boolean> {
    try {
        await unlink(worldFilePath(id));
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
