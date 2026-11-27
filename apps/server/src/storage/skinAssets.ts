import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isRecord, type SkinManifest, skinFontFamily } from '@catcup/shared';

import { type ArchiveEntry, entryText, findEntry } from '../packs/archive.js';
import { paths, resolveInside } from './paths.js';

/**
 * A skin's own files: the images it paints with and the fonts it names.
 *
 * RFC 0007 §`media` says a pack carries its assets and the host serves them
 * read-only from that one pack's folder. Everything here is that promise:
 * nothing is copied out, nothing outside the folder can be reached, and a file
 * the manifest does not declare is not served.
 */

/** The three things a skin may carry, because those are the three it can use. */
export const SKIN_MEDIA_TYPES = ['image', 'audio', 'font'] as const;
export type SkinMediaType = (typeof SKIN_MEDIA_TYPES)[number];

/** Content types the host will speak, by extension. Anything else is refused at install. */
const CONTENT_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    svg: 'image/svg+xml',
    ogg: 'audio/ogg',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    flac: 'audio/flac',
    woff2: 'font/woff2',
};

/** One declared asset, resolved against the archive. */
export interface SkinAsset {
    /** What the manifest calls it. */
    id: string;
    type: SkinMediaType;
    /** Archive-relative path, already validated by the reader. */
    path: string;
    contentType: string;
    bytes: Uint8Array;
}

/** The manifest's `media/index.json`, as a skin writes it. */
interface MediaIndex {
    media?: Record<string, { type?: unknown; path?: unknown; [key: string]: unknown }>;
}

/**
 * Read the assets a skin declares.
 *
 * The index is optional: a skin with only tokens and a stylesheet is the common
 * case, and requiring an empty `media/index.json` for it would be ceremony. A
 * skin that names an asset the archive does not contain fails here, at install,
 * rather than at the first paint that wanted it.
 */
export function readSkinAssets(manifest: SkinManifest, entries: ArchiveEntry[]): SkinAsset[] {
    if (!manifest.assets) {
        return [];
    }

    const indexEntry = findEntry(entries, manifest.assets);
    if (!indexEntry) {
        throw new Error(`The skin names "${manifest.assets}" as its media index, but the package does not contain it.`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(entryText(indexEntry));
    } catch {
        throw new Error(`${manifest.assets} is not valid JSON.`);
    }
    if (!isRecord(parsed)) {
        throw new Error(`${manifest.assets} needs a "media" object.`);
    }

    const index = parsed as MediaIndex;
    if (!index.media || !isRecord(index.media)) {
        throw new Error(`${manifest.assets} has no "media" object.`);
    }

    const assets: SkinAsset[] = [];
    for (const [id, declaration] of Object.entries(index.media)) {
        if (!isRecord(declaration)) {
            throw new Error(`${manifest.assets}: "${id}" is not an object.`);
        }
        const type = declaration.type;
        if (typeof type !== 'string' || !(SKIN_MEDIA_TYPES as readonly string[]).includes(type)) {
            throw new Error(`${manifest.assets}: "${id}" needs a type of ${SKIN_MEDIA_TYPES.join(', ')}.`);
        }
        const mediaPath = declaration.path;
        if (typeof mediaPath !== 'string' || !mediaPath.trim()) {
            throw new Error(`${manifest.assets}: "${id}" needs a path.`);
        }

        const entry = findEntry(entries, mediaPath);
        if (!entry) {
            throw new Error(`${manifest.assets}: "${id}" names "${mediaPath}", which the package does not contain.`);
        }

        const extension = path.extname(entry.path).slice(1).toLowerCase();
        const contentType = CONTENT_TYPES[extension];
        if (!contentType) {
            // A type the host cannot speak is worse than a missing file: the
            // browser would guess, and `nosniff` would make it guess wrong.
            throw new Error(
                `${manifest.assets}: "${id}" is a .${extension} file, which a skin cannot carry. Use one of: ${Object.keys(
                    CONTENT_TYPES,
                ).join(', ')}.`,
            );
        }

        assets.push({ id, type: type as SkinMediaType, path: entry.path, contentType, bytes: entry.bytes });
    }

    return assets;
}

/** Where one skin's assets live on disk. */
export function skinMediaDirectory(id: string): string {
    // `resolveInside` throws on a path that escapes the profile, so an id is
    // never trusted to be a file name even though the caller validated it.
    return resolveInside(paths.skins, `${id}.media`);
}

/** Write a skin's assets, replacing whatever a previous install left. */
export async function writeSkinAssets(id: string, assets: SkinAsset[]): Promise<void> {
    const directory = skinMediaDirectory(id);
    await rm(directory, { recursive: true, force: true });
    if (assets.length === 0) {
        return;
    }
    await mkdir(directory, { recursive: true });
    // The declaration is written first, so a crash halfway through leaves a
    // folder the host will not serve rather than a folder it half-trusts.
    await writeFile(
        path.join(directory, DECLARED_FILE),
        JSON.stringify({
            paths: assets.map((asset) => asset.path),
            fonts: Object.fromEntries(
                assets
                    .filter((asset) => asset.type === 'font')
                    .map((asset) => [asset.path, skinFontFamily(id, asset.id)]),
            ),
        }),
    );
    for (const asset of assets) {
        const target = resolveInside(directory, asset.path);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, asset.bytes);
    }
}

/**
 * Read one served asset.
 *
 * `declared` is the list this install wrote, held in the same way the manifest
 * is: a skin serves exactly the files its index names, so an asset dropped into
 * the folder by hand is not reachable. That is the difference between a folder
 * the host reads and a folder the host trusts.
 */
export async function readSkinAsset(
    id: string,
    declared: string[],
    relativePath: string,
): Promise<{ data: Buffer; contentType: string } | null> {
    const normalised = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!declared.includes(normalised)) {
        return null;
    }
    const directory = skinMediaDirectory(id);
    let target: string;
    try {
        target = resolveInside(directory, normalised);
    } catch {
        return null;
    }
    try {
        const data = await readFile(target);
        return {
            data,
            contentType: CONTENT_TYPES[path.extname(normalised).slice(1).toLowerCase()] ?? 'application/octet-stream',
        };
    } catch {
        return null;
    }
}

/**
 * Archive path → the CSS family name the server declared for it.
 *
 * Written by `writeSkinAssets` beside the assets, so the client can turn a
 * `tokens.font` path into the family the `@font-face` actually uses without
 * re-deriving it from a media index it does not have.
 */
export async function declaredFontFamilies(id: string): Promise<Record<string, string>> {
    const raw = await readFile(path.join(skinMediaDirectory(id), DECLARED_FILE), 'utf8').catch(() => null);
    if (!raw) {
        return {};
    }
    try {
        const parsed = JSON.parse(raw) as { fonts?: unknown };
        if (!parsed.fonts || !isRecord(parsed.fonts)) {
            return {};
        }
        const families: Record<string, string> = {};
        for (const [fontPath, family] of Object.entries(parsed.fonts)) {
            if (typeof family === 'string') {
                families[fontPath] = family;
            }
        }
        return families;
    } catch {
        return {};
    }
}

/**
 * The paths this install declared.
 *
 * Kept beside the assets rather than re-read from the archive: the archive is
 * not stored after install, and the served set must be what *this* install
 * wrote. A file put in the folder by hand is therefore not a way in.
 */
const DECLARED_FILE = 'index.json';

export async function declaredAssetPaths(id: string): Promise<string[]> {
    const raw = await readFile(path.join(skinMediaDirectory(id), DECLARED_FILE), 'utf8').catch(() => null);
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw) as { paths?: unknown };
        return Array.isArray(parsed.paths)
            ? parsed.paths.filter((entry): entry is string => typeof entry === 'string')
            : [];
    } catch {
        return [];
    }
}

/** Every file a skin's media folder holds, for a clean removal. */
export async function removeSkinAssets(id: string): Promise<void> {
    await rm(skinMediaDirectory(id), { recursive: true, force: true });
}

/** Whether the folder exists, used only to keep a test honest. */
export async function skinAssetNames(id: string): Promise<string[]> {
    try {
        return await readdir(skinMediaDirectory(id));
    } catch {
        return [];
    }
}
