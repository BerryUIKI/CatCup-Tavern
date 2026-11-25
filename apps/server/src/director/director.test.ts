import { directorConfigSchema } from '@catcup/shared';
import { describe, expect, it } from 'vitest';
import { isUsableChoiceSet, optionsFromLines, parseChoices } from './choices.js';
import { directorBlock, directorRefusal, playedNamesOf } from './config.js';

/**
 * The director's pure parts: the cast block, the one refusal, and the option
 * block parser.
 *
 * The refusal and the parser are the two places where a mistake is silent — a
 * single chat allowed to play its own card produces a model that occasionally
 * speaks for the person, and a sentinel block that fails to strip shows up in
 * the stored chat and in every prompt after it.
 */

const character = { id: 'Aurelia.png', name: 'Aurelia' };

function director(overrides: Record<string, unknown> = {}) {
    return directorConfigSchema.parse({ enabled: true, ...overrides });
}

describe('playedNamesOf', () => {
    it('resolves avatar file names to display names', () => {
        const names = playedNamesOf({
            character,
            director: director({ playedMembers: ['Aurelia.png'] }),
        });
        expect(names).toEqual(['Aurelia']);
    });

    it('drops a member the chat does not contain rather than leaking a file name', () => {
        // A stale entry should cost nothing, not put `x.png` in the prompt.
        const names = playedNamesOf({
            character,
            director: director({ playedMembers: ['Aurelia.png', 'gone.png'] }),
        });
        expect(names).toEqual(['Aurelia']);
    });
});

describe('directorBlock', () => {
    it('emits nothing when the director is off', () => {
        // This is what keeps an ordinary chat's prompt byte-identical.
        expect(directorBlock({ character, director: director({ enabled: false }) })).toBe('');
    });

    it('emits the cast block even with no rules written', () => {
        // The cast block is the useful half: it needs no authoring and it is what
        // stops the model writing the player's lines.
        const block = directorBlock({ character, director: director({ playedMembers: ['Aurelia.png'] }) });

        expect(block).toContain('The player controls Aurelia');
        expect(block).toContain('Never write their dialogue');
    });

    it('puts the standing rules first, then the cast', () => {
        const block = directorBlock({
            character,
            director: director({ rules: 'Keep the pace slow.', playedMembers: ['Aurelia.png'] }),
        });

        expect(block.indexOf('Keep the pace slow')).toBeLessThan(block.indexOf('The player controls'));
    });

    it('emits nothing when there are neither rules nor a played member', () => {
        // A block that says nothing is worse than no block: it spends tokens
        // and tells the model nothing.
        expect(directorBlock({ character, director: director() })).toBe('');
    });
});

describe('directorRefusal', () => {
    it('refuses a single chat playing its own character, naming both ways out', () => {
        const refusal = directorRefusal({
            director: director({ playedMembers: ['Aurelia.png'] }),
            character,
            isGroup: false,
        });

        expect(refusal).toContain('Aurelia');
        expect(refusal).toContain('group');
        expect(refusal).toContain('narrator');
    });

    it('allows a single chat that plays nobody', () => {
        expect(directorRefusal({ director: director({ rules: 'Narrate.' }), character, isGroup: false })).toBeNull();
    });

    it('allows a group to play any member, including the one who could speak', () => {
        // A group has no contradiction: the speaker is chosen per turn and a
        // played member is muted for the whole chat.
        expect(
            directorRefusal({ director: director({ playedMembers: ['Aurelia.png'] }), character, isGroup: true }),
        ).toBeNull();
    });

    it('allows a disabled director whatever it names', () => {
        // A chat with the director off must never be blocked from opening.
        expect(
            directorRefusal({
                director: director({ enabled: false, playedMembers: ['Aurelia.png'] }),
                character,
                isGroup: false,
            }),
        ).toBeNull();
    });
});

describe('parseChoices', () => {
    it('leaves a reply with no block alone', () => {
        const result = parseChoices('She looks up. The rain keeps falling.');
        expect(result).toEqual({
            prose: 'She looks up. The rain keeps falling.',
            options: [],
            sawBlock: false,
        });
    });

    it('separates the prose from the options', () => {
        const result = parseChoices(
            [
                '她抬起眼睛看着你，没有立刻回答。',
                '',
                '<<<CHOICES>>>',
                '掏出手机看那条短信',
                '直接下楼',
                '<<<END>>>',
            ].join('\n'),
        );

        expect(result.prose).toBe('她抬起眼睛看着你，没有立刻回答。');
        expect(result.options.map((option) => option.label)).toEqual(['掏出手机看那条短信', '直接下楼']);
        expect(result.sawBlock).toBe(true);
    });

    it('keeps the options a truncated block managed to write', () => {
        // A stream cut mid-block is the case the line format exists for: every
        // complete line is a usable option.
        const result = parseChoices('Prose here.\n\n<<<CHOICES>>>\nFirst option\nSecond opti');

        expect(result.prose).toBe('Prose here.');
        expect(result.options.map((option) => option.label)).toEqual(['First option', 'Second opti']);
    });

    it('strips decoration a model adds on its own', () => {
        const result = parseChoices(
            ['Prose.', '<<<CHOICES>>>', '1. Open the door', '- "Say nothing"', '• Walk away', '<<<END>>>'].join('\n'),
        );

        // The label is what gets sent as the person's message, so a stray quote
        // or number would end up in their own dialogue.
        expect(result.options.map((option) => option.label)).toEqual(['Open the door', 'Say nothing', 'Walk away']);
    });

    it('removes a dangling sentinel even when the block never closed', () => {
        // Leaving it would put `<<<CHOICES>>>` in the stored chat, in the
        // export, and in the next turn's prompt.
        const result = parseChoices('Prose.\n<<<CHOICES>>>\nOption one');
        expect(result.prose).toBe('Prose.');
    });

    it('keeps prose written after the block', () => {
        const result = parseChoices('Before.\n<<<CHOICES>>>\nOne\nTwo\n<<<END>>>\nAfter.');
        expect(result.prose).toContain('Before.');
        expect(result.prose).toContain('After.');
    });

    it('bounds the number of options', () => {
        const lines = Array.from({ length: 20 }, (_value, index) => `Option ${index}`);
        expect(parseChoices(`Prose.\n<<<CHOICES>>>\n${lines.join('\n')}\n<<<END>>>`, 3).options).toHaveLength(3);
    });
});

describe('optionsFromLines', () => {
    it('drops an option too long to be a button', () => {
        const options = optionsFromLines(['Short one', 'x'.repeat(300), 'Another']);
        expect(options.map((option) => option.label)).toEqual(['Short one', 'Another']);
    });

    it('gives each option a stable id', () => {
        expect(optionsFromLines(['A', 'B']).map((option) => option.id)).toEqual(['choice-1', 'choice-2']);
    });
});

describe('isUsableChoiceSet', () => {
    it('treats one option as no choice at all', () => {
        // One option is a suggestion wearing a button, not a decision.
        expect(isUsableChoiceSet([{ id: 'a', label: 'Only one' }])).toBe(false);
        expect(
            isUsableChoiceSet([
                { id: 'a', label: 'One' },
                { id: 'b', label: 'Two' },
            ]),
        ).toBe(true);
    });
});
