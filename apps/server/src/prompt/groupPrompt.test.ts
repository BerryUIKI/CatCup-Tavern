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
