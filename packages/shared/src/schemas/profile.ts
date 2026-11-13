import { z } from 'zod';

/**
 * A profile is a data scope: its own characters, chats, groups, world info,
 * presets, quick reply sets, regex rules, personas, images and configuration.
 * The provider list, its models, the API keys and auth are shared by every
 * profile on the machine.
 *
 * `data/settings.json` holds the index; each profile's own configuration lives
 * at `data/profiles/<id>/settings.json`. A v1 data folder, which had a single
 * settings file and one shared tree, is migrated into one `Default` profile.
 */

/** One profile as the index lists it. */
export const profileEntrySchema = z.object({
    id: z.string().min(1).max(120),
    name: z.string().trim().min(1).max(80),
    description: z.string().max(500).default(''),
    /**
     * An archived profile keeps its entry — name, description and place in the
     * list — while its folder moves to `archive/`. Restoring is then a move
     * back plus clearing this flag, so nothing about the profile is guessed.
     */
    archived: z.boolean().default(false),
});
export type ProfileEntry = z.infer<typeof profileEntrySchema>;

export const PROFILE_INDEX_VERSION = 2;

export const profileIndexSchema = z.object({
    version: z.literal(PROFILE_INDEX_VERSION),
    activeProfileId: z.string().min(1),
    profiles: z.array(profileEntrySchema).min(1),
});
export type ProfileIndex = z.infer<typeof profileIndexSchema>;

/** What a profile owns, so the interface can say what a switch changes. */
export interface ProfileCounts {
    characters: number;
    chats: number;
    groups: number;
    books: number;
    presets: number;
}

/** A profile as the client sees it. */
export interface ProfileSummary extends ProfileEntry {
    /** The profile the server is currently serving. */
    active: boolean;
    /** An archived profile is not listed in the switcher but can be restored. */
    archived: boolean;
    counts: ProfileCounts;
    /** Size of the profile's directory in bytes; `0` when it could not be measured. */
    sizeBytes: number;
}

export const profileCreateSchema = z
    .object({
        name: z.string().trim().min(1).max(80),
        description: z.string().max(500).optional(),
        /** Copy this profile's configuration (never its content) into the new one. */
        copyFromId: z.string().min(1).max(120).optional(),
    })
    .strict();
export type ProfileCreate = z.infer<typeof profileCreateSchema>;

export const profileRenameSchema = z
    .object({
        name: z.string().trim().min(1).max(80).optional(),
        description: z.string().max(500).optional(),
    })
    .strict();
export type ProfileRename = z.infer<typeof profileRenameSchema>;
