import { beforeAll, describe, expect, it } from 'vitest';

import {
    createTokenCounter,
    ESTIMATE_COUNTER,
    encodingForModel,
    estimateAnthropicTokens,
    estimateTokens,
    warmTokenizers,
} from './tokenizer.js';

beforeAll(async () => {
    await warmTokenizers();
});

describe('tokenizer selection', () => {
    it('maps OpenAI model families to their tiktoken encoding', () => {
        expect(encodingForModel('gpt-4o')).toBe('o200k_base');
        expect(encodingForModel('gpt-4o-mini')).toBe('o200k_base');
        expect(encodingForModel('gpt-4.1')).toBe('o200k_base');
        expect(encodingForModel('gpt-5')).toBe('o200k_base');
        expect(encodingForModel('o3-mini')).toBe('o200k_base');
        expect(encodingForModel('gpt-4-turbo')).toBe('cl100k_base');
        expect(encodingForModel('gpt-3.5-turbo')).toBe('cl100k_base');
        expect(encodingForModel('text-davinci-003')).toBe('p50k_base');
        expect(encodingForModel('davinci-002')).toBe('p50k_base');
        expect(encodingForModel('davinci')).toBe('r50k_base');
    });

    it('prefers the more specific pattern', () => {
        // `gpt-4o` must not fall through to the `gpt-4` rule.
        expect(encodingForModel('gpt-4o')).not.toBe('cl100k_base');
        expect(encodingForModel('davinci-002')).not.toBe('r50k_base');
    });

    it('strips a provider namespace', () => {
        expect(encodingForModel('openai/gpt-4o')).toBe('o200k_base');
        expect(encodingForModel('GPT-4O')).toBe('o200k_base');
    });

    it('returns null for models without a tiktoken encoding', () => {
        expect(encodingForModel('llama3.1')).toBeNull();
        expect(encodingForModel('deepseek-chat')).toBeNull();
        expect(encodingForModel('claude-sonnet-5-5')).toBeNull();
        expect(encodingForModel('')).toBeNull();
    });

    it('counts Claude with the bundled vocabulary', () => {
        const counter = createTokenCounter('anthropic', 'claude-sonnet-5-5');

        expect(counter.source).toBe('claude');
        expect(counter.count('hello world')).toBe(2);
        expect(counter.count('')).toBe(0);
        // A real BPE splits CJK more finely than one token per character.
        expect(counter.count('你好世界')).toBe(5);
    });

    it('gives OpenAI-compatible providers the matching encoding', () => {
        expect(createTokenCounter('openai', 'gpt-4o').source).toBe('tiktoken');
        expect(createTokenCounter('openrouter', 'openai/gpt-4o').encoding).toBe('o200k_base');
        expect(createTokenCounter('custom', 'gpt-3.5-turbo').encoding).toBe('cl100k_base');
    });

    it('falls back to the estimate for models it does not know', () => {
        expect(createTokenCounter('ollama', 'llama3.1').source).toBe('estimate');
        expect(createTokenCounter('custom', 'deepseek-chat').source).toBe('estimate');
    });

    it('counts with the real encoding, not characters', () => {
        const counter = createTokenCounter('openai', 'gpt-4o');

        // Two words are two tokens; the character estimate rounds 11 chars up
        // to four, which is why the exact counter is worth the dependency.
        expect(counter.count('hello world')).toBe(2);
        expect(counter.count('')).toBe(0);
        expect(estimateTokens('hello world')).toBe(4);
    });

    it('handles long text without overflowing', () => {
        const counter = createTokenCounter('openai', 'gpt-4o');
        const text = 'The quick brown fox jumps over the lazy dog. '.repeat(500);

        const tokens = counter.count(text);
        expect(tokens).toBeGreaterThan(4900);
        expect(tokens).toBeLessThan(5100);
    });
});

describe('estimators', () => {
    it('counts CJK characters as roughly one token each', () => {
        expect(estimateTokens('你好世界')).toBe(4);
        expect(estimateTokens('hello world')).toBe(4);
    });

    it('approximates Claude tokens from characters when the vocabulary is unavailable', () => {
        expect(estimateAnthropicTokens('')).toBe(0);
        expect(estimateAnthropicTokens('1234567')).toBe(2);
        expect(ESTIMATE_COUNTER.count('hello world')).toBe(4);
    });
});
