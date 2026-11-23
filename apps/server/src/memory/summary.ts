// Written for CatCup. When a summary is due, which messages it covers, and the
// request that produces it. The stored shape — one summary per covered message
// on `extra.memory` — is the chat format and does not change here.

import { RESERVED_TOKENS } from '@catcup/compat-st';
import {
    type CharacterDetail,
    type ChatMessage,
    DEFAULT_APPEND_ONLY_MEMORY_PROMPT,
    DEFAULT_MEMORY_PROMPT,
    type GenerationSettings,
    getLatestSummary,
    type MemorySettings,
    type PersonaSettings,
    substituteMacros,
} from '@catcup/shared';
import { createMacroContext, type GroupMacroMembers } from '../prompt/worldInfoTurn.js';
import type { PromptMessage } from '../providers/types.js';

/** Per-message allowance for the chat-completion wrappers in a token budget. */
const MESSAGE_OVERHEAD = 4;

/** Allowance for the two messages of a summary request. */
const REQUEST_OVERHEAD = MESSAGE_OVERHEAD * 2;

const WORD_PATTERN = /\b\w+\b/g;

/**
 * Count words as runs of word characters.
 *
 * This is the unit `promptForceWords` is expressed in, so it has to stay
 * stable: a change here silently moves the threshold for every chat that has
 * auto-summary on.
 */
export function countWords(text: string): number {
    return (text.match(WORD_PATTERN) ?? []).length;
}

export interface SummaryProgress {
    /** Messages after the latest summary. */
    messages: number;
    /** Words in those messages. */
    words: number;
    /** Index of the latest summary, or null. */
    latestIndex: number | null;
}

/** How much conversation has accumulated since the latest summary. */
export function summaryProgress(messages: readonly ChatMessage[]): SummaryProgress {
    const latest = getLatestSummary(messages);
    const start = latest ? latest.index + 1 : 0;
    let count = 0;
    let words = 0;

    for (let index = start; index < messages.length; index += 1) {
        const message = messages[index];
        if (!message) {
            continue;
        }
        count += 1;
        words += countWords(message.mes);
    }

    return { messages: count, words, latestIndex: latest?.index ?? null };
}

/**
 * Whether a reply should trigger an automatic summary.
 *
 * Four conditions, and each one exists to stop a specific failure:
 *
 * - The feature is off, or both triggers are disabled — nothing to do.
 * - Fewer than two messages — there is no settled history yet. A summary always
 *   covers history *before* the newest message, so one message cannot be
 *   summarized without the summary describing the reply it just answered.
 * - Nothing since the last summary — every system message is skipped and an
 *   empty message carries nothing, so re-summarizing would ask the model to
 *   summarize silence and pay for the answer.
 *
 * Either trigger firing is enough: the interval counts every new message, and
 * the word threshold counts only their words.
 */
export function shouldAutoSummarize(
    messages: readonly ChatMessage[],
    settings: Pick<MemorySettings, 'enabled' | 'promptInterval' | 'promptForceWords'>,
): boolean {
    if (!settings.enabled) {
        return false;
    }
    if (settings.promptInterval <= 0 && settings.promptForceWords <= 0) {
        return false;
    }
    if (messages.length < 2) {
        return false;
    }

    const progress = summaryProgress(messages);
    const start = progress.latestIndex === null ? 0 : progress.latestIndex + 1;
    const hasCandidate = messages
        .slice(start, messages.length - 1)
        .some((message) => !message.is_system && message.mes.trim().length > 0);
    if (!hasCandidate) {
        return false;
    }

    if (settings.promptInterval > 0 && progress.messages >= settings.promptInterval) {
        return true;
    }
    if (settings.promptForceWords > 0 && progress.words >= settings.promptForceWords) {
        return true;
    }
    return false;
}

export interface SummaryTranscriptInput {
    messages: readonly ChatMessage[];
    /** First message to consider; the latest summary's index plus one. */
    startIndex: number;
    /** Token budget for the transcript text alone. */
    budget: number;
    countTokens: (text: string) => number;
    /** Cap on messages; `0` means the budget alone decides. */
    maxMessages?: number;
}

export interface SummaryTranscript {
    text: string;
    /** Index of the last message included. */
    lastUsedIndex: number;
    messages: number;
}

/**
 * Build the transcript a summary request summarizes.
 *
 * Follows SillyTavern's raw prompt builder: messages after the latest summary,
 * oldest first, `Name:\nmessage` blocks joined by blank lines, the newest
 * message excluded, and the oldest messages kept when the budget overflows so
 * the next summary can continue from where this one stopped.
 */
export function buildSummaryTranscript(input: SummaryTranscriptInput): SummaryTranscript | null {
    const entries: Array<{ index: number; text: string }> = [];
    const stop = input.messages.length - 1;

    for (let index = input.startIndex; index < stop; index += 1) {
        const message = input.messages[index];
        if (!message || message.is_system || !message.mes.trim()) {
            continue;
        }

        const name = message.name.trim() || (message.is_user ? 'User' : 'Character');
        const text = `${name}:\n${message.mes}`;
        const candidate = [...entries.map((entry) => entry.text), text].join('\n\n');
        if (input.countTokens(candidate) > input.budget) {
            break;
        }

        entries.push({ index, text });
        if ((input.maxMessages ?? 0) > 0 && entries.length >= (input.maxMessages ?? 0)) {
            break;
        }
    }

    const last = entries[entries.length - 1];
    if (!last) {
        return null;
    }

    return {
        text: entries.map((entry) => entry.text).join('\n\n'),
        lastUsedIndex: last.index,
        messages: entries.length,
    };
}

export interface SummaryRequestInput {
    messages: readonly ChatMessage[];
    character: CharacterDetail;
    persona: PersonaSettings;
    group?: GroupMacroMembers;
    memory: MemorySettings;
    generation: GenerationSettings;
    countTokens: (text: string) => number;
}

export interface SummaryRequest {
    prompt: PromptMessage[];
    maxTokens: number;
    /** Message that will carry `extra.memory` once the summary is stored. */
    lastUsedIndex: number;
    transcriptMessages: number;
}

/** Either a ready request or the reason none could be built. */
export type SummaryRequestResult = { request: SummaryRequest } | { reason: string };

/**
 * Build one summary request: the instruction as a system message, and the
 * carried summary plus the new transcript as the user message.
 *
 * The request is built here rather than through the prompt assembler on
 * purpose. A summary must not be shaped by the active preset, the world info
 * scan or the regex scripts: it is a maintenance call about the chat, and
 * letting a jailbreak prompt or a lorebook entry into it would make the
 * summary depend on scene state it is supposed to stand outside of.
 */
export function buildSummaryRequest(input: SummaryRequestInput): SummaryRequestResult {
    const latest = getLatestSummary(input.messages);
    const maxTokens = input.memory.responseLength > 0 ? input.memory.responseLength : input.generation.maxTokens;

    /**
     * In append-only mode the previous summary is deliberately withheld.
     *
     * Handing it back is what makes the default chain destructive: the model is
     * asked to fold an unbounded history into a fixed word budget, so whatever
     * does not fit is gone for good. Withholding it asks for the new range
     * alone, which is also what makes the result a stable unit an index could
     * later consume.
     *
     * The transcript still starts after the latest summary, so nothing is
     * summarized twice — only the previous summary's *text* stops being an
     * input.
     */
    const carried = input.memory.appendOnly ? '' : (latest?.value ?? '');

    /**
     * The stock prompt tells the model to "use that as a base and expand",
     * which is incoherent when nothing is carried. A prompt still holding that
     * instruction is swapped for the append-only default rather than sent as
     * an instruction about text the model was not given; a prompt the person
     * wrote themselves is sent as written, since it is theirs to shape.
     */
    const prompt =
        input.memory.appendOnly && input.memory.prompt === DEFAULT_MEMORY_PROMPT
            ? DEFAULT_APPEND_ONLY_MEMORY_PROMPT
            : input.memory.prompt;

    const macroContext = createMacroContext(input.character, input.persona, input.group, latest?.value);
    const summaryPrompt = substituteMacros(prompt, {
        ...macroContext,
        words: input.memory.promptWords,
    });
    if (!summaryPrompt.trim()) {
        return { reason: 'The summary prompt is empty.' };
    }

    const fixed = input.countTokens(summaryPrompt) + input.countTokens(carried) + REQUEST_OVERHEAD;
    const budget = input.generation.contextSize - maxTokens - RESERVED_TOKENS - fixed;
    if (budget <= 0) {
        return { reason: 'The context budget leaves no room for a summary request.' };
    }

    const transcript = buildSummaryTranscript({
        messages: input.messages,
        startIndex: latest ? latest.index + 1 : 0,
        budget,
        countTokens: input.countTokens,
        maxMessages: input.memory.maxMessages,
    });
    if (!transcript) {
        return { reason: 'No new messages to summarize.' };
    }

    const userContent = [carried, transcript.text].filter(Boolean).join('\n\n');

    return {
        request: {
            prompt: [
                { role: 'system', content: summaryPrompt },
                { role: 'user', content: userContent },
            ],
            maxTokens,
            lastUsedIndex: transcript.lastUsedIndex,
            transcriptMessages: transcript.messages,
        },
    };
}
