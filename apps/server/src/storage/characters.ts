import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { CharacterDetail, CharacterPatch, CharacterSummary } from '@catcup/shared';
import writeFileAtomic from 'write-file-atomic';

import { parseCardBuffer } from '../cards/parse.js';
import { buildCardPayload, writePngCard } from '../cards/write.js';
import { withFileLock } from './mutex.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';

interface CacheEntry {
    mtimeMs: number;
    detail: CharacterDetail;
}

const cache = new Map<string, CacheEntry>();

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

async function loadCharacterFile(filePath: string, fileName: string): Promise<CharacterDetail | null> {
    const stats = await stat(filePath);
    const cached = cache.get(fileName);
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
            spec: parsed.spec,
            hasCharacterBook: Boolean(parsed.card.character_book?.entries.length),
            updatedAt: stats.mtimeMs,
            avatarUrl: `/api/characters/${encodeURIComponent(id)}/avatar?v=${Math.floor(stats.mtimeMs)}`,
            card: parsed.card,
            rawCard: parsed.raw,
        };
        cache.set(fileName, { mtimeMs: stats.mtimeMs, detail });
        return detail;
    } catch (error) {
        console.error(`[characters] Failed to parse ${fileName}:`, error);
        return null;
    }
}

function toSummary(detail: CharacterDetail): CharacterSummary {
    return {
        id: detail.id,
        fileName: detail.fileName,
        format: detail.format,
        name: detail.name,
        creator: detail.creator,
        tags: detail.tags,
        spec: detail.spec,
        hasCharacterBook: detail.hasCharacterBook,
        updatedAt: detail.updatedAt,
        avatarUrl: detail.avatarUrl,
    };
}

export async function listCharacters(): Promise<CharacterSummary[]> {
    let files: string[];
    try {
        const entries = await readdir(paths.characters, { withFileTypes: true });
        files = entries.filter((entry) => entry.isFile() && extensionOf(entry.name)).map((entry) => entry.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const details = await Promise.all(
        files.map((fileName) => loadCharacterFile(path.join(paths.characters, fileName), fileName)),
    );
    return details
        .filter((detail): detail is CharacterDetail => detail !== null)
        .map(toSummary)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export async function getCharacter(id: string): Promise<CharacterDetail | null> {
    const cleanId = id.replace(/\.(png|json)$/i, '');
    assertSimpleName(cleanId);

    for (const extension of ['.png', '.json'] as const) {
        const fileName = `${cleanId}${extension}`;
        const filePath = resolveInside(paths.characters, fileName);
        try {
            await stat(filePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                continue;
            }
            throw error;
        }
        return loadCharacterFile(filePath, fileName);
    }
    return null;
}

export async function getCharacterFile(id: string): Promise<{ filePath: string; detail: CharacterDetail } | null> {
    const cleanId = id.replace(/\.(png|json)$/i, '');
    assertSimpleName(cleanId);

    for (const extension of ['.png', '.json'] as const) {
        const fileName = `${cleanId}${extension}`;
        const filePath = resolveInside(paths.characters, fileName);
        try {
            await stat(filePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                continue;
            }
            throw error;
        }
        const detail = await loadCharacterFile(filePath, fileName);
        if (detail) {
            return { filePath, detail };
        }
    }
    return null;
}

export async function importCharacter(originalName: string, buffer: Buffer): Promise<CharacterDetail> {
    const parsed = parseCardBuffer(buffer, originalName);
    const extension = extensionOf(originalName);
    if (!extension) {
        throw new Error('Unsupported card format: expected .png or .json');
    }

    const fallbackName = path.basename(originalName, path.extname(originalName));
    const baseName = safeFileName(parsed.card.name || fallbackName, 'character');

    const existing = new Set(
        (await readdir(paths.characters, { withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name.toLowerCase()),
    );

    let fileName = `${baseName}${extension}`;
    let index = 2;
    while (existing.has(fileName.toLowerCase())) {
        fileName = `${baseName} (${index})${extension}`;
        index += 1;
    }

    const target = resolveInside(paths.characters, fileName);
    await withFileLock(target, () => writeFileAtomic(target, buffer, { mode: 0o644 }));
    cache.delete(fileName);

    const detail = await loadCharacterFile(target, fileName);
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
export async function updateCharacter(id: string, patch: CharacterPatch): Promise<CharacterDetail | null> {
    const found = await getCharacterFile(id);
    if (!found) {
        return null;
    }

    return withFileLock(found.filePath, async () => {
        const payload = buildCardPayload(found.detail.rawCard, patch);

        if (found.detail.format === 'png') {
            const buffer = await readFile(found.filePath);
            const next = writePngCard(new Uint8Array(buffer), payload);
            await writeFileAtomic(found.filePath, Buffer.from(next), { mode: 0o644 });
        } else {
            await writeFileAtomic(found.filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        }

        cache.delete(found.detail.fileName);
        return loadCharacterFile(found.filePath, found.detail.fileName);
    });
}

export async function deleteCharacter(id: string): Promise<boolean> {
    const found = await getCharacterFile(id);
    if (!found) {
        return false;
    }
    await withFileLock(found.filePath, () => unlink(found.filePath));
    cache.delete(found.detail.fileName);
    return true;
}

export function clearCharacterCache(): void {
    cache.clear();
}
