import { describe, expect, it } from 'vitest';

import { toContents } from './gemini.js';

const history = [
    { role: 'system' as const, content: 'You are a narrator.' },
    { role: 'user' as const, content: 'The door opens.' },
    { role: 'assistant' as const, content: 'Alex, come in.' },
];

describe('toContents', () => {
    it('hoists system turns into systemInstruction', () => {
        const converted = toContents(history, undefined);
        expect(converted.systemInstruction).toBe('You are a narrator.');
        expect(converted.contents).toEqual([
            { role: 'user', parts: [{ text: 'The door opens.' }] },
            { role: 'model', parts: [{ text: 'Alex, come in.' }] },
        ]);
    });

    it('renames assistant to model', () => {
        const converted = toContents([{ role: 'assistant' as const, content: 'Hello.' }], undefined);
        // The leading assistant turn is dropped: Gemini rejects a conversation
        // that does not open with a user turn.
        expect(converted.contents).toEqual([]);
    });

    it('drops leading model turns so the conversation opens with a user turn', () => {
        const converted = toContents(
            [
                { role: 'assistant' as const, content: 'Welcome.' },
                { role: 'assistant' as const, content: 'Still here.' },
                { role: 'user' as const, content: 'Hello.' },
            ],
            undefined,
        );
        expect(converted.contents).toEqual([{ role: 'user', parts: [{ text: 'Hello.' }] }]);
    });

    it('appends the prefill as a trailing model turn', () => {
        const converted = toContents([...history, { role: 'user' as const, content: 'Come in.' }], 'Alex:');
        expect(converted.contents[converted.contents.length - 1]).toEqual({
            role: 'model',
            parts: [{ text: 'Alex:' }],
        });
    });

    it('leaves systemInstruction empty when there is no system turn', () => {
        const converted = toContents([{ role: 'user' as const, content: 'Hello.' }], undefined);
        expect(converted.systemInstruction).toBe('');
    });

    it('joins several system turns into one instruction block', () => {
        const converted = toContents(
            [
                { role: 'system' as const, content: 'First.' },
                { role: 'system' as const, content: 'Second.' },
                { role: 'user' as const, content: 'Hello.' },
            ],
            undefined,
        );
        expect(converted.systemInstruction).toBe('First.\n\nSecond.');
    });
});
