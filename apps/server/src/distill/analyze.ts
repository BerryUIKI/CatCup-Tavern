import { type DistillAnalysis, distillAnalysisSchema, errorMessage, type ProviderConfig } from '@catcup/shared';

import { getAdapter } from '../providers/index.js';
import { extractJson } from '../providers/reply.js';
import type { PromptMessage } from '../providers/types.js';
import { ANALYSIS_REPAIR_USER_TEMPLATE, ANALYSIS_SAMPLING, analysisMessages, renderPrompt } from './prompts.js';

/**
 * One analysis request over one chunk.
 *
 * The output contract is strict JSON: the pipeline merges many of these, so a
 * reply that is prose with JSON buried in it cannot be merged at all. A model
 * that wraps the object in a code fence is handled, because that is the one
 * formatting habit worth tolerating; anything else gets one repair attempt and
 * then the chunk is reported incomplete rather than failing the run.
 *
 * The prompt text lives in `prompts.ts`, because the exported Claude Skill
 * carries the same strings and must not be able to drift from the runtime.
 */

export interface AnalyzeInput {
    provider: ProviderConfig;
    apiKey: string | undefined;
    model: string;
    text: string;
    /** What this chunk covers, so the model knows where it is in the book. */
    chapter: string;
    signal: AbortSignal;
}

/** How many times one chunk's reply is attempted before it is written off. */
const MAX_ATTEMPTS = ANALYSIS_SAMPLING.attempts;

/** The request ceiling. An analysis reply is a list of names and short facts. */
const MAX_TOKENS = ANALYSIS_SAMPLING.maxTokens;

/** Distillation is extraction, not writing, so the temperature stays low. */
const TEMPERATURE = ANALYSIS_SAMPLING.temperature;

function prompt(text: string, chapter: string): PromptMessage[] {
    return analysisMessages(text, chapter);
}

/** Drain one request into a string. Streams are the only API the adapters offer. */
async function complete(input: AnalyzeInput, messages: PromptMessage[], signal: AbortSignal): Promise<string> {
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
 * Analyse one chunk, retrying once on a reply that is not usable.
 *
 * Returns `null` when both attempts fail. That is deliberately not an error:
 * one unreadable chapter should cost that chapter, not the whole book, and the
 * review sheet names the sections that were skipped.
 */
export async function analyzeChunk(input: AnalyzeInput): Promise<DistillAnalysis | null> {
    let lastProblem = '';
    let messages = prompt(input.text, input.chapter);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        let raw: string;
        try {
            raw = await complete(input, messages, input.signal);
        } catch (error) {
            if (input.signal.aborted) {
                throw error;
            }
            lastProblem = errorMessage(error);
            continue;
        }

        const parsed = distillAnalysisSchema.safeParse(extractJson(raw));
        if (parsed.success) {
            return parsed.data;
        }

        lastProblem = parsed.error.issues[0]?.message ?? 'the reply was not the expected JSON';
        // The second attempt gets the failure named, which is what repairs a
        // model that dropped a required key rather than one that ignored the
        // instruction to answer in JSON at all.
        messages = [
            ...prompt(input.text, input.chapter),
            { role: 'assistant', content: raw.slice(0, 2000) },
            {
                role: 'user',
                content: renderPrompt(ANALYSIS_REPAIR_USER_TEMPLATE, { problem: lastProblem }),
            },
        ];
    }

    console.warn(`[distill] Analysis of "${input.chapter}" was unusable: ${lastProblem}`);
    return null;
}
