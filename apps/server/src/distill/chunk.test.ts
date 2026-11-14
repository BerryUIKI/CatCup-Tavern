import { describe, expect, it } from 'vitest';

import { chunkBook, chunkBudget } from './chunk.js';
import type { Section } from './sections.js';

/** One token per word, so a budget is easy to reason about in a test. */
const countWords = (text: string): number => text.split(/\s+/).filter(Boolean).length;

function sections(texts: string[]): Section[] {
    return texts.map((text, index) => ({ index, title: `Chapter ${index + 1}`, text }));
}

/** `n` words, so a section's size is exact. */
function words(n: number): string {
    return Array.from({ length: n }, (_, index) => `word${index}`).join(' ');
}

describe('chunkBudget', () => {
    it('leaves room for the reply and the instructions', () => {
        expect(chunkBudget(30_000)).toBe(30_000 - 4000 - 2000);
    });

    it('never goes below a floor a paragraph and the instructions both fit in', () => {
        expect(chunkBudget(1000)).toBe(1500);
    });
});

describe('chunkBook', () => {
    it('packs whole sections into one chunk while they fit', () => {
        const chunks = chunkBook(sections([words(40), words(40)]), countWords, 100);

        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.sections).toEqual([0, 1]);
        expect(chunks[0]?.label).toBe('Chapter 1, Chapter 2');
    });

    it('starts a new chunk when the next section would not fit', () => {
        const chunks = chunkBook(sections([words(40), words(40), words(40)]), countWords, 100);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]?.sections).toEqual([0, 1]);
        expect(chunks[1]?.sections).toEqual([2]);
    });

    it('splits one oversized section on paragraph boundaries', () => {
        // Five paragraphs of 40 words: two fit a 100-word budget, so the
        // section becomes three requests labelled with their position.
        const section: Section = {
            index: 0,
            title: 'Long',
            text: Array.from({ length: 5 }, () => words(40)).join('\n\n'),
        };
        const chunks = chunkBook([section], countWords, 100);

        expect(chunks.map((chunk) => chunk.label)).toEqual(['Long 1/3', 'Long 2/3', 'Long 3/3']);
    });

    it('repeats the previous paragraph as overlap so a split fact is not cut in half', () => {
        const paragraphs = [words(40), words(40), words(40)];
        const section: Section = { index: 0, title: 'Long', text: paragraphs.join('\n\n') };
        const chunks = chunkBook([section], countWords, 50);

        // The second chunk opens with the first chunk's last paragraph…
        expect(chunks[1]?.overlap).toBe(paragraphs[0]);
        expect(chunks[1]?.text.startsWith(paragraphs[0] ?? '')).toBe(true);
        // …and records it, so the merge can subtract it.
        expect(chunks[0]?.overlap).toBe('');
    });

    it('keeps a single short book in one chunk with no overlap', () => {
        const chunks = chunkBook(sections([words(10)]), countWords, 100);
        expect(chunks).toHaveLength(1);
        expect(chunks[0]?.overlap).toBe('');
    });

    it('numbers chunks consecutively across a split and unsplit section', () => {
        const long: Section = {
            index: 0,
            title: 'Long',
            text: Array.from({ length: 4 }, () => words(40)).join('\n\n'),
        };
        const chunks = chunkBook([long, { index: 1, title: 'Short', text: words(10) }], countWords, 50);

        expect(chunks.map((chunk) => chunk.index)).toEqual(chunks.map((_, index) => index));
    });

    it('returns nothing for a book with no sections', () => {
        expect(chunkBook([], countWords, 100)).toEqual([]);
    });
});
