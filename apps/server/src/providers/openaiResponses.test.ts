import { describe, expect, it } from 'vitest';

import { toInput } from './openaiResponses.js';

const history = [
    { role: 'system' as const, content: 'You are a narrator.' },
    { role: 'user' as const, content: 'The door opens.' },
    { role: 'assistant' as const, content: 'Alex, come in.' },
];

describe('toInput', () => {
    it('hoists system turns into instructions', () => {
        const converted = toInput(history, undefined);
        expect(converted.instructions).toBe('You are a narrator.');
        expect(converted.input).toEqual([
            { role: 'user', content: 'The door opens.' },
            { role: 'assistant', content: 'Alex, come in.' },
        ]);
    });

    it('joins several system turns into one instruction block', () => {
        const converted = toInput(
            [
                { role: 'system' as const, content: 'First.' },
                { role: 'system' as const, content: 'Second.' },
                { role: 'user' as const, content: 'Hello.' },
            ],
            undefined,
        );
        expect(converted.instructions).toBe('First.\n\nSecond.');
    });

    it('leaves instructions empty when there is no system turn', () => {
        const converted = toInput([{ role: 'user' as const, content: 'Hello.' }], undefined);
        expect(converted.instructions).toBe('');
    });

    it('appends the prefill as a trailing assistant item', () => {
        const converted = toInput([...history, { role: 'user' as const, content: 'Come in.' }], 'Alex:');
        expect(converted.input[converted.input.length - 1]).toEqual({ role: 'assistant', content: 'Alex:' });
    });

    it('does not add a prefill item when the prefill is empty', () => {
        const withEmpty = toInput(history, '');
        expect(withEmpty.input).toEqual(toInput(history, undefined).input);
    });

    it('keeps the conversation in order', () => {
        const converted = toInput(history, undefined);
        expect(converted.input.map((item) => item.role)).toEqual(['user', 'assistant']);
    });
});
