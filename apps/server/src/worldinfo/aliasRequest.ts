import { type AliasReply, aliasReplySchema, errorMessage, type ProviderConfig } from '@catcup/shared';

import { getAdapter } from '../providers/index.js';
import { extractJson } from '../providers/reply.js';
import type { PromptMessage } from '../providers/types.js';
import { ALIAS_REPAIR_USER_TEMPLATE, ALIAS_SAMPLING, aliasMessages } from './aliasPrompts.js';

/**
 * One alias request over one entry.
 *
 * The reply is a list, so a model that answers in prose has produced nothing
 * usable; it gets one repair turn with the failure named and then the row is
 * reported incomplete rather than failing the run. That is deliberate — a
 * hundred-entry book should cost the entries that failed, not the run.
 */

export interface AliasRequestInput {
    provider: ProviderConfig;
    apiKey: string | undefined;
    model: string;
    /** The entry's title, for the prompt's heading. */
    title: string;
    /** The keys the book already carries, so the model does not repeat them. */
    keys: readonly string[];
    /** Any aliases the entry already has, for the same reason. */
    existing: readonly string[];
    content: string;
    signal: AbortSignal;
}

const MAX_ATTEMPTS = ALIAS_SAMPLING.attempts;
const MAX_TOKENS = ALIAS_SAMPLING.maxTokens;
const TEMPERATURE = ALIAS_SAMPLING.temperature;

/** Drain one request into text. The adapters only stream. */
async function complete(input: AliasRequestInput, messages: PromptMessage[], signal: AbortSignal): Promise<string> {
    const adapter = getAdapter(input.provider);
    let text = '';
    for await (const chunk of adapter.streamChat(input.provider, input.apiKey, {
        model: input.model,
        messages,
        temperature: TEMPERATURE,
        topP: 1,
        maxTokens: MAX_TOKENS,
        signal,
    })) {
        if (chunk.type === 'text') {
            text += chunk.text;
        }
    }
    return text;
}

/**
 * The names a reply offers, cleaned and filtered.
 *
 * Three things are dropped. Anything the book already matches on is a repeat of
 * a key and would only produce a duplicate trace line. Anything longer than a
 * key can usefully be is a phrase that will never appear in a chat. And anything
 * case-insensitively equal to something already kept is a repeat.
 *
 * The result is capped, because a model asked for "other names" will sometimes
 * answer with thirty and a scanner given thirty aliases for every entry matches
 * everything in every scene.
 */
export function cleanAliases(
    offered: readonly string[],
    keys: readonly string[],
    existing: readonly string[],
    maxLength: number,
    maxCount: number,
): string[] {
    const taken = new Set([...keys, ...existing].map((value) => value.trim().toLowerCase()));
    const kept: string[] = [];

    for (const raw of offered) {
        const alias = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
        if (!alias || alias.length > maxLength) {
            continue;
        }
        const key = alias.toLowerCase();
        if (taken.has(key)) {
            continue;
        }
        taken.add(key);
        kept.push(alias);
        if (kept.length >= maxCount) {
            break;
        }
    }

    return kept;
}

/**
 * Ask for one entry's aliases, retrying once on a reply that cannot be read.
 *
 * Returns `null` when both attempts fail, which the caller records as an
 * incomplete row. A *request* failure and a *reply* failure are both `null`, but
 * they are not the same thing to a person: "the provider refused the request"
 * and "the model answered with prose" call for different fixes, so the reason is
 * returned alongside.
 */
export async function generateAliases(input: AliasRequestInput): Promise<AliasReply | null> {
    const outcome = await requestAliases(input);
    return outcome.reply;
}

export interface AliasOutcome {
    reply: AliasReply | null;
    /** Why there is no reply, worded for the row. */
    problem?: string;
    /** True when no reply ever arrived, as opposed to a reply that could not be read. */
    unreachable?: boolean;
}

/**
 * The request itself, with the reason kept.
 *
 * A thrown error is retried like an unusable reply, because a provider that
 * returned a 500 once usually answers on the second try. Two failures end the
 * row; the first error's message is what the row reports, since it is almost
 * always the same one twice.
 */
export async function requestAliases(input: AliasRequestInput): Promise<AliasOutcome> {
    let lastProblem = '';
    let unreachable = false;
    let messages = aliasMessages({
        title: input.title,
        keys: input.keys,
        existing: input.existing,
        content: input.content,
    });

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        let raw: string;
        try {
            raw = await complete(input, messages, input.signal);
        } catch (error) {
            if (input.signal.aborted) {
                throw error;
            }
            lastProblem = errorMessage(error) || 'the request failed';
            unreachable = true;
            continue;
        }

        const parsed = aliasReplySchema.safeParse(extractJson(raw));
        if (parsed.success) {
            return { reply: parsed.data };
        }
        unreachable = false;

        lastProblem = parsed.error.issues[0]?.message ?? 'the reply was not the expected JSON';
        // The second attempt is given the failure, which is what repairs a model
        // that dropped the key rather than one that ignored the JSON instruction.
        messages = [
            ...aliasMessages({
                title: input.title,
                keys: input.keys,
                existing: input.existing,
                content: input.content,
            }),
            { role: 'assistant', content: raw.slice(0, 1200) },
            { role: 'user', content: ALIAS_REPAIR_USER_TEMPLATE.replace('{{problem}}', lastProblem) },
        ];
    }

    console.warn(`[aliases] A reply for "${input.title}" was unusable: ${lastProblem}`);
    return { reply: null, problem: lastProblem, unreachable };
}
