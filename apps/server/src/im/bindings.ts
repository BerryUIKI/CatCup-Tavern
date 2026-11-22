import path from 'node:path';

import { isRecord } from '@catcup/shared';

import { readJsonFile, writeJsonFile } from '../storage/jsonFile.js';
import { withFileLock } from '../storage/mutex.js';
import { paths, resolveInside } from '../storage/paths.js';

/**
 * Which CatCup chat an IM conversation is talking to.
 *
 * A sidecar beside the profile rather than anything inside the chat file. It is
 * CatCup-only wiring about which phone reaches which story — it means nothing to
 * SillyTavern, and `chat_metadata` already carries `persona_id` and the summary
 * anchors, so putting transport bookkeeping there would make it travel with the
 * story into an export where it would be noise at best and confusing at worst.
 *
 * Keyed by chat id, which is *the IM side's* id — a Telegram chat — and points
 * at the character and chat it drives.
 */

export interface ImBinding {
    /** The CatCup character whose chat this conversation drives. */
    characterId: string;
    /** The chat id inside that character. */
    chatId: string;
    /** The persona the chat uses, snapshotted so a rebind can be undone. */
    boundAt: number;
}

export interface BindingFile {
    version: 1;
    /** Transport kind, so a second platform's bindings cannot collide. */
    transport: string;
    /** IM chat id -> what it drives. */
    bindings: Record<string, ImBinding>;
}

function bindingPath(transport: string): string {
    return resolveInside(paths.root, `im-${transport}.json`);
}

function emptyFile(transport: string): BindingFile {
    return { version: 1, transport, bindings: {} };
}

/** Read one transport's bindings. A corrupt file reads as none, never fatal. */
export async function readBindings(transport = 'telegram'): Promise<Record<string, ImBinding>> {
    const raw = await readJsonFile<unknown>(bindingPath(transport), null);
    if (!isRecord(raw) || !isRecord(raw.bindings)) {
        // A hand-edited or half-written file must not stop a bot from starting;
        // the worst case is that the next message reports "not bound", which is
        // recoverable with one command.
        return {};
    }

    const bindings: Record<string, ImBinding> = {};
    for (const [chatId, value] of Object.entries(raw.bindings)) {
        if (!isRecord(value)) {
            continue;
        }
        if (typeof value.characterId !== 'string' || typeof value.chatId !== 'string') {
            continue;
        }
        bindings[chatId] = {
            characterId: value.characterId,
            chatId: value.chatId,
            boundAt: typeof value.boundAt === 'number' ? value.boundAt : 0,
        };
    }
    return bindings;
}

/** The binding for one IM chat, or `null` when it has none. */
export async function readBinding(imChatId: string, transport = 'telegram'): Promise<ImBinding | null> {
    return (await readBindings(transport))[imChatId] ?? null;
}

/** Point an IM chat at a CatCup chat, replacing whatever it pointed at. */
export async function setBinding(
    imChatId: string,
    binding: Omit<ImBinding, 'boundAt'>,
    transport = 'telegram',
): Promise<ImBinding> {
    const file = bindingPath(transport);
    return withFileLock(file, async () => {
        const bindings = await readBindings(transport);
        const record: ImBinding = { ...binding, boundAt: Date.now() };
        bindings[imChatId] = record;
        await writeJsonFile(file, { version: 1, transport, bindings } satisfies BindingFile);
        return record;
    });
}

/** Forget one IM chat's binding. Returns whether there was one. */
export async function clearBinding(imChatId: string, transport = 'telegram'): Promise<boolean> {
    const file = bindingPath(transport);
    return withFileLock(file, async () => {
        const bindings = await readBindings(transport);
        if (!(imChatId in bindings)) {
            return false;
        }
        delete bindings[imChatId];
        await writeJsonFile(file, { version: 1, transport, bindings } satisfies BindingFile);
        return true;
    });
}

/** Where the binding file lives, for a test or a diagnostic. */
export function bindingFileFor(transport = 'telegram'): string {
    return bindingPath(transport);
}

/** Exported for a test that wants to purge a profile's bindings wholesale. */
export async function clearAllBindings(transport = 'telegram'): Promise<void> {
    const file = bindingPath(transport);
    await withFileLock(file, async () => {
        await writeJsonFile(file, emptyFile(transport));
    });
}

/** The directory a profile's bindings sit in, so a caller can probe it. */
export function bindingDirectory(): string {
    return path.dirname(bindingPath('telegram'));
}
