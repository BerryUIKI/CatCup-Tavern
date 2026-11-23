// Adapted from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/world-info.js
// The book shapes and uid resolution are the format; the hash payload and
// its key order are this client's, kept because a chat keys its
// `timedWorldInfo` records by that value. See docs/REUSE.md.

import { type WorldInfoAliasMap, worldInfoEntrySchema } from '@catcup/shared';

import { getStringHash } from './hash.js';
import { parseDecorators } from './matching.js';
import type { ScanEntry } from './worldinfo-types.js';

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

/** Pull the entries map out of the shapes SillyTavern and its exporters produce. */
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
 * SillyTavern writes `uid` on every entry it saves; older and hand-written
 * files key the entry map by uid instead. The editor resolves uids through the
 * same function as the loader, so the entry a `PATCH` targets is the entry the
 * scanner read.
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

        // SillyTavern hashes `{ uid, world, ...entry }` with `decorators` and
        // the stripped `content` appended, then uses that hash to match timed
        // effects stored in imported chats. Key order is part of the payload,
        // so build it the same way instead of hashing the parsed object.
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
