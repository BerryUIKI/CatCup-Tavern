import { describe, expect, it } from 'vitest';

import {
    buildGroupDepthPrompts,
    buildJoinedCardFields,
    type CardDepthPrompt,
    DEPTH_PROMPT_DEFAULT_DEPTH,
    type JoinedMemberCard,
    joinsGroupCards,
    readCardDepthPrompt,
} from './groupCards.js';
import { groupGenerationMode } from './schemas/group.js';

function member(name: string, overrides: Partial<JoinedMemberCard> = {}): JoinedMemberCard {
    return {
        fileName: `${name}.png`,
        name,
        description: `${name} description`,
        personality: `${name} personality`,
        scenario: `${name} scenario`,
        mesExample: `${name}: hello`,
        ...overrides,
    };
}

describe('joinsGroupCards', () => {
    it('is false only for swap mode', () => {
        expect(joinsGroupCards(groupGenerationMode.SWAP)).toBe(false);
        expect(joinsGroupCards(groupGenerationMode.APPEND)).toBe(true);
        expect(joinsGroupCards(groupGenerationMode.APPEND_DISABLED)).toBe(true);
    });
});

describe('buildJoinedCardFields', () => {
    const members = [member('Aria'), member('Bram'), member('Cleo')];

    it('returns null for swap mode, so the speaker keeps their own card', () => {
        expect(
            buildJoinedCardFields({
                members,
                disabledMembers: [],
                generationMode: groupGenerationMode.SWAP,
                speaker: 'Aria.png',
            }),
        ).toBeNull();
    });

    it('returns null for an empty group', () => {
        expect(
            buildJoinedCardFields({
                members: [],
                disabledMembers: [],
                generationMode: groupGenerationMode.APPEND,
                speaker: 'Aria.png',
            }),
        ).toBeNull();
    });

    it('joins every field with a newline, skipping empty ones', () => {
        const fields = buildJoinedCardFields({
            members: [member('Aria'), member('Bram', { personality: '' }), member('Cleo')],
            disabledMembers: [],
            generationMode: groupGenerationMode.APPEND,
            speaker: 'Aria.png',
        });
        expect(fields).toEqual({
            description: 'Aria description\nBram description\nCleo description',
            personality: 'Aria personality\nCleo personality',
            scenario: 'Aria scenario\nBram scenario\nCleo scenario',
            // Every member's examples are their own `<START>` block.
            mesExample: '<START>\nAria: hello\n<START>\nBram: hello\n<START>\nCleo: hello',
        });
    });

    it('skips muted members when joining, as APPEND does', () => {
        const fields = buildJoinedCardFields({
            members,
            disabledMembers: ['Bram.png'],
            generationMode: groupGenerationMode.APPEND,
            speaker: 'Aria.png',
        });
        expect(fields?.description).toBe('Aria description\nCleo description');
    });

    it('keeps a muted speaker’s own card, as SillyTavern does', () => {
        const fields = buildJoinedCardFields({
            members,
            disabledMembers: ['Bram.png'],
            generationMode: groupGenerationMode.APPEND,
            speaker: 'Bram.png',
        });
        expect(fields?.description).toBe('Aria description\nBram description\nCleo description');
    });

    it('includes muted members when the group says so, as APPEND_DISABLED does', () => {
        const fields = buildJoinedCardFields({
            members,
            disabledMembers: ['Bram.png'],
            generationMode: groupGenerationMode.APPEND_DISABLED,
            speaker: 'Aria.png',
        });
        expect(fields?.description).toBe('Aria description\nBram description\nCleo description');
    });

    it('wraps every field in the join prefix and suffix', () => {
        const fields = buildJoinedCardFields({
            members: [member('Aria'), member('Bram')],
            disabledMembers: [],
            generationMode: groupGenerationMode.APPEND,
            speaker: 'Aria.png',
            joinPrefix: '[{{char}} <FIELDNAME>] ',
            joinSuffix: ' [end]',
            substitute: (text, charName) => text.replace(/\{\{char\}\}/g, charName),
        });
        expect(fields?.description).toBe(
            '[Aria Description] Aria description [end]\n[Bram Description] Bram description [end]',
        );
    });

    it('prepends <START> to an example block that lacks one', () => {
        const fields = buildJoinedCardFields({
            members: [member('Aria', { mesExample: '<START>\nAria: hi' }), member('Bram')],
            disabledMembers: [],
            generationMode: groupGenerationMode.APPEND,
            speaker: 'Aria.png',
        });
        expect(fields?.mesExample).toBe('<START>\nAria: hi\n<START>\nBram: hello');
    });

    it('uses a chat-level scenario override for the whole group', () => {
        const fields = buildJoinedCardFields({
            members,
            disabledMembers: [],
            generationMode: groupGenerationMode.APPEND,
            speaker: 'Aria.png',
            scenarioOverride: '  A shared room.  ',
        });
        expect(fields?.scenario).toBe('A shared room.');
    });
});

describe('readCardDepthPrompt', () => {
    it('reads a full depth prompt', () => {
        expect(readCardDepthPrompt({ depth_prompt: { prompt: 'Be terse.', depth: 2, role: 'assistant' } })).toEqual({
            prompt: 'Be terse.',
            depth: 2,
            role: 'assistant',
        });
    });

    it('applies SillyTavern defaults to a partial one', () => {
        expect(readCardDepthPrompt({ depth_prompt: { prompt: 'Be terse.' } })).toEqual({
            prompt: 'Be terse.',
            depth: DEPTH_PROMPT_DEFAULT_DEPTH,
            role: 'system',
        });
    });

    it('ignores an empty, missing or malformed value', () => {
        expect(readCardDepthPrompt({})).toBeNull();
        expect(readCardDepthPrompt({ depth_prompt: { prompt: '   ' } })).toBeNull();
        expect(readCardDepthPrompt({ depth_prompt: 'Be terse.' })).toBeNull();
        expect(readCardDepthPrompt(undefined)).toBeNull();
    });

    it('falls back on an unknown role', () => {
        expect(readCardDepthPrompt({ depth_prompt: { prompt: 'x', role: 'narrator' } })?.role).toBe('system');
    });
});

describe('buildGroupDepthPrompts', () => {
    const members = [member('Aria'), member('Bram'), member('Cleo')];
    const depthPrompts = new Map<string, CardDepthPrompt>([
        ['Aria.png', { prompt: 'Aria aside.', depth: 3, role: 'system' }],
        ['Bram.png', { prompt: 'Bram aside.', depth: 4, role: 'user' }],
    ]);

    it('contributes nothing in swap mode; the speaker’s own depth prompt is used instead', () => {
        expect(
            buildGroupDepthPrompts({
                members,
                depthPrompts,
                disabledMembers: [],
                generationMode: groupGenerationMode.SWAP,
                speaker: 'Aria.png',
            }),
        ).toEqual([]);
    });

    it('collects every member’s depth prompt in the join modes', () => {
        const prompts = buildGroupDepthPrompts({
            members,
            depthPrompts,
            disabledMembers: [],
            generationMode: groupGenerationMode.APPEND,
            speaker: 'Aria.png',
        });
        expect(prompts.map((item) => [item.charName, item.text, item.depth, item.role])).toEqual([
            ['Aria', 'Aria aside.', 3, 'system'],
            ['Bram', 'Bram aside.', 4, 'user'],
        ]);
    });

    it('skips muted members but keeps the speaker’s own aside', () => {
        const prompts = buildGroupDepthPrompts({
            members,
            depthPrompts,
            disabledMembers: ['Aria.png', 'Bram.png'],
            generationMode: groupGenerationMode.APPEND,
            speaker: 'Bram.png',
        });
        expect(prompts.map((item) => item.charName)).toEqual(['Bram']);
    });

    it('expands macros with the member as the character', () => {
        const prompts = buildGroupDepthPrompts({
            members,
            depthPrompts: new Map([['Cleo.png', { prompt: '{{char}} is watching.', depth: 1, role: 'system' }]]),
            disabledMembers: [],
            generationMode: groupGenerationMode.APPEND,
            speaker: 'Aria.png',
            substitute: (text, charName) => text.replace(/\{\{char\}\}/g, charName),
        });
        expect(prompts[0]?.text).toBe('Cleo is watching.');
    });
});
