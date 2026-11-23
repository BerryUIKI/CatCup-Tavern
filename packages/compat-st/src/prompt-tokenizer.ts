// Written for CatCup. Counting tokens for a model, with an estimate when no
// real vocabulary applies.

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { Tokenizer } from '@agnai/web-tokenizers';
import type { ProviderKind } from '@catcup/shared';
import { getEncoding, type Tiktoken, type TiktokenEncoding } from 'js-tiktoken';

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
 * The bundled Claude vocabulary.
 *
 * Anthropic ships no tokenizer package, so a 65k-token byte-level BPE
 * vocabulary is bundled and counting uses it. Reading a 1.7 MB file is
 * asynchronous while counting is not — `countTokens` runs once per message in a
 * hot loop — so the server warms this at startup and every counter stays
 * synchronous afterwards.
 */
let claudeTokenizer: Tokenizer | null = null;

/**
 * Load the Claude vocabulary. Safe to call more than once.
 *
 * The path is supplied by the app rather than computed here: the assets folder
 * belongs to the server, and a package that guessed at it would break the first
 * time the layout moved. A caller that does not pass one gets the estimate,
 * which is already the fallback when the vocabulary is missing.
 */
export async function warmTokenizers(vocabularyPath?: string): Promise<void> {
    if (claudeTokenizer || !vocabularyPath) {
        return;
    }
    const vocabulary = vocabularyPath;
    try {
        const file = await readFile(vocabulary);
        const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
        const { Tokenizer: WebTokenizer } = require('@agnai/web-tokenizers') as { Tokenizer: typeof Tokenizer };
        claudeTokenizer = await WebTokenizer.fromJSON(bytes as ArrayBuffer);
    } catch (error) {
        console.warn(`Could not load the Claude tokenizer at ${vocabulary}.`, error);
    }
}

/**
 * Which tiktoken encoding a model id uses.
 *
 * **Order is the whole correctness of this table.** The list is scanned top to
 * bottom and the first match wins, so a more specific prefix must come before a
 * more general one: `gpt-4o` before `gpt-4`, `text-davinci-003` before
 * `davinci`, `o1`/`o3`/`o4` before the `gpt-4` family. Re-sorting the table
 * alphabetically would silently give several models the wrong vocabulary, and
 * the only symptom would be a token count that is slightly off.
 *
 * Ids are compared after the last `/`, so an OpenRouter id such as
 * `openai/gpt-4o` resolves like `gpt-4o`.
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
 * Anthropic providers always use the Claude vocabulary, whatever the model id
 * says — the provider is the authority on which tokenizer it counts with.
 *
 * Everything else uses the tiktoken encoding the id resolves to, which covers
 * OpenAI ids and OpenRouter ids that carry an OpenAI model name. An id that
 * resolves to nothing — a local `llama3`, a DeepSeek model, anything new —
 * falls back to the labelled estimate rather than borrowing an OpenAI
 * vocabulary. A confidently wrong exact count is worse than a count that says
 * it is an estimate.
 */
export function createTokenCounter(kind: ProviderKind, model: string): TokenCounter {
    if (kind === 'anthropic') {
        return claudeCounter();
    }

    const encoding = encodingForModel(model);
    return encoding ? TIKTOKEN_COUNTER(encoding) : ESTIMATE_COUNTER;
}
