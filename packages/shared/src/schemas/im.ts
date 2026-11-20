import { z } from 'zod';

/**
 * Reaching a character from an instant-messaging client.
 *
 * Settled by RFC 0004. The decisions that shape this schema:
 *
 * - **Owner only.** A single allowlisted user id, compared server-side. Anyone
 *   else is ignored silently — no reply, nothing that confirms the bot is
 *   listening — because the app is single-user and a bot that answers strangers
 *   would share one chat history and one set of provider keys with them.
 * - **The token never appears here.** It lives in `data/secrets.json` beside the
 *   provider keys, and the client only ever learns whether one is set.
 * - **Off by default.** Turning a bot on is a deliberate act; a profile that has
 *   never heard of IM must not start polling because a schema defaulted to true.
 *
 * The scope is *the profile*, not the machine: a Telegram bot bound to a story
 * belongs to the story's profile, the same way its chats and world book do.
 */

export const imSettingsSchema = z.object({
    /** Start the long-polling loop when the server starts. */
    enabled: z.boolean().default(false),
    /**
     * The Telegram user id allowed to talk to the bot.
     *
     * A string rather than a number because Telegram ids exceed 2^32 and
     * arrive as strings from the API; comparing them as numbers would lose
     * precision on real accounts.
     */
    ownerId: z.string().trim().max(40).default(''),
    /**
     * Send a message to the owner when a generation finishes or fails.
     *
     * Off by default and separate from `enabled`: a bot used for conversation is
     * not necessarily a bot wanted as a notification channel, and a person who
     * does not accept message content leaving the machine can still read these
     * — a notification carries a character name and one sentence.
     */
    notifyOnReply: z.boolean().default(false),
});
export type ImSettings = z.infer<typeof imSettingsSchema>;

export const DEFAULT_IM_SETTINGS: ImSettings = {
    enabled: false,
    ownerId: '',
    notifyOnReply: false,
};

/**
 * A partial update for `PATCH /api/settings`.
 *
 * `imSettingsSchema.partial()` still applies each field's default in Zod 4 — the
 * same trap the memory settings have — so every field is spelled out optional
 * here instead.
 */
export const imSettingsPatchSchema = z.object({
    enabled: z.boolean().optional(),
    ownerId: z.string().trim().max(40).optional(),
    notifyOnReply: z.boolean().optional(),
});
export type ImSettingsPatch = z.infer<typeof imSettingsPatchSchema>;

/** What the client learns about the bot. The token is never part of it. */
export interface ImStatusView {
    /** Whether a bot token is stored. */
    hasToken: boolean;
    /** Whether the polling loop is running right now. */
    running: boolean;
    /** The last problem, worded for a person; cleared on a successful poll. */
    error: string | null;
    /** Telegram's `getMe` answer, once a poll has succeeded. */
    bot: { id: string; username: string } | null;
}

export const imTokenSchema = z.object({
    /** Omit to keep the stored token; an empty string clears it. */
    token: z.string().max(200).optional(),
});
export type ImTokenInput = z.infer<typeof imTokenSchema>;

/**
 * What a Telegram export scan reports, so the import screen can show a person
 * what would be written before it is.
 *
 * It names the participants and how often each spoke — the one decision that
 * cannot be automated is which of them is *you*, and a picker needs the names.
 */
export interface TelegramParticipant {
    name: string;
    count: number;
}

export interface TelegramScanView {
    title: string | null;
    participants: TelegramParticipant[];
    /** Rows that carry text and would be written. */
    messages: number;
    /** Rows dropped because they are not conversation. */
    skipped: { service: number; empty: number; malformed: number };
    range: { from: string | null; to: string | null };
}
