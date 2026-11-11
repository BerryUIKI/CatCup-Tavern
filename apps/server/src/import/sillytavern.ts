import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { isRecord } from '@catcup/shared';

import { importCharacter } from '../storage/characters.js';
import { importChatFile } from '../storage/chats.js';
import { createPreset } from '../storage/presets.js';
import { createWorld } from '../storage/worlds.js';

/**
 * Import an existing SillyTavern installation.
 *
 * The user points at their ST user directory — the one holding `characters/`,
 * `chats/`, `worlds/` and their presets — and everything this app understands
 * is copied in. Group chats, backgrounds, themes and ST's own settings are not
 * imported: the shapes do not exist here yet, and silently dropping half of a
 * settings file would be worse than not touching it.
 */

/** Files larger than this are skipped rather than read into memory. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Upper bound per kind, so a wrong path cannot walk a huge tree. */
const MAX_FILES = 500;

const EXTENSIONS = {
    character: ['.png', '.json'],
    chat: ['.jsonl'],
    world: ['.json'],
    preset: ['.json'],
} as const;

export interface ImportPlan {
    /** Files found, per kind. */
    characters: number;
    chats: number;
    worlds: number;
    presets: number;
    /** Folders that were looked at, for the report. */
    sources: string[];
    errors: string[];
}

export interface ImportResult {
    imported: { characters: number; chats: number; worlds: number; presets: number };
    errors: string[];
    /** Chats whose character was not imported, reported rather than guessed at. */
    skippedChats: string[];
}

async function listFiles(directory: string, extensions: readonly string[]): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name)
        .filter((name) => extensions.some((extension) => name.toLowerCase().endsWith(extension)))
        .sort()
        .slice(0, MAX_FILES)
        .map((name) => path.join(directory, name));
}

async function listDirectories(directory: string): Promise<string[]> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(directory, entry.name));
}

/** Candidate preset folders, newest layout first. */
async function findPresetDirectories(root: string): Promise<string[]> {
    const candidates = [
        path.join(root, 'openai presets'),
        path.join(root, 'presets', 'openai'),
        path.join(root, 'public', 'presets', 'openai'),
    ];

    const found: string[] = [];
    for (const candidate of candidates) {
        const info = await stat(candidate).catch(() => null);
        if (info?.isDirectory()) {
            found.push(candidate);
        }
    }
    return found;
}

/** Read a file unless it is too large to be a card or a chat. */
async function readSafely(filePath: string): Promise<Buffer | null> {
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile() || info.size > MAX_FILE_BYTES) {
        return null;
    }
    return readFile(filePath);
}

/**
 * Look at what a directory holds without changing anything.
 *
 * A directory that has none of the four shapes is rejected, so pointing at the
 * wrong folder produces a clear message instead of a zero-count import.
 */
export async function scanSillyTavern(root: string): Promise<ImportPlan> {
    if (!path.isAbsolute(root)) {
        throw new Error('The path must be absolute.');
    }
    const info = await stat(root).catch(() => null);
    if (!info?.isDirectory()) {
        throw new Error('That path is not a directory.');
    }

    const characterDir = path.join(root, 'characters');
    const chatDir = path.join(root, 'chats');
    const worldDir = path.join(root, 'worlds');
    const presetDirs = await findPresetDirectories(root);

    const sources: string[] = [];
    const errors: string[] = [];

    const characters = await listFiles(characterDir, EXTENSIONS.character);
    if (characters.length > 0) {
        sources.push(characterDir);
    }

    const chatFolders = await listDirectories(chatDir);
    let chats = 0;
    for (const folder of chatFolders) {
        const files = await listFiles(folder, EXTENSIONS.chat);
        chats += files.length;
        if (files.length > 0) {
            sources.push(folder);
        }
    }

    const worlds = await listFiles(worldDir, EXTENSIONS.world);
    if (worlds.length > 0) {
        sources.push(worldDir);
    }

    let presets = 0;
    for (const directory of presetDirs) {
        const files = await listFiles(directory, EXTENSIONS.preset);
        presets += files.length;
        if (files.length > 0) {
            sources.push(directory);
        }
    }

    if (characters.length === 0 && chats === 0 && worlds.length === 0 && presets === 0) {
        throw new Error(
            'No SillyTavern data found there. Point at the user folder that contains characters/, chats/ and worlds/.',
        );
    }

    return { characters: characters.length, chats, worlds: worlds.length, presets, sources, errors };
}

export async function importSillyTavern(root: string): Promise<ImportResult> {
    const plan = await scanSillyTavern(root);
    const errors = [...plan.errors];
    const skippedChats: string[] = [];
    const imported = { characters: 0, chats: 0, worlds: 0, presets: 0 };

    // Characters first: chats are attached to them by name.
    const byName = new Map<string, Awaited<ReturnType<typeof importCharacter>>>();

    for (const filePath of await listFiles(path.join(root, 'characters'), EXTENSIONS.character)) {
        const buffer = await readSafely(filePath);
        if (!buffer) {
            errors.push(`${path.basename(filePath)}: too large or unreadable`);
            continue;
        }
        try {
            const character = await importCharacter(path.basename(filePath), buffer);
            byName.set(path.basename(filePath, path.extname(filePath)).toLowerCase(), character);
            byName.set(character.name.toLowerCase(), character);
            byName.set(character.id.toLowerCase(), character);
            imported.characters += 1;
        } catch (error) {
            errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : 'failed'}`);
        }
    }

    for (const folder of await listDirectories(path.join(root, 'chats'))) {
        const folderName = path.basename(folder).toLowerCase();
        const character = byName.get(folderName);

        for (const filePath of await listFiles(folder, EXTENSIONS.chat)) {
            if (!character) {
                skippedChats.push(`${path.basename(folder)}/${path.basename(filePath)}`);
                continue;
            }
            const buffer = await readSafely(filePath);
            if (!buffer) {
                errors.push(`${path.basename(filePath)}: too large or unreadable`);
                continue;
            }
            try {
                await importChatFile(character, path.basename(filePath), buffer.toString('utf8'));
                imported.chats += 1;
            } catch (error) {
                errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : 'failed'}`);
            }
        }
    }

    for (const filePath of await listFiles(path.join(root, 'worlds'), EXTENSIONS.world)) {
        const buffer = await readSafely(filePath);
        if (!buffer) {
            errors.push(`${path.basename(filePath)}: too large or unreadable`);
            continue;
        }
        try {
            const book = JSON.parse(buffer.toString('utf8')) as unknown;
            if (!isRecord(book)) {
                throw new Error('not a JSON object');
            }
            await createWorld({ fileName: path.basename(filePath), book });
            imported.worlds += 1;
        } catch (error) {
            errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : 'failed'}`);
        }
    }

    for (const directory of await findPresetDirectories(root)) {
        for (const filePath of await listFiles(directory, EXTENSIONS.preset)) {
            const buffer = await readSafely(filePath);
            if (!buffer) {
                errors.push(`${path.basename(filePath)}: too large or unreadable`);
                continue;
            }
            try {
                const preset = JSON.parse(buffer.toString('utf8')) as unknown;
                if (!isRecord(preset)) {
                    throw new Error('not a JSON object');
                }
                await createPreset({ fileName: path.basename(filePath), preset });
                imported.presets += 1;
            } catch (error) {
                errors.push(`${path.basename(filePath)}: ${error instanceof Error ? error.message : 'failed'}`);
            }
        }
    }

    return { imported, errors, skippedChats };
}
