import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sanitize from 'sanitize-filename';

import { config } from '../config.js';

export const paths = {
    root: config.dataDir,
    characters: path.join(config.dataDir, 'characters'),
    chats: path.join(config.dataDir, 'chats'),
    groups: path.join(config.dataDir, 'groups'),
    groupChats: path.join(config.dataDir, 'group chats'),
    worlds: path.join(config.dataDir, 'worlds'),
    presets: path.join(config.dataDir, 'presets'),
    quickReplies: path.join(config.dataDir, 'quickreplies'),
    regex: path.join(config.dataDir, 'regex.json'),
    settings: path.join(config.dataDir, 'settings.json'),
    secrets: path.join(config.dataDir, 'secrets.json'),
    auth: path.join(config.dataDir, 'auth.json'),
} as const;

export async function ensureDataDirs(): Promise<void> {
    await Promise.all([
        mkdir(paths.characters, { recursive: true }),
        mkdir(paths.chats, { recursive: true }),
        mkdir(paths.groups, { recursive: true }),
        mkdir(paths.groupChats, { recursive: true }),
        mkdir(paths.worlds, { recursive: true }),
        mkdir(paths.presets, { recursive: true }),
        mkdir(paths.quickReplies, { recursive: true }),
    ]);
}

function stripControlCharacters(value: string): string {
    let output = '';
    for (const char of value) {
        const code = char.codePointAt(0) ?? 0;
        output += code < 0x20 || code === 0x7f ? ' ' : char;
    }
    return output;
}

/** Sanitize a user-controlled display name for use as a file or folder name. */
export function safeFileName(input: string, fallback = 'untitled'): string {
    const cleaned = sanitize(stripControlCharacters(input).trim()).replace(/\s+/g, ' ').trim();
    const truncated = cleaned.slice(0, 120).trim();
    return truncated || fallback;
}

/** Reject ids that could traverse directories. */
export function assertSimpleName(name: string): void {
    if (!name || name === '.' || name === '..' || name.includes('\0') || /[\\/]/.test(name)) {
        throw new Error('Invalid name');
    }
}

export function resolveInside(base: string, ...parts: string[]): string {
    const target = path.resolve(base, ...parts);
    const relative = path.relative(base, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error('Path escapes the data directory');
    }
    return target;
}
