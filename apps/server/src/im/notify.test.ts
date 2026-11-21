import { describe, expect, it } from 'vitest';

import { previewOf } from './notify.js';

/**
 * What a notification carries.
 *
 * The point of a notification is "it is ready", not a second copy of the story
 * in another chat — so the preview is one sentence and it is bounded. That is
 * worth asserting because the failure is a slow one: a preview that quietly
 * grows until it is the whole reply is not noticed until someone's phone shows
 * a chapter.
 */

describe('previewOf', () => {
    it('keeps a short reply whole', () => {
        expect(previewOf('The gate swings open.')).toBe('The gate swings open.');
    });

    it('takes the first sentence when there are several', () => {
        expect(previewOf('The gate swings open. Mist pours through it.')).toBe('The gate swings open.');
    });

    it('takes the first sentence of a Chinese reply', () => {
        // A CJK full stop is a sentence boundary; without handling it the whole
        // paragraph would be one "sentence" and get truncated mid-word instead.
        expect(previewOf('门开了。雾气涌进来。')).toBe('门开了。');
    });

    it('collapses whitespace so a paragraph does not arrive as a block', () => {
        expect(previewOf('Line one.\n\n   Line two.')).toBe('Line one.');
    });

    it('truncates an over-long first sentence rather than sending it whole', () => {
        const preview = previewOf(`${'word '.repeat(200)}`);
        expect(preview.length).toBeLessThanOrEqual(120);
        expect(preview.endsWith('…')).toBe(true);
    });

    it('returns nothing for empty text', () => {
        expect(previewOf('   ')).toBe('');
    });
});
