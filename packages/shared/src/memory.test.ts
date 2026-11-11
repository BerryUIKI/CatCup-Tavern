import { describe, expect, it } from 'vitest';

import { getLatestSummary } from './memory.js';

describe('getLatestSummary', () => {
    it('returns null for an empty chat', () => {
        expect(getLatestSummary([])).toBeNull();
    });

    it('returns the newest summary with its message index', () => {
        const messages = [
            { name: 'A', is_user: false, mes: 'first' },
            { name: 'You', is_user: true, mes: 'hello', extra: { memory: 'old summary' } },
            { name: 'A', is_user: false, mes: 'reply' },
            { name: 'You', is_user: true, mes: 'again', extra: { memory: 'new summary' } },
            { name: 'A', is_user: false, mes: 'latest' },
        ];
        expect(getLatestSummary(messages)).toEqual({ value: 'new summary', index: 3 });
    });

    it('ignores empty or non-string memory values', () => {
        const messages = [
            { name: 'A', is_user: false, mes: 'hi', extra: { memory: 'real' } },
            { name: 'B', is_user: false, mes: 'hi', extra: { memory: '   ' } },
            { name: 'C', is_user: false, mes: 'hi', extra: { memory: 42 } },
        ];
        expect(getLatestSummary(messages)).toEqual({ value: 'real', index: 0 });
    });

    it('finds a summary that ended up on the last message', () => {
        const messages = [
            { name: 'A', is_user: false, mes: 'hi' },
            { name: 'B', is_user: false, mes: 'there', extra: { memory: 'summary' } },
        ];
        expect(getLatestSummary(messages)).toEqual({ value: 'summary', index: 1 });
    });
});
