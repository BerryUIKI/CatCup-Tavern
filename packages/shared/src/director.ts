import { z } from 'zod';

/**
 * The director: a per-chat layer that turns a conversation into a story.
 *
 * Settled by RFC 0003. Layer 1 only — story mode's graph is reserved at the
 * bottom of this file but not built, because it needs a plot distillation that
 * has no design yet.
 *
 * The compatibility promise is the shape of everything here: **a chat with no
 * `director` key behaves exactly as it does today.** Every field has a default,
 * every reader tolerates absence, and a test asserts that a chat without one
 * produces the same prompt and the same file after a reply.
 */

export const DIRECTOR_SPEAKER_MODES = ['auto', 'rotate', 'director'] as const;
export const directorSpeakerModeSchema = z.enum(DIRECTOR_SPEAKER_MODES);
export type DirectorSpeakerMode = (typeof DIRECTOR_SPEAKER_MODES)[number];

/** How many options a reply may offer. Two is a choice; five is a menu. */
export const MIN_CHOICES = 2;
export const MAX_CHOICES = 4;

export const directorConfigSchema = z.object({
    /** Absent on every chat written before this existed. */
    enabled: z.boolean().default(false),
    /**
     * How the next speaker is chosen.
     *
     * `auto` is today's group activation strategy. The other two extend it
     * rather than replacing it, and played members are excluded from all three.
     */
    speakerMode: directorSpeakerModeSchema.default('auto'),
    /**
     * Cast the person plays: present in the prompt, never written by the model.
     *
     * Avatar file names rather than display names, so a card being renamed does
     * not silently unbind the person from who they were playing.
     */
    playedMembers: z.array(z.string()).default([]),
    /** Standing instructions — the per-chat replacement for a global Author's Note. */
    rules: z.string().max(8000).default(''),
    /** Offer choices after each reply. */
    choices: z.boolean().default(false),
    /** How many options to offer when `choices` is on. */
    choiceCount: z.number().int().min(MIN_CHOICES).max(MAX_CHOICES).default(3),
});
export type DirectorConfig = z.infer<typeof directorConfigSchema>;

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
    enabled: false,
    speakerMode: 'auto',
    playedMembers: [],
    rules: '',
    choices: false,
    choiceCount: 3,
};

/**
 * A partial update for the director config.
 *
 * Spelled out rather than `.partial()`: Zod 4 still applies each field's default
 * to a partial schema, so a patch carrying only `enabled` would reset the rest —
 * the same trap the memory and IM settings have.
 */
export const directorConfigPatchSchema = z.object({
    enabled: z.boolean().optional(),
    speakerMode: directorSpeakerModeSchema.optional(),
    playedMembers: z.array(z.string()).optional(),
    rules: z.string().max(8000).optional(),
    choices: z.boolean().optional(),
    choiceCount: z.number().int().min(MIN_CHOICES).max(MAX_CHOICES).optional(),
});
export type DirectorConfigPatch = z.infer<typeof directorConfigPatchSchema>;

/**
 * Read a chat's director config.
 *
 * Absence is the common case and must be cheap and silent: an unreadable or
 * partial object is treated as "no director", never as an error, because a
 * hand-edited chat file must not stop a chat from opening.
 */
export function directorOf(metadata: Record<string, unknown> | null | undefined): DirectorConfig | null {
    const raw = metadata?.director;
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const parsed = directorConfigSchema.safeParse(raw);
    if (!parsed.success) {
        return null;
    }
    // Present but off is "no director" to every caller; centralising that here
    // stops each call site from having to remember it.
    return parsed.data.enabled ? parsed.data : null;
}

// --- choices ---------------------------------------------------------------

/**
 * One option a reply offers.
 *
 * `label` is what gets sent if clicked, so it has to read as something a person
 * would type. `detail` is only ever shown on hover.
 */
export const directorChoiceSchema = z.object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(200),
    detail: z.string().max(500).optional(),
});
export type DirectorChoice = z.infer<typeof directorChoiceSchema>;

export const directorChoicesSchema = z.object({
    options: z.array(directorChoiceSchema).max(MAX_CHOICES).default([]),
    /** Set once one is taken, so the context inspector can say which. */
    usedOptionId: z.string().optional(),
});
export type DirectorChoices = z.infer<typeof directorChoicesSchema>;

/** The `extra.director` a message carries. An unknown `extra` key the writer preserves. */
export const messageDirectorSchema = z.object({
    choices: directorChoicesSchema.optional(),
});
export type MessageDirector = z.infer<typeof messageDirectorSchema>;

/**
 * Read a message's choices, if it has any.
 *
 * Absence is normal — most messages have none — so this returns `null` rather
 * than an empty object, which lets a caller write `if (choices)` and mean it.
 */
export function choicesOf(message: { extra?: Record<string, unknown> | undefined }): DirectorChoices | null {
    const raw = message.extra?.director;
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const parsed = messageDirectorSchema.safeParse(raw);
    const choices = parsed.success ? parsed.data.choices : undefined;
    return choices && choices.options.length > 0 ? choices : null;
}

// --- story (reserved) ------------------------------------------------------

/**
 * Story mode's state, reserved.
 *
 * Written down now and deliberately not built: RFC 0003's Layer 2 needs a plot
 * distillation that has no design of its own yet, and inventing a schema before
 * that design would be guessing at what the distillation should emit.
 *
 * The shape is here for one reason that is not speculative — `chat_metadata` is
 * where it will live, and a reader that ignores unknown keys is what keeps the
 * two layers independent. Recording it now means story mode can be added
 * without touching the director's storage.
 */
export const storyStateSchema = z.object({
    graphId: z.string().min(1).max(200),
    nodeId: z.string().min(1).max(200),
    /** Nodes already visited, oldest first. Compressed before it enters the prompt. */
    visited: z.array(z.string()).default([]),
    /** Facts the director must keep true at this node. */
    state: z.record(z.string(), z.unknown()).default({}),
});
export type StoryState = z.infer<typeof storyStateSchema>;

/** Read a chat's story state, if it has one. Reserved; nothing writes this yet. */
export function storyOf(metadata: Record<string, unknown> | null | undefined): StoryState | null {
    const raw = metadata?.story;
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const parsed = storyStateSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
}
