import { describe, expect, it } from 'vitest';

import { prepareSpeechText, splitSpeechText } from './tts.js';

describe('prepareSpeechText', () => {
    it('collapses whitespace and keeps plain prose', () => {
        expect(prepareSpeechText('  Hello   there.\n\nHow are you?  ')).toBe('Hello there. How are you?');
    });

    it('removes fenced code blocks', () => {
        expect(prepareSpeechText('Before\n```js\nconst x = 1;\n```\nAfter')).toBe('Before After');
        expect(prepareSpeechText('Before ~~~\ncode\n~~~ After')).toBe('Before After');
    });

    it('removes tags but keeps their text, and drops script bodies', () => {
        expect(prepareSpeechText('<b>Bold</b> text<script>alert(1)</script>')).toBe('Bold text');
        expect(prepareSpeechText('A <em>quiet</em> room.')).toBe('A quiet room.');
    });

    it('keeps literal angle brackets that are not known markup', () => {
        expect(prepareSpeechText('The sign read <danger> ahead.')).toBe('The sign read <danger> ahead.');
        expect(prepareSpeechText('x<y>z')).toBe('x<y>z');
    });

    it('drops images and keeps link labels', () => {
        expect(prepareSpeechText('Look ![alt](image.png) at [the door](https://example.com).')).toBe(
            'Look at the door.',
        );
    });

    it('strips markdown emphasis and structural markers', () => {
        expect(prepareSpeechText('# Heading\n> quoted\n- item\n*action* and `code`')).toBe(
            'Heading quoted item action and code',
        );
    });

    it('can keep asterisks', () => {
        expect(prepareSpeechText('*action*', { stripAsterisks: false })).toBe('*action*');
    });

    it('keeps code fences when asked', () => {
        expect(prepareSpeechText('```code```', { skipCodeBlocks: false })).toBe('code');
    });

    it('returns an empty string for markup-only text', () => {
        expect(prepareSpeechText('```code``` ![x](y.png)')).toBe('');
    });
});

describe('splitSpeechText', () => {
    it('returns no chunks for empty text', () => {
        expect(splitSpeechText('   ')).toEqual([]);
    });

    it('keeps short text in one chunk', () => {
        expect(splitSpeechText('Hello there.')).toEqual(['Hello there.']);
    });

    it('splits at sentence boundaries', () => {
        const text = 'One sentence. Two sentence. Three sentence.';
        const chunks = splitSpeechText(text, 16);
        expect(chunks).toEqual(['One sentence.', 'Two sentence.', 'Three sentence.']);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(16);
        }
    });

    it('hard-wraps an oversized sentence at a space', () => {
        const text = 'aaaa bbbb cccc dddd';
        const chunks = splitSpeechText(text, 10);
        expect(chunks).toEqual(['aaaa bbbb', 'cccc dddd']);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(10);
        }
    });

    it('hard-wraps a word longer than the limit', () => {
        const chunks = splitSpeechText('abcdefghij', 4);
        expect(chunks).toEqual(['abcd', 'efgh', 'ij']);
    });

    it('preserves the text when chunks are joined', () => {
        const text = 'The lantern flickers. The room is quiet. Nobody speaks.';
        const chunks = splitSpeechText(text, 25);
        expect(chunks.join(' ')).toBe(text);
    });
});
