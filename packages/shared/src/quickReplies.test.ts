import { describe, expect, it } from 'vitest';

import { parseQuickReplyScript } from './quickReplies.js';

describe('parseQuickReplyScript', () => {
    it('leaves plain text untouched', () => {
        expect(parseQuickReplyScript('Hello there!')).toEqual({ kind: 'text', text: 'Hello there!' });
    });

    it('treats leading whitespace before a slash as plain text', () => {
        expect(parseQuickReplyScript('  /send hi')).toEqual({ kind: 'text', text: '  /send hi' });
    });

    it('parses a single command', () => {
        expect(parseQuickReplyScript('/send Hello there')).toEqual({
            kind: 'commands',
            commands: [{ name: 'send', alias: 'send', argument: 'Hello there', named: {} }],
        });
    });

    it('maps SillyTavern aliases to canonical names', () => {
        const result = parseQuickReplyScript('/nar The sun sets. | /cont | /regen');
        expect(result).toMatchObject({
            kind: 'commands',
            commands: [
                { name: 'sys', alias: 'nar', argument: 'The sun sets.' },
                { name: 'continue', alias: 'cont', argument: '' },
                { name: 'regenerate', alias: 'regen', argument: '' },
            ],
        });
    });

    it('reads named arguments before the text', () => {
        expect(parseQuickReplyScript('/send name="Chloe" Hello, guys!')).toEqual({
            kind: 'commands',
            commands: [
                {
                    name: 'send',
                    alias: 'send',
                    argument: 'Hello, guys!',
                    named: { name: 'Chloe' },
                },
            ],
        });
    });

    it('keeps escaped quotes inside a quoted text argument', () => {
        expect(parseQuickReplyScript('/send "say \\"hi\\" now"')).toMatchObject({
            kind: 'commands',
            commands: [{ name: 'send', argument: 'say "hi" now' }],
        });
    });

    it('keeps pipes inside quotes', () => {
        expect(parseQuickReplyScript('/send "one | two"')).toMatchObject({
            kind: 'commands',
            commands: [{ name: 'send', argument: 'one | two' }],
        });
    });

    it('unescapes an escaped pipe', () => {
        expect(parseQuickReplyScript('/send one \\| two')).toMatchObject({
            kind: 'commands',
            commands: [{ name: 'send', argument: 'one | two' }],
        });
    });

    it('supports the /:run shorthand', () => {
        expect(parseQuickReplyScript('/:My Reply')).toMatchObject({
            kind: 'commands',
            commands: [{ name: 'run', alias: ':', argument: 'My Reply' }],
        });
    });

    it('leaves unknown key=value tokens in the text', () => {
        expect(parseQuickReplyScript('/send 2+2=4')).toMatchObject({
            kind: 'commands',
            commands: [{ name: 'send', argument: '2+2=4', named: {} }],
        });
    });

    it('reports an unsupported command', () => {
        const result = parseQuickReplyScript('/setvar x 1');
        expect(result.kind).toBe('error');
        if (result.kind === 'error') {
            expect(result.message).toContain('Unsupported quick reply command "/setvar"');
        }
    });

    it('reports an unclosed quote', () => {
        const result = parseQuickReplyScript('/send "hello');
        expect(result).toEqual({ kind: 'error', message: 'The quick reply has an unclosed quote.' });
    });

    it('reports an empty command in a chain', () => {
        const result = parseQuickReplyScript('/send one || /trigger');
        expect(result).toEqual({ kind: 'error', message: 'A quick reply command is empty.' });
    });

    it('treats an empty message as empty text', () => {
        expect(parseQuickReplyScript('   ')).toEqual({ kind: 'text', text: '   ' });
    });
});
