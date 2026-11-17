import { describe, expect, it } from 'vitest';

import { hasCjk, tokenize, tokenizeQuery } from './tokenize.js';

describe('tokenize', () => {
    it('lowercases and splits English on word boundaries', () => {
        expect(tokenize('The Northern Keep')).toEqual(['northern', 'keep']);
    });

    it('drops stopwords from the index side', () => {
        expect(tokenize('The keep and the tower')).toEqual(['keep', 'tower']);
    });

    it('keeps stopwords on the query side', () => {
        // A query is short and every term is a deliberate signal, so nothing is
        // filtered. The trade-off is documented on `tokenizeQuery`.
        expect(tokenizeQuery('the keep')).toContain('the');
        expect(tokenizeQuery('the keep')).toContain('keep');
    });

    it('strips punctuation', () => {
        expect(tokenize('Keep, tower; gate!')).toEqual(['keep', 'tower', 'gate']);
    });

    it('segments Chinese into words', () => {
        const terms = tokenize('北方要塞驻扎着边防军', { cjkBigrams: false });

        expect(terms).toContain('北方');
        expect(terms).toContain('要塞');
    });

    it('adds character bigrams for Chinese words', () => {
        const terms = tokenize('要塞', { cjkBigrams: true });

        expect(terms).toContain('要塞');
    });

    it('bridges a compound the segmenter splits', () => {
        // The segmenter reads 查理 + 曼, so 里曼 and 曼骑 exist only because
        // bigrams are computed over the source run rather than per word. Those
        // two terms are what let a query spelled as one compound still match.
        const terms = tokenize('查理曼骑士团');

        expect(terms).toContain('理曼');
        expect(terms).toContain('曼骑');
    });

    it('keeps Japanese text', () => {
        expect(tokenize('北の砦', { cjkBigrams: false }).length).toBeGreaterThan(0);
    });

    it('handles mixed English and Chinese in one string', () => {
        const terms = tokenize('Mira 守卫着北方要塞 at dusk');

        expect(terms).toContain('mira');
        expect(terms).toContain('北方');
        expect(terms).toContain('dusk');
    });

    it('returns nothing for empty or whitespace input', () => {
        expect(tokenize('')).toEqual([]);
        expect(tokenize('   \n\t ')).toEqual([]);
    });

    it('returns nothing for pure punctuation', () => {
        expect(tokenize('!!! ... ???')).toEqual([]);
    });

    it('can keep stopwords', () => {
        expect(tokenize('the keep', { stopwords: false })).toContain('the');
    });

    it('can disable bigrams', () => {
        const withBigrams = tokenize('查理曼骑士团');
        const without = tokenize('查理曼骑士团', { cjkBigrams: false });

        expect(without.length).toBeLessThan(withBigrams.length);
    });

    it('does not emit bigrams for single CJK characters', () => {
        expect(tokenize('北', { cjkBigrams: true })).toEqual(['北']);
    });

    it('is idempotent on the same input', () => {
        const text = 'The Northern Keep 北方要塞 garrison';

        expect(tokenize(text)).toEqual(tokenize(text));
    });

    it('never returns an empty-string term', () => {
        expect(tokenize('a b c . , !').every((term) => term.length > 0)).toBe(true);
    });
});

describe('hasCjk', () => {
    it('detects Chinese', () => {
        expect(hasCjk('北方要塞')).toBe(true);
    });

    it('detects Japanese and Korean', () => {
        expect(hasCjk('砦')).toBe(true);
        expect(hasCjk('요새')).toBe(true);
    });

    it('rejects Latin-only text', () => {
        expect(hasCjk('northern keep')).toBe(false);
    });
});
