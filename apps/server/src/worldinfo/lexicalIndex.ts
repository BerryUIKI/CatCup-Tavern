/**
 * Lexical index caching for the world info scanner.
 *
 * Building a BM25 index over a book is the expensive half of lexical matching:
 * about 1.2 s for ten thousand entries. A scan runs on every turn, so the index
 * is built once per book revision and then reused.
 *
 * The cache key is a content hash of the entries actually fed to the index, not
 * a file mtime and not a book id. That matters because:
 *
 * - An edit through the world info editor rewrites the file, but a rename or a
 *   scope move does not change content at all, and re-indexing it would be
 *   wasted work.
 * - The same book can be loaded from the profile scope or the shared scope. A
 *   content hash makes both resolve to one entry instead of two.
 * - A card-linked book and a globally enabled book can put the same entry in
 *   one scan twice; the caller dedupes by id first, and the hash follows.
 *
 * The cache is per process and never persisted. A restart rebuilds it, which is
 * the right trade: a stale index is worse than a cold one, and the source of
 * truth is always the JSON on disk.
 */

import type { ScanEntry } from '@catcup/compat-st';
import { type Bm25Index, type Bm25Options, buildEntryIndex } from '../retrieval/bm25.js';

/** How many books to keep indexed at once. */
const MAX_CACHED_INDEXES = 16;

interface CacheRecord {
    index: Bm25Index;
}

const cache = new Map<string, CacheRecord>();

/**
 * Hash the fields the index actually reads.
 *
 * Only `key`, `comment` and `content` matter: changing an entry's `order` or
 * `position` changes where it lands in the prompt but not how it scores.
 * Including them would rebuild the index after a reorder that cannot alter a
 * single hit.
 */
export function indexFingerprint(entries: readonly ScanEntry[]): string {
    // A cheap 53-bit rolling hash is enough: a collision needs two different
    // books of the same length whose contents agree on this reduction, and the
    // cost of one is a wrong ranking, not corrupted data. A cryptographic hash
    // would trade milliseconds per scan for a guarantee nothing here needs.
    let hash1 = 0x811c9dc5;
    let hash2 = 0x01000193;

    const mix = (text: string): void => {
        for (let index = 0; index < text.length; index += 1) {
            const code = text.charCodeAt(index);
            hash1 = Math.imul(hash1 ^ code, 0x01000193);
            hash2 = Math.imul(hash2 + code, 0x85ebca6b);
        }
        // Field separators, so ["ab","c"] and ["a","bc"] differ.
        hash1 = Math.imul(hash1 ^ 0x1f, 0x01000193);
        hash2 = Math.imul(hash2 ^ 0x2f, 0x85ebca6b);
    };

    for (const entry of entries) {
        mix(entry.id);
        mix(entry.comment);
        mix(entry.content);
        for (const key of entry.key) {
            mix(key);
        }
        // Aliases are indexed as part of the entry's keys, so an edit to them
        // changes what the index would score. Without this an alias edit would
        // leave a stale index serving the old keys until the process restart.
        for (const alias of entry.autoKeys) {
            mix(alias);
        }
    }

    return `${entries.length}:${(hash1 >>> 0).toString(36)}${(hash2 >>> 0).toString(36)}`;
}

/**
 * Get the index for a set of entries, building it when the content is new.
 *
 * Returns the index only, plus the fingerprint it was cached under. The caller
 * resolves a hit id against the entries it already holds — never against
 * anything from a previous build.
 *
 * That distinction is load-bearing. The fingerprint covers the fields the index
 * *scores* (`id`, `comment`, `content`, `key`), so editing any other field
 * leaves it unchanged: disabling an entry, moving it to a depth, reordering it,
 * changing its probability or role. Those fields are still read by the scan —
 * the lexical pass checks `disable`, `triggers`, `characterFilter`, the timed
 * effects and the budget against them. Handing back entry objects captured at
 * build time meant every such edit was ignored until the process restarted.
 */
export function getEntryIndex(
    entries: readonly ScanEntry[],
    options?: Bm25Options,
): { index: Bm25Index; fingerprint: string } {
    const fingerprint = indexFingerprint(entries);
    const cached = cache.get(fingerprint);

    if (cached) {
        // Refresh recency so an actively used book is not the one evicted.
        cache.delete(fingerprint);
        cache.set(fingerprint, cached);
        return { index: cached.index, fingerprint };
    }

    const index = buildEntryIndex(entries, options);

    const record: CacheRecord = { index };
    cache.set(fingerprint, record);

    if (cache.size > MAX_CACHED_INDEXES) {
        const oldest = cache.keys().next();
        if (!oldest.done) {
            cache.delete(oldest.value);
        }
    }

    return { index, fingerprint };
}

/** Drop every cached index. Used after a bulk import or in tests. */
export function clearIndexCache(): void {
    cache.clear();
}
