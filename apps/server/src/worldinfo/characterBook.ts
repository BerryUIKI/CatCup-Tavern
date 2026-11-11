// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/world-info.js
// `convertCharacterBook`, ported to TypeScript without global state.
// See docs/REUSE.md.

import type { CharacterBook } from '@catcup/shared';

import { NEW_ENTRY_DEFAULTS } from './entries.js';

/** A character book converted into the shape `data/worlds/*.json` holds. */
export interface ConvertedCharacterBook {
    entries: Record<string, Record<string, unknown>>;
    /** The card's original book, so an export can carry it back unchanged. */
    originalData: CharacterBook;
}

function numberFrom(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function nullableNumberFrom(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanFrom(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function nullableBooleanFrom(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function stringFrom(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function stringListFrom(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Convert a V2/V3 card's `character_book` into a world info book.
 *
 * Field mapping follows SillyTavern's `convertCharacterBook`: an entry's `id`
 * becomes its `uid`, `keys` become `key`, and the card-specific
 * `extensions.*` fields map to the world info names, falling back to the same
 * defaults SillyTavern uses.
 */
export function convertCharacterBook(book: CharacterBook): ConvertedCharacterBook {
    const entries: Record<string, Record<string, unknown>> = {};

    book.entries.forEach((entry, index) => {
        const uid = entry.id ?? index;
        const extensions = entry.extensions ?? {};

        entries[String(uid)] = {
            ...structuredClone(NEW_ENTRY_DEFAULTS),
            uid,
            key: entry.keys,
            keysecondary: entry.secondary_keys ?? [],
            comment: entry.comment ?? '',
            content: entry.content,
            constant: entry.constant ?? false,
            // The world info template defaults this to true, but a converted
            // card entry that says nothing gets false, exactly as in ST.
            selective: entry.selective ?? false,
            order: entry.insertion_order,
            position: numberFrom(extensions.position, entry.position === 'before_char' ? 0 : 1),
            excludeRecursion: booleanFrom(extensions.exclude_recursion, false),
            preventRecursion: booleanFrom(extensions.prevent_recursion, false),
            delayUntilRecursion:
                typeof extensions.delay_until_recursion === 'boolean' ||
                typeof extensions.delay_until_recursion === 'number'
                    ? extensions.delay_until_recursion
                    : false,
            disable: !entry.enabled,
            addMemo: Boolean(entry.comment),
            displayIndex: numberFrom(extensions.display_index, index),
            probability: numberFrom(extensions.probability, 100),
            useProbability: booleanFrom(extensions.useProbability, true),
            depth: numberFrom(extensions.depth, 4),
            selectiveLogic: numberFrom(extensions.selectiveLogic, 0),
            outletName: stringFrom(extensions.outlet_name, ''),
            group: stringFrom(extensions.group, ''),
            groupOverride: booleanFrom(extensions.group_override, false),
            groupWeight: numberFrom(extensions.group_weight, 100),
            scanDepth: nullableNumberFrom(extensions.scan_depth),
            caseSensitive: nullableBooleanFrom(extensions.case_sensitive),
            matchWholeWords: nullableBooleanFrom(extensions.match_whole_words),
            useGroupScoring: nullableBooleanFrom(extensions.use_group_scoring),
            automationId: stringFrom(extensions.automation_id, ''),
            role: numberFrom(extensions.role, 0),
            vectorized: booleanFrom(extensions.vectorized, false),
            sticky: nullableNumberFrom(extensions.sticky),
            cooldown: nullableNumberFrom(extensions.cooldown),
            delay: nullableNumberFrom(extensions.delay),
            matchPersonaDescription: booleanFrom(extensions.match_persona_description, false),
            matchCharacterDescription: booleanFrom(extensions.match_character_description, false),
            matchCharacterPersonality: booleanFrom(extensions.match_character_personality, false),
            matchCharacterDepthPrompt: booleanFrom(extensions.match_character_depth_prompt, false),
            matchScenario: booleanFrom(extensions.match_scenario, false),
            matchCreatorNotes: booleanFrom(extensions.match_creator_notes, false),
            extensions,
            triggers: stringListFrom(extensions.triggers),
            ignoreBudget: booleanFrom(extensions.ignore_budget, false),
        };
    });

    return { entries, originalData: book };
}
