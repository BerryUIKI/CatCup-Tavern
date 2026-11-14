import { readdir, stat } from 'node:fs/promises';

import { type ItemScope, isRecord, type PresetDetail, type PresetSummary } from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { paths, resolveInside, safeFileName } from './paths.js';
import {
    copyItemIntoScope,
    locateItem,
    listMergedItems,
    moveItemBetweenScopes,
    removeIfPresent,
    type ScopeMoveResult,
} from './scopes.js';

const PRESET_EXTENSIONS = ['.json'] as const;

/** Absolute path of a preset file in one scope. */
export function presetFilePath(id: string, scope: ItemScope = 'profile'): string {
    const directory = scope === 'shared' ? paths.sharedPresets : paths.presets;
    return resolveInside(directory, `${id.replace(/[/\\]/g, '')}.json`);
}

function normalizeId(candidate: string, fallback = 'preset'): string {
    const cleaned = candidate.replace(/\.json$/i, '').trim();
    return safeFileName(cleaned, fallback).slice(0, 120).trim() || fallback;
}

function promptCount(preset: Record<string, unknown>): number {
    return Array.isArray(preset.prompts) ? preset.prompts.length : 0;
}

/**
 * List presets from both scopes, newest first.
 *
 * A shared preset whose id the profile uses is not listed twice; the profile's
 * preset carries `shadowed`.
 */
export async function listPresets(): Promise<PresetSummary[]> {
    const merged = await listMergedItems('presets', PRESET_EXTENSIONS);

    const summaries = await Promise.all(
        merged.map(async (item): Promise<PresetSummary | null> => {
            try {
                const [stats, raw] = await Promise.all([stat(item.filePath), readJsonFile<unknown>(item.filePath, null)]);
                const preset = isRecord(raw) ? raw : {};
                return {
                    id: item.id,
                    name: item.id,
                    updatedAt: stats.mtimeMs,
                    promptCount: promptCount(preset),
                    scope: item.scope,
                    ...(item.shadowed ? { shadowed: true } : {}),
                };
            } catch {
                return null;
            }
        }),
    );

    return summaries
        .filter((preset): preset is PresetSummary => preset !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Read one preset, the profile's copy first. Returns `null` when neither scope has it. */
export async function readPreset(id: string): Promise<PresetDetail | null> {
    const found = await locateItem('presets', id, PRESET_EXTENSIONS);
    if (!found) {
        return null;
    }
    const raw = await readJsonFile<unknown>(found.filePath, null);
    if (!isRecord(raw)) {
        return null;
    }
    return { id, preset: raw, scope: found.scope };
}

/**
 * Read the raw preset body only, for generation.
 *
 * This is the one preset read on every reply, so it resolves through both
 * scopes: a preset a person marked reusable keeps working from any profile.
 */
export async function readPresetBody(id: string): Promise<Record<string, unknown> | null> {
    return (await readPreset(id))?.preset ?? null;
}

/**
 * Store a preset under a free name in the requested scope.
 *
 * The id comes from the supplied file name, then the preset body's `name`,
 * then `preset`; collisions get a numeric suffix, like chat names.
 */
export async function createPreset(input: {
    fileName?: string;
    preset: unknown;
    scope?: ItemScope;
}): Promise<PresetDetail> {
    if (!isRecord(input.preset)) {
        throw new Error('Preset must be a JSON object');
    }

    const scope = input.scope ?? 'profile';
    const preferred =
        input.fileName?.trim() || (typeof input.preset.name === 'string' ? input.preset.name : '') || 'preset';
    const base = normalizeId(preferred);
    const directory = scope === 'shared' ? paths.sharedPresets : paths.presets;

    const existing = new Set(
        (await readdir(directory).catch(() => [] as string[])).map((name) => name.toLowerCase()),
    );

    let id = base;
    let index = 2;
    while (existing.has(`${id.toLowerCase()}.json`)) {
        id = `${base} (${index})`;
        index += 1;
    }

    const file = presetFilePath(id, scope);
    await withFileLock(file, () => writeJsonFile(file, input.preset));

    return { id, preset: input.preset, scope };
}

/** Overwrite an existing preset, in whichever scope holds it. */
export async function writePreset(id: string, preset: unknown): Promise<PresetDetail> {
    if (!isRecord(preset)) {
        throw new Error('Preset must be a JSON object');
    }
    const found = await locateItem('presets', id, PRESET_EXTENSIONS);
    const file = found?.filePath ?? presetFilePath(id);
    await withFileLock(file, () => writeJsonFile(file, preset));
    return { id, preset, scope: found?.scope ?? 'profile' };
}

/**
 * Merge prompt fields into a stored preset, leaving everything else alone.
 *
 * Used by the prompt order editor: a preset carries dozens of sampling and
 * behaviour fields, and the editor must not clobber the ones it does not show.
 */
export async function updatePreset(
    id: string,
    patch: { prompts?: unknown[]; prompt_order?: unknown[] },
): Promise<PresetDetail> {
    const existing = await readPreset(id);
    if (!existing) {
        throw new Error('Preset not found');
    }

    const next: Record<string, unknown> = { ...existing.preset };
    if (patch.prompts !== undefined) {
        next.prompts = patch.prompts;
    }
    if (patch.prompt_order !== undefined) {
        next.prompt_order = patch.prompt_order;
    }

    return writePreset(id, next);
}

/** Delete a preset from whichever scope holds it. Returns false when it did not exist. */
export async function deletePreset(id: string): Promise<boolean> {
    const found = await locateItem('presets', id, PRESET_EXTENSIONS);
    if (!found) {
        return false;
    }
    return removeIfPresent(found.filePath);
}

/** Move a preset into the shared scope, or take a shared one into this profile. */
export async function changePresetScope(id: string, target: ItemScope): Promise<ScopeMoveResult> {
    return moveItemBetweenScopes('presets', id, target, PRESET_EXTENSIONS);
}

/** Copy a preset into the other scope under a free name. */
export async function copyPresetIntoScope(id: string, target: ItemScope): Promise<ScopeMoveResult> {
    return copyItemIntoScope('presets', id, target, PRESET_EXTENSIONS);
}
