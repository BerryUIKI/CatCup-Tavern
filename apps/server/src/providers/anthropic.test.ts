import { describe, expect, it } from 'vitest';

import { convertMessages } from './anthropic.js';

const history = [
    { role: 'system' as const, content: 'You are a narrator.' },
    { role: 'user' as const, content: 'The door opens.' },
    { role: 'assistant' as const, content: 'Alex, come in.' },
];

describe('convertMessages', () => {
    it('hoists system messages and keeps the alternation', () => {
        const converted = convertMessages(history);
        expect(converted.system).toBe('You are a narrator.');
        expect(converted.messages).toEqual([
            { role: 'user', content: 'The door opens.' },
            { role: 'assistant', content: 'Alex, come in.' },
        ]);
    });

    it('adds a start marker when the chat opens with an assistant greeting', () => {
        const converted = convertMessages([{ role: 'assistant', content: 'Welcome.' }]);
        expect(converted.messages[0]).toEqual({ role: 'user', content: '[Start of chat]' });
        expect(converted.messages[1]).toEqual({ role: 'assistant', content: 'Welcome.' });
    });

    it('appends the prefill as a trailing assistant turn', () => {
        const converted = convertMessages([...history, { role: 'user', content: 'Come on in.' }], 'Alex:');
        expect(converted.messages[converted.messages.length - 1]).toEqual({ role: 'assistant', content: 'Alex:' });
    });

    it('extends an assistant turn that is already last instead of adding another', () => {
        const converted = convertMessages(
            [
                { role: 'user', content: 'Hello.' },
                { role: 'assistant', content: 'Hi.' },
            ],
            'Alex:',
        );
        expect(converted.messages).toEqual([
            { role: 'user', content: 'Hello.' },
            { role: 'assistant', content: 'Hi.Alex:' },
        ]);
    });

    it('trims trailing whitespace from the prefill, which the API rejects', () => {
        const converted = convertMessages([{ role: 'user', content: 'Hi.' }], 'Alex:  ');
        expect(converted.messages[converted.messages.length - 1]).toEqual({ role: 'assistant', content: 'Alex:' });
    });

    it('ignores an empty or whitespace prefill', () => {
        expect(convertMessages(history, '').messages).toEqual(convertMessages(history).messages);
        expect(convertMessages(history, '   ').messages).toEqual(convertMessages(history).messages);
    });
});
