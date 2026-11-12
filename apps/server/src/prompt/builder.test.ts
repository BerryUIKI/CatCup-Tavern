import {
    type CharacterDetail,
    type ChatMessage,
    DEFAULT_PROMPT_ORDER,
    GLOBAL_PROMPT_ORDER_ID,
    type PromptEntry,
    type PromptOrderEntry,
} from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import type { WorldInfoPrompt } from '../worldinfo/types.js';
import { buildPrompt } from './builder.js';
import { substituteMacros } from './macros.js';
import type { PromptSettings } from './manager.js';

const character = {
    id: 'seraphina',
    fileName: 'Seraphina.png',
    format: 'png',
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
const settings = { temperature: 1, topP: 1, maxTokens: 256, contextSize: 4096, stream: true };

const history: ChatMessage[] = [
    { name: 'Seraphina', is_user: false, send_date: '', mes: 'Welcome, traveler.', extra: {} },
    { name: 'Alex', is_user: true, send_date: '', mes: 'Thank you.', extra: {} },
];

function worldInfo(overrides: Partial<WorldInfoPrompt> = {}): WorldInfoPrompt {
    return {
        worldInfoBefore: '',
        worldInfoAfter: '',
        worldInfoString: '',
        worldInfoExamples: [],
        worldInfoDepth: [],
        anBefore: [],
        anAfter: [],
        outletEntries: {},
        authorNote: null,
        buckets: {
            before: [],
            after: [],
            authorNoteTop: [],
            authorNoteBottom: [],
            atDepth: [],
            examples: [],
            outlets: {},
        },
        ...overrides,
    };
}

function orderWith(identifier: string, enabled: boolean) {
    return DEFAULT_PROMPT_ORDER.map((entry) =>
        entry.identifier === identifier ? { ...entry, enabled } : { ...entry },
    );
}

function promptSettings(overrides: Partial<PromptSettings> = {}): Partial<PromptSettings> {
    return overrides;
}

/** Fill the schema defaults a raw preset definition may omit. */
function promptEntry(overrides: Record<string, unknown>): PromptEntry {
    return {
        identifier: '',
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
        ...overrides,
    } as PromptEntry;
}

function orderEndingWith(identifier: Record<string, unknown>): PromptOrderEntry[] {
    return [
        ...DEFAULT_PROMPT_ORDER.map((entry) => ({ ...entry })),
        { identifier: String(identifier.identifier), enabled: true },
    ];
}

describe('prompt assembly', () => {
    it('emits one message per marker in prompt-order order', () => {
        const result = buildPrompt({ character, messages: history, persona, settings });

        expect(result.messages.map((message) => message.content)).toEqual([
            "Write Seraphina's next reply in a fictional chat between Seraphina and Alex.",
            'A curious traveler.',
            'A guardian of Eldoria.',
            'Kind and watchful.',
            'A forest glade.',
            '[Start a new Chat]',
            'Welcome, traveler.',
            'Thank you.',
            'Stay in character.',
        ]);
        expect(result.messages[6]?.role).toBe('assistant');
        expect(result.messages[7]?.role).toBe('user');
    });

    it('expands macros in chat history without touching the stored message', () => {
        const greeting: ChatMessage = {
            name: 'Seraphina',
            is_user: false,
            send_date: '',
            mes: 'Welcome, {{user}}. I am {{char}}.',
            extra: {},
        };

        const result = buildPrompt({ character, messages: [greeting], persona, settings });

        expect(result.messages.map((message) => message.content)).toContain('Welcome, Alex. I am Seraphina.');
        expect(greeting.mes).toBe('Welcome, {{user}}. I am {{char}}.');
    });

    it('does not merge the character sheet into one message', () => {
        const result = buildPrompt({ character, messages: [], persona, settings });
        const systemMessages = result.messages.filter((message) => message.role === 'system');
        expect(systemMessages.length).toBeGreaterThanOrEqual(5);
        expect(systemMessages.some((message) => message.content.includes('[Character:'))).toBe(false);
    });

    it('places world info in its own slots', () => {
        const result = buildPrompt({
            character,
            messages: [],
            persona,
            settings,
            worldInfo: worldInfo({ worldInfoBefore: 'Lore before', worldInfoAfter: 'Lore after' }),
        });

        const contents = result.messages.map((message) => message.content);
        expect(contents[1]).toBe('Lore before');
        expect(contents[contents.indexOf('A forest glade.') + 1]).toBe('Lore after');
    });

    it('applies wi_format once per bucket', () => {
        const result = buildPrompt({
            character,
            messages: [],
            persona,
            settings,
            worldInfo: worldInfo({ worldInfoBefore: 'Lore' }),
            formats: { wi: '<{0}>' },
        });

        expect(result.messages.map((message) => message.content)).toContain('<Lore>');
    });

    it('lets the character card override the main prompt with {{original}}', () => {
        const withMain = {
            ...character,
            card: { ...character.card, system_prompt: 'Card prompt. {{original}}' },
        } as CharacterDetail;

        const result = buildPrompt({ character: withMain, messages: [], persona, settings });

        expect(result.messages[0]?.content).toBe(
            "Card prompt. Write Seraphina's next reply in a fictional chat between Seraphina and Alex.",
        );
    });

    it('ignores the card override when forbid_overrides is set', () => {
        const prompts = {
            prompts: [
                promptEntry({
                    identifier: 'main',
                    system_prompt: true,
                    content: 'Preset main',
                    forbid_overrides: true,
                }),
            ],
        };
        const withMain = {
            ...character,
            card: { ...character.card, system_prompt: 'Card prompt' },
        } as CharacterDetail;

        const result = buildPrompt({
            character: withMain,
            messages: [],
            persona,
            settings,
            promptSettings: prompts,
        });

        expect(result.messages[0]?.content).toBe('Preset main');
    });

    it('drops history entirely when the chatHistory marker is disabled', () => {
        const result = buildPrompt({
            character,
            messages: history,
            persona,
            settings,
            promptSettings: promptSettings({
                promptOrder: [{ character_id: GLOBAL_PROMPT_ORDER_ID, order: orderWith('chatHistory', false) }],
            }),
        });

        const contents = result.messages.map((message) => message.content);
        expect(contents).not.toContain('[Start a new Chat]');
        expect(contents).not.toContain('Welcome, traveler.');
    });

    it('appends a marker missing from the order at the end', () => {
        const order = DEFAULT_PROMPT_ORDER.filter((entry) => entry.identifier !== 'charDescription');
        const result = buildPrompt({
            character,
            messages: [],
            persona,
            settings,
            promptSettings: promptSettings({
                promptOrder: [{ character_id: GLOBAL_PROMPT_ORDER_ID, order }],
            }),
        });

        expect(result.messages[result.messages.length - 1]?.content).toBe('A guardian of Eldoria.');
    });

    it('honours injection_trigger', () => {
        const prompts = {
            prompts: [
                promptEntry({
                    identifier: 'continueOnly',
                    system_prompt: false,
                    role: 'system',
                    content: 'Continue only',
                    injection_trigger: ['continue'],
                }),
            ],
            promptOrder: [
                {
                    character_id: GLOBAL_PROMPT_ORDER_ID,
                    order: orderEndingWith({ identifier: 'continueOnly' }),
                },
            ],
        };

        const normal = buildPrompt({ character, messages: [], persona, settings, promptSettings: prompts });
        expect(normal.messages.map((message) => message.content)).not.toContain('Continue only');

        const cont = buildPrompt({
            character,
            messages: [],
            persona,
            settings,
            promptSettings: prompts,
            generationType: 'continue',
        });
        expect(cont.messages.map((message) => message.content)).toContain('Continue only');
    });

    it('injects absolute prompts at their depth', () => {
        const prompts = {
            prompts: [
                promptEntry({
                    identifier: 'deep',
                    system_prompt: false,
                    role: 'system',
                    content: 'Deep lore',
                    injection_position: 1,
                    injection_depth: 1,
                }),
            ],
            promptOrder: [
                {
                    character_id: GLOBAL_PROMPT_ORDER_ID,
                    order: orderEndingWith({ identifier: 'deep' }),
                },
            ],
        };

        const result = buildPrompt({ character, messages: history, persona, settings, promptSettings: prompts });
        const contents = result.messages.map((message) => message.content);

        expect(contents[contents.indexOf('Deep lore') + 1]).toBe('Thank you.');
    });

    it('injects the author note into the chat at its depth', () => {
        const result = buildPrompt({
            character,
            messages: history,
            persona,
            settings,
            worldInfo: worldInfo({
                authorNote: { value: 'Remember the glade.', position: 1, depth: 0, role: 0, scan: false },
            }),
        });

        const contents = result.messages.map((message) => message.content);
        expect(contents[contents.indexOf('Remember the glade.') + 1]).toBe('Stay in character.');
    });

    it('parses example dialogue into named system messages', () => {
        const withExamples = {
            ...character,
            card: {
                ...character.card,
                mes_example: ['<START>', '{{user}}: Hello there', '{{char}}: Hi, traveler.', ''].join('\n'),
            },
        } as CharacterDetail;

        const result = buildPrompt({ character: withExamples, messages: [], persona, settings });
        const examples = result.messages.filter((message) => message.name);

        expect(examples.map((message) => [message.name, message.content])).toEqual([
            ['example_user', 'Hello there'],
            ['example_assistant', 'Hi, traveler.'],
        ]);
    });

    it('adds the continue nudge last', () => {
        const result = buildPrompt({ character, messages: history, persona, settings, generationType: 'continue' });

        expect(result.messages[result.messages.length - 1]?.content).toBe(
            '[Continue your last message without repeating its original content.]',
        );
    });

    it('drops the oldest history first when the budget is short', () => {
        const longHistory: ChatMessage[] = [
            { name: 'Seraphina', is_user: false, send_date: '', mes: 'x'.repeat(300), extra: {} },
            ...history,
        ];

        const result = buildPrompt({
            character,
            messages: longHistory,
            persona,
            settings: { ...settings, contextSize: 400, maxTokens: 10 },
            countTokens: (text) => text.length,
        });

        const contents = result.messages.map((message) => message.content);
        expect(contents).toContain('Thank you.');
        expect(contents).toContain('Welcome, traveler.');
        expect(contents).not.toContain('x'.repeat(300));
    });

    it('merges adjacent system messages when squashing is enabled', () => {
        const separate = buildPrompt({ character, messages: [], persona, settings });
        const squashed = buildPrompt({ character, messages: [], persona, settings, squashSystemMessages: true });

        expect(squashed.messages.length).toBeLessThan(separate.messages.length);
        expect(squashed.messages[0]?.content).toContain("Write Seraphina's next reply");
        expect(squashed.messages[0]?.content).toContain('A guardian of Eldoria.');
    });
});

describe('macros', () => {
    const context = {
        char: 'Seraphina',
        user: 'Alex',
        description: 'A guardian.',
        personality: 'Kind.',
        scenario: 'A glade.',
    };

    it('substitutes the core macros', () => {
        expect(substituteMacros('{{char}} meets {{user}} in {{scenario}}', context)).toBe(
            'Seraphina meets Alex in A glade.',
        );
    });

    it('expands original only once', () => {
        expect(substituteMacros('{{original}} / {{original}}', { ...context, original: 'base' })).toBe('base / ');
    });

    it('leaves unknown macros untouched', () => {
        expect(substituteMacros('{{unknown}}', context)).toBe('{{unknown}}');
    });
});
