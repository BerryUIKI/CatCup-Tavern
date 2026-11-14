import type { Stats } from 'node:fs';
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { CharacterDetail, CharacterPatch, CharacterSummary, ItemScope } from '@catcup/shared';
import { isRecord } from '@catcup/shared';
import writeFileAtomic from 'write-file-atomic';

import { readFavorite } from '../cards/favorite.js';
import { readCharacterModel } from '../cards/model.js';
import { type ParsedCard, parseCardBuffer } from '../cards/parse.js';
import { buildCardPayload, mutateCardPayload, writePngCard } from '../cards/write.js';
import { deleteCharacterAssets } from './characterAssets.js';
import { withFileLock } from './mutex.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';
import { locateItem, listMergedItems, copyItemIntoScope, moveItemBetweenScopes, type ScopeMoveResult } from './scopes.js';

/** A card may be a PNG with embedded data or a plain JSON export. */
const CARD_EXTENSIONS = ['.png', '.json'] as const;

interface CacheEntry {
    mtimeMs: number;
    detail: CharacterDetail;
}

/**
 * Parsed cards, keyed by scope **and** file name.
 *
 * The scope is part of the key because two profiles may hold a card with the
 * same file name, and because one profile reads both its own folder and the
 * shared one; keying on the name alone would serve the wrong Mira.
 */
const cache = new Map<string, CacheEntry>();

function cacheKey(scope: ItemScope, fileName: string): string {
    return `${scope}:${paths.root}|${fileName}`;
}

function extensionOf(fileName: string): '.png' | '.json' | null {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.png')) {
        return '.png';
    }
    if (lower.endsWith('.json')) {
        return '.json';
    }
    return null;
}

function characterId(fileName: string): string {
    return fileName.replace(/\.(png|json)$/i, '');
}

/** Accepts an id with or without its card extension. */
export function normalizeCharacterId(id: string): string {
    return id.trim().replace(/\.(png|json)$/i, '');
}

/**
 * The card's creation time in milliseconds.
 *
 * V2/V3's `creation_date` is in seconds; a legacy flat card or an ST export may
 * carry a root `create_date` (an ISO string). The file's birth time is the last
 * resort, but an atomic write replaces the file, so it is only stable once a
 * date has been stamped into the card.
 */
function readCreatedAt(parsed: ParsedCard, stats: Stats): number {
    const creation = parsed.card.creation_date;
    if (typeof creation === 'number' && Number.isFinite(creation) && creation > 0) {
        return creation > 1e12 ? creation : creation * 1000;
    }

    const raw = isRecord(parsed.raw) ? parsed.raw : {};
    const root = raw.create_date;
    if (typeof root === 'string') {
        const parsedDate = Date.parse(root);
        if (Number.isFinite(parsedDate) && parsedDate > 0) {
            return parsedDate;
        }
    }
    if (typeof root === 'number' && Number.isFinite(root) && root > 0) {
        return root > 1e12 ? root : root * 1000;
    }

    return stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.ctimeMs;
}

async function loadCharacterFile(
    filePath: string,
    fileName: string,
    scope: ItemScope,
): Promise<CharacterDetail | null> {
    const stats = await stat(filePath);
    const key = cacheKey(scope, fileName);
    const cached = cache.get(key);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
        return cached.detail;
    }

    try {
        const buffer = await readFile(filePath);
        const parsed = parseCardBuffer(buffer, fileName);
        const extension = extensionOf(fileName);
        if (!extension) {
            return null;
        }
        const id = characterId(fileName);
        const detail: CharacterDetail = {
            id,
            fileName,
            format: extension === '.png' ? 'png' : 'json',
            name: parsed.card.name || id,
            creator: parsed.card.creator,
            tags: parsed.card.tags,
            fav: readFavorite(parsed),
            model: readCharacterModel(parsed),
            spec: parsed.spec,
            hasCharacterBook: Boolean(parsed.card.character_book?.entries.length),
            createdAt: readCreatedAt(parsed, stats),
            updatedAt: stats.mtimeMs,
            avatarUrl: `/api/characters/${encodeURIComponent(id)}/avatar?v=${Math.floor(stats.mtimeMs)}`,
            card: parsed.card,
            rawCard: parsed.raw,
            scope,
        };
        cache.set(key, { mtimeMs: stats.mtimeMs, detail });
        return detail;
    } catch (error) {
        console.error(`[characters] Failed to parse ${fileName}:`, error);
        return null;
    }
}

export function toSummary(detail: CharacterDetail): CharacterSummary {
    return {
        id: detail.id,
        fileName: detail.fileName,
        format: detail.format,
        name: detail.name,
        creator: detail.creator,
        tags: detail.tags,
        fav: detail.fav,
        model: detail.model,
        spec: detail.spec,
        hasCharacterBook: detail.hasCharacterBook,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        avatarUrl: detail.avatarUrl,
        scope: detail.scope,
        ...(detail.shadowed ? { shadowed: true } : {}),
    };
}

/**
 * Every card this profile can see: its own cast first, then the shared one.
 *
 * A shared card whose id the profile already uses is not listed twice; the
 * profile's card carries `shadowed` so the library can say the shared one is
 * behind it.
 */
export async function listCharacters(): Promise<CharacterSummary[]> {
    const merged = await listMergedItems('characters', CARD_EXTENSIONS);

    const details = await Promise.all(
        merged.map(async (item) => {
            const detail = await loadCharacterFile(item.filePath, item.fileName, item.scope).catch(() => null);
            if (!detail) {
                return null;
            }
            return item.shadowed ? { ...detail, shadowed: true } : detail;
        }),
    );

    return details
        .filter((detail): detail is CharacterDetail => detail !== null)
        .map(toSummary)
        .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * One card by id, the profile's copy first.
 *
 * The id is the file name without its extension in both scopes, so an id an
 * existing chat or group already stores keeps resolving after its card is
 * marked reusable.
 */
export async function getCharacter(id: string): Promise<CharacterDetail | null> {
    const cleanId = normalizeCharacterId(id);
    assertSimpleName(cleanId);

    const found = await locateItem('characters', cleanId, CARD_EXTENSIONS);
    if (!found) {
        return null;
    }
    return loadCharacterFile(found.filePath, found.fileName, found.scope);
}

export async function getCharacterFile(
    id: string,
): Promise<{ filePath: string; detail: CharacterDetail } | null> {
    const cleanId = normalizeCharacterId(id);
    assertSimpleName(cleanId);

    const found = await locateItem('characters', cleanId, CARD_EXTENSIONS);
    if (!found) {
        return null;
    }
    const detail = await loadCharacterFile(found.filePath, found.fileName, found.scope);
    return detail ? { filePath: found.filePath, detail } : null;
}

/**
 * Store a card in the requested scope.
 *
 * A profile import lands in the profile's own folder unless the caller asked
 * for the shared one, and a name already in use in that same scope gets a
 * numeric suffix. The other scope does not participate: importing a second
 * `Mira` into a profile that already sees a shared `Mira` is allowed, because
 * the profile's copy is the one that wins and the shared one stays intact.
 */
export async function importCharacter(
    originalName: string,
    buffer: Buffer,
    scope: ItemScope = 'profile',
): Promise<CharacterDetail> {
    const parsed = parseCardBuffer(buffer, originalName);
    const extension = extensionOf(originalName);
    if (!extension) {
        throw new Error('Unsupported card format: expected .png or .json');
    }

    const fallbackName = path.basename(originalName, path.extname(originalName));
    const baseName = safeFileName(parsed.card.name || fallbackName, 'character');
    const directory = scope === 'shared' ? paths.sharedCharacters : paths.characters;

    const existing = new Set(
        (await readdir(directory, { withFileTypes: true }).catch(() => []))
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name.toLowerCase()),
    );

    let fileName = `${baseName}${extension}`;
    let index = 2;
    while (existing.has(fileName.toLowerCase())) {
        fileName = `${baseName} (${index})${extension}`;
        index += 1;
    }

    const target = resolveInside(directory, fileName);
    await withFileLock(target, () => writeFileAtomic(target, buffer, { mode: 0o644 }));
    cache.delete(cacheKey(scope, fileName));

    const detail = await loadCharacterFile(target, fileName, scope);
    if (!detail) {
        throw new Error('Imported card could not be read back');
    }
    return detail;
}

/**
 * Merge an edit into a stored card and write it back.
 *
 * The file name does not change: it is the character id that chats, avatars and
 * world info references already use. Only the card's own `name` field moves.
 */
/**
 * Stamp a creation date into a card that has none.
 *
 * Atomic writes replace the file, so a birth time is not durable across edits.
 * The V2/V3 `creation_date` field (seconds) freezes the first observed date the
 * same way SillyTavern's `create_date` does, and later writes keep it.
 */
function stampCreationDate(payload: Record<string, unknown>, createdAt: number): Record<string, unknown> {
    if (!isRecord(payload.data) || payload.data.creation_date !== undefined) {
        return payload;
    }
    if (!Number.isFinite(createdAt) || createdAt <= 0) {
        return payload;
    }
    return { ...payload, data: { ...payload.data, creation_date: Math.floor(createdAt / 1000) } };
}

/** Write a built payload back into the card file, in the format it arrived in. */
async function writeCardFile(
    found: { filePath: string; detail: CharacterDetail },
    payload: Record<string, unknown>,
): Promise<CharacterDetail | null> {
    const outgoing = stampCreationDate(payload, found.detail.createdAt);
    if (found.detail.format === 'png') {
        const buffer = await readFile(found.filePath);
        const next = writePngCard(new Uint8Array(buffer), outgoing);
        await writeFileAtomic(found.filePath, Buffer.from(next), { mode: 0o644 });
    } else {
        await writeFileAtomic(found.filePath, `${JSON.stringify(outgoing, null, 2)}\n`, 'utf8');
    }

    cache.delete(cacheKey(found.detail.scope, found.detail.fileName));
    return loadCharacterFile(found.filePath, found.detail.fileName, found.detail.scope);
}

export async function updateCharacter(id: string, patch: CharacterPatch): Promise<CharacterDetail | null> {
    const found = await getCharacterFile(id);
    if (!found) {
        return null;
    }

    return withFileLock(found.filePath, () => writeCardFile(found, buildCardPayload(found.detail.rawCard, patch)));
}

/** A card write that distinguishes a missing card from an unreadable result. */
export type CharacterMutationResult =
    | { status: 'ok'; character: CharacterDetail }
    | { status: 'missing' }
    | { status: 'unreadable' };

/**
 * Mutate the card body and write it back, keeping the file format.
 *
 * The card is read again inside the file lock, so a favorite or tag write does
 * not clobber an editor save that read the same base card. A mutation that
 * returns its input data unchanged is not written at all, leaving the file's
 * mtime and avatar version alone.
 */
async function mutateCharacterData(
    id: string,
    mutate: (data: Record<string, unknown>) => Record<string, unknown>,
): Promise<CharacterMutationResult> {
    const found = await getCharacterFile(id);
    if (!found) {
        return { status: 'missing' };
    }

    return withFileLock(found.filePath, async () => {
        const fresh = await loadCharacterFile(found.filePath, found.detail.fileName, found.detail.scope);
        if (!fresh) {
            return { status: 'unreadable' };
        }

        let changed = false;
        const payload = mutateCardPayload(fresh.rawCard, (data) => {
            const next = mutate(data);
            if (next !== data) {
                changed = true;
            }
            return next;
        });
        if (!changed) {
            return { status: 'ok', character: fresh };
        }

        const detail = await writeCardFile({ filePath: found.filePath, detail: fresh }, payload);
        return detail ? { status: 'ok', character: detail } : { status: 'unreadable' };
    });
}

/**
 * Trim and deduplicate only the tags in the request. Tags already on the card
 * are never rewritten: their order, spelling and whitespace stay byte-identical.
 */
function normalizeRequestedTags(tags: readonly string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const tag of tags) {
        const cleaned = tag.trim();
        if (!cleaned) {
            continue;
        }
        const key = tagKey(cleaned);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(cleaned);
    }
    return result;
}

/** Comparison key: case- and whitespace-insensitive, without rewriting the tag. */
function tagKey(tag: string): string {
    return tag.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Set SillyTavern's `data.extensions.fav` flag on a stored card. */
export async function setCharacterFavorite(id: string, favorite: boolean): Promise<CharacterMutationResult> {
    return mutateCharacterData(id, (data) => {
        const extensions = isRecord(data.extensions) ? data.extensions : {};
        if (extensions.fav === favorite) {
            return data;
        }
        return { ...data, extensions: { ...extensions, fav: favorite } };
    });
}

/**
 * Add or remove tags on a stored card.
 *
 * Addition appends only tags the card does not already have (case-insensitive)
 * and removal matches case-insensitively; everything else on the card is kept
 * as it was.
 */
export async function updateCharacterTags(
    id: string,
    tags: readonly string[],
    mode: 'add' | 'remove',
): Promise<CharacterMutationResult> {
    const requested = normalizeRequestedTags(tags);
    const requestedKeys = new Set(requested.map(tagKey));

    return mutateCharacterData(id, (data) => {
        const existing = Array.isArray(data.tags)
            ? data.tags.filter((tag): tag is string => typeof tag === 'string')
            : [];
        const existingKeys = new Set(existing.map(tagKey));
        const next =
            mode === 'add'
                ? [...existing, ...requested.filter((tag) => !existingKeys.has(tagKey(tag)))]
                : existing.filter((tag) => !requestedKeys.has(tagKey(tag)));

        const unchanged = next.length === existing.length && next.every((tag, index) => tag === existing[index]);
        return unchanged ? data : { ...data, tags: next };
    });
}

/**
 * Point a card at a world info book through `extensions.world`.
 *
 * This is the field SillyTavern uses to bind a card to a lorebook, so the link
 * travels with the exported card and the scanner reads it without the book
 * having to be enabled globally.
 */
export async function setCharacterWorld(id: string, worldName: string): Promise<CharacterDetail | null> {
    const found = await getCharacterFile(id);
    if (!found) {
        return null;
    }

    return withFileLock(found.filePath, () => {
        const payload = mutateCardPayload(found.detail.rawCard, (data) => {
            const extensions = isRecord(data.extensions) ? data.extensions : {};
            return { ...data, extensions: { ...extensions, world: worldName } };
        });
        return writeCardFile(found, payload);
    });
}

export async function deleteCharacter(id: string): Promise<boolean> {
    const found = await getCharacterFile(id);
    if (!found) {
        return false;
    }
    await withFileLock(found.filePath, () => unlink(found.filePath));
    cache.delete(cacheKey(found.detail.scope, found.detail.fileName));
    // Assets follow the card: a shared card's assets live beside the shared
    // folder, so the same id in the other scope keeps its own.
    await deleteCharacterAssets(found.detail.id, found.detail.scope).catch((error) => {
        console.error(`[characters] Failed to remove assets for ${found.detail.id}:`, error);
    });
    return true;
}

/** Move a card between the profile and the shared scope. */
export async function changeCharacterScope(id: string, target: ItemScope): Promise<ScopeMoveResult> {
    const result = await moveItemBetweenScopes('characters', normalizeCharacterId(id), target, CARD_EXTENSIONS);
    cache.clear();
    return result;
}

/** Copy a card into the other scope under a free id, leaving the original in place. */
export async function copyCharacterIntoScope(id: string, target: ItemScope): Promise<ScopeMoveResult> {
    return copyItemIntoScope('characters', normalizeCharacterId(id), target, CARD_EXTENSIONS);
}

export function clearCharacterCache(): void {
    cache.clear();
}
