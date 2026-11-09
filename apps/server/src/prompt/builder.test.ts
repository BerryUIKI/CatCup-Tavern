import type { CharacterDetail, ChatMessage } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { buildPrompt, substituteMacros } from './builder.js';

const character = {
    id: 'seraphina',
    fileName: 'Seraphina.png',
    format: 'png',
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
        post_history_instructions: 'Stay in character.',
        alternate_greetings: [],
        group_only_greetings: [],
        tags: [],
        creator: '',
        character_version: '',
        extensions: {},
    },
} as unknown as CharacterDetail;

const persona = { name: 'Alex', description: 'A curious traveler.' };
const settings = {
    temperature: 1,
    topP: 1,
    maxTokens: 256,
    contextSize: 4096,
    stream: true,
};

describe('prompt builder', () => {
    it('substitutes core macros', () => {
        const result = substituteMacros('{{char}} meets {{user}} in {{scenario}}', character, persona);
        expect(result).toBe('Seraphina meets Alex in A forest glade.');
    });

    it('builds a system prompt and a start-of-chat user turn', () => {
        const prompt = buildPrompt({
            character,
            messages: [],
            persona,
            settings,
        });
        expect(prompt[0]?.role).toBe('system');
        expect(prompt[0]?.content).toContain('Seraphina');
        expect(prompt.some((message) => message.role === 'user')).toBe(true);
        expect(prompt[prompt.length - 1]?.content).toBe('Stay in character.');
    });

    it('keeps the newest history under the token budget', () => {
        const messages: ChatMessage[] = Array.from({ length: 20 }, (_, index) => ({
            name: index % 2 === 0 ? 'Alex' : 'Seraphina',
            is_user: index % 2 === 0,
            mes: `Message ${index} ${'x'.repeat(200)}`,
        }));

        const prompt = buildPrompt({
            character,
            messages,
            persona,
            settings: { ...settings, contextSize: 900, maxTokens: 100 },
        });

        const hasLast = prompt.some((message) => message.content.includes('Message 19'));
        expect(hasLast).toBe(true);
        expect(prompt.length).toBeLessThan(20);
    });
});
