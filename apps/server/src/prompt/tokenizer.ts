// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/tokenizers.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Tokenizer } from '@agnai/web-tokenizers';
import type { ProviderKind } from '@catcup/shared';
import { getEncoding, type Tiktoken, type TiktokenEncoding } from 'js-tiktoken';

import { config } from '../config.js';

/**
 * The package's ESM entry is a UMD wrapper whose `default` export is the
 * namespace object, so a plain `import { Tokenizer }` yields undefined. Loading
 * it through `require` uses the CommonJS build, which exports the class
 * correctly in both the server and the test runner.
 */
const require = createRequire(import.meta.url);

const CJK_PATTERN = /[⺀-⻿　-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;

/**
 * Rough token estimate, used when no tokenizer matches the model.
 *
 * CJK characters are roughly 1 token each; Latin text is roughly 3.6
 * characters per token. Deliberately slightly conservative, because
 * over-counting trims a little history while under-counting overruns the
 * context window and the provider rejects the request.
 */
export function estimateTokens(text: string): number {
    let cjk = 0;
    let other = 0;
    for (const char of text) {
        if (CJK_PATTERN.test(char)) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    return Math.ceil(cjk + other / 3.6);
}

/**
 * Characters per token for the Claude estimate.
 *
 * This is only a fallback: it is used when the bundled Claude vocabulary cannot
 * be read, which should only happen if the asset was not shipped.
 */
const ANTHROPIC_CHARS_PER_TOKEN = 3.5;

/** Approximate token count for a Claude model, used when the vocabulary is missing. */
export function estimateAnthropicTokens(text: string): number {
    return Math.ceil(text.length / ANTHROPIC_CHARS_PER_TOKEN);
}

/**
 * SillyTavern's bundled Claude vocabulary.
 *
 * Anthropic ships no tokenizer package, so SillyTavern includes the Claude
 * byte-level BPE vocabulary (65k tokens) and counts with it. Reading it is
 * asynchronous, so the server warms it at startup and every counter stays
 * synchronous; `countTokens` runs once per message in a hot loop.
 */
const CLAUDE_VOCABULARY = path.join(config.repoRoot, 'apps/server/assets/tokenizers/claude.json');

let claudeTokenizer: Tokenizer | null = null;

/** Load the Claude vocabulary. Safe to call more than once. */
export async function warmTokenizers(): Promise<void> {
    if (claudeTokenizer) {
        return;
    }
    try {
        const file = await readFile(CLAUDE_VOCABULARY);
        const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        const { Tokenizer: WebTokenizer } = require('@agnai/web-tokenizers') as { Tokenizer: typeof Tokenizer };
        claudeTokenizer = await WebTokenizer.fromJSON(bytes as ArrayBuffer);
    } catch (error) {
        console.warn(`Could not load the Claude tokenizer at ${CLAUDE_VOCABULARY}.`, error);
    }
}

/**
 * Which tiktoken encoding a model id uses.
 *
 * The order matters: `gpt-4o` must be tested before `gpt-4`, and
 * `text-davinci-003` before `davinci`. Ids are compared after the last `/`, so
 * an OpenRouter id such as `openai/gpt-4o` resolves like `gpt-4o`.
 */
const ENCODING_PATTERNS: Array<{ pattern: RegExp; encoding: TiktokenEncoding }> = [
    { pattern: /^gpt-5/, encoding: 'o200k_base' },
    { pattern: /^gpt-4\.1/, encoding: 'o200k_base' },
    { pattern: /^gpt-4o/, encoding: 'o200k_base' },
    { pattern: /^chatgpt-4o/, encoding: 'o200k_base' },
    { pattern: /^o[134](-|$)/, encoding: 'o200k_base' },
    { pattern: /^gpt-4(-|$)/, encoding: 'cl100k_base' },
    { pattern: /^gpt-3\.5/, encoding: 'cl100k_base' },
    { pattern: /^gpt-35/, encoding: 'cl100k_base' },
    { pattern: /^text-embedding-3/, encoding: 'cl100k_base' },
    { pattern: /^text-embedding-ada/, encoding: 'cl100k_base' },
    { pattern: /^text-davinci-00[23]/, encoding: 'p50k_base' },
    { pattern: /^code-davinci/, encoding: 'p50k_base' },
    { pattern: /^(babbage|davinci)-002/, encoding: 'p50k_base' },
    { pattern: /^text-davinci-001/, encoding: 'r50k_base' },
    { pattern: /^davinci(-|$)/, encoding: 'r50k_base' },
    { pattern: /^gpt2/, encoding: 'r50k_base' },
];

/** Strip a provider namespace so `openai/gpt-4o` resolves like `gpt-4o`. */
function baseModelId(model: string): string {
    const trimmed = model.trim().toLowerCase();
    const slash = trimmed.lastIndexOf('/');
    return slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
}

/** The tiktoken encoding for a model id, or `null` when none applies. */
export function encodingForModel(model: string): TiktokenEncoding | null {
    if (!model.trim()) {
        return null;
    }
    const id = baseModelId(model);
    return ENCODING_PATTERNS.find((entry) => entry.pattern.test(id))?.encoding ?? null;
}

/**
 * What produced a counter's numbers.
 *
 * `tiktoken` and `claude` are real vocabularies; `estimate` is the
 * character-based fallback. The inspector names the one in use so a budget
 * surprise has an explanation.
 */
export type TokenCounterSource = 'tiktoken' | 'claude' | 'estimate';

export interface TokenCounter {
    count(text: string): number;
    source: TokenCounterSource;
    /** The tiktoken encoding name, when one is in use. */
    encoding?: TiktokenEncoding;
    /** What the inspector shows, e.g. `o200k_base` or `estimate (chars/3.6)`. */
    label: string;
}

const encoders = new Map<TiktokenEncoding, Tiktoken>();

/** Encoders hold large rank tables, so one instance per encoding is shared. */
function encoderFor(encoding: TiktokenEncoding): Tiktoken {
    const cached = encoders.get(encoding);
    if (cached) {
        return cached;
    }
    const created = getEncoding(encoding);
    encoders.set(encoding, created);
    return created;
}

export const TIKTOKEN_COUNTER = (encoding: TiktokenEncoding): TokenCounter => {
    const encoder = encoderFor(encoding);
    return {
        count: (text) => (text ? encoder.encode(text).length : 0),
        source: 'tiktoken',
        encoding,
        label: encoding,
    };
};

/**
 * The Claude counter, using the bundled vocabulary when it loaded and the
 * character estimate when it did not.
 */
export function claudeCounter(): TokenCounter {
    const tokenizer = claudeTokenizer;
    if (!tokenizer) {
        return { count: estimateAnthropicTokens, source: 'estimate', label: 'estimate (chars/3.5)' };
    }
    return {
        count: (text) => (text ? tokenizer.encode(text).length : 0),
        source: 'claude',
        label: 'claude',
    };
}

export const ESTIMATE_COUNTER: TokenCounter = {
    count: estimateTokens,
    source: 'estimate',
    label: 'estimate (chars/3.6)',
};

/**
 * Pick a counter for a provider and model.
 *
 * Claude models use the bundled Claude vocabulary. OpenAI and OpenAI-compatible
 * providers use the matching tiktoken encoding when the model id is recognised,
 * which covers GPT and OpenRouter ids. A local model such as `llama3` has its
 * own tokenizer, so it falls back to the estimate rather than pretending either
 * vocabulary is right.
 */
export function createTokenCounter(kind: ProviderKind, model: string): TokenCounter {
    if (kind === 'anthropic') {
        return claudeCounter();
    }

    const encoding = encodingForModel(model);
    return encoding ? TIKTOKEN_COUNTER(encoding) : ESTIMATE_COUNTER;
}
