// Written for CatCup. The image gallery: where a generated picture and its
// metadata live on disk, and the file-name rules that keep a request from
// escaping its own folder.

import { randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type GeneratedImage, IMAGE_BACKENDS, type ImageBackend } from '@catcup/shared';

import { badRequest, notFound } from '../http/errors.js';
import type { ImageFormat } from '../images/types.js';
import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';

/**
 * The gallery on disk.
 *
 * The layout is the published one — `user/images/<folder>/<file>`, with the
 * folder named after the character or the group and the `url` field of a chat
 * message pointing at it relatively — so a gallery written here stays legible to
 * the other tavern clients, and one written by them opens here. The sidecar
 * beside each image is CatCup's own and is described in `docs/DATA-FORMATS.md`;
 * the other clients ignore files that are not images, which is what makes it
 * safe to put one there.
 *
 * Everything else in this file is about one property: **a request may not name
 * a path that leaves its own folder.** Folder and file are both validated
 * against a fixed grammar before either reaches the filesystem, and the result
 * is resolved inside the gallery root rather than joined onto it.
 */

/** A format's canonical file extension, so a gallery has one spelling per type. */
const EXTENSIONS: Record<ImageFormat, string> = {
    png: 'png',
    jpeg: 'jpg',
    webp: 'webp',
};

/**
 * What may be served, by extension.
 *
 * Read rather than inferred from the format map above, because the gallery also
 * contains files this app did not write — a `jpeg` extension is common and has
 * to keep working.
 */
const CONTENT_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
};

/** What a stored file name may look like: no separators, no leading dot. */
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface ImageMetadata {
    prompt: string;
    negativePrompt: string;
    backend: ImageBackend;
    model: string;
    width: number;
    height: number;
    seed: number | null;
    createdAt: string;
}

function assertFolder(folder: string): void {
    try {
        assertSimpleName(folder);
    } catch {
        throw badRequest('Invalid image folder', 'IMAGE_PATH');
    }
}

function extensionOf(file: string): string {
    return path.extname(file).slice(1).toLowerCase();
}

function assertFile(file: string): void {
    if (!FILE_PATTERN.test(file) || !Object.hasOwn(CONTENT_TYPES, extensionOf(file))) {
        throw badRequest('Invalid image file name', 'IMAGE_PATH');
    }
}

/** Resolve one file inside the gallery. Both parts are checked first. */
function imagePath(folder: string, file: string): string {
    assertFolder(folder);
    assertFile(file);
    return resolveInside(paths.userImages, folder, file);
}

function folderPath(folder: string): string {
    assertFolder(folder);
    return resolveInside(paths.userImages, folder);
}

/** A metadata record with every field answered, for a sidecar that is absent or partial. */
function metadataDefaults(): ImageMetadata {
    return {
        prompt: '',
        negativePrompt: '',
        backend: 'automatic1111',
        model: '',
        width: 0,
        height: 0,
        seed: null,
        createdAt: '',
    };
}

/**
 * Read a sidecar, keeping whatever is usable.
 *
 * Field by field rather than all-or-nothing: a hand-edited sidecar with one bad
 * value should still show its picture in the grid, with that one field blank.
 */
function parseMetadata(raw: unknown): ImageMetadata {
    const fallback = metadataDefaults();
    if (!raw || typeof raw !== 'object') {
        return fallback;
    }
    const record = raw as Record<string, unknown>;
    const text = (value: unknown): string => (typeof value === 'string' ? value : '');
    const number = (value: unknown, otherwise: number): number =>
        typeof value === 'number' && Number.isFinite(value) ? value : otherwise;

    return {
        prompt: text(record.prompt),
        negativePrompt: text(record.negativePrompt),
        backend: IMAGE_BACKENDS.includes(record.backend as ImageBackend)
            ? (record.backend as ImageBackend)
            : fallback.backend,
        model: text(record.model),
        width: number(record.width, fallback.width),
        height: number(record.height, fallback.height),
        seed: typeof record.seed === 'number' && Number.isFinite(record.seed) ? record.seed : null,
        createdAt: text(record.createdAt),
    };
}

function toGenerated(folder: string, file: string, metadata: ImageMetadata, fallbackDate: Date): GeneratedImage {
    return {
        folder,
        file,
        url: `user/images/${folder}/${file}`,
        prompt: metadata.prompt,
        negativePrompt: metadata.negativePrompt,
        backend: metadata.backend,
        model: metadata.model,
        width: metadata.width,
        height: metadata.height,
        seed: metadata.seed,
        createdAt: metadata.createdAt || fallbackDate.toISOString(),
    };
}

/**
 * The gallery folder for a character.
 *
 * Named after the display name, because that is what the format says a gallery
 * folder is; the id is the fallback for a name that sanitises to nothing, so two
 * characters whose names both vanish cannot end up sharing a folder.
 */
export function characterFolder(character: { id: string; name: string }): string {
    return safeFileName(character.name, character.id);
}

/** A group gallery is named by the group id — the group has no single name to use. */
export function groupFolder(group: { id: string }): string {
    assertFolder(group.id);
    return group.id;
}

/**
 * Write one generated image and its sidecar into the gallery.
 *
 * The file name carries a timestamp and four random bytes: two images generated
 * in the same millisecond would otherwise collide, and a collision would mean
 * one of them silently replacing the other's sidecar.
 */
export async function saveImage(
    folder: string,
    data: Buffer,
    format: ImageFormat,
    metadata: ImageMetadata,
): Promise<GeneratedImage> {
    const directory = folderPath(folder);
    await mkdir(directory, { recursive: true });

    const file = `image-${Date.now()}-${randomBytes(4).toString('hex')}.${EXTENSIONS[format]}`;
    const filePath = imagePath(folder, file);
    await writeFile(filePath, data);
    await writeJsonFile(`${filePath}.json`, metadata);

    return toGenerated(folder, file, metadata, new Date());
}

/** Read the image bytes and the content type to serve. */
export async function readImage(folder: string, file: string): Promise<{ data: Buffer; contentType: string }> {
    const filePath = imagePath(folder, file);
    try {
        const data = await readFile(filePath);
        return { data, contentType: CONTENT_TYPES[extensionOf(file)] ?? 'application/octet-stream' };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw notFound('Image not found');
        }
        throw error;
    }
}

export async function readImageMetadata(folder: string, file: string): Promise<ImageMetadata> {
    const filePath = imagePath(folder, file);
    return parseMetadata(await readJsonFile<unknown>(`${filePath}.json`, null));
}

export async function imageExists(folder: string, file: string): Promise<boolean> {
    try {
        const stats = await stat(imagePath(folder, file));
        return stats.isFile();
    } catch {
        return false;
    }
}

/**
 * Delete an image and its sidecar.
 *
 * The sidecar's removal is best-effort: a missing sidecar is not a reason to
 * refuse to delete the picture the caller asked about.
 */
export async function deleteImage(folder: string, file: string): Promise<void> {
    const filePath = imagePath(folder, file);
    try {
        await unlink(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            throw notFound('Image not found');
        }
        throw error;
    }
    await unlink(`${filePath}.json`).catch(() => undefined);
}

/**
 * List a gallery folder, newest first.
 *
 * Sorted by the file's own modification time rather than by its name: the name
 * carries a timestamp this app writes, but a file copied in from elsewhere does
 * not, and the modification time is the one fact every entry has. A file that
 * disappears between the directory read and the `stat` is left out rather than
 * failing the whole listing.
 */
export async function listImages(folder: string): Promise<GeneratedImage[]> {
    const directory = folderPath(folder);
    let entries: Dirent[];
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const images: Array<GeneratedImage & { sortTime: number }> = [];
    for (const entry of entries) {
        if (!entry.isFile() || !Object.hasOwn(CONTENT_TYPES, extensionOf(entry.name))) {
            continue;
        }
        const filePath = path.join(directory, entry.name);
        try {
            const stats = await stat(filePath);
            const metadata = parseMetadata(await readJsonFile<unknown>(`${filePath}.json`, null));
            images.push({
                ...toGenerated(folder, entry.name, metadata, stats.mtime),
                sortTime: stats.mtimeMs,
            });
        } catch {
            // Unreadable right now, so not shown right now.
        }
    }

    return images
        .sort((left, right) => right.sortTime - left.sortTime)
        .map(({ sortTime: _sortTime, ...image }) => image);
}
