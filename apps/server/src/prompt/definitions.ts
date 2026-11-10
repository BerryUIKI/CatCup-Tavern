// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/PromptManager.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import { DEFAULT_PROMPT_ORDER, type PromptEntry, type PromptOrderEntry } from '@catcup/shared';

/** Identifiers with behaviour attached. Everything else is plain content. */
export const IDENTIFIER = {
    MAIN: 'main',
    NSFW: 'nsfw',
    JAILBREAK: 'jailbreak',
    ENHANCE_DEFINITIONS: 'enhanceDefinitions',
    CHAT_HISTORY: 'chatHistory',
    DIALOGUE_EXAMPLES: 'dialogueExamples',
    WORLD_INFO_BEFORE: 'worldInfoBefore',
    WORLD_INFO_AFTER: 'worldInfoAfter',
    CHAR_DESCRIPTION: 'charDescription',
    CHAR_PERSONALITY: 'charPersonality',
    SCENARIO: 'scenario',
    PERSONA_DESCRIPTION: 'personaDescription',
} as const;

/** The fixed system prompts SillyTavern merges into the collection by identifier. */
export const SYSTEM_PROMPT_IDENTIFIERS: readonly string[] = [
    IDENTIFIER.WORLD_INFO_BEFORE,
    IDENTIFIER.WORLD_INFO_AFTER,
    IDENTIFIER.CHAR_DESCRIPTION,
    IDENTIFIER.CHAR_PERSONALITY,
    IDENTIFIER.SCENARIO,
    IDENTIFIER.PERSONA_DESCRIPTION,
];

/** Markers re-added at the end of the collection when absent from the order. */
export const MERGEABLE_IDENTIFIERS: readonly string[] = [
    IDENTIFIER.WORLD_INFO_BEFORE,
    IDENTIFIER.WORLD_INFO_AFTER,
    IDENTIFIER.CHAR_DESCRIPTION,
    IDENTIFIER.CHAR_PERSONALITY,
    IDENTIFIER.SCENARIO,
    IDENTIFIER.PERSONA_DESCRIPTION,
];

/** SillyTavern's built-in prompt definitions, in declaration order. */
export const ST_DEFAULT_PROMPTS: PromptEntry[] = [
    {
        identifier: IDENTIFIER.MAIN,
        name: 'Main Prompt',
        system_prompt: true,
        role: 'system',
        content: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.",
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.NSFW,
        name: 'Auxiliary Prompt',
        system_prompt: true,
        role: 'system',
        content: '',
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.DIALOGUE_EXAMPLES,
        name: 'Chat Examples',
        system_prompt: true,
        marker: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.JAILBREAK,
        name: 'Post-History Instructions',
        system_prompt: true,
        role: 'system',
        content: '',
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.CHAT_HISTORY,
        name: 'Chat History',
        system_prompt: true,
        marker: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.WORLD_INFO_AFTER,
        name: 'World Info (after)',
        system_prompt: true,
        marker: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.WORLD_INFO_BEFORE,
        name: 'World Info (before)',
        system_prompt: true,
        marker: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.ENHANCE_DEFINITIONS,
        name: 'Enhance Definitions',
        system_prompt: true,
        marker: false,
        role: 'system',
        content:
            "If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute.",
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.CHAR_DESCRIPTION,
        name: 'Char Description',
        system_prompt: true,
        marker: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.CHAR_PERSONALITY,
        name: 'Char Personality',
        system_prompt: true,
        marker: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.SCENARIO,
        name: 'Scenario',
        system_prompt: true,
        marker: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
    {
        identifier: IDENTIFIER.PERSONA_DESCRIPTION,
        name: 'Persona Description',
        system_prompt: true,
        marker: true,
        injection_position: 0,
        injection_depth: 4,
        injection_order: 100,
        injection_trigger: [],
        extension: false,
    },
];

/** The default order, cloned so callers can mutate it safely. */
export function defaultPromptOrder(): PromptOrderEntry[] {
    return DEFAULT_PROMPT_ORDER.map((entry) => ({ ...entry }));
}

/** Template strings SillyTavern inserts around injected content. */
export const DEFAULT_MESSAGES = {
    newChat: '[Start a new Chat]',
    newExampleChat: '[Example Chat]',
    continueNudge: '[Continue your last message without repeating its original content.]',
    impersonation:
        "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]",
} as const;

/** Formats applied to card fields and world info before assembly. */
export const DEFAULT_FORMATS = {
    wi: '{0}',
    personality: '{{personality}}',
    scenario: '{{scenario}}',
} as const;

/** `injection_position` values. */
export const INJECTION_POSITION = {
    RELATIVE: 0,
    ABSOLUTE: 1,
} as const;

/** `injection_order` default. */
export const DEFAULT_INJECTION_ORDER = 100;

/** Tokens SillyTavern reserves for the assistant priming. */
export const RESERVED_TOKENS = 3;

/** Generation types an entry can be limited to through `injection_trigger`. */
export type GenerationType = 'normal' | 'continue' | 'impersonate' | 'swipe' | 'regenerate' | 'quiet';
