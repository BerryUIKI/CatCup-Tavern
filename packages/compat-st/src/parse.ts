// Written for CatCup. Reading a world info book: the entry map shapes, uid
// resolution, and the entry hash a chat's timed-effect records are keyed by.

import { type WorldInfoAliasMap, worldInfoEntrySchema } from '@catcup/shared';

import { getStringHash } from './hash.js';
import { parseDecorators } from './matching.js';
import type { ScanEntry } from './worldinfo-types.js';

/**
 * The world info file, as this app reads it.
 *
 * The shapes are the published ones — an `entries` map, or a bare `uid -> entry`
 * map from an older export — and `docs/DATA-FORMATS.md` records both. Two rules
 * here exist because getting them wrong produces no error and no failing test,
 * only an entry whose sticky or cooldown quietly stops working:
 *
 * - **The hash covers the raw record, not the parsed one.** Its payload is
 *   `{ uid, world, ...entry, decorators, content }`, with the decorators and the
 *   stripped content *appended* and the key order exactly as written. A chat's
 *   `timedWorldInfo` records are matched by that number, so an entry hashed from
 *   a re-serialized object — different key order, or a field dropped by the
 *   schema — would no longer find the records it wrote.
 * - **Unknown fields stay on the entry.** A newer client's field survives
 *   because the hash is taken from the source object rather than from what the
 *   schema kept.
 */

const ENTRY_HINTS = ['key', 'keysecondary', 'content', 'comment', 'uid'];

function looksLikeEntry(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }
    return ENTRY_HINTS.some((field) => field in value);
}

function looksLikeEntryMap(value: Record<string, unknown>): boolean {
    const values = Object.values(value);
    return values.length > 0 && values.every(looksLikeEntry);
}

/** Pull the entries map out of either shape a book file may use. */
export function extractEntries(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null;
    }

    const root = raw as Record<string, unknown>;
    const nested = root.entries;
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        return nested as Record<string, unknown>;
    }

    // Older exports and hand-written files sometimes use a bare `uid -> entry`
    // map with no `entries` wrapper.
    if (looksLikeEntryMap(root)) {
        return root;
    }

    return null;
}

/**
 * Resolve the uid an entry is known by.
 *
 * The entry's own `uid` wins; a file that keys its map by uid instead is the
 * older shape and falls back to the record key. The editor resolves uids
 * through this same function as the loader, so the entry a `PATCH` targets is
 * always the entry the scanner read — even in a hand-written file where the
 * record key and the `uid` field disagree.
 */
export function resolveUid(raw: Record<string, unknown>, key: string, fallback: number): number {
    const candidate = raw.uid;
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
        return candidate;
    }
    const fromKey = Number.parseInt(key, 10);
    return Number.isInteger(fromKey) ? fromKey : fallback;
}

/**
 * Normalize one world info file into scan-ready entries.
 *
 * Unknown fields survive on the entry object; the raw file is kept separately
 * so an export can round-trip anything the schema does not model.
 */
export function parseWorldInfoBook(id: string, raw: unknown): ScanEntry[] {
    const rawEntries = extractEntries(raw);
    if (!rawEntries) {
        return [];
    }

    const entries: ScanEntry[] = [];
    let index = 0;

    for (const [key, value] of Object.entries(rawEntries)) {
        const parsed = worldInfoEntrySchema.safeParse(value);
        if (!parsed.success) {
            index += 1;
            continue;
        }

        const source = value as Record<string, unknown>;
        const uid = resolveUid(source, key, index);
        const { decorators, content } = parseDecorators(parsed.data.content);

        // Hashing the *raw* record, with the decorators and stripped content
        // appended, is what lets an imported chat's timed-effect records keep
        // matching. Key order is part of the payload, so this is built in this
        // order deliberately rather than spread from a parsed object.
        const { uid: _sourceUid, ...rest } = source;
        const hash = getStringHash(JSON.stringify({ uid, world: id, ...rest, decorators, content }));

        entries.push({
            ...parsed.data,
            uid,
            world: id,
            id: `${id}.${uid}`,
            decorators,
            content,
            hash,
            autoKeys: [],
        });
        index += 1;
    }

    return entries;
}

/**
 * Attach a book's aliases to the entries they belong to.
 *
 * Aliases are kept out of the entry itself, so they arrive here as a second
 * input and are merged on top of an already-parsed entry. An alias the book's
 * own keys already list is dropped: it would only produce a duplicate trace
 * line, and the authored key is the one that should be reported.
 */
export function applyAliases(entries: ScanEntry[], aliases: WorldInfoAliasMap): ScanEntry[] {
    if (Object.keys(aliases).length === 0) {
        return entries;
    }

    for (const entry of entries) {
        const record = aliases[String(entry.uid)];
        if (!record || record.aliases.length === 0) {
            continue;
        }
        const authored = new Set(entry.key.map((key) => key.toLowerCase()));
        entry.autoKeys = record.aliases.filter((alias) => !authored.has(alias.toLowerCase()));
    }

    return entries;
}
