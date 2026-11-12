import { isRecord } from '@catcup/shared';
import { strFromU8, strToU8, unzipSync, type Zippable, zipSync } from 'fflate';

import { safeFileName } from '../storage/paths.js';
import { normalizeCard, type ParsedCard } from './parse.js';
import { mutateCardPayload } from './write.js';

/**
 * CharX package support.
 *
 * CharX is RisuAI's character archive: a ZIP with `card.json` in Character
 * Card V3 shape, images and other assets under `assets/`, and optionally a
 * `module.risum` bundle of Risu scripts. CatCup imports the card, uses a PNG
 * icon as the character image, and keeps every asset so a CharX export can
 * round-trip. Risu modules are not imported: CatCup cannot execute them.
 */

const MAX_ENTRIES = 200;
const MAX_ENTRY_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 60 * 1024 * 1024;
const MAX_CARD_BYTES = 10 * 1024 * 1024;
const MAX_PATH_LENGTH = 400;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
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

export interface ParsedCharx {
    card: ParsedCard;
    /** PNG bytes from the card's icon asset; null when there is no usable icon. */
    icon: Buffer | null;
    /** Safe `assets/...` entries from the archive, keyed by their path. */
    assets: Map<string, Buffer>;
}

export interface CharxInput {
    rawCard: unknown;
    name: string;
    id: string;
    /** PNG image of the stored character card, when it has one. */
    avatar: Buffer | null;
    /** Stored character assets, keyed by their `assets/...` path. */
    assets: Map<string, Buffer>;
}

function isPng(data: Buffer): boolean {
    return data.length >= PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
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

/** RisuAI writes `embeded://`; some tools use the corrected spelling or `__asset:`. */
const EMBEDDED_URI_PREFIXES = ['embeded://', 'embedded://', '__asset:'];

/** Resolve an embedded asset URI to a safe archive path. */
function embeddedPath(uri: string): string | null {
    const lower = uri.toLowerCase();
    const prefix = EMBEDDED_URI_PREFIXES.find((candidate) => lower.startsWith(candidate));
    if (!prefix) {
        return null;
    }
    let path = uri.slice(prefix.length);
    try {
        path = decodeURIComponent(path);
    } catch {
        // A malformed escape is left as-is and then validated like any path.
    }
    return safeAssetPath(path);
}

function isIconEntry(entry: Record<string, unknown>): boolean {
    return typeof entry.type === 'string' && entry.type.toLowerCase() === 'icon';
}

function iconBuffer(entry: Record<string, unknown>, assets: Map<string, Buffer>): Buffer | null {
    if (typeof entry.uri !== 'string') {
        return null;
    }
    const path = embeddedPath(entry.uri);
    const data = path ? assets.get(path) : undefined;
    return data && isPng(data) ? data : null;
}

/** The icon the card points at (preferring one named `main`), or an `assets/icon/` PNG. */
function findIcon(card: ParsedCard, assets: Map<string, Buffer>): Buffer | null {
    const entries = Array.isArray(card.card.assets) ? card.card.assets : [];
    const icons = entries.filter((entry): entry is Record<string, unknown> => isRecord(entry) && isIconEntry(entry));
    const main = icons.find(
        (entry) => typeof entry.name === 'string' && entry.name.toLowerCase() === 'main' && iconBuffer(entry, assets),
    );
    if (main) {
        return iconBuffer(main, assets);
    }
    for (const entry of icons) {
        const data = iconBuffer(entry, assets);
        if (data) {
            return data;
        }
    }

    for (const [path, data] of assets) {
        if (path.startsWith('assets/icon/') && isPng(data)) {
            return data;
        }
    }
    return null;
}

/**
 * Read a CharX archive.
 *
 * Every asset is kept, not only the icon, so an export can put the package
 * back together. Files outside `assets/` and the optional `module.risum` are
 * ignored; both are documented as unsupported.
 */
export function parseCharx(buffer: Buffer): ParsedCharx {
    let entries = 0;
    let total = 0;
    let limited = false;

    let files: Record<string, Uint8Array>;
    try {
        files = unzipSync(new Uint8Array(buffer), {
            filter: (file) => {
                entries += 1;
                if (entries > MAX_ENTRIES) {
                    limited = true;
                    return false;
                }
                const size = typeof file.originalSize === 'number' ? file.originalSize : 0;
                if (size > MAX_ENTRY_BYTES || total + size > MAX_TOTAL_BYTES) {
                    limited = true;
                    return false;
                }
                total += size;
                return true;
            },
        });
    } catch {
        throw new Error('The CharX package could not be read as a ZIP archive');
    }

    const cardKey = Object.keys(files).find((name) => name.toLowerCase() === 'card.json');
    if (!cardKey) {
        throw new Error(
            limited
                ? 'The CharX package is too large, and card.json was not extracted'
                : 'The CharX package does not contain card.json',
        );
    }

    const cardBytes = files[cardKey];
    if (!cardBytes || cardBytes.byteLength === 0) {
        throw new Error('The CharX package has an empty card.json');
    }
    if (cardBytes.byteLength > MAX_CARD_BYTES) {
        throw new Error('The CharX card.json is too large');
    }

    let text = strFromU8(cardBytes);
    if (text.charCodeAt(0) === 0xfeff) {
        text = text.slice(1);
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch {
        throw new Error('The CharX card.json is not valid JSON');
    }
    if (!isRecord(raw) || typeof raw.spec !== 'string') {
        throw new Error('The CharX card.json is missing the spec field');
    }
    const card = normalizeCard(raw);

    const assets = new Map<string, Buffer>();
    let actualTotal = 0;
    for (const [name, data] of Object.entries(files)) {
        if (name === cardKey || data.byteLength === 0) {
            continue;
        }
        const safe = safeAssetPath(name);
        if (!safe?.startsWith('assets/')) {
            continue;
        }
        actualTotal += data.byteLength;
        if (actualTotal > MAX_TOTAL_BYTES) {
            throw new Error('The CharX package expands beyond the asset limit');
        }
        assets.set(safe, Buffer.from(data));
    }

    return { card, icon: findIcon(card, assets), assets };
}

/** A file name for the icon asset, unique against the package's other files. */
function iconPath(name: string, id: string, files: Map<string, Buffer>): string {
    const base = safeFileName(name, id).replace(/[. ]+$/, '') || 'icon';
    let candidate = `assets/icon/image/${base}.png`;
    let index = 2;
    while (files.has(candidate)) {
        candidate = `assets/icon/image/${base}_${index}.png`;
        index += 1;
    }
    return candidate;
}

function keepsAsset(entry: Record<string, unknown>, files: Map<string, Buffer>): boolean {
    if (typeof entry.uri !== 'string') {
        return false;
    }
    const lower = entry.uri.toLowerCase();
    if (!EMBEDDED_URI_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
        return true;
    }
    const path = embeddedPath(entry.uri);
    return Boolean(path && files.has(path));
}

/**
 * Build a CharX archive from a stored card.
 *
 * The card is written as V3. A PNG character image becomes the icon asset; an
 * existing icon entry keeps its path when that path is safe and present, so a
 * package that came from CharX keeps its original layout. Assets are written
 * uncompressed because images are already compressed.
 */
export function buildCharx(input: CharxInput): Buffer {
    const files = new Map(input.assets);
    let icon: Record<string, unknown> | null = null;
    let iconFile: string | null = null;

    const payload = mutateCardPayload(input.rawCard, (data) => {
        const existing = Array.isArray(data.assets) ? data.assets.filter(isRecord) : [];
        const entries = input.avatar
            ? existing.filter((entry) => !isIconEntry(entry) && keepsAsset(entry, files))
            : existing.filter((entry) => keepsAsset(entry, files));

        if (input.avatar) {
            const previous = existing.find((entry) => {
                if (!isIconEntry(entry) || typeof entry.uri !== 'string') {
                    return false;
                }
                const path = embeddedPath(entry.uri);
                return Boolean(path?.toLowerCase().endsWith('.png') && files.has(path));
            });
            const previousPath = previous && typeof previous.uri === 'string' ? embeddedPath(previous.uri) : null;
            iconFile = previousPath ?? iconPath(input.name, input.id, files);
            if (previousPath) {
                files.delete(previousPath);
            }
            icon = previous
                ? { ...previous, uri: `embeded://${iconFile}`, ext: 'png' }
                : { type: 'icon', uri: `embeded://${iconFile}`, name: input.name, ext: 'png' };
        }

        return { ...data, assets: icon ? [icon, ...entries] : entries };
    });

    const card = { ...payload, spec: 'chara_card_v3', spec_version: '3.0' };
    const zip: Zippable = {
        'card.json': [strToU8(`${JSON.stringify(card, null, 4)}\n`), { level: 6 }],
    };
    for (const [path, data] of files) {
        const safe = safeAssetPath(path);
        if (!safe?.startsWith('assets/')) {
            continue;
        }
        zip[safe] = [new Uint8Array(data), { level: 0 }];
    }
    if (iconFile && input.avatar) {
        zip[iconFile] = [new Uint8Array(input.avatar), { level: 0 }];
    }

    return Buffer.from(zipSync(zip, { level: 6 }));
}
