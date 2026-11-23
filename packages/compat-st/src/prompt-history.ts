// Written for CatCup. Turning stored chat messages and a card's example
// dialogue into the turns a prompt carries.

import type { ChatMessage } from '@catcup/shared';

export interface HistoryEntry {
    role: 'system' | 'user' | 'assistant';
    content: string;
    /** The stored speaker name; group chats prefix the prompt with it. */
    name?: string;
}

/** The `extra.type` a slash-command narration carries. */
const NARRATOR = 'narrator';

/**
 * Convert stored chat messages into prompt history.
 *
 * Three rules, each of which changes what a model sees:
 *
 * - **System messages are skipped.** They are the app's own bookkeeping — a
 *   branch marker, a prompt note — not part of the conversation being continued.
 * - **Narrator messages become system turns.** A narration written by a slash
 *   command is prose the model should react to, but it is not the character
 *   speaking, so it must not arrive as an assistant turn and be continued.
 * - **Content is not trimmed, only `\r` is stripped.** A whitespace-only
 *   message is a real beat in some chats, and trimming it would silently delete
 *   a turn the user can see.
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

export interface ParseExampleOptions {
    /**
     * Every other group member's name.
     *
     * A line starting with one of these belongs to that character rather than
     * to the persona. It is what makes a joined card's examples parse at all,
     * because the merged `mes_example` text carries every member's `Name:` lines.
     */
    otherNames?: readonly string[];
    /**
     * Prefix each turn with its speaker.
     *
     * Group chats need it so the model can tell three characters' examples
     * apart. A single-character chat does not, and the prefix would only
     * duplicate what the card already says.
     */
    appendNames?: boolean;
}

/**
 * Split a card's `mes_example` into its example conversations.
 *
 * The format is loose, so the rules are conventions rather than a grammar:
 *
 * - Blocks are separated by `<START>`, case-insensitively. Anything before the
 *   first marker is a description of the examples, not dialogue, and is
 *   discarded.
 * - Inside a block, the first line is that block's own description and is
 *   skipped.
 * - A line beginning `Name:` switches the speaker. The persona is recognised by
 *   the caller's user name; any other recognised name is a character, which is
 *   why `otherNames` matters in a group.
 * - Each run of lines between two switches is one turn. The turn's `name` is
 *   the literal `example_user` or `example_assistant` rather than the speaker's
 *   name, because that is what the format says an example turn is called.
 *
 * Returns one array per block, in the order they appear.
 */
export function parseExampleBlocks(
    mesExample: string,
    charName: string,
    userName: string,
    options: ParseExampleOptions = {},
): ExampleMessage[][] {
    if (!mesExample.trim()) {
        return [];
    }

    return mesExample
        .split(/<START>/i)
        .slice(1)
        .map((block) => parseExampleBlock(block, charName, userName, options));
}

/**
 * Turn one `<START>` block into its alternating turns.
 *
 * Two details are easy to lose:
 *
 * - **Longest name first.** `Bram Wyrd:` has to win over `Bram:`, or a
 *   character whose name is a prefix of another's swallows their lines.
 * - **The speaker prefix is removed once, from the start of the turn only.**
 *   Later lines keep whatever prefix they arrived with, because a line that
 *   repeats the name is the author quoting something, not another switch.
 *
 * A turn that is only whitespace is still emitted. Dropping it would change the
 * rhythm of the example, and the model reads the rhythm.
 */
function parseExampleBlock(
    block: string,
    charName: string,
    userName: string,
    options: ParseExampleOptions,
): ExampleMessage[] {
    const lines = block.split('\n');
    const result: ExampleMessage[] = [];
    let current: string[] = [];
    let inUser = false;
    let inBot = false;
    let botName = charName;

    const otherNames = [...(options.otherNames ?? [])]
        .filter((name) => name && name !== charName)
        .sort((a, b) => b.length - a.length);

    const flush = (speaker: string, name: ExampleMessage['name']): void => {
        const joined = current.join('\n').trim();
        const stripped = joined.startsWith(`${speaker}:`) ? joined.slice(speaker.length + 1).trim() : joined;
        result.push({
            role: 'system',
            content: options.appendNames && stripped ? `${speaker}: ${stripped}` : stripped,
            name,
        });
        current = [];
    };

    // Line 0 describes the block; dialogue starts at line 1.
    for (let index = 1; index < lines.length; index += 1) {
        const line = lines[index] ?? '';

        if (line.startsWith(`${userName}:`)) {
            inUser = true;
            if (inBot) {
                flush(botName, 'example_assistant');
            }
            inBot = false;
        } else if (line.startsWith(`${charName}:`) || otherNames.some((name) => line.startsWith(`${name}:`))) {
            botName = line.startsWith(`${charName}:`) ? charName : line.slice(0, line.indexOf(':'));
            inBot = true;
            if (inUser) {
                flush(userName, 'example_user');
            }
            inUser = false;
        }

        current.push(line);
    }

    // Whatever is open when the block ends is a turn; user first, because a
    // block cannot end mid-bot-turn without having started one.
    if (inUser) {
        flush(userName, 'example_user');
    } else if (inBot) {
        flush(botName, 'example_assistant');
    }

    return result;
}
