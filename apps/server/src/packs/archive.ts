import { strFromU8, unzipSync } from 'fflate';

/**
 * The one way CatCup opens a ZIP.
 *
 * `.charx`, `.catcup` and a distilled skill all arrive as archives from a
 * person's disk, so all three go through the same limits and the same path
 * validation. The constants used to live inside the CharX reader; they are
 * here so a second reader cannot pick its own, and so tightening one tightens
 * every format at once.
 *
 * The limits are not tuning. A ZIP's header is the only thing that says how
 * big its contents claim to be, so the size checks run on the bytes that
 * actually arrived, and the path check runs before anything is written.
 */

/** How many entries one archive may hold. */
export const MAX_ENTRIES = 200;
/** How large one extracted entry may be. */
export const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
/** How large everything extracted from one archive may be together. */
export const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
/** The longest archive-internal path CatCup will accept. */
export const MAX_PATH_LENGTH = 400;
/**
 * The largest `card.json` a character package may carry.
 *
 * Card-specific rather than a general archive rule, but it belongs beside the
 * others: it is the same kind of limit, checked on extracted bytes, and a
 * reader that did not know it would accept a 25 MB card the charx reader
 * refuses.
 */
export const MAX_CARD_BYTES = 10 * 1024 * 1024;

const RESERVED_SEGMENT = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID_SEGMENT_CHARACTERS = '<>:"|?*';

function hasInvalidSegmentCharacter(value: string): boolean {
    for (const character of value) {
        const code = character.codePointAt(0) ?? 0;
        if (code < 0x20 || code === 0x7f || INVALID_SEGMENT_CHARACTERS.includes(character)) {
            return true;
        }
    }
    return false;
}

/**
 * Validate a path from inside a ZIP or an asset URI.
 *
 * The path is later joined under the data directory, so absolute paths,
 * backslashes, `..`, Windows device names and reserved characters are rejected
 * rather than sanitized: a renamed asset would break the card's `embeded://`
 * references anyway.
 */
export function safeAssetPath(name: string): string | null {
    if (!name || name.length > MAX_PATH_LENGTH || name.includes('\0')) {
        return null;
    }
    // ZIP paths use `/`, but archives from Windows tools sometimes use `\`.
    const normalized = name.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
        return null;
    }
    const segments = normalized.split('/');
    if (segments.length > 10) {
        return null;
    }
    for (const segment of segments) {
        if (!segment || segment === '.' || segment === '..' || segment.length > 120) {
            return null;
        }
        if (hasInvalidSegmentCharacter(segment) || RESERVED_SEGMENT.test(segment)) {
            return null;
        }
        if (segment.endsWith('.') || segment.endsWith(' ')) {
            return null;
        }
    }
    return segments.join('/');
}

export interface ArchiveEntry {
    /** The archive-relative path, already validated. */
    path: string;
    bytes: Uint8Array;
}

export class ArchiveTooLargeError extends Error {
    constructor(readonly reason: 'entries' | 'entry-size' | 'total-size') {
        super(`The archive is too large (${reason})`);
    }
}

export class ArchiveUnreadableError extends Error {
    constructor() {
        super('The package could not be read as a ZIP archive');
    }
}

/**
 * Read an archive under the shared limits.
 *
 * Returns entries sorted by path so two reads of the same bytes give the same
 * order — a manifest reader that depended on ZIP ordering would be a
 * behaviour change disguised as a file format.
 *
 * An entry whose path fails `safeAssetPath` is dropped rather than refusing the
 * whole archive: a package can legitimately carry a file for another tool, and
 * a reader that only needs `manifest.json` should not die over it. A reader
 * that *does* need a dropped file will say it is missing, which is the message
 * an author can act on.
 */
export function readArchive(buffer: Buffer | Uint8Array): ArchiveEntry[] {
    let entries = 0;
    let total = 0;
    let tooLarge: ArchiveTooLargeError['reason'] | null = null;

    const files: Record<string, Uint8Array> = (() => {
        try {
            return unzipSync(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer), {
                filter: (file) => {
                    entries += 1;
                    if (entries > MAX_ENTRIES) {
                        tooLarge ??= 'entries';
                        return false;
                    }
                    const size = typeof file.originalSize === 'number' ? file.originalSize : 0;
                    if (size > MAX_ENTRY_BYTES) {
                        tooLarge ??= 'entry-size';
                        return false;
                    }
                    if (total + size > MAX_TOTAL_BYTES) {
                        tooLarge ??= 'total-size';
                        return false;
                    }
                    total += size;
                    return true;
                },
            });
        } catch {
            throw new ArchiveUnreadableError();
        }
    })();

    // A limit that was hit refuses the archive outright rather than returning a
    // partial one. The alternative — keep whatever fitted — hands a reader a
    // package that is missing files it will later call absent, which is the
    // confusing failure this check exists to avoid.
    if (tooLarge) {
        throw new ArchiveTooLargeError(tooLarge);
    }

    const result: ArchiveEntry[] = [];
    for (const [rawName, bytes] of Object.entries(files)) {
        const path = safeAssetPath(rawName);
        if (!path) {
            continue;
        }
        result.push({ path, bytes });
    }
    result.sort((left, right) => left.path.localeCompare(right.path));
    return result;
}

/** Decode one entry as UTF-8 text, with a byte-order mark removed. */
export function entryText(entry: ArchiveEntry): string {
    const text = strFromU8(entry.bytes);
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Find one entry by path, case-insensitively — archives differ on that. */
export function findEntry(entries: ArchiveEntry[], path: string): ArchiveEntry | null {
    const wanted = path.toLowerCase();
    return entries.find((entry) => entry.path.toLowerCase() === wanted) ?? null;
}
