import { z } from 'zod';

/**
 * Character Card V2/V3 schemas.
 *
 * Field names follow the SillyTavern / Character Card spec so cards can be
 * imported and exported without translation. Unknown fields are preserved via
 * passthrough objects.
 *
 * Derived from the Character Card V2/V3 specification used by SillyTavern.
 * @see https://github.com/SillyTavern/SillyTavern
 */

export const characterBookEntrySchema = z
    .object({
        keys: z.array(z.string()).default([]),
        content: z.string().default(''),
        extensions: z.record(z.string(), z.unknown()).default({}),
        enabled: z.boolean().default(true),
        insertion_order: z.number().default(100),
        case_sensitive: z.boolean().optional(),
        name: z.string().optional(),
        priority: z.number().optional(),
        id: z.number().optional(),
        comment: z.string().optional(),
        selective: z.boolean().optional(),
        secondary_keys: z.array(z.string()).optional(),
        constant: z.boolean().optional(),
        position: z.enum(['before_char', 'after_char']).optional(),
    })
    .passthrough();

export const characterBookSchema = z
    .object({
        name: z.string().optional(),
        description: z.string().optional(),
        scan_depth: z.number().optional(),
        token_budget: z.number().optional(),
        recursive_scanning: z.boolean().optional(),
        extensions: z.record(z.string(), z.unknown()).default({}),
        entries: z.array(characterBookEntrySchema).default([]),
    })
    .passthrough();

export const characterCardDataSchema = z
    .object({
        name: z.string().default('Unnamed'),
        nickname: z.string().optional(),
        description: z.string().default(''),
        personality: z.string().default(''),
        scenario: z.string().default(''),
        first_mes: z.string().default(''),
        mes_example: z.string().default(''),
        creator_notes: z.string().default(''),
        creator_notes_multilingual: z.record(z.string(), z.string()).optional(),
        system_prompt: z.string().default(''),
        post_history_instructions: z.string().default(''),
        alternate_greetings: z.array(z.string()).default([]),
        group_only_greetings: z.array(z.string()).default([]),
        character_book: characterBookSchema.optional(),
        tags: z.array(z.string()).default([]),
        creator: z.string().default(''),
        character_version: z.string().default(''),
        extensions: z.record(z.string(), z.unknown()).default({}),
        assets: z.array(z.unknown()).optional(),
        source: z.array(z.string()).optional(),
        creation_date: z.number().optional(),
        modification_date: z.number().optional(),
    })
    .passthrough();

export const characterCardV2Schema = z
    .object({
        spec: z.literal('chara_card_v2'),
        spec_version: z.string().default('2.0'),
        data: characterCardDataSchema,
    })
    .passthrough();

export const characterCardV3Schema = z
    .object({
        spec: z.literal('chara_card_v3'),
        spec_version: z.string().default('3.0'),
        data: characterCardDataSchema,
    })
    .passthrough();

/**
 * Fields the character editor may change.
 *
 * Merged into the stored card, so `extensions`, the character book, V3 assets
 * and anything else the editor does not show survive a save.
 */
export const characterPatchSchema = z
    .object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        personality: z.string().optional(),
        scenario: z.string().optional(),
        first_mes: z.string().optional(),
        mes_example: z.string().optional(),
        creator_notes: z.string().optional(),
        system_prompt: z.string().optional(),
        post_history_instructions: z.string().optional(),
        alternate_greetings: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        creator: z.string().optional(),
        character_version: z.string().optional(),
        /** Shown in group chats; V3 cards only. */
        nickname: z.string().optional(),
        /** Extra openings used in group chats; V3 cards only. */
        group_only_greetings: z.array(z.string()).optional(),
    })
    .strict();

/** How a card is exported. */
export type CharacterExportFormat = 'png' | 'json';

export type CharacterBookEntry = z.infer<typeof characterBookEntrySchema>;
export type CharacterBook = z.infer<typeof characterBookSchema>;
export type CharacterCardData = z.infer<typeof characterCardDataSchema>;
export type CharacterCardV2 = z.infer<typeof characterCardV2Schema>;
export type CharacterCardV3 = z.infer<typeof characterCardV3Schema>;
export type CharacterPatch = z.infer<typeof characterPatchSchema>;
export type CharacterSpec = 'v2' | 'v3' | 'legacy';

export interface CharacterSummary {
    /** File name without extension, matching SillyTavern's avatar naming. */
    id: string;
    fileName: string;
    format: 'png' | 'json';
    name: string;
    creator: string;
    tags: string[];
    spec: CharacterSpec;
    hasCharacterBook: boolean;
    updatedAt: number;
    avatarUrl: string;
}

export interface CharacterDetail extends CharacterSummary {
    card: CharacterCardData;
    rawCard: unknown;
}
