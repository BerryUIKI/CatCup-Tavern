import { z } from 'zod';

/**
 * SillyTavern World Info (lorebook) JSON format.
 *
 * Entries are keyed by uid string and use snake_case / camelCase field names
 * from SillyTavern's own format.
 *
 * SillyTavern writes `null` for several numeric and string fields to mean
 * "unset" (its editor template defaults `sticky`, `cooldown`, `delay` and
 * `group_weight` to `null`), and it tolerates non-array values for the key
 * lists. This schema normalizes both, because rejecting a record would drop a
 * whole lorebook entry: `key: null` and `sticky: null` are ordinary in files
 * produced by SillyTavern and by card exporters.
 */

/** A numeric field where `null` means "unset" and falls back to the ST default. */
const numberOr = (fallback: number) =>
    z
        .number()
        .nullish()
        .transform((value) => value ?? fallback);

/** A string field where `null` means "unset". */
const stringOr = (fallback: string) =>
    z
        .string()
        .nullish()
        .transform((value) => value ?? fallback);

/** A boolean field where `null` means "unset". */
const booleanOr = (fallback: boolean) =>
    z
        .boolean()
        .nullish()
        .transform((value) => value ?? fallback);

/**
 * A list of strings. SillyTavern guards these with `Array.isArray`, so a
 * non-array value behaves as an empty list rather than breaking the entry.
 */
const stringList = () =>
    z
        .unknown()
        .nullish()
        .transform((value): string[] =>
            Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [],
        );

export const characterFilterSchema = z
    .object({
        names: stringList(),
        tags: stringList(),
        isExclude: booleanOr(false),
    })
    .nullish()
    .transform((value) => value ?? undefined);

export const worldInfoEntrySchema = z
    .object({
        uid: z.number().optional(),
        key: stringList(),
        keysecondary: stringList(),
        comment: stringOr(''),
        content: stringOr(''),
        constant: booleanOr(false),
        selective: booleanOr(false),
        selectiveLogic: numberOr(0),
        order: numberOr(100),
        position: numberOr(0),
        disable: booleanOr(false),
        displayIndex: z.number().optional(),
        addMemo: z.boolean().optional(),
        group: stringOr(''),
        groupOverride: booleanOr(false),
        groupWeight: numberOr(100),
        sticky: numberOr(0),
        cooldown: numberOr(0),
        delay: numberOr(0),
        probability: numberOr(100),
        depth: numberOr(4),
        useProbability: booleanOr(true),
        role: z.number().nullable().default(null),
        vectorized: booleanOr(false),
        excludeRecursion: booleanOr(false),
        preventRecursion: booleanOr(false),
        delayUntilRecursion: z
            .union([z.boolean(), z.number()])
            .nullish()
            .transform((value) => value ?? false),
        scanDepth: z.number().nullable().default(null),
        caseSensitive: z.boolean().nullable().default(null),
        matchWholeWords: z.boolean().nullable().default(null),
        useGroupScoring: z.boolean().nullable().default(null),
        matchPersonaDescription: booleanOr(false),
        matchCharacterDescription: booleanOr(false),
        matchCharacterPersonality: booleanOr(false),
        matchCharacterDepthPrompt: booleanOr(false),
        matchScenario: booleanOr(false),
        matchCreatorNotes: booleanOr(false),
        characterFilter: characterFilterSchema,
        ignoreBudget: booleanOr(false),
        outletName: stringOr(''),
        triggers: stringList(),
        automationId: stringOr(''),
        extensions: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough();

export const worldInfoFileSchema = z
    .object({
        entries: z.record(z.string(), worldInfoEntrySchema).default({}),
    })
    .passthrough();

export type CharacterFilter = z.infer<typeof characterFilterSchema>;
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

/** Example-message anchor positions, persisted as `0` top and `1` bottom. */
export const WI_ANCHOR_POSITION = {
    BEFORE: 0,
    AFTER: 1,
} as const;
