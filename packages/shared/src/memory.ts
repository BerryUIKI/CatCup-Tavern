// Adapted from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/memory/index.js
// The storage model — one summary per covered message on `extra.memory`, and
// the lookup over it — is the format. The default prompts are CatCup's own
// wording. See docs/REUSE.md.

import type { ChatMessage } from './schemas/chat.js';

/**
 * The default summarize prompt.
 *
 * `{{words}}` is replaced with the configured target length; the other macros
 * expand through the normal macro context.
 */
export const DEFAULT_MEMORY_PROMPT =
    'Summarize the story so far: the facts and events that matter later. If a summary is already in your memory, build on it rather than starting over. Keep it to {{words}} words or fewer, and reply with the summary alone.';

/**
 * The default prompt when summaries are append-only.
 *
 * Every sentence of the rewriting prompt that presumes a rewrite had to go:
 * "build on it rather than starting over" *is* the destructive chain. What
 * remains asks for the passage below only, which is what makes a summary a
 * stable unit rather than a lossy fold of everything before it.
 */
export const DEFAULT_APPEND_ONLY_MEMORY_PROMPT =
    'Summarize the passage below: the facts and events that matter later. Keep it to {{words}} words or fewer, and reply with the summary alone.';

/** The default injection template. */
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
