import { describe, expect, it } from 'vitest';

import { parseExampleBlocks } from './history.js';

// The parser is handed already-expanded text, so the speaker names are real.
const EXAMPLES = `<START>
Alex: Do you get many travellers?
Mira: Enough to keep the fire honest.`;

describe('parseExampleBlocks', () => {
    it('turns each speaker turn into an example message', () => {
        const blocks = parseExampleBlocks(EXAMPLES, 'Mira', 'Alex');
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toEqual([
            { role: 'system', content: 'Do you get many travellers?', name: 'example_user' },
            { role: 'system', content: 'Enough to keep the fire honest.', name: 'example_assistant' },
        ]);
    });

    it('only prefixes names when the caller asks for it', () => {
        const blocks = parseExampleBlocks(EXAMPLES, 'Mira', 'Alex', { appendNames: true });
        expect(blocks[0]?.[1]).toEqual({
            role: 'system',
            content: 'Mira: Enough to keep the fire honest.',
            name: 'example_assistant',
        });
    });

    it('keeps every member line inside the block, as SillyTavern does', () => {
        // Joined examples put all members in one block. ST only opens a new
        // message when the speaker changes *role*, so consecutive characters
        // share one assistant turn.
        const merged = `<START>
Mira: Mine.
Bram: His.
Mira: Mine again.
Alex: I sit down.
Cleo: Hers.`;
        const blocks = parseExampleBlocks(merged, 'Mira', 'Alex', {
            otherNames: ['Mira', 'Bram', 'Cleo'],
            appendNames: true,
        });
        expect(blocks[0]?.map((message) => [message.name, message.content])).toEqual([
            ['example_assistant', 'Mira: Mine.\nBram: His.\nMira: Mine again.'],
            ['example_user', 'Alex: I sit down.'],
            ['example_assistant', 'Cleo: Hers.'],
        ]);
    });

    it('keeps the persona line as the user turn even when a member shares the prefix', () => {
        const merged = `<START>
Alex: I sit down.
Bram: Stew?`;
        const blocks = parseExampleBlocks(merged, 'Mira', 'Alex', { otherNames: ['Bram'], appendNames: true });
        expect(blocks[0]?.[0]).toEqual({ role: 'system', content: 'Alex: I sit down.', name: 'example_user' });
    });

    it('prefers the longest matching member name', () => {
        const merged = `<START>
Bram Wyrd: Long name.`;
        const blocks = parseExampleBlocks(merged, 'Mira', 'Alex', {
            otherNames: ['Bram', 'Bram Wyrd'],
            appendNames: true,
        });
        expect(blocks[0]?.[0]?.content).toBe('Bram Wyrd: Long name.');
    });

    it('returns nothing for an empty card', () => {
        expect(parseExampleBlocks('', 'Mira', 'Alex')).toEqual([]);
    });
});
