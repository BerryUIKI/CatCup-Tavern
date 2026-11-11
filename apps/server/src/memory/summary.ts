// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/memory/index.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import {
    type CharacterDetail,
    type ChatMessage,
    type GenerationSettings,
    getLatestSummary,
    type MemorySettings,
    type PersonaSettings,
    substituteMacros,
} from '@catcup/shared';

import { RESERVED_TOKENS } from '../prompt/definitions.js';
import { createMacroContext, type GroupMacroMembers } from '../prompt/worldInfoTurn.js';
import type { PromptMessage } from '../providers/types.js';

/** Per-message allowance for the chat-completion wrappers in a token budget. */
const MESSAGE_OVERHEAD = 4;

/** Allowance for the two messages of a summary request. */
const REQUEST_OVERHEAD = MESSAGE_OVERHEAD * 2;

const WORD_PATTERN = /\S+/g;

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
 * Whether a new reply should trigger an automatic summary.
 *
 * The newest message is never part of a summary request (SillyTavern excludes
 * it so the summary covers settled history), so this also requires at least
 * one earlier message to summarize.
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

/**
 * Build one summary request: the summarize instruction as a system message and
 * the previous summary plus the new transcript as the user message.
 *
 * This mirrors SillyTavern's raw prompt builders rather than its default quiet
 * prompt, so the summary request stays independent of the active preset, world
 * info and regex scripts.
 */
export function buildSummaryRequest(input: SummaryRequestInput): SummaryRequest | null {
    const latest = getLatestSummary(input.messages);
    const maxTokens = input.memory.responseLength > 0 ? input.memory.responseLength : input.generation.maxTokens;
    const macroContext = createMacroContext(input.character, input.persona, input.group, latest?.value);
    const summaryPrompt = substituteMacros(input.memory.prompt, {
        ...macroContext,
        words: input.memory.promptWords,
    });
    if (!summaryPrompt.trim()) {
        return null;
    }

    const fixed = input.countTokens(summaryPrompt) + input.countTokens(latest?.value ?? '') + REQUEST_OVERHEAD;
    const budget = input.generation.contextSize - maxTokens - RESERVED_TOKENS - fixed;
    if (budget <= 0) {
        return null;
    }

    const transcript = buildSummaryTranscript({
        messages: input.messages,
        startIndex: latest ? latest.index + 1 : 0,
        budget,
        countTokens: input.countTokens,
        maxMessages: input.memory.maxMessages,
    });
    if (!transcript) {
        return null;
    }

    const userContent = [latest?.value ?? '', transcript.text].filter(Boolean).join('\n\n');

    return {
        prompt: [
            { role: 'system', content: summaryPrompt },
            { role: 'user', content: userContent },
        ],
        maxTokens,
        lastUsedIndex: transcript.lastUsedIndex,
        transcriptMessages: transcript.messages,
    };
}
