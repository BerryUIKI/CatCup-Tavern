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
