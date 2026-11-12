import { readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
    isRecord,
    type QuickReplySet,
    type QuickReplySetView,
    quickReplyItemSchema,
    quickReplySetSchema,
} from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';

/**
 * Quick reply sets live one file per set, named after the set, matching
 * SillyTavern's `data/QuickReplies/<name>.json`. The file id is the file name
 * without `.json`; the set's `name` field is what settings and chats link to.
 */

/** Absolute path of a quick reply set file. */
export function quickReplySetFilePath(id: string): string {
    assertSimpleName(id);
    return resolveInside(paths.quickReplies, `${id}.json`);
}

/** Serialize every write: name uniqueness spans files, and renaming moves one. */
function withSetsLock<T>(fn: () => Promise<T>): Promise<T> {
    return withFileLock(path.join(paths.quickReplies, '.quick-replies'), fn);
}

function viewOf(id: string, set: QuickReplySet): QuickReplySetView {
    return { ...set, id };
}

/** Every readable set, sorted by name. Invalid files are skipped. */
export async function listQuickReplySets(): Promise<QuickReplySetView[]> {
    let names: string[];
    try {
        names = await readdir(paths.quickReplies);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const sets = await Promise.all(
        names
            .filter((name) => name.toLowerCase().endsWith('.json'))
            .map(async (fileName): Promise<QuickReplySetView | null> => {
                const id = fileName.slice(0, -'.json'.length);
                try {
                    const raw = await readJsonFile<unknown>(quickReplySetFilePath(id), null);
                    const parsed = quickReplySetSchema.safeParse(raw);
                    return parsed.success ? viewOf(id, parsed.data) : null;
                } catch {
                    return null;
                }
            }),
    );

    return sets
        .filter((set): set is QuickReplySetView => set !== null)
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** Read one set. Returns `null` when the file is missing or invalid. */
export async function readQuickReplySet(id: string): Promise<QuickReplySetView | null> {
    const raw = await readJsonFile<unknown>(quickReplySetFilePath(id), null);
    const parsed = quickReplySetSchema.safeParse(raw);
    return parsed.success ? viewOf(id, parsed.data) : null;
}

function findById(sets: readonly QuickReplySetView[], id: string): QuickReplySetView | undefined {
    return sets.find((set) => set.id.toLowerCase() === id.toLowerCase());
}

function findByName(sets: readonly QuickReplySetView[], name: string): QuickReplySetView | undefined {
    return sets.find((set) => set.name.toLowerCase() === name.toLowerCase());
}

function normalizeId(candidate: string): string {
    return (
        safeFileName(candidate.replace(/\.json$/i, '').trim(), 'quick replies')
            .slice(0, 120)
            .trim() || 'quick replies'
    );
}

/**
 * File ids already present, readable or not.
 *
 * A corrupt file is skipped by the list but still occupies its name; creating
 * over it would silently destroy whatever the user had.
 */
async function takenIds(sets: readonly QuickReplySetView[]): Promise<Set<string>> {
    const taken = new Set(sets.map((set) => set.id.toLowerCase()));
    const names = await readdir(paths.quickReplies).catch(() => [] as string[]);
    for (const name of names) {
        if (name.toLowerCase().endsWith('.json')) {
            taken.add(name.slice(0, -'.json'.length).toLowerCase());
        }
    }
    return taken;
}

/** Keep the stored id index at least as large as any quick reply id. */
function withIdIndex(set: QuickReplySet): QuickReplySet {
    const highest = set.qrList.reduce((max, item) => Math.max(max, item.id), set.idIndex);
    return { ...set, idIndex: highest };
}

function duplicateIds(set: QuickReplySet): number[] {
    const seen = new Set<number>();
    const duplicates = new Set<number>();
    for (const item of set.qrList) {
        if (seen.has(item.id)) {
            duplicates.add(item.id);
        }
        seen.add(item.id);
    }
    return [...duplicates];
}

const SET_KEYS: ReadonlySet<string> = new Set(Object.keys(quickReplySetSchema.shape));
const ITEM_KEYS: ReadonlySet<string> = new Set(Object.keys(quickReplyItemSchema.shape));

/** Fields the schemas do not know, so an import or a save can keep them. */
function unknownFields(source: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> {
    return Object.fromEntries(Object.entries(source).filter(([key]) => !known.has(key)));
}

export type QuickReplySetWriteResult =
    | { status: 'ok'; set: QuickReplySetView; renamedFrom: string | null }
    | { status: 'missing' }
    | { status: 'name-taken' }
    | { status: 'invalid'; message: string };

/** Create an empty set from a name. */
export async function createQuickReplySet(name: string): Promise<QuickReplySetWriteResult> {
    return withSetsLock(async () => {
        const parsed = quickReplySetSchema.safeParse({ name });
        if (!parsed.success) {
            return { status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid set name' };
        }

        const sets = await listQuickReplySets();
        const cleanName = parsed.data.name;
        if (findByName(sets, cleanName)) {
            return { status: 'name-taken' };
        }

        let id = normalizeId(cleanName);
        if (findById(sets, id)) {
            return { status: 'name-taken' };
        }
        const taken = await takenIds(sets);
        const base = id;
        let index = 2;
        while (taken.has(id.toLowerCase())) {
            id = `${base} (${index})`;
            index += 1;
        }

        const set = withIdIndex({ ...parsed.data });
        await writeJsonFile(quickReplySetFilePath(id), set);
        return { status: 'ok', set: viewOf(id, set), renamedFrom: null };
    });
}

/**
 * Replace a set.
 *
 * Unknown fields already on disk survive a save; the editor sends the full
 * quick reply objects it received, so their auto-execution flags survive too.
 * Renaming moves the file and reports the old name so the caller can update
 * settings links.
 */
export async function saveQuickReplySet(id: string, input: unknown): Promise<QuickReplySetWriteResult> {
    return withSetsLock(async () => {
        const fresh = await readQuickReplySet(id);
        if (!fresh) {
            return { status: 'missing' };
        }

        const parsed = quickReplySetSchema.safeParse(input);
        if (!parsed.success) {
            return { status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid quick reply set' };
        }

        const duplicates = duplicateIds(parsed.data);
        if (duplicates.length > 0) {
            return {
                status: 'invalid',
                message: `Duplicate quick reply id ${duplicates[0]}. Each quick reply in a set needs its own id.`,
            };
        }

        const sets = await listQuickReplySets();
        const sameName = findByName(sets, parsed.data.name);
        if (sameName && sameName.id.toLowerCase() !== id.toLowerCase()) {
            return { status: 'name-taken' };
        }

        const nextId = normalizeId(parsed.data.name);
        if (nextId.toLowerCase() !== id.toLowerCase() && findById(sets, nextId)) {
            return { status: 'name-taken' };
        }

        // Keep fields the editor did not send: unknown top-level keys and any
        // unknown fields on quick replies that already existed. Fields the
        // schema knows are taken from the request, with schema defaults.
        const { id: _storedId, ...stored } = fresh;
        const storedItems = new Map(stored.qrList.map((item) => [item.id, item]));
        const qrList = parsed.data.qrList.map((item) => ({
            ...unknownFields((storedItems.get(item.id) ?? {}) as Record<string, unknown>, ITEM_KEYS),
            ...item,
        }));
        const set = withIdIndex({
            ...unknownFields(stored as Record<string, unknown>, SET_KEYS),
            ...parsed.data,
            qrList,
        });
        const targetFile = quickReplySetFilePath(nextId);
        const sourceFile = quickReplySetFilePath(fresh.id);
        const renamed = nextId !== fresh.id;

        if (renamed) {
            await rename(sourceFile, targetFile);
        }
        await writeJsonFile(targetFile, set);

        return {
            status: 'ok',
            set: viewOf(nextId, set),
            // Any name change needs the settings links rewritten, even when the
            // sanitized file id happened to stay the same.
            renamedFrom: fresh.name !== set.name ? fresh.name : null,
        };
    });
}

/** Delete a set file. Returns the deleted set, or `null` when it was missing. */
export async function deleteQuickReplySet(id: string): Promise<QuickReplySetView | null> {
    return withSetsLock(async () => {
        const set = await readQuickReplySet(id);
        if (!set) {
            return null;
        }
        await unlink(quickReplySetFilePath(set.id)).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        });
        return set;
    });
}

/**
 * Give every quick reply a unique, non-zero id.
 *
 * Older or hand-written sets may omit ids, which the schema defaults to 0; two
 * such replies would collide and only the first would be runnable.
 */
function normalizeItemIds(set: QuickReplySet): QuickReplySet {
    let next = Math.max(set.idIndex, ...set.qrList.map((item) => item.id));
    const seen = new Set<number>();
    const qrList = set.qrList.map((item) => {
        let id = item.id;
        if (id <= 0 || seen.has(id)) {
            next += 1;
            id = next;
        }
        seen.add(id);
        return id === item.id ? item : { ...item, id };
    });
    return withIdIndex({ ...set, qrList });
}

/**
 * Read a set from an imported payload.
 *
 * SillyTavern exports a version 2 set body. A single quick reply object — what
 * the QR editor's export button produces — is accepted as a one-reply set.
 */
export function extractQuickReplySet(data: unknown): QuickReplySet | null {
    if (!isRecord(data)) {
        return null;
    }

    if (Array.isArray(data.qrList)) {
        const parsed = quickReplySetSchema.safeParse(data);
        return parsed.success ? normalizeItemIds(parsed.data) : null;
    }

    const item = quickReplyItemSchema.safeParse(data);
    if (typeof data.message === 'string' && item.success) {
        const label = typeof data.label === 'string' && data.label ? data.label : 'Imported reply';
        const set = quickReplySetSchema.parse({ name: label, qrList: [{ ...item.data, id: 1 }], idIndex: 1 });
        return normalizeItemIds(set);
    }

    return null;
}

/** Import a set under its own name, or under `name` when one is supplied. */
export async function importQuickReplySet(data: unknown, name?: string): Promise<QuickReplySetWriteResult> {
    const imported = extractQuickReplySet(data);
    if (!imported) {
        return { status: 'invalid', message: 'The file is not a SillyTavern quick reply set (version 2).' };
    }
    if (name?.trim()) {
        imported.name = name.trim();
    }

    return withSetsLock(async () => {
        const parsed = quickReplySetSchema.safeParse(imported);
        if (!parsed.success) {
            return { status: 'invalid', message: parsed.error.issues[0]?.message ?? 'Invalid quick reply set' };
        }

        const sets = await listQuickReplySets();
        if (findByName(sets, parsed.data.name)) {
            return { status: 'name-taken' };
        }

        let id = normalizeId(parsed.data.name);
        const taken = await takenIds(sets);
        const base = id;
        let index = 2;
        while (taken.has(id.toLowerCase())) {
            id = `${base} (${index})`;
            index += 1;
        }

        const set = withIdIndex(parsed.data);
        await writeJsonFile(quickReplySetFilePath(id), set);
        return { status: 'ok', set: viewOf(id, set), renamedFrom: null };
    });
}
