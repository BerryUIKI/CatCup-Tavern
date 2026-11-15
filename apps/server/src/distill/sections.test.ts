import { describe, expect, it } from 'vitest';

import { isHeading, paragraphsOf, splitByHeadings, splitIntoParts, splitMarkdown, splitPlainText } from './sections.js';

describe('chapter headings', () => {
    it('recognises the English forms a novel uses', () => {
        for (const line of ['Chapter 12', 'CHAPTER XII', 'Chapter One', 'Part 2', 'Prologue', 'Epilogue']) {
            expect(isHeading(line), line).toBe(true);
        }
    });

    it('recognises the Chinese forms a novel uses', () => {
        for (const line of ['第一章', '第十二回', '第三卷', '序章', '楔子', '尾声']) {
            expect(isHeading(line), line).toBe(true);
        }
    });

    it('does not treat a sentence or a long line as a heading', () => {
        expect(isHeading('Chapter twelve was the one where everything changed for everyone.')).toBe(false);
        expect(isHeading('The prologue to the argument was long and dull, and he regretted it.')).toBe(false);
        expect(isHeading('')).toBe(false);
        // A heading form embedded in prose is not a heading; only a whole line is.
        expect(isHeading('she read Chapter 4 twice')).toBe(false);
    });
});

describe('splitByHeadings', () => {
    const book = ['The inn was quiet.', '', 'Chapter 1', 'Mira lit the lamp.', '', 'Chapter 2', 'Bram arrived.'].join(
        '\n',
    );

    it('opens a section at each heading and keeps the text before the first one', () => {
        const sections = splitByHeadings(book);
        expect(sections.map((section) => section.title)).toEqual(['Opening', 'Chapter 1', 'Chapter 2']);
        expect(sections[1]?.text).toBe('Mira lit the lamp.');
        expect(sections[0]?.text).toBe('The inn was quiet.');
    });

    it('numbers sections in order', () => {
        expect(splitByHeadings(book).map((section) => section.index)).toEqual([0, 1, 2]);
    });
});

describe('splitIntoParts', () => {
    it('cuts heading-less text into runs of paragraphs', () => {
        const paragraphs = Array.from({ length: 90 }, (_, index) => `Paragraph ${index + 1}.`);
        const sections = splitIntoParts(paragraphs.join('\n\n'), 40);

        expect(sections.map((section) => section.title)).toEqual(['Part 1', 'Part 2', 'Part 3']);
        expect(paragraphsOf(sections[0]?.text ?? '')).toHaveLength(40);
    });

    it('returns nothing for text without paragraphs', () => {
        expect(splitIntoParts('   \n\n  ')).toEqual([]);
    });
});

describe('splitPlainText', () => {
    it('keeps chaptered text chaptered', () => {
        const sections = splitPlainText(['Chapter 1', 'One.', 'Chapter 2', 'Two.'].join('\n'));
        expect(sections.map((section) => section.title)).toEqual(['Chapter 1', 'Chapter 2']);
    });

    it('falls back to parts when there is no heading anywhere', () => {
        const text = Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n');
        const sections = splitPlainText(text);
        expect(sections.length).toBeGreaterThan(1);
        expect(sections[0]?.title).toBe('Part 1');
    });

    it('splits a single untitled opening rather than returning one opaque section', () => {
        const text = Array.from({ length: 80 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n');
        // A file whose only "section" is the untitled opening is a file with no
        // headings, and one section would make a whole novel a single row.
        expect(splitPlainText(text)[0]?.title).toBe('Part 1');
    });
});

describe('splitMarkdown', () => {
    it('sections at the repeated chapter level and leaves deeper levels inside', () => {
        const md = ['# Chapter 1', 'text', '## A scene', 'scene text', '# Chapter 2', 'more'].join('\n');
        const sections = splitMarkdown(md);

        expect(sections.map((section) => section.title)).toEqual(['Chapter 1', 'Chapter 2']);
        // The scene heading is body text, not a section of its own.
        expect(sections[0]?.text).toContain('A scene');
        expect(sections[0]?.text).toContain('scene text');
    });

    it('sections at the chapters under a book title', () => {
        const md = ['# My Novel', 'by someone', '## Chapter 1', 'one', '## Chapter 2', 'two'].join('\n');
        const sections = splitMarkdown(md);

        expect(sections.map((section) => section.title)).toEqual(['Opening', 'Chapter 1', 'Chapter 2']);
        // The book's own title heads the front matter rather than being dropped.
        expect(sections[0]?.text).toBe('My Novel\nby someone');
    });

    it('sections the body when the file is one heading over a whole novel', () => {
        const body = Array.from({ length: 60 }, (_, index) => `Paragraph ${index + 1}.`).join('\n\n');
        const sections = splitMarkdown(`# My Novel\n\n${body}`);

        expect(sections.length).toBeGreaterThan(1);
        // The title is kept so the first entry of a sections run still names the book.
        expect(sections[0]?.title).toBe('My Novel');
        expect(sections[1]?.title).toBe('My Novel (2)');
    });
});
