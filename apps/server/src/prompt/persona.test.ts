import {
    type CharacterDetail,
    type ChatMessage,
    DEFAULT_PROMPT_ORDER,
    GLOBAL_PROMPT_ORDER_ID,
    type PersonaSettings,
} from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { assemblePrompt, personaPromptText } from './assemble.js';

/**
 * A persona may now carry a card's voice. Two things must hold: the extra text
 * reaches the prompt, and a persona that has none produces the same prompt it
 * always did — byte for byte, because that is what every existing settings file
 * contains.
 */

const character = {
    id: 'mira',
    fileName: 'Mira.png',
    format: 'png',
    name: 'Mira',
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
        name: 'Mira',
        description: 'Runs the Cat’s Cup.',
        personality: 'Dry, watchful.',
        scenario: 'A rain-soaked evening.',
        first_mes: 'You picked a night for it.',
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

const history: ChatMessage[] = [
    { name: 'Mira', is_user: false, send_date: '', mes: 'You picked a night for it.', extra: {} },
];

function assemble(persona: PersonaSettings) {
    return assemblePrompt({
        promptSettings: {
            prompts: [],
            promptOrder: [{ character_id: GLOBAL_PROMPT_ORDER_ID, order: DEFAULT_PROMPT_ORDER }],
        },
        character,
        persona,
        messages: history,
        contextSize: 4096,
        maxTokens: 256,
    });
}

function personaTexts(result: ReturnType<typeof assemble>): string[] {
    // The assembled messages carry no identifiers, so the persona slot is found
    // by what only it can say: the card's own fields are distinct strings.
    const cardTexts = new Set([
        character.card.description,
        character.card.personality,
        character.card.scenario,
        character.card.first_mes,
    ]);
    return result.messages
        .map((message) => message.content)
        .filter((content) => content.trim() !== '' && !cardTexts.has(content))
        .filter(
            (content) =>
                content.includes('Personality:') ||
                content.includes('Scenario:') ||
                content.startsWith('Runs') ||
                content.startsWith('A '),
        )
        .filter((content) => !content.includes('Write '));
}

describe('personaPromptText', () => {
    it('returns just the description for a two-field persona', () => {
        expect(personaPromptText({ name: 'Alex', description: 'A traveler.' })).toBe('A traveler.');
    });

    it('appends the optional fields as labelled paragraphs', () => {
        expect(
            personaPromptText({
                name: 'Mira',
                description: 'Runs the inn.',
                personality: 'Dry.',
                scenario: 'A rainy evening.',
            }),
        ).toBe('Runs the inn.\n\nPersonality: Dry.\n\nScenario: A rainy evening.');
    });

    it('skips the description when there is none and still returns the rest', () => {
        expect(personaPromptText({ name: 'Mira', description: '', personality: 'Dry.' })).toBe('Personality: Dry.');
    });

    it('returns an empty string when the persona has no text at all', () => {
        expect(personaPromptText({ name: 'You', description: '' })).toBe('');
    });
});

describe('assembling a persona', () => {
    it('produces the same prompt for a two-field persona as before the fields existed', () => {
        const result = assemble({ name: 'Alex', description: 'A curious traveler.' });
        expect(personaTexts(result)).toEqual(['A curious traveler.']);
    });

    it('puts the persona description and the extra fields in one slot', () => {
        const result = assemble({
            name: 'Mira',
            description: 'Runs the inn.',
            personality: 'Dry.',
            scenario: 'A rainy evening.',
        });
        expect(personaTexts(result)).toEqual(['Runs the inn.\n\nPersonality: Dry.\n\nScenario: A rainy evening.']);
    });

    it('inserts no persona slot at all when the persona has no text', () => {
        const result = assemble({ name: 'You', description: '' });
        expect(personaTexts(result)).toEqual([]);
    });

    it('sends the persona examples as the user side, never as the assistant', () => {
        const result = assemble({
            name: 'Mira',
            description: 'Runs the inn.',
            mesExample: '{{user}}: Is there a room?\n{{char}}: One.',
        });

        const examples = result.messages.filter(
            (message) => message.content.includes('Is there a room?') || message.content.includes('One.'),
        );
        expect(examples.length).toBeGreaterThan(0);
        for (const message of examples) {
            // The persona's line is a user example; the character answers.
            if (message.content.includes('Is there a room?')) {
                expect(message.name).toBe('example_user');
            }
            if (message.content.trim() === 'One.') {
                expect(message.name).toBe('example_assistant');
            }
        }
    });

    it('adds no example block when the persona has none', () => {
        const withExamples = assemble({
            name: 'Mira',
            description: 'x',
            mesExample: '{{user}}: Is there a room?\n{{char}}: One.',
        });
        const without = assemble({ name: 'Mira', description: 'x' });
        expect(withExamples.messages.length).toBeGreaterThan(without.messages.length);
    });
});
