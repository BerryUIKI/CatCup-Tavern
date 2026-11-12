// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/openai.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import type { ChatMessage } from '@catcup/shared';

export interface HistoryEntry {
    role: 'system' | 'user' | 'assistant';
    content: string;
    /** The stored speaker name; group chats prefix the prompt with it. */
    name?: string;
}

/** SillyTavern's `system_message_types.NARRATOR`. */
const NARRATOR = 'narrator';

/**
 * Convert stored chat messages into prompt history.
 *
 * `is_system` messages are skipped, matching ST's `coreChat` filter. Narrator
 * messages are sent as system turns, and `\r` is stripped. Content is never
 * trimmed: ST keeps whitespace-only messages.
 */
export function toHistoryEntries(messages: readonly ChatMessage[]): HistoryEntry[] {
    const entries: HistoryEntry[] = [];

    for (const message of messages) {
        if (message.is_system) {
            continue;
        }

        const narrator = message.extra?.type === NARRATOR;
        const role: HistoryEntry['role'] = message.is_user ? 'user' : narrator ? 'system' : 'assistant';
        entries.push({
            role,
            content: message.mes.replace(/\r/g, ''),
            ...(message.name ? { name: message.name } : {}),
        });
    }

    return entries;
}

export interface ExampleMessage {
    role: 'system';
    content: string;
    name: 'example_user' | 'example_assistant';
}

/**
 * Split a card's `mes_example` into SillyTavern's example blocks.
 *
 * The text before the first `<START>` is a description and is discarded, the
 * first line of each block is skipped, and each speaker turn becomes one
 * message whose `name` is the literal `example_user` or `example_assistant`,
 * not the speaker's name.
 */
export function parseExampleBlocks(mesExample: string, charName: string, userName: string): ExampleMessage[][] {
    if (!mesExample.trim()) {
        return [];
    }

    return mesExample
        .split(/<START>/i)
        .slice(1)
        .map((block) => parseExampleBlock(block, charName, userName));
}

function parseExampleBlock(block: string, charName: string, userName: string): ExampleMessage[] {
    const lines = block.split('\n');
    const result: ExampleMessage[] = [];
    let current: string[] = [];
    let inUser = false;
    let inBot = false;
    const botName = charName;

    const flush = (speaker: string, name: ExampleMessage['name']): void => {
        const parsed = current.join('\n').replace(`${speaker}:`, '').trim();
        result.push({ role: 'system', content: parsed, name });
        current = [];
    };

    // Line 0 is always the block's description.
    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index] ?? '';

        if (line.startsWith(`${userName}:`)) {
            inUser = true;
            if (inBot) {
                flush(botName, 'example_assistant');
            }
            inBot = false;
        } else if (line.startsWith(`${charName}:`)) {
            inBot = true;
            if (inUser) {
                flush(userName, 'example_user');
            }
            inUser = false;
        }

        current.push(line);
    }

    if (inUser) {
        flush(userName, 'example_user');
    } else if (inBot) {
        flush(botName, 'example_assistant');
    }

    return result;
}
