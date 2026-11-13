import type { CharacterDetail, ChatMessage } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { buildPrompt } from './builder.js';

const speaker = {
    id: 'Seraphina',
    fileName: 'Seraphina.json',
    format: 'json',
    name: 'Seraphina',
    creator: '',
    tags: [],
    spec: 'v2',
    hasCharacterBook: false,
    fav: false,
    createdAt: 0,
    updatedAt: 0,
    avatarUrl: '',
    rawCard: {},
    card: {
        name: 'Seraphina',
        description: 'A guardian of Eldoria.',
        personality: 'Kind and watchful.',
        scenario: 'A forest glade.',
        first_mes: 'Welcome, traveler.',
        mes_example: '',
        creator_notes: '',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: [],
        group_only_greetings: [],
        tags: [],
        creator: '',
        character_version: '',
        extensions: {},
    },
} as unknown as CharacterDetail;

const persona = { name: 'Alex', description: '' };
const settings = { temperature: 1, topP: 1, maxTokens: 256, contextSize: 4096, stream: true };

const history: ChatMessage[] = [
    { name: 'Aria', is_user: false, mes: 'The fire is lit.' },
    { name: 'Bram', is_user: false, mes: 'I brought stew.' },
    { name: 'Alex', is_user: true, mes: 'Thank you.' },
];

function buildGroupPrompt() {
    return buildPrompt({
        character: speaker,
        messages: history,
        persona,
        settings,
        newChatPrompt: '[Start a new group chat. Group members: Aria, Bram]',
        groupNudge: '[Write the next reply only as {{char}}.]',
        prefixCharacterNames: true,
        generationType: 'normal',
    });
}

describe('group prompt assembly', () => {
    it('prefixes every character message with its speaker name', () => {
        const prompt = buildGroupPrompt();
        const contents = prompt.messages.map((message) => message.content);

        expect(contents).toContain('Aria: The fire is lit.');
        expect(contents).toContain('Bram: I brought stew.');
        expect(contents).toContain('Thank you.');
        expect(contents).not.toContain('Alex: Thank you.');
    });

    it('uses the group new-chat marker', () => {
        const prompt = buildGroupPrompt();
        const contents = prompt.messages.map((message) => message.content);
        expect(contents).toContain('[Start a new group chat. Group members: Aria, Bram]');
    });

    it('appends the group nudge last with the speaker expanded', () => {
        const prompt = buildGroupPrompt();
        const last = prompt.messages[prompt.messages.length - 1];

        expect(last).toMatchObject({ role: 'system', content: '[Write the next reply only as Seraphina.]' });
    });

    it('expands the group macros from the supplied roster', () => {
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            newChatPrompt: 'Members: {{group}} · speaking: {{groupNotMuted}}',
            group: { members: ['Aria', 'Bram', 'Cass'], enabled: ['Aria', 'Cass'] },
            generationType: 'normal',
        });
        const contents = prompt.messages.map((message) => message.content);

        expect(contents).toContain('Members: Aria, Bram, Cass · speaking: Aria, Cass');
    });

    it('prefixes narrator messages with their speaker too', () => {
        const prompt = buildPrompt({
            character: speaker,
            messages: [...history, { name: 'System', is_user: false, mes: 'Rain falls.', extra: { type: 'narrator' } }],
            persona,
            settings,
            prefixCharacterNames: true,
            generationType: 'normal',
        });
        const contents = prompt.messages.map((message) => message.content);

        expect(contents).toContain('System: Rain falls.');
    });

    it('leaves names alone outside group mode', () => {
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            generationType: 'normal',
        });
        const contents = prompt.messages.map((message) => message.content);

        expect(contents).toContain('The fire is lit.');
        expect(contents).not.toContain('Aria: The fire is lit.');
        expect(contents[contents.length - 1]).not.toBe('[Write the next reply only as Seraphina.]');
    });
});

describe('joined group cards', () => {
    it('replaces the speaker card fields with the merged ones', () => {
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            generationType: 'normal',
            joinedCard: {
                description: 'Aria guards the gate.\nBram keeps the stew.',
                personality: 'Alert.\nWarm.',
                scenario: 'A shared tavern.',
                mesExample: '<START>\nSeraphina: Who goes there?',
            },
        });
        const contents = prompt.messages.map((message) => message.content);

        expect(contents).toContain('Aria guards the gate.\nBram keeps the stew.');
        expect(contents).toContain('A shared tavern.');
        expect(contents).not.toContain('A guardian of Eldoria.');
        expect(contents).not.toContain('A forest glade.');
        // The merged examples are parsed into example blocks for the speaker.
        expect(contents.join('\n')).toContain('Who goes there?');
    });

    it('expands {{description}} from the merged card, as SillyTavern does', () => {
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            generationType: 'normal',
            groupNudge: 'Card says: {{description}}',
            joinedCard: {
                description: 'Merged description.',
                personality: 'Merged personality.',
                scenario: 'Merged scenario.',
                mesExample: '',
            },
        });
        const last = prompt.messages[prompt.messages.length - 1];

        expect(last?.content).toBe('Card says: Merged description.');
    });

    it('keeps the speaker card when no joined card is supplied', () => {
        const prompt = buildGroupPrompt();
        const contents = prompt.messages.map((message) => message.content);

        expect(contents).toContain('A guardian of Eldoria.');
    });
});

describe('card depth prompts', () => {
    it('injects a card aside in chat at the depth it asks for', () => {
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            generationType: 'normal',
            cardDepthPrompts: [
                {
                    fileName: 'Seraphina.json',
                    charName: 'Seraphina',
                    text: 'Stay in character.',
                    depth: 1,
                    role: 'system',
                },
            ],
        });
        const contents = prompt.messages.map((message) => message.content);

        expect(contents).toContain('Stay in character.');
        // Depth 1 is the last message before the newest turn.
        const index = contents.indexOf('Stay in character.');
        expect(contents[index - 1]).toBe('I brought stew.');
    });

    it('injects several asides in card order', () => {
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            generationType: 'normal',
            cardDepthPrompts: [
                { fileName: 'Aria.png', charName: 'Aria', text: 'Aria aside.', depth: 0, role: 'system' },
                { fileName: 'Bram.png', charName: 'Bram', text: 'Bram aside.', depth: 0, role: 'system' },
            ],
        });
        const contents = prompt.messages.map((message) => message.content);

        expect(contents).toContain('Aria aside.');
        expect(contents).toContain('Bram aside.');
        expect(contents.indexOf('Aria aside.')).toBeLessThan(contents.indexOf('Bram aside.'));
    });

    it('skips an empty aside', () => {
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            generationType: 'normal',
            cardDepthPrompts: [{ fileName: 'x', charName: 'X', text: '   ', depth: 0, role: 'system' }],
        });
        const contents = prompt.messages.map((message) => message.content);
        expect(contents.some((content) => content.trim() === '')).toBe(false);
    });
});
