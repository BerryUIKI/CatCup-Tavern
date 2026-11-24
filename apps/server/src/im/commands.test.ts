import { describe, expect, it } from 'vitest';

import { parseCommand, splitForTelegram, TELEGRAM_MAX_LENGTH } from './commands.js';

/**
 * The command parser and the reply splitter.
 *
 * Both are pure, and both have a failure mode that is silent: a bare message
 * read as a command loses a line of the story, and a reply split badly arrives
 * as fragments in the wrong order. Neither shows up until someone reads the
 * chat back.
 */

describe('parseCommand', () => {
    it('treats a bare message as speech', () => {
        expect(parseCommand('I open the gate.')).toEqual({ kind: 'message', text: 'I open the gate.' });
    });

    it('reads the five commands', () => {
        expect(parseCommand('/chat Aurelia')).toEqual({ kind: 'chat', argument: 'Aurelia' });
        expect(parseCommand('/new')).toEqual({ kind: 'new' });
        expect(parseCommand('/stop')).toEqual({ kind: 'stop' });
        expect(parseCommand('/who')).toEqual({ kind: 'who' });
        expect(parseCommand('/help')).toEqual({ kind: 'help' });
    });

    it('strips the bot suffix Telegram adds in groups', () => {
        // Without this, `/stop@catcup_bot` is read as the word `stop@catcup_bot`
        // and silently becomes a line of dialogue.
        expect(parseCommand('/stop@catcup_bot')).toEqual({ kind: 'stop' });
        expect(parseCommand('/chat@catcup_bot Aurelia')).toEqual({ kind: 'chat', argument: 'Aurelia' });
    });

    it('treats /start as help, because that is what Telegram sends on open', () => {
        expect(parseCommand('/start')).toEqual({ kind: 'help' });
    });

    it('treats an unknown command as speech rather than losing the message', () => {
        // A line that legitimately begins with a slash must still reach the
        // character; refusing it would silently drop it.
        expect(parseCommand('/me draws a blade')).toEqual({ kind: 'message', text: '/me draws a blade' });
    });

    it('ignores case and surrounding space', () => {
        expect(parseCommand('  /Chat Aurelia  ')).toEqual({ kind: 'chat', argument: 'Aurelia' });
    });

    it('keeps a multi-word argument whole', () => {
        expect(parseCommand('/chat Ser Bram')).toEqual({ kind: 'chat', argument: 'Ser Bram' });
    });
});

describe('the commands about the instance rather than the story', () => {
    it('reads /status and /provider, with or without the bot suffix', () => {
        // Telegram appends `@botname` in a group; the parser strips it, and
        // these two go through the same rule as every other command.
        expect(parseCommand('/status')).toEqual({ kind: 'status' });
        expect(parseCommand('/status@catcup_bot')).toEqual({ kind: 'status' });
        expect(parseCommand('/provider')).toEqual({ kind: 'provider' });
    });

    it('is case-insensitive, like the rest', () => {
        expect(parseCommand('/STATUS')).toEqual({ kind: 'status' });
        expect(parseCommand('/Provider')).toEqual({ kind: 'provider' });
    });

    it('does not take an argument for either', () => {
        // An argument is dropped rather than rejected: both answer from state,
        // and refusing would lose the command over a stray word.
        expect(parseCommand('/status now please')).toEqual({ kind: 'status' });
    });
});

describe('splitForTelegram', () => {
    it('leaves a short reply alone', () => {
        expect(splitForTelegram('A short line.')).toEqual(['A short line.']);
    });

    it('returns nothing for empty text', () => {
        expect(splitForTelegram('   ')).toEqual([]);
    });

    it('splits on paragraph boundaries first', () => {
        // A blank line is where the writer put a boundary, so it is the first
        // and least damaging place to cut.
        const first = 'a'.repeat(2000);
        const second = 'b'.repeat(2000);
        const chunks = splitForTelegram(`${first}\n\n${second}`, 2500);

        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toBe(first);
        expect(chunks[1]).toBe(second);
    });

    it('never exceeds the limit', () => {
        const text = `${'word '.repeat(2000)}`;
        for (const chunk of splitForTelegram(text, 500)) {
            expect(chunk.length).toBeLessThanOrEqual(500);
        }
    });

    it('preserves every character of content across the split', () => {
        const sentences = Array.from({ length: 60 }, (_value, index) => `Sentence number ${index} is here.`);
        const chunks = splitForTelegram(sentences.join(' '), 200);

        // Rejoining must give back the same words in the same order: a splitter
        // that drops or reorders text is worse than one that sends too much.
        expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(sentences.join(' ').replace(/\s+/g, ' '));
    });

    it('cuts a single unbroken run at a space when it can', () => {
        const text = 'x'.repeat(300);
        const chunks = splitForTelegram(text, 100);

        expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
        expect(chunks.join('')).toBe(text);
    });

    it('handles a Chinese reply, which has no spaces to break on', () => {
        // A CJK reply with no punctuation at all is one long "word"; it must
        // still be cut rather than sent over the limit and rejected.
        const text = '火'.repeat(5000);
        const chunks = splitForTelegram(text);

        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(TELEGRAM_MAX_LENGTH);
        }
        expect(chunks.join('')).toBe(text);
    });

    it('breaks a Chinese paragraph on its own full stops before cutting characters', () => {
        const sentence = '她走进门。';
        const text = sentence.repeat(1000);
        const chunks = splitForTelegram(text, 200);

        // Every chunk should end on a sentence boundary rather than mid-word,
        // because the splitter prefers punctuation when it exists.
        for (const chunk of chunks) {
            expect(chunk.endsWith('。')).toBe(true);
        }
    });
});
