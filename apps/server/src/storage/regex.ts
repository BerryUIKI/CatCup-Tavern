import { randomUUID } from 'node:crypto';

import { isRecord, type RegexScript, type RegexScriptPatch, regexScriptSchema } from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { paths } from './paths.js';

/**
 * Regex scripts live in one JSON array because their order is behaviour:
 * scripts run in order and each sees the previous one's output. A map keyed by
 * id would lose that.
 */

/** Read every valid stored script. Invalid records are skipped, not fatal. */
export async function listRegexScripts(): Promise<RegexScript[]> {
    const raw = await readJsonFile<unknown>(paths.regex, null);
    if (!isRecord(raw) || !Array.isArray(raw.scripts)) {
        return [];
    }

    const scripts: RegexScript[] = [];
    for (const candidate of raw.scripts) {
        const parsed = regexScriptSchema.safeParse(candidate);
        if (parsed.success) {
            scripts.push(parsed.data);
        }
    }
    return scripts;
}

/**
 * Serialize a read-modify-write of the script file.
 *
 * Returns `null` when the caller decided not to write, so a missing id can be
 * reported as "not found" without a second read.
 */
async function mutate(
    change: (scripts: readonly RegexScript[]) => RegexScript[] | null,
): Promise<RegexScript[] | null> {
    return withFileLock(paths.regex, async () => {
        const current = await listRegexScripts();
        const next = change(current);
        if (!next) {
            return null;
        }
        await writeJsonFile(paths.regex, { scripts: next });
        return next;
    });
}

export interface RegexImportResult {
    scripts: RegexScript[];
    /** One message per script that could not be read. */
    errors: string[];
}

/**
 * Read the shapes an import can arrive in.
 *
 * SillyTavern exports one script as an object and a set as an array, and a
 * backup of its settings wraps the array in `{ regex: [...] }`.
 */
export function extractImportedScripts(data: unknown): unknown[] {
    if (Array.isArray(data)) {
        return data;
    }
    if (isRecord(data)) {
        if (Array.isArray(data.scripts)) {
            return data.scripts;
        }
        if (Array.isArray(data.regex)) {
            return data.regex;
        }
        if (typeof data.findRegex === 'string' || typeof data.scriptName === 'string') {
            return [data];
        }
    }
    return [];
}

/** Append or replace the stored list from an imported payload. */
export async function importRegexScripts(data: unknown, mode: 'append' | 'replace'): Promise<RegexImportResult> {
    const candidates = extractImportedScripts(data);
    const errors: string[] = [];
    const taken = new Set<string>();
    const imported: RegexScript[] = [];

    for (const [index, candidate] of candidates.entries()) {
        const record = isRecord(candidate) ? candidate : {};
        let id = typeof record.id === 'string' && record.id ? record.id : randomUUID();
        if (taken.has(id)) {
            id = randomUUID();
        }

        const parsed = regexScriptSchema.safeParse({ ...record, id });
        if (!parsed.success) {
            errors.push(`Script ${index + 1}: ${parsed.error.issues[0]?.message ?? 'invalid script'}`);
            continue;
        }

        taken.add(id);
        imported.push(parsed.data);
    }

    const merged = await mutate((current) => {
        const kept = mode === 'replace' ? [] : current;
        const seen = new Set(kept.map((script) => script.id));
        return [...kept, ...imported.map((script) => (seen.has(script.id) ? { ...script, id: randomUUID() } : script))];
    });

    return { scripts: merged ?? imported, errors };
}

export async function createRegexScript(input: RegexScriptPatch): Promise<RegexScript> {
    const script = regexScriptSchema.parse({ ...input, id: randomUUID() });
    await mutate((current) => [...current, script]);
    return script;
}

/** Merge a patch into one script. Returns `null` when the id is unknown. */
export async function updateRegexScript(id: string, patch: RegexScriptPatch): Promise<RegexScript | null> {
    const merged = { ...patch };
    const changed = Object.fromEntries(Object.entries(merged).filter(([, value]) => value !== undefined));

    let updated: RegexScript | null = null;
    await mutate((current) => {
        const index = current.findIndex((script) => script.id === id);
        if (index < 0) {
            return null;
        }
        const next = regexScriptSchema.parse({ ...current[index], ...changed });
        const copy = [...current];
        copy[index] = next;
        updated = next;
        return copy;
    });

    return updated;
}

/** Remove one script. Returns false when the id is unknown. */
export async function deleteRegexScript(id: string): Promise<boolean> {
    const next = await mutate((current) => {
        const filtered = current.filter((script) => script.id !== id);
        return filtered.length === current.length ? null : filtered;
    });
    return next !== null;
}

/** Reorder the list by id. Ids the caller omits keep their relative order at the end. */
export async function reorderRegexScripts(ids: readonly string[]): Promise<RegexScript[]> {
    const next = await mutate((current) => {
        const byId = new Map(current.map((script) => [script.id, script]));
        const ordered: RegexScript[] = [];
        for (const id of ids) {
            const script = byId.get(id);
            if (script) {
                ordered.push(script);
                byId.delete(id);
            }
        }
        return [...ordered, ...byId.values()];
    });
    return next ?? [];
}
