// Written for CatCup. Where a chat's rolling summaries are stored, how they are
// found again, and the wording a summary request starts from.

import type { ChatMessage } from './schemas/chat.js';

/**
 * Summary memory, as the chat file carries it.
 *
 * A summary lives on the message whose range it covers, as `extra.memory` —
 * that is the format, recorded in `docs/DATA-FORMATS.md`, and it is why a chat
 * copied elsewhere keeps its summaries and why deleting the newest one brings
 * an older summary back into effect. Nothing here writes anything: this file is
 * the read side plus the default wording.
 *
 * The two prompts below are CatCup's own. They are what a summary request uses
 * when the settings carry no prompt, so a profile that never opened the memory
 * settings still gets a result — and a profile that wrote its own is never
 * overridden.
 */

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

/** A summary stored on a chat message's `extra.memory`. */
export interface StoredSummary {
    value: string;
    /** Index of the message whose `extra.memory` holds the summary. */
    index: number;
}

/**
 * Find the latest summary in a chat.
 *
 * Every message is considered, including the newest. Skipping the last one
 * would look right for a summary the app just wrote and be wrong after a
 * deletion or a branch, where the newest message is the one carrying it — the
 * summary would silently stop applying.
 *
 * An empty or whitespace-only value does not count: a cleared summary is
 * stored as an empty string rather than removed, and treating it as a summary
 * would inject an empty bracket into the prompt.
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
 * The format already keeps them all — each summary is written onto the message
 * whose range it covers, and nothing clears an older anchor — so only the
 * *read* path ever forgot them, by stopping at the first hit.
 *
 * A chat summarized the rewrite way still yields several entries, one per
 * update, but they are successive rewrites of the same story rather than
 * disjoint ranges: reading them as append-only history would repeat the story.
 * That is why the setting, not the file, decides which reading applies.
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
