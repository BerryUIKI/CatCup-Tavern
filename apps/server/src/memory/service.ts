// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/memory/index.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import {
    type CharacterDetail,
    type ChatMessage,
    errorMessage,
    type PersonaSettings,
    type SummarizeResponse,
} from '@catcup/shared';

import { badRequest, HttpError } from '../http/errors.js';
import { resolvePreset } from '../prompt/preset.js';
import { createTokenCounter } from '../prompt/tokenizer.js';
import type { GroupMacroMembers } from '../prompt/worldInfoTurn.js';
import { getAdapter } from '../providers/index.js';
import type { MessagePatch } from '../storage/chats.js';
import { readPresetBody } from '../storage/presets.js';
import { getActiveProvider, getProviderSecret, getSettings } from '../storage/settings.js';
import { buildSummaryRequest, shouldAutoSummarize } from './summary.js';

/** A summary request that takes longer than this is aborted. */
const SUMMARY_TIMEOUT_MS = 120_000;

/** The live chat a summary is written back to. */
export interface MemoryChatSource {
    messages: ChatMessage[];
    update: (index: number, patch: MessagePatch) => Promise<ChatMessage>;
}

/** One chat's memory target, shared by the manual and automatic paths. */
export interface MemoryTarget {
    /** Unique per chat, so memory writes on one file never overlap. */
    key: string;
    /** The card whose macros apply to the summarize prompt. */
    character: CharacterDetail;
    persona: PersonaSettings;
    group?: GroupMacroMembers;
    read: () => Promise<MemoryChatSource | null>;
}

/**
 * Serialize memory work per chat.
 *
 * A summary request holds the lock across the model call, so a manual edit or
 * delete issued while an automatic summary is in flight lands afterwards
 * instead of being overwritten by it.
 */
const memoryLocks = new Map<string, Promise<unknown>>();

export async function withMemoryLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = memoryLocks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    memoryLocks.set(key, run);
    try {
        return await run;
    } finally {
        if (memoryLocks.get(key) === run) {
            memoryLocks.delete(key);
        }
    }
}

/**
 * Locate the message a summary was computed from after the chat may have
 * changed. A deleted or edited anchor is not found, which is the signal to
 * discard the stale summary rather than attach it to the wrong message.
 */
export function findMessageIndex(messages: readonly ChatMessage[], anchor: ChatMessage): number {
    return messages.findIndex(
        (message) =>
            message.mes === anchor.mes &&
            message.name === anchor.name &&
            Boolean(message.is_user) === Boolean(anchor.is_user) &&
            (anchor.send_date ? message.send_date === anchor.send_date : true),
    );
}

async function writeAnchor(
    target: MemoryTarget,
    anchor: ChatMessage,
    patch: MessagePatch,
): Promise<{ index: number; message: ChatMessage } | null> {
    const source = await target.read();
    if (!source) {
        return null;
    }
    const index = findMessageIndex(source.messages, anchor);
    if (index === -1) {
        return null;
    }
    return { index, message: await source.update(index, patch) };
}

/**
 * Apply a memory change chosen from the chat as it is under the lock.
 *
 * Evaluating the choice inside the lock means a manual save or delete targets
 * the newest summary even when an automatic summary was in flight when the
 * request arrived, instead of a stale message index.
 */
export async function updateMemoryWith(
    target: MemoryTarget,
    choose: (messages: readonly ChatMessage[]) => { index: number; patch: MessagePatch } | null,
): Promise<{ index: number; message: ChatMessage } | null> {
    return withMemoryLock(target.key, async () => {
        const source = await target.read();
        if (!source) {
            return null;
        }
        const choice = choose(source.messages);
        if (!choice) {
            return null;
        }
        return { index: choice.index, message: await source.update(choice.index, choice.patch) };
    });
}

async function runSummary(target: MemoryTarget, signal?: AbortSignal): Promise<SummarizeResponse> {
    const settings = await getSettings();
    const provider = await getActiveProvider();
    if (!provider) {
        throw badRequest('No provider is available. Configure one in Settings first.');
    }
    if (!provider.model.trim()) {
        throw badRequest('The active provider has no model selected');
    }

    const source = await target.read();
    if (!source) {
        throw badRequest('Chat not found');
    }

    const apiKey = await getProviderSecret(provider.id);
    const tokenCounter = createTokenCounter(provider.kind, provider.model);
    const activePreset = settings.activePresetId ? await readPresetBody(settings.activePresetId) : null;
    const preset = resolvePreset(activePreset, settings.generation);

    const built = buildSummaryRequest({
        messages: source.messages,
        character: target.character,
        persona: target.persona,
        ...(target.group ? { group: target.group } : {}),
        memory: settings.memory,
        generation: preset.generation,
        countTokens: tokenCounter.count,
    });
    if ('reason' in built) {
        return { summary: null, reason: built.reason };
    }
    const request = built.request;
    const anchor = source.messages[request.lastUsedIndex];
    if (!anchor) {
        return { summary: null, reason: 'No new messages to summarize.' };
    }

    // Abort a request that never finishes so the per-chat lock cannot be held
    // forever by a provider that streams whitespace or keeps the socket open.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });

    const adapter = getAdapter(provider);
    let text = '';
    try {
        for await (const chunk of adapter.streamChat(provider, apiKey, {
            model: provider.model,
            messages: request.prompt,
            temperature: preset.generation.temperature,
            topP: preset.generation.topP,
            maxTokens: request.maxTokens,
            signal: controller.signal,
        })) {
            if (chunk.type === 'text') {
                text += chunk.text;
            }
        }
    } catch (error) {
        if (error instanceof HttpError) {
            throw error;
        }
        const message = controller.signal.aborted ? 'The summary request timed out.' : errorMessage(error);
        throw new HttpError(502, message, 'SUMMARY_FAILED');
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forwardAbort);
    }

    const value = text.trim();
    if (!value) {
        throw new HttpError(502, 'The model returned an empty summary', 'SUMMARY_FAILED');
    }

    // The chat may have changed while the model was thinking. Re-locate the
    // anchored message; if it is gone or edited, discard the summary instead
    // of attaching it to a different message.
    const stored = await writeAnchor(target, anchor, { extra: { memory: value } });
    if (!stored) {
        return {
            summary: null,
            reason: 'The chat changed while the summary was being written; the summary was discarded.',
        };
    }

    return {
        summary: { value, index: stored.index },
        messages: request.transcriptMessages,
    };
}

/**
 * Run one summary for a chat and store it on the last covered message.
 *
 * Manual requests always run; the automatic path checks the schedule first.
 */
export async function summarizeNow(target: MemoryTarget, signal?: AbortSignal): Promise<SummarizeResponse> {
    return withMemoryLock(target.key, () => runSummary(target, signal));
}

const activeAutoSummaries = new Set<string>();

/**
 * Update a chat's summary after a reply when the schedule says it is due.
 *
 * Runs in the background after the generation stream has finished, so a slow
 * summary never delays the reply. Errors are logged and never reach the chat.
 */
export async function maybeSummarizeAfterTurn(target: MemoryTarget): Promise<void> {
    if (activeAutoSummaries.has(target.key)) {
        return;
    }
    activeAutoSummaries.add(target.key);

    try {
        const settings = await getSettings();
        const source = await target.read();
        if (!source) {
            return;
        }
        // Only summarize after a reply; a failed generation leaves the user's
        // message on top and should not trigger a request.
        const last = source.messages[source.messages.length - 1];
        if (!last || last.is_user || last.is_system) {
            return;
        }
        if (!shouldAutoSummarize(source.messages, settings.memory)) {
            return;
        }

        const result = await summarizeNow(target);
        if (result.summary) {
            console.info(`[memory] Updated the summary for ${target.key}`);
        } else {
            console.info(`[memory] No summary for ${target.key}: ${result.reason ?? 'nothing to do'}`);
        }
    } catch (error) {
        console.warn(`[memory] Automatic summary failed for ${target.key}: ${errorMessage(error)}`);
    } finally {
        activeAutoSummaries.delete(target.key);
    }
}
