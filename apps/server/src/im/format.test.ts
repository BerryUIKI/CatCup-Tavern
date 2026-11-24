import { describe, expect, it } from 'vitest';

import { escapeTelegramHtml, formatForTelegram, hasBalancedTags } from './format.js';

/**
 * Roleplay prose into Telegram's HTML subset.
 *
 * The failure this file is mostly about is not a crash: it is a message that
 * arrives with its emphasis still showing, or one Telegram refuses to parse so
 * the person sees nothing at all. Both are silent from the sender's side, which
 * is why the conservative rules matter more than the clever ones.
 */

describe('escaping', () => {
    it('escapes the three characters Telegram treats as markup', () => {
        expect(escapeTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    });

    it('leaves everything else alone', () => {
        expect(escapeTelegramHtml('snake_case and 2*3 and "quotes"')).toBe('snake_case and 2*3 and "quotes"');
    });
});

describe('emphasis', () => {
    it('converts a single asterisk span to italics', () => {
        expect(formatForTelegram('*she smiles*')).toBe('<i>she smiles</i>');
    });

    it('converts a doubled asterisk span to bold', () => {
        expect(formatForTelegram('**in the dark**')).toBe('<b>in the dark</b>');
    });

    it('converts a tripled asterisk span to both', () => {
        expect(formatForTelegram('***and then***')).toBe('<b><i>and then</i></b>');
    });

    it('converts a doubled underscore span to underline', () => {
        // A single underscore is left alone — it appears inside words far more
        // often than it means emphasis.
        expect(formatForTelegram('__a whisper__')).toBe('<u>a whisper</u>');
        expect(formatForTelegram('snake_case_word')).toBe('snake_case_word');
    });

    it('handles several spans in one reply', () => {
        expect(formatForTelegram('*one* and **two**')).toBe('<i>one</i> and <b>two</b>');
    });

    it('leaves an unmatched marker alone', () => {
        expect(formatForTelegram('a * b')).toBe('a * b');
    });

    it('does not convert a span that crosses a line break', () => {
        // A "span" that opens in one paragraph and closes in another is a
        // delimiter someone typed, not emphasis.
        const text = '*open\nclosed*';
        expect(formatForTelegram(text)).toBe(text);
    });

    it('does not convert an empty span', () => {
        expect(formatForTelegram('** **')).toBe('** **');
    });

    it('escapes before it converts, so an authored tag stays text', () => {
        const result = formatForTelegram('<b>not markup</b> *but this is*');

        expect(result).toContain('&lt;b&gt;');
        expect(result).toContain('<i>but this is</i>');
    });
});

describe('the balance check', () => {
    it('accepts the tags this file produces', () => {
        expect(hasBalancedTags(formatForTelegram('*one* **two** ***three*** __four__'))).toBe(true);
    });

    it('accepts plain text', () => {
        expect(hasBalancedTags('nothing here')).toBe(true);
    });

    it('rejects an unclosed tag', () => {
        expect(hasBalancedTags('<b>open')).toBe(false);
    });

    it('rejects an out-of-order pair', () => {
        expect(hasBalancedTags('<b><i></b></i>')).toBe(false);
    });

    it('is what makes the plain-text fallback reachable', () => {
        // The check exists because Telegram rejects a whole message on a parse
        // error. A reply the person never sees is worse than one with a
        // visible asterisk, so an unbalanced conversion is sent unformatted.
        expect(hasBalancedTags(formatForTelegram('** **'))).toBe(true);
    });
});
