import { z } from 'zod';

/**
 * SillyTavern World Info (lorebook) JSON format.
 *
 * Entries are keyed by uid string and use snake_case / camelCase field names
 * from SillyTavern's own format.
 */

export const worldInfoEntrySchema = z
    .object({
        uid: z.number().optional(),
        key: z.array(z.string()).default([]),
        keysecondary: z.array(z.string()).default([]),
        comment: z.string().default(''),
        content: z.string().default(''),
        constant: z.boolean().default(false),
        selective: z.boolean().default(false),
        selectiveLogic: z.number().default(0),
        order: z.number().default(100),
        position: z.number().default(0),
        disable: z.boolean().default(false),
        displayIndex: z.number().optional(),
        addMemo: z.boolean().optional(),
        group: z.string().default(''),
        groupOverride: z.boolean().default(false),
        groupWeight: z.number().default(100),
        sticky: z.number().default(0),
        cooldown: z.number().default(0),
        delay: z.number().default(0),
        probability: z.number().default(100),
        depth: z.number().default(4),
        useProbability: z.boolean().default(true),
        role: z.number().nullable().default(null),
        vectorized: z.boolean().default(false),
        excludeRecursion: z.boolean().default(false),
        preventRecursion: z.boolean().default(false),
        delayUntilRecursion: z.union([z.boolean(), z.number()]).default(false),
        scanDepth: z.number().nullable().default(null),
        caseSensitive: z.boolean().nullable().default(null),
        matchWholeWords: z.boolean().nullable().default(null),
        useGroupScoring: z.boolean().nullable().default(null),
        matchPersonaDescription: z.boolean().default(false),
        matchCharacterDescription: z.boolean().default(false),
        matchCharacterPersonality: z.boolean().default(false),
        matchCharacterDepthPrompt: z.boolean().default(false),
        matchScenario: z.boolean().default(false),
        matchCreatorNotes: z.boolean().default(false),
        ignoreBudget: z.boolean().default(false),
        outletName: z.string().default(''),
        triggers: z.array(z.string()).default([]),
        automationId: z.string().default(''),
        extensions: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough();

export const worldInfoFileSchema = z
    .object({
        entries: z.record(z.string(), worldInfoEntrySchema).default({}),
    })
    .passthrough();

export type WorldInfoEntry = z.infer<typeof worldInfoEntrySchema>;
export type WorldInfoFile = z.infer<typeof worldInfoFileSchema>;

/**
 * Injection positions understood by SillyTavern's prompt builder. The numeric
 * values are persisted in world info files and must not be renumbered.
 */
export const WORLD_INFO_POSITION = {
    BEFORE_CHAR: 0,
    AFTER_CHAR: 1,
    AN_TOP: 2,
    AN_BOTTOM: 3,
    AT_DEPTH: 4,
    EM_TOP: 5,
    EM_BOTTOM: 6,
    OUTLET: 7,
} as const;

/** Secondary-keyword logic, persisted as `selectiveLogic`. */
export const WORLD_INFO_LOGIC = {
    AND_ANY: 0,
    NOT_ALL: 1,
    NOT_ANY: 2,
    AND_ALL: 3,
} as const;

/** Roles for depth-injected entries. */
export const PROMPT_ROLE = {
    SYSTEM: 0,
    USER: 1,
    ASSISTANT: 2,
} as const;
