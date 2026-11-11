import {
    type CharacterDetail,
    type ChatMessage,
    DEFAULT_PROMPT_ORDER,
    GLOBAL_PROMPT_ORDER_ID,
    type PromptEntry,
} from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { buildPrompt } from './builder.js';
import { IDENTIFIER, ST_DEFAULT_PROMPTS } from './definitions.js';

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
    { name: 'Seraphina', is_user: false, mes: 'The fire is lit.' },
    { name: 'Alex', is_user: true, mes: 'Thank you.' },
];

function promptWith(
    position: number,
    role = 0,
    depth = 1,
    template = '[Summary: The gate opened.]',
): ReturnType<typeof buildPrompt> {
    return buildPrompt({
        character: speaker,
        messages: history,
        persona,
        settings,
        generationType: 'normal',
        summaryText: 'The gate opened.',
        summaryInjection: { content: template, position, role, depth },
    });
}

function mainIndex(messages: ReturnType<typeof buildPrompt>['messages']): number {
    return messages.findIndex((message) => message.content.includes("Write Seraphina's next reply"));
}

describe('summary memory injection', () => {
    it('places the summary after the main prompt by default', () => {
        const prompt = promptWith(0);
        const index = mainIndex(prompt.messages);

        expect(index).toBeGreaterThanOrEqual(0);
        expect(prompt.messages[index + 1]).toMatchObject({
            role: 'system',
            content: '[Summary: The gate opened.]',
        });
    });

    it('places the summary before the main prompt when asked', () => {
        const prompt = promptWith(2);
        const index = mainIndex(prompt.messages);

        expect(prompt.messages[index - 1]).toMatchObject({
            role: 'system',
            content: '[Summary: The gate opened.]',
        });
    });

    it('injects the summary in chat at the configured depth and role', () => {
        const prompt = promptWith(1, 1, 1);
        const summaryIndex = prompt.messages.findIndex((message) => message.content === '[Summary: The gate opened.]');

        expect(summaryIndex).toBeGreaterThan(0);
        expect(prompt.messages[summaryIndex]?.role).toBe('user');
        expect(prompt.messages[summaryIndex + 1]?.content).toBe('Thank you.');
    });

    it('omits the summary when the position is none', () => {
        const prompt = promptWith(-1);
        expect(prompt.messages.some((message) => message.content.includes('[Summary:'))).toBe(false);
    });

    it('expands the summary macro in prompt entries', () => {
        const prompts: PromptEntry[] = ST_DEFAULT_PROMPTS.map((prompt) =>
            prompt.identifier === IDENTIFIER.MAIN ? { ...prompt, content: 'Story so far: {{summary}}' } : prompt,
        );
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            promptSettings: {
                prompts,
                promptOrder: [
                    {
                        character_id: GLOBAL_PROMPT_ORDER_ID,
                        order: DEFAULT_PROMPT_ORDER.map((entry) => ({ ...entry })),
                    },
                ],
            },
            generationType: 'normal',
            summaryText: 'The gate opened.',
        });

        expect(prompt.messages.some((message) => message.content === 'Story so far: The gate opened.')).toBe(true);
    });

    it('moves the summary beside an in-chat main prompt', () => {
        const prompts: PromptEntry[] = ST_DEFAULT_PROMPTS.map((prompt) =>
            prompt.identifier === IDENTIFIER.MAIN
                ? { ...prompt, injection_position: 1, injection_depth: 1, injection_order: 50 }
                : prompt,
        );
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            promptSettings: {
                prompts,
                promptOrder: [
                    {
                        character_id: GLOBAL_PROMPT_ORDER_ID,
                        order: DEFAULT_PROMPT_ORDER.map((entry) => ({ ...entry })),
                    },
                ],
            },
            generationType: 'normal',
            summaryInjection: { content: '[Summary: The gate opened.]', position: 0, role: 0, depth: 1 },
        });

        // The summary joins the absolute main prompt in the same depth bucket
        // instead of becoming a standalone top-level system message.
        expect(
            prompt.messages.some(
                (message) =>
                    message.content.includes("Write Seraphina's next reply") &&
                    message.content.includes('[Summary: The gate opened.]'),
            ),
        ).toBe(true);
    });

    it('does not expand an empty summary', () => {
        const prompt = buildPrompt({
            character: speaker,
            messages: history,
            persona,
            settings,
            generationType: 'normal',
        });
        const contents = prompt.messages.map((message) => message.content).join('\n');
        expect(contents).not.toContain('[Summary:');
    });
});
