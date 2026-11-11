import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import writeFileAtomic from 'write-file-atomic';

export async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
    try {
        const raw = await readFile(file, 'utf8');
        return JSON.parse(raw) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
    });
}

export async function readTextFile(file: string): Promise<string | null> {
    try {
        return await readFile(file, 'utf8');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

export async function writeTextFile(file: string, value: string, mode = 0o644): Promise<void> {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, value, { encoding: 'utf8', mode });
}
