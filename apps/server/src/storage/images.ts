import { randomBytes } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { type GeneratedImage, IMAGE_BACKENDS, type ImageBackend } from '@catcup/shared';

import { badRequest, notFound } from '../http/errors.js';
import type { ImageFormat } from '../images/types.js';
import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';

const EXTENSIONS: Record<ImageFormat, string> = {
    png: 'png',
    jpeg: 'jpg',
    webp: 'webp',
};

const CONTENT_TYPES: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
};

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

function imagePath(folder: string, file: string): string {
    assertFolder(folder);
    assertFile(file);
    return resolveInside(paths.userImages, folder, file);
}

function folderPath(folder: string): string {
    assertFolder(folder);
    return resolveInside(paths.userImages, folder);
}

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

function parseMetadata(raw: unknown): ImageMetadata {
    const base = metadataDefaults();
    if (!raw || typeof raw !== 'object') {
        return base;
    }
    const record = raw as Record<string, unknown>;
    return {
        prompt: typeof record.prompt === 'string' ? record.prompt : base.prompt,
        negativePrompt: typeof record.negativePrompt === 'string' ? record.negativePrompt : base.negativePrompt,
        backend: IMAGE_BACKENDS.includes(record.backend as ImageBackend)
            ? (record.backend as ImageBackend)
            : base.backend,
        model: typeof record.model === 'string' ? record.model : base.model,
        width: typeof record.width === 'number' && Number.isFinite(record.width) ? record.width : base.width,
        height: typeof record.height === 'number' && Number.isFinite(record.height) ? record.height : base.height,
        seed: typeof record.seed === 'number' && Number.isFinite(record.seed) ? record.seed : null,
        createdAt: typeof record.createdAt === 'string' ? record.createdAt : base.createdAt,
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

/** The gallery folder for a character; ST names it after the display name. */
export function characterFolder(character: { id: string; name: string }): string {
    return safeFileName(character.name, character.id);
}

/** A group gallery is named by the group id, as SillyTavern does. */
export function groupFolder(group: { id: string }): string {
    assertFolder(group.id);
    return group.id;
}

/** Write one generated image and its sidecar metadata into the gallery. */
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

/** Delete an image and its sidecar. */
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

/** List a gallery folder, newest first. */
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
            // A file that disappears or cannot be read is left out of the grid.
        }
    }

    return images
        .sort((left, right) => right.sortTime - left.sortTime)
        .map(({ sortTime: _sortTime, ...image }) => image);
}
