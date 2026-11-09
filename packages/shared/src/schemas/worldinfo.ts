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

/** Positions understood by SillyTavern's prompt builder. */
export const WORLD_INFO_POSITION = {
    BEFORE_CHAR: 0,
    AFTER_CHAR: 1,
    AN_TOP: 2,
    AN_BOTTOM: 3,
    AT_DEPTH: 4,
} as const;
