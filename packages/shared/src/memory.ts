// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/memory/index.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import type { ChatMessage } from './schemas/chat.js';

/**
 * SillyTavern's default summarize prompt, from the Memory extension.
 *
 * `{{words}}` is replaced with the configured target length; the other macros
 * expand through the normal macro context.
 */
export const DEFAULT_MEMORY_PROMPT =
    'Ignore previous instructions. Summarize the most important facts and events in the story so far. If a summary already exists in your memory, use that as a base and expand with new facts. Limit the summary to {{words}} words or less. Your response should include nothing but the summary.';

/**
 * The default prompt when summaries are append-only.
 *
 * Every sentence of the SillyTavern prompt that presumes a rewrite had to go:
 * "use that as a base and expand with new facts" *is* the destructive chain.
 * What remains asks for the new range only, which is what makes a summary a
 * stable unit rather than a lossy fold of everything before it.
 */
export const DEFAULT_APPEND_ONLY_MEMORY_PROMPT =
    'Ignore previous instructions. Summarize the most important facts and events in the passage below. Limit the summary to {{words}} words or less. Your response should include nothing but the summary.';

/** SillyTavern's default injection template. */
export const DEFAULT_MEMORY_TEMPLATE = '[Summary: {{summary}}]';

/** A summary stored on a chat message, as SillyTavern's Memory extension does. */
export interface StoredSummary {
    value: string;
    /** Index of the message whose `extra.memory` holds the summary. */
    index: number;
}

/**
 * Find the latest summary in a chat.
 *
 * SillyTavern walks backwards over the message list and skips the newest
 * message; CatCup looks at every message so a summary that ended up last after
 * a deletion still counts. The stored shape is unchanged.
 */
export function getLatestSummary(messages: readonly ChatMessage[]): StoredSummary | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const memory = messages[index]?.extra?.memory;
        if (typeof memory === 'string' && memory.trim().length > 0) {
            return { value: memory, index };
        }
    }
    return null;
}

/**
 * Every summary in a chat, oldest first.
 *
 * SillyTavern's format already keeps them: each summary is written onto the
 * message whose range it covers, and nothing ever clears an older anchor. Only
 * the *read* path forgets them, because `getLatestSummary` stops at the first
 * hit. Append-only mode turns the chain from a rolling rewrite into a list, and
 * this is the list.
 *
 * A chat that was summarized the default way still yields several entries — one
 * per update — but they are successive rewrites of the same story rather than
 * disjoint ranges, so a caller treating them as append-only history would
 * repeat itself. That is why the setting, not the file, decides.
 */
export function getSummaries(messages: readonly ChatMessage[]): StoredSummary[] {
    const summaries: StoredSummary[] = [];

    for (let index = 0; index < messages.length; index += 1) {
        const memory = messages[index]?.extra?.memory;
        if (typeof memory === 'string' && memory.trim().length > 0) {
            summaries.push({ value: memory, index });
        }
    }

    return summaries;
}
