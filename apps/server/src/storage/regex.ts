import { randomUUID } from 'node:crypto';

import {
    isRecord,
    type ItemScope,
    type RegexScript,
    type RegexScriptPatch,
    type RegexScriptView,
    regexScriptSchema,
} from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { libraryFile } from './scopes.js';

/**
 * Regex scripts live in one JSON array because their order is behaviour:
 * scripts run in order and each sees the previous one's output. A map keyed by
 * id would lose that.
 *
 * The shared layer keeps one list per scope rather than moving single rules
 * between files. A script is therefore shared by living in `shared/regex.json`,
 * and the profile's list runs first because that is the list the person
 * arranged most recently in front of them. Order between the two lists is
 * fixed — profile then shared — so a shared rule cannot silently jump ahead of
 * a profile rule that depended on running first.
 */

function scopeFile(scope: ItemScope): string {
    return libraryFile('regex')[scope];
}

async function readScope(scope: ItemScope): Promise<RegexScript[]> {
    const raw = await readJsonFile<unknown>(scopeFile(scope), null);
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

async function writeScope(scope: ItemScope, scripts: readonly RegexScript[]): Promise<void> {
    await writeJsonFile(scopeFile(scope), { scripts });
}

/**
 * Every script this profile runs, in run order: its own list, then the shared
 * one.
 *
 * A shared rule whose id a profile rule already uses is dropped rather than
 * run twice; the profile's rule carries `shadowed` so the list can say the
 * shared one is behind it.
 */
export async function listRegexScripts(): Promise<RegexScriptView[]> {
    const [profile, shared] = await Promise.all([readScope('profile'), readScope('shared')]);
    const profileIds = new Set(profile.map((script) => script.id));

    return [
        ...profile.map((script) => {
            const shadowed = shared.some((candidate) => candidate.id === script.id);
            return { ...script, scope: 'profile' as const, ...(shadowed ? { shadowed: true } : {}) };
        }),
        ...shared
            .filter((script) => !profileIds.has(script.id))
            .map((script) => ({ ...script, scope: 'shared' as const })),
    ];
}

/**
 * Serialize a read-modify-write of one scope's script file.
 *
 * Returns `null` when the caller decided not to write, so a missing id can be
 * reported as "not found" without a second read.
 */
async function mutate(
    scope: ItemScope,
    change: (scripts: readonly RegexScript[]) => RegexScript[] | null,
): Promise<RegexScript[] | null> {
    return withFileLock(scopeFile(scope), async () => {
        const current = await readScope(scope);
        const next = change(current);
        if (!next) {
            return null;
        }
        await writeScope(scope, next);
        return next;
    });
}

/** Which scope holds a script; the profile's list wins, as every lookup does. */
async function scopeOf(id: string): Promise<ItemScope | null> {
    const profile = await readScope('profile');
    if (profile.some((script) => script.id === id)) {
        return 'profile';
    }
    const shared = await readScope('shared');
    return shared.some((script) => script.id === id) ? 'shared' : null;
}

export interface RegexImportResult {
    scripts: RegexScriptView[];
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

/**
 * Append or replace the stored list from an imported payload.
 *
 * `replace` only replaces the target scope's list: importing a SillyTavern
 * preset into a profile must not wipe the rules every other profile relies on.
 */
export async function importRegexScripts(
    data: unknown,
    mode: 'append' | 'replace',
    scope: ItemScope = 'profile',
): Promise<RegexImportResult> {
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

    // Ids already used in the other scope get fresh ones, so an import cannot
    // create a collision that would silently hide a rule.
    const otherIds = new Set((await readScope(scope === 'shared' ? 'profile' : 'shared')).map((s) => s.id));

    const merged = await mutate(scope, (current) => {
        const kept = mode === 'replace' ? [] : current;
        const seen = new Set(kept.map((script) => script.id));
        return [
            ...kept,
            ...imported.map((script) =>
                seen.has(script.id) || otherIds.has(script.id) ? { ...script, id: randomUUID() } : script,
            ),
        ];
    });

    const scripts = (merged ?? imported).map((script) => ({ ...script, scope }));
    return { scripts, errors };
}

export async function createRegexScript(
    input: RegexScriptPatch,
    scope: ItemScope = 'profile',
): Promise<RegexScriptView> {
    const script = regexScriptSchema.parse({ ...input, id: randomUUID() });
    await mutate(scope, (current) => [...current, script]);
    return { ...script, scope };
}

/**
 * Merge a patch into one script. Returns `null` when the id is unknown.
 *
 * The write lands in the scope that holds the script, so editing a shared rule
 * edits the shared file.
 */
export async function updateRegexScript(id: string, patch: RegexScriptPatch): Promise<RegexScriptView | null> {
    const scope = await scopeOf(id);
    if (!scope) {
        return null;
    }

    const changed = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const next = await mutate(scope, (current) => {
        const index = current.findIndex((script) => script.id === id);
        if (index < 0) {
            return null;
        }
        const copy = [...current];
        copy[index] = regexScriptSchema.parse({ ...current[index], ...changed });
        return copy;
    });

    const updated = next?.find((script) => script.id === id);
    return updated ? { ...updated, scope } : null;
}

/** Remove one script from whichever scope holds it. Returns false when the id is unknown. */
export async function deleteRegexScript(id: string): Promise<boolean> {
    const scope = await scopeOf(id);
    if (!scope) {
        return false;
    }

    const next = await mutate(scope, (current) => {
        const filtered = current.filter((script) => script.id !== id);
        return filtered.length === current.length ? null : filtered;
    });
    return next !== null;
}

/**
 * Reorder the list by id.
 *
 * `scope` says which list the new order belongs to; ids from the other scope
 * are ignored, because their order is not this list's to decide. Ids the caller
 * omits keep their relative order at the end.
 */
export async function reorderRegexScripts(ids: readonly string[], scope: ItemScope = 'profile'): Promise<RegexScriptView[]> {
    await mutate(scope, (current) => {
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
    return listRegexScripts();
}

/**
 * Move a script between the two lists.
 *
 * A rule is shared or private as a whole, so this appends it to the target list
 * under a fresh id when the id is already taken there, and removes it from the
 * one it came from.
 */
export async function changeRegexScriptScope(id: string, target: ItemScope): Promise<RegexScriptView | null> {
    const source = await scopeOf(id);
    if (!source || source === target) {
        return null;
    }

    const script = (await readScope(source)).find((candidate) => candidate.id === id);
    if (!script) {
        return null;
    }

    const targetIds = new Set((await readScope(target)).map((candidate) => candidate.id));
    const moved = targetIds.has(script.id) ? { ...script, id: randomUUID() } : script;

    await mutate(source, (current) => current.filter((candidate) => candidate.id !== id));
    await mutate(target, (current) => [...current, moved]);
    return { ...moved, scope: target };
}

/** Copy a script into the other list under a fresh id, leaving the original in place. */
export async function copyRegexScriptIntoScope(id: string, target: ItemScope): Promise<RegexScriptView | null> {
    const source = await scopeOf(id);
    if (!source || source === target) {
        return null;
    }

    const script = (await readScope(source)).find((candidate) => candidate.id === id);
    if (!script) {
        return null;
    }

    const copy = { ...script, id: randomUUID() };
    await mutate(target, (current) => [...current, copy]);
    return { ...copy, scope: target };
}
