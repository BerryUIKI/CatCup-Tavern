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
        /**
         * SillyTavern's entry template defaults `selective` to `true`, so an
         * entry that only lists secondary keys still applies their logic.
         */
        selective: booleanOr(true),
        selectiveLogic: numberOr(0),
        /**
         * Insertion order. SillyTavern defaults a *missing* order to 100 but
         * coerces an explicit `null` through `Number()`, which makes it 0, so
         * the two are not the same and both spellings are kept distinct.
         */
        order: z
            .number()
            .nullish()
            .transform((value) => (value === null ? 0 : (value ?? 100))),
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

const characterFilterPatchSchema = z
    .object({
        names: z.array(z.string()),
        tags: z.array(z.string()),
        isExclude: z.boolean(),
    })
    .strict();

/**
 * Fields the world info entry editor is allowed to change.
 *
 * The patch is merged into the entry as stored on disk, so any field that is
 * absent here — an extension's data, a SillyTavern field this editor does not
 * show, an unknown key from a hand-edited file — survives a save untouched.
 *
 * `uid` and `displayIndex` are absent because the server owns them, and
 * `vectorized` is absent because SillyTavern only sets it from its
 * vectorization extension.
 */
export const worldInfoEntryPatchSchema = z
    .object({
        key: z.array(z.string()).optional(),
        keysecondary: z.array(z.string()).optional(),
        comment: z.string().optional(),
        content: z.string().optional(),
        constant: z.boolean().optional(),
        selective: z.boolean().optional(),
        selectiveLogic: z.number().int().min(0).max(3).optional(),
        order: z.number().int().optional(),
        position: z.number().int().min(0).max(7).optional(),
        disable: z.boolean().optional(),
        addMemo: z.boolean().optional(),
        group: z.string().optional(),
        groupOverride: z.boolean().optional(),
        groupWeight: z.number().optional(),
        sticky: z.number().int().min(0).optional(),
        cooldown: z.number().int().min(0).optional(),
        delay: z.number().int().min(0).optional(),
        probability: z.number().min(0).max(100).optional(),
        depth: z.number().int().min(0).optional(),
        useProbability: z.boolean().optional(),
        role: z.number().int().min(0).max(2).nullable().optional(),
        excludeRecursion: z.boolean().optional(),
        preventRecursion: z.boolean().optional(),
        delayUntilRecursion: z.union([z.boolean(), z.number().int().min(0)]).optional(),
        scanDepth: z.number().int().min(0).nullable().optional(),
        caseSensitive: z.boolean().nullable().optional(),
        matchWholeWords: z.boolean().nullable().optional(),
        useGroupScoring: z.boolean().nullable().optional(),
        matchPersonaDescription: z.boolean().optional(),
        matchCharacterDescription: z.boolean().optional(),
        matchCharacterPersonality: z.boolean().optional(),
        matchCharacterDepthPrompt: z.boolean().optional(),
        matchScenario: z.boolean().optional(),
        matchCreatorNotes: z.boolean().optional(),
        characterFilter: characterFilterPatchSchema.nullable().optional(),
        ignoreBudget: z.boolean().optional(),
        outletName: z.string().optional(),
        triggers: z.array(z.string()).optional(),
        automationId: z.string().optional(),
    })
    .strict();

export type CharacterFilter = z.infer<typeof characterFilterSchema>;
export type WorldInfoEntry = z.infer<typeof worldInfoEntrySchema>;
export type WorldInfoEntryPatch = z.infer<typeof worldInfoEntryPatchSchema>;
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
