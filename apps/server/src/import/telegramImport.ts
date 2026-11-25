import type { CharacterDetail, ChatDetail, ChatFile } from '@catcup/shared';

import { serializeChat } from '../storage/chats.js';
import { buildChatMessages, type ScanResult, scanTelegramExport } from './telegram.js';

/**
 * Writing a scanned Telegram export as a CatCup chat.
 *
 * The importer owns the mapping and the file shape; the storage layer owns the
 * path, the name collision and the atomic write. Keeping it that way means an
 * imported chat is indistinguishable from one the app created, which is what
 * makes it export to SillyTavern and distil like any other.
 */

export class TelegramImportError extends Error {
    constructor(
        message: string,
        public readonly code: string,
    ) {
        super(message);
        this.name = 'TelegramImportError';
    }
}

/** The header an imported chat carries, matching what the app writes. */
function headerFor(character: CharacterDetail, owner: string): ChatFile['header'] {
    return {
        chat_metadata: {},
        user_name: owner,
        character_name: character.name,
    };
}

/**
 * Build the chat file an import produces, or throw with a reason a person can
 * act on.
 *
 * Every failure here is one the confirmation screen should have prevented, so
 * each carries a code the route turns into a `400` with a specific message
 * rather than a generic "import failed".
 */
export function buildChatFile(character: CharacterDetail, scan: ScanResult, owner: string): ChatFile {
    if (scan.messages.length === 0) {
        throw new TelegramImportError('This export holds no messages to import.', 'TELEGRAM_EMPTY');
    }

    const names = new Set(scan.messages.map((message) => message.from));
    if (!names.has(owner)) {
        throw new TelegramImportError(
            `"${owner}" never speaks in this export. Pick someone who does.`,
            'TELEGRAM_UNKNOWN_OWNER',
        );
    }

    const messages = buildChatMessages(scan, owner, { characterName: character.name });
    if (!messages) {
        // `buildChatMessages` refuses a group rather than collapsing every other
        // participant into the character's name, which would rewrite the story.
        throw new TelegramImportError(
            'This export has more than one other speaker, which looks like a group chat. Group exports are not supported yet.',
            'TELEGRAM_GROUP',
        );
    }

    return { header: headerFor(character, owner), messages };
}

/** Read an export's bytes and scan it. The message count is what a UI shows. */
export function scanExport(raw: string): ScanResult {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new TelegramImportError(
            'That file is not valid JSON. Export the chat again with Telegram Desktop and choose the JSON format.',
            'TELEGRAM_FORMAT',
        );
    }
    return scanTelegramExport(parsed);
}

/**
 * Write a scanned export as a new chat on one character.
 *
 * The chat id comes from the export's title, with a numeric suffix when taken,
 * so importing the same file twice adds a copy rather than overwriting — the
 * same rule the SillyTavern folder import follows.
 */
export async function importTelegramChat(
    character: CharacterDetail,
    scan: ScanResult,
    owner: string,
    importChat: (character: CharacterDetail, fileName: string, content: string) => Promise<ChatDetail>,
): Promise<ChatDetail> {
    const chat = buildChatFile(character, scan, owner);
    const base = (scan.title ?? `${character.name} (Telegram)`).trim() || 'Telegram chat';
    return importChat(character, `${base}.jsonl`, serializeChat(chat));
}
