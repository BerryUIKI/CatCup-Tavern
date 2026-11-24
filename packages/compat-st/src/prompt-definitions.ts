// Written for CatCup. The identifiers a prompt preset refers to, and the
// default prompt list a preset with none starts from.

import { DEFAULT_PROMPT_ORDER, type PromptEntry, type PromptOrderEntry } from '@catcup/shared';

/**
 * The preset's prompt vocabulary.
 *
 * A preset stores a list of `{ identifier, enabled }` and a client has to agree
 * on what each identifier *means*, or a preset exported here reads differently
 * in another client. The field list is in `docs/DATA-FORMATS.md`; this file is
 * where the identifiers themselves live, and they are the exchange format —
 * renaming one would silently reorder every imported preset.
 *
 * Two things here are **not** format and are CatCup's own: the instruction text
 * inside `MAIN`, `ENHANCE_DEFINITIONS` and the rest, and the message templates.
 * A preset always carries its own text, so these are only what a fresh install
 * or an empty preset starts from — which is exactly why they can be written for
 * this project without breaking anything that came from elsewhere.
 */

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
    /**
     * The director's standing instructions and cast block.
     *
     * Placed after the persona and before the character description, so the
     * rules sit with the other system material rather than in the dialogue.
     * Absent from the prompt entirely when no director is enabled.
     */
    DIRECTOR_RULES: 'directorRules',
} as const;

/**
 * Identifiers whose content the caller supplies rather than the preset.
 *
 * These are merged into the collection by their identifier: the card, the
 * persona and the world info scan fill them, and a preset that omits one still
 * gets it.
 */
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

/**
 * The default prompt definitions, in declaration order.
 *
 * The order, the identifiers and the marker flags are the exchange format
 * — a preset stores them and a client has to agree on what they mean. The
 * two instruction strings below are CatCup's own wording.
 */
export const ST_DEFAULT_PROMPTS: PromptEntry[] = [
    {
        identifier: IDENTIFIER.MAIN,
        name: 'Main Prompt',
        system_prompt: true,
        role: 'system',
        content:
            'Continue the scene as {{char}}, replying to {{user}} in a fictional chat. Stay in character and in the scene.',
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
            'Anything you know about {{char}} beyond this sheet may inform tone and detail, but the fields above are canonical: where they disagree, they win.',
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
    {
        /**
         * The director. Marker-only like the persona and character blocks: the
         * content comes from the chat's own director config, never from here.
         *
         * It is always in the list and injects nothing unless the chat has an
         * enabled director, which is what makes "a chat without a director
         * behaves exactly as before" true without a second code path.
         */
        identifier: IDENTIFIER.DIRECTOR_RULES,
        name: 'Director',
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

/**
 * Template strings inserted around injected content.
 *
 * The two bracketed placeholders are labels rather than instruction — a model
 * reading `[Start a new Chat]` needs no help with what it means, and a preset
 * that carries its own text replaces either of them. The two prompts below are
 * CatCup's own wording.
 */
export const DEFAULT_MESSAGES = {
    newChat: '[Start a new Chat]',
    newExampleChat: '[Example Chat]',
    continueNudge: '[Keep going from where that reply stopped. Do not repeat what it already said.]',
    impersonation:
        '[Reply as {{user}}: carry on the scene in their voice and their style, drawn from the history so far. Never speak as {{char}} or as the system, and never narrate what {{char}} does.]',
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

/**
 * Tokens held back from the budget for the assistant priming.
 *
 * A provider that takes a trailing assistant turn spends tokens on it that the
 * prompt's own estimate does not see, so the budget reserves room rather than
 * discovering the overrun at request time.
 */
export const RESERVED_TOKENS = 3;

/** Generation types an entry can be limited to through `injection_trigger`. */
export type GenerationType = 'normal' | 'continue' | 'impersonate' | 'swipe' | 'regenerate' | 'quiet';
