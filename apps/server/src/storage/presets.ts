import { readdir, stat, unlink } from 'node:fs/promises';

import { isRecord, type PresetDetail, type PresetSummary } from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';

/** Absolute path of a preset file. */
export function presetFilePath(id: string): string {
    assertSimpleName(id);
    return resolveInside(paths.presets, `${id}.json`);
}

function normalizeId(candidate: string, fallback = 'preset'): string {
    const cleaned = candidate.replace(/\.json$/i, '').trim();
    return safeFileName(cleaned, fallback).slice(0, 120).trim() || fallback;
}

function promptCount(preset: Record<string, unknown>): number {
    return Array.isArray(preset.prompts) ? preset.prompts.length : 0;
}

/** List presets in `data/presets`, newest first. */
export async function listPresets(): Promise<PresetSummary[]> {
    let names: string[];
    try {
        names = await readdir(paths.presets);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const summaries = await Promise.all(
        names
            .filter((name) => name.toLowerCase().endsWith('.json'))
            .map(async (fileName): Promise<PresetSummary | null> => {
                const id = fileName.slice(0, -'.json'.length);
                try {
                    const file = presetFilePath(id);
                    const [stats, raw] = await Promise.all([stat(file), readJsonFile<unknown>(file, null)]);
                    const preset = isRecord(raw) ? raw : {};
                    return { id, name: id, updatedAt: stats.mtimeMs, promptCount: promptCount(preset) };
                } catch {
                    return null;
                }
            }),
    );

    return summaries
        .filter((preset): preset is PresetSummary => preset !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Read one preset. Returns `null` when the file does not exist. */
export async function readPreset(id: string): Promise<PresetDetail | null> {
    const raw = await readJsonFile<unknown>(presetFilePath(id), null);
    if (!isRecord(raw)) {
        return null;
    }
    return { id, preset: raw };
}

/** Read the raw preset body only, for generation. */
export async function readPresetBody(id: string): Promise<Record<string, unknown> | null> {
    return (await readPreset(id))?.preset ?? null;
}

/**
 * Store a preset under a free name.
 *
 * The id comes from the supplied file name, then the preset body's `name`,
 * then `preset`; collisions get a numeric suffix, like chat names.
 */
export async function createPreset(input: { fileName?: string; preset: unknown }): Promise<PresetDetail> {
    if (!isRecord(input.preset)) {
        throw new Error('Preset must be a JSON object');
    }

    const preferred =
        input.fileName?.trim() || (typeof input.preset.name === 'string' ? input.preset.name : '') || 'preset';
    const base = normalizeId(preferred);

    const existing = new Set(
        (await readdir(paths.presets).catch(() => [] as string[])).map((name) => name.toLowerCase()),
    );

    let id = base;
    let index = 2;
    while (existing.has(`${id.toLowerCase()}.json`)) {
        id = `${base} (${index})`;
        index += 1;
    }

    const file = presetFilePath(id);
    await withFileLock(file, () => writeJsonFile(file, input.preset));

    return { id, preset: input.preset };
}

/** Overwrite an existing preset. */
export async function writePreset(id: string, preset: unknown): Promise<PresetDetail> {
    if (!isRecord(preset)) {
        throw new Error('Preset must be a JSON object');
    }
    const file = presetFilePath(id);
    await withFileLock(file, () => writeJsonFile(file, preset));
    return { id, preset };
}

/** Delete a preset. Returns false when it did not exist. */
export async function deletePreset(id: string): Promise<boolean> {
    try {
        await unlink(presetFilePath(id));
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
