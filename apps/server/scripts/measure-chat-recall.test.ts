/**
 * The window arithmetic the recall measurement depends on.
 *
 * The number this script produces is only worth having if "dropped" and "kept"
 * mean what they say, so the boundaries are asserted directly rather than
 * inferred from the printed output.
 */

import { describe, expect, it } from 'vitest';

import { indexOf, recallOver, type Turn, turnsOf } from './measure-chat-recall.js';

function turns(texts: readonly string[]): Turn[] {
    return texts.map((text, index) => ({ index, text }));
}

describe('turnsOf', () => {
    it('skips system rows and empty messages, keeping order', () => {
        const result = turnsOf([
            { mes: 'Welcome.' },
            { is_system: true, mes: 'A note the prompt never sends.' },
            { mes: '   ' },
            { mes: 'Hello.' },
        ]);

        expect(result.map((turn) => turn.text)).toEqual(['Welcome.', 'Hello.']);
        expect(result.map((turn) => turn.index)).toEqual([0, 1]);
    });
});

describe('recallOver', () => {
    it('counts a hit only when the window had already dropped it', () => {
        // The gate is established in the first message, then a long stretch of
        // unrelated turns pushes it out of a two-message window, and the last
        // turn asks about it again.
        const chat = turns([
            'Aurelia sealed the orchard gate with an oath of salt and iron.',
            'I see.',
            'We walked past the mill.',
            'Nice weather.',
            'Is that gate still sealed by the oath?',
        ]);

        const counts = recallOver(chat, indexOf(chat), 2);

        // At the last turn the window is messages 3 and 4, so message 0 is the
        // only thing outside it that shares vocabulary.
        expect(counts.recoverable).toBeGreaterThan(0);
        expect(counts.hits).toBeGreaterThan(0);
    });

    it('reports nothing when the whole chat fits the window', () => {
        const chat = turns(['One.', 'Two.', 'Three.']);

        // `window` 3 means the first examined turn is index 3, which does not
        // exist — nothing has been dropped.
        expect(recallOver(chat, indexOf(chat), 3)).toEqual({
            examined: 0,
            recoverable: 0,
            hits: 0,
            byRank: [0, 0, 0, 0, 0],
        });
    });

    it('examines one turn per message past the first full window', () => {
        const chat = turns(['a', 'b', 'c', 'd', 'e', 'f']);
        expect(recallOver(chat, indexOf(chat), 2).examined).toBe(4);
    });

    it('does not count a message the window still shows', () => {
        // Every message mentions the gate, so everything scores — but with a
        // window covering the whole chat there is nothing dropped to recall.
        const chat = turns(['gate one', 'gate two', 'gate three']);
        const counts = recallOver(chat, indexOf(chat), 3);

        expect(counts.recoverable).toBe(0);
    });
});
