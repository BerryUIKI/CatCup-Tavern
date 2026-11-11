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

import { badRequest } from '../http/errors.js';
import { resolvePreset } from '../prompt/preset.js';
import { createTokenCounter } from '../prompt/tokenizer.js';
import type { GroupMacroMembers } from '../prompt/worldInfoTurn.js';
import { getAdapter } from '../providers/index.js';
import type { MessagePatch } from '../storage/chats.js';
import { readPresetBody } from '../storage/presets.js';
import { getActiveProvider, getProviderSecret, getSettings } from '../storage/settings.js';
import { buildSummaryRequest, shouldAutoSummarize } from './summary.js';

/** The live chat a summary is written back to. */
export interface MemoryChatSource {
    messages: ChatMessage[];
    update: (index: number, patch: MessagePatch) => Promise<ChatMessage>;
}

/** One chat's memory target, shared by the manual and automatic paths. */
export interface MemoryTarget {
    /** Unique per chat, so automatic summaries cannot overlap on one file. */
    key: string;
    /** The card whose macros apply to the summarize prompt. */
    character: CharacterDetail;
    persona: PersonaSettings;
    group?: GroupMacroMembers;
    read: () => Promise<MemoryChatSource | null>;
}

/**
 * Run one summary for a chat and store it on the last covered message.
 *
 * Manual requests always run; the automatic path checks the schedule first.
 */
export async function summarizeNow(target: MemoryTarget, signal?: AbortSignal): Promise<SummarizeResponse> {
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

    const request = buildSummaryRequest({
        messages: source.messages,
        character: target.character,
        persona: target.persona,
        ...(target.group ? { group: target.group } : {}),
        memory: settings.memory,
        generation: preset.generation,
        countTokens: tokenCounter.count,
    });
    if (!request) {
        return { summary: null, reason: 'No new messages to summarize' };
    }

    const adapter = getAdapter(provider);
    const abort = signal ?? new AbortController().signal;
    let text = '';
    for await (const chunk of adapter.streamChat(provider, apiKey, {
        model: provider.model,
        messages: request.prompt,
        temperature: preset.generation.temperature,
        topP: preset.generation.topP,
        maxTokens: request.maxTokens,
        signal: abort,
    })) {
        if (chunk.type === 'text') {
            text += chunk.text;
        }
    }

    const value = text.trim();
    if (!value) {
        throw new Error('The model returned an empty summary');
    }

    await source.update(request.lastUsedIndex, { extra: { memory: value } });
    return {
        summary: { value, index: request.lastUsedIndex },
        messages: request.transcriptMessages,
    };
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

        await summarizeNow(target);
        console.info(`[memory] Updated the summary for ${target.key}`);
    } catch (error) {
        console.warn(`[memory] Automatic summary failed for ${target.key}: ${errorMessage(error)}`);
    } finally {
        activeAutoSummaries.delete(target.key);
    }
}
