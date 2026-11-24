// Written for CatCup. Converting a card's embedded `character_book` into a
// world info book the scanner can read.

import type { CharacterBook } from '@catcup/shared';

import { NEW_ENTRY_DEFAULTS } from './entries.js';

/**
 * A V2/V3 card's embedded lorebook, turned into the shape `data/worlds/*.json`
 * holds.
 *
 * The two formats are both written down — the card's `character_book` fields in
 * `packages/shared/src/schemas/character.ts`, and the world info entry fields in
 * `docs/DATA-FORMATS.md` — so this is a field-by-field translation between two
 * specifications rather than a copy of anyone's converter. Every mapping is
 * listed below in the order the entry object is built.
 */

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
 * Convert a card's `character_book` into a world info book.
 *
 * The field mapping, and why each one is what it is:
 *
 * - `id` becomes `uid`, falling back to the entry's position in the array —
 *   the card format makes `id` optional but every world info entry needs one.
 * - `keys` / `secondary_keys` become `key` / `keysecondary`.
 * - `enabled` is inverted into `disable`, because that is the polarity the
 *   world info format uses.
 * - `addMemo` is derived from whether a comment exists, so the editor shows the
 *   memo box exactly for the entries that have one.
 * - `position: 'before_char'` becomes `0`; anything else becomes `1`. The card
 *   format has two positions and the world info format has a numeric scale, so
 *   the two named values are the only ones that can be carried exactly.
 * - `selective` defaults to **false** here, not to the world info template's
 *   `true`. A card that says nothing about it means "insert on its primary keys
 *   alone", and defaulting it on would make a `keysecondary` gate a filter that
 *   applies in this app and not in the app the card was written for.
 * - Everything under `extensions.*` maps to its world info name, with the
 *   documented default when absent.
 * - The whole `extensions` object is carried through as well, so a round-trip
 *   export can put back fields this mapping does not name.
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
            // card entry that says nothing gets false: a card's silence means
            // "primary keys alone", and the entry's `keysecondary` is a gate
            // only when the card says it is.
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
