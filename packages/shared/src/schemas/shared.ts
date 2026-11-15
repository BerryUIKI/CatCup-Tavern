import { z } from 'zod';

/**
 * The shared layer: items a profile marks as reusable.
 *
 * Every item the library can show — character, world info book, preset, quick
 * reply set, regex rule, persona — has exactly one owner scope. `profile` items
 * live in `data/profiles/<id>/`, `shared` items in `data/shared/`. The shared
 * folder is a real folder, not a flag, so the layout stays honest and a backup
 * of `data/` still needs no interpretation.
 *
 * A profile sees its own items plus the shared scope, never another profile's.
 * When both hold the same id the profile's item wins, and the row that wins is
 * marked `shadowed` so the shared original is not a mystery.
 *
 * See `docs/RFC/0001-profiles.md` §4 and §13.2.
 */

/** Where one item lives. */
export const itemScopeSchema = z.enum(['profile', 'shared']);
export type ItemScope = z.infer<typeof itemScopeSchema>;

/** A library list filter: one scope, or both. */
export const scopeFilterSchema = z.enum(['all', 'profile', 'shared']);
export type ScopeFilter = z.infer<typeof scopeFilterSchema>;

/** The kinds of item the shared layer covers. */
export const SHARED_ITEM_KINDS = ['characters', 'worlds', 'presets', 'quickreplies', 'regex', 'personas'] as const;
export const sharedItemKindSchema = z.enum(SHARED_ITEM_KINDS);
export type SharedItemKind = z.infer<typeof sharedItemKindSchema>;

/** Fields a library list adds to every row once the shared layer exists. */
export interface ScopedItem {
    /** The scope this item was read from. */
    scope: ItemScope;
    /**
     * `true` when this profile item hides a shared item with the same id.
     *
     * Only the winning row carries the flag; the shared original is not listed
     * a second time, because an id addresses one item.
     */
    shadowed?: boolean;
}

/** Optional `scope` on a create request; `profile` when absent. */
export const itemScopeOptionsSchema = z.object({
    scope: itemScopeSchema.default('profile'),
});

/** `POST /api/shared/:kind/:id/move`, `.../unshare` and `.../copy` take no body. */
export const sharedActionParamsSchema = z.object({
    kind: sharedItemKindSchema,
    id: z.string().min(1).max(300),
});
export type SharedActionParams = z.infer<typeof sharedActionParamsSchema>;

/**
 * What one scope-change action did.
 *
 * `id` is the id the item has afterwards: a copy gets a free name, a move keeps
 * the one it had. The caller refetches the library either way, but the toast can
 * say where it went.
 */
export interface SharedItemActionResult {
    kind: SharedItemKind;
    id: string;
    /** Ids of items the action left untouched, when the caller asked for several. */
    scope: ItemScope;
    /** How many profiles can now see this item; `1` for a profile-owned item. */
    visibleToProfiles: number;
}

/**
 * A shared item as the settings panel lists it.
 *
 * Personas are the one kind that is not a file-backed library: they are a list
 * inside the settings file, so the shared ones need their own summary shape.
 */
export interface SharedScopeSummary {
    /** How many items of each kind the shared scope holds. */
    counts: Record<Exclude<SharedItemKind, 'personas'>, number>;
    /** Number of personas in `shared/personas.json`. */
    personas: number;
    /** Total bytes under `data/shared/`. */
    sizeBytes: number;
}

/**
 * The `scope` a row came from, for the badge.
 *
 * A word, not a colour alone: the interface renders "Shared" beside an icon, so
 * the meaning survives a monochrome screen and a colour-blind reader.
 */
export const SHARED_BADGE_LABEL = 'Shared';

/** Prefix a decision message with the profiles an action affects. */
export function describeScopeChange(source: ItemScope, target: ItemScope): string {
    if (source === target) {
        return 'That item is already in this scope.';
    }
    return target === 'shared'
        ? 'This item becomes visible in every profile on this machine.'
        : 'This item leaves the shared scope and belongs to this profile alone.';
}
