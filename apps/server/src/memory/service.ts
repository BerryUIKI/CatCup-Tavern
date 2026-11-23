// Written for CatCup. The summary lifecycle: the per-chat lock, the model call,
// and writing the result back onto the message it covers.

import { createTokenCounter } from '@catcup/compat-st';
import {
    type CharacterDetail,
    type ChatMessage,
    errorMessage,
    type PersonaSettings,
    type SummarizeResponse,
} from '@catcup/shared';
import { badRequest, HttpError } from '../http/errors.js';
import { resolvePreset } from '../prompt/preset.js';
import type { GroupMacroMembers } from '../prompt/worldInfoTurn.js';
import { getAdapter } from '../providers/index.js';
import type { MessagePatch } from '../storage/chats.js';
import { readPresetBody } from '../storage/presets.js';
import { getActiveProvider, getProviderSecret, getSettings } from '../storage/settings.js';
import { buildSummaryRequest, shouldAutoSummarize } from './summary.js';

/**
 * A summary request that takes longer than this is aborted.
 *
 * Not a quality setting: the per-chat lock is held across the model call, so a
 * provider that streams whitespace or keeps the socket open would block every
 * later memory write for that chat indefinitely.
 */
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
 *
 * The chain is built from the *previous* promise, so a task that failed does
 * not poison the queue: the next one still runs. The key is dropped only when
 * it is still this task's promise at the end, so a queued successor's entry is
 * not deleted out from under it.
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
 * Locate the message a summary was computed from, after the chat may have
 * changed while the model was thinking.
 *
 * Matching is by content, author and — when the anchor carries one — send date.
 * A message that was deleted, or whose text or author changed, is not found,
 * and that is the signal to discard the summary: attaching it to whatever now
 * sits at that index would label the wrong message as covered.
 *
 * The send date is optional because messages written by other clients may not
 * have one; falling back to content alone is better than refusing to find the
 * anchor at all.
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
 * Apply a memory change chosen from the chat as it is *inside* the lock.
 *
 * The chooser receives the messages only once the lock is held, which is the
 * point: a manual save or delete that arrived while an automatic summary was
 * in flight then targets the newest summary rather than the index that was
 * correct when the request was made.
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

/**
 * Build and run one summary request.
 *
 * Fresh state is read every time — settings, provider, preset, the chat — so a
 * summary started after the user changed a provider uses the new one. The
 * target holds only what does not change per turn: the chat key, the card and
 * persona whose macros apply.
 *
 * The model is the provider's default, never a character's choice. A summary is
 * not a character speaking, and pinning it to whichever card is selected would
 * make the same chat summarize differently depending on who is talking.
 */
async function runSummary(target: MemoryTarget, signal?: AbortSignal): Promise<SummarizeResponse> {
    const settings = await getSettings();
    const provider = await getActiveProvider();
    if (!provider) {
        throw badRequest('No provider is available. Configure one in Settings first.');
    }
    // Summaries are not a character speaking, so they use the provider default
    // rather than any character's model choice.
    const model = provider.defaultModel;
    if (!model) {
        throw badRequest('The active provider has no model selected');
    }

    const source = await target.read();
    if (!source) {
        throw badRequest('Chat not found');
    }

    const apiKey = await getProviderSecret(provider.id);
    const tokenCounter = createTokenCounter(provider.kind, model);
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

    // Two abort sources, one controller: the timeout above, and the caller's
    // signal. The listener is removed in `finally` so a long-lived signal does
    // not accumulate one per summary.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
    const forwardAbort = () => controller.abort();
    signal?.addEventListener('abort', forwardAbort, { once: true });

    const adapter = getAdapter(provider);
    let text = '';
    try {
        for await (const chunk of adapter.streamChat(provider, apiKey, {
            model,
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
    // anchored message; if it is gone or edited, discard the summary. Reporting
    // the discard as a reason rather than an error is deliberate: nothing went
    // wrong, the summary simply described text that no longer exists.
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
 * Update a chat's summary after a reply, when the schedule says it is due.
 *
 * Runs in the background once the reply has finished streaming, so a slow
 * summary never delays it. Nothing here may reach the chat: a failed summary is
 * a log line, not a visible error, because the user did not ask for it.
 *
 * Two guards, for different reasons:
 *
 * - The in-flight set stops a chat from queueing a second automatic request
 *   behind the first, which would otherwise summarize the same history twice.
 * - Only a reply triggers it. If the newest message is the user's own, the
 *   generation either failed or has not produced anything, and summarizing then
 *   would cover a turn that is not finished.
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
