import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import sanitize from 'sanitize-filename';

import { config } from '../config.js';

/**
 * The directory whose content a profile owns.
 *
 * Everything scoped — characters, chats, groups, world info, presets, quick
 * reply sets, regex, personas, images and the profile's own `settings.json` —
 * is read from here. Only the provider list, the keys and auth live outside it.
 *
 * The server is single-user and the profile switch is guarded (it refuses while
 * a generation runs), so one module-level value is enough. It is deliberately
 * read through getters: every storage module asks `paths.<key>` at call time, so
 * a switch is visible to the next request without touching 45 call sites.
 */
let activeScope: string = config.dataDir;

/** Point every scoped path at a profile's directory. */
export function setActiveScope(directory: string): void {
    activeScope = directory;
}

/** The active profile's directory. */
export function getActiveScope(): string {
    return activeScope;
}

function inside(...parts: string[]): string {
    return path.join(activeScope, ...parts);
}

export const paths = {
    /** The active profile's directory. */
    get root(): string {
        return activeScope;
    },
    get characters(): string {
        return inside('characters');
    },
    /** Extracted CharX assets, one folder per character id. */
    get characterAssets(): string {
        return inside('character-assets');
    },
    get chats(): string {
        return inside('chats');
    },
    get groups(): string {
        return inside('groups');
    },
    get groupChats(): string {
        return inside('group chats');
    },
    get worlds(): string {
        return inside('worlds');
    },
    get presets(): string {
        return inside('presets');
    },
    get quickReplies(): string {
        return inside('quickreplies');
    },
    /** Generated gallery images, in SillyTavern's `user/images` layout. */
    get userImages(): string {
        return path.join(activeScope, 'user', 'images');
    },
    /** Uploaded books, one folder per book, holding the source file and its record. */
    get books(): string {
        return inside('books');
    },
    /** Run records for book distillation. */
    get distill(): string {
        return inside('distill');
    },
    get regex(): string {
        return inside('regex.json');
    },
    /**
     * A profile's reusable personas.
     *
     * Before the shared layer personas lived only inside `settings.json`. A
     * profile that marks one reusable keeps its own copies here, so the shared
     * file and the profile file are the same shape and a move is a real move.
     */
    get personas(): string {
        return inside('personas.json');
    },
    /** The active profile's configuration. */
    get settings(): string {
        return inside('settings.json');
    },

    // Things one machine has one of, whatever profile is active.
    /** The profile index: which profiles exist and which is active. */
    globalSettings: path.join(config.dataDir, 'settings.json'),
    /** Provider configurations, shared by every profile. */
    providers: path.join(config.dataDir, 'providers.json'),
    /** API keys, shared by every profile. */
    secrets: path.join(config.dataDir, 'secrets.json'),
    auth: path.join(config.dataDir, 'auth.json'),

    // The shared layer: items a profile marked as reusable. Never inside a
    // profile, so an archived profile cannot take a shared item with it.
    get shared(): string {
        return path.join(config.dataDir, 'shared');
    },
    get sharedCharacters(): string {
        return path.join(config.dataDir, 'shared', 'characters');
    },
    get sharedCharacterAssets(): string {
        return path.join(config.dataDir, 'shared', 'character-assets');
    },
    get sharedWorlds(): string {
        return path.join(config.dataDir, 'shared', 'worlds');
    },
    get sharedPresets(): string {
        return path.join(config.dataDir, 'shared', 'presets');
    },
    get sharedQuickReplies(): string {
        return path.join(config.dataDir, 'shared', 'quickreplies');
    },
    get sharedRegex(): string {
        return path.join(config.dataDir, 'shared', 'regex.json');
    },
    get sharedPersonas(): string {
        return path.join(config.dataDir, 'shared', 'personas.json');
    },
} as const;

/**
 * Every folder a profile owns, relative to its root.
 *
 * Forward slashes on purpose: these are also the names a migration reports, and
 * `path.join` would make them platform-shaped in the plan output.
 */
export const SCOPED_DIRECTORIES = [
    'characters',
    'character-assets',
    'chats',
    'groups',
    'group chats',
    'worlds',
    'presets',
    'quickreplies',
    'user/images',
    'books',
    'distill',
] as const;

/**
 * Plain JSON libraries a profile owns, relative to its root.
 *
 * They are written as files when a profile marks an item reusable, so a folder
 * that has never used the shared layer simply does not carry them.
 */
export const SCOPED_FILES = ['regex.json', 'personas.json'] as const;

/** Create the content folders under `directory`, defaulting to the active scope. */
export async function ensureDataDirs(directory: string = activeScope): Promise<void> {
    await Promise.all(SCOPED_DIRECTORIES.map((folder) => mkdir(path.join(directory, folder), { recursive: true })));
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
