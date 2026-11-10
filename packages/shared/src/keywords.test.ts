import { describe, expect, it } from 'vitest';

import { formatKeywords, isValidRegex, splitKeywordsAndRegexes } from './keywords.js';

describe('keyword input', () => {
    it('splits on commas and trims each key', () => {
        expect(splitKeywordsAndRegexes(' dragon ,  wyrm ,kingdom')).toEqual(['dragon', 'wyrm', 'kingdom']);
    });

    it('drops empty parts', () => {
        expect(splitKeywordsAndRegexes('dragon,, ,wyrm,')).toEqual(['dragon', 'wyrm']);
    });

    it('keeps commas inside a regex key', () => {
        expect(splitKeywordsAndRegexes('/dragon|wyrm, wyrmling/i, castle')).toEqual([
            '/dragon|wyrm, wyrmling/i',
            'castle',
        ]);
    });

    it('splits a closed slash token that is not a valid regex', () => {
        expect(splitKeywordsAndRegexes('/(/, castle')).toEqual(['/(/', 'castle']);
    });

    it('treats the rest of the input as one key while a regex is unterminated', () => {
        expect(splitKeywordsAndRegexes('/not, a regex')).toEqual(['/not, a regex']);
    });

    it('does not split a regex that starts right after a comma', () => {
        expect(splitKeywordsAndRegexes('dragon,/a,b/i')).toEqual(['dragon', '/a,b/i']);
    });

    it('treats an escaped slash inside a regex as content', () => {
        expect(splitKeywordsAndRegexes('/a\\/b,c/i')).toEqual(['/a\\/b,c/i']);
    });

    it('returns an empty list for blank input', () => {
        expect(splitKeywordsAndRegexes('   ')).toEqual([]);
    });

    it('round-trips through the editor format', () => {
        const keys = ['dragon', '/a,b/i'];
        expect(splitKeywordsAndRegexes(formatKeywords(keys))).toEqual(keys);
    });

    it('validates slash-delimited patterns', () => {
        expect(isValidRegex('/dragon/i')).toBe(true);
        expect(isValidRegex('dragon')).toBe(false);
        expect(isValidRegex('/unclosed')).toBe(false);
        expect(isValidRegex('/(/')).toBe(false);
    });
});
