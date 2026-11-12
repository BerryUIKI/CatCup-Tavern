import { z } from 'zod';

/**
 * SillyTavern Quick Replies, version 2 set format.
 *
 * A set is stored as one JSON file named after the set, exactly as
 * SillyTavern's `data/QuickReplies/<name>.json` files are. Fields the editor
 * does not show (auto-execution flags, context-menu links, icons) are kept so a
 * set imported from SillyTavern round-trips without losing them.
 */

/** A link from a quick reply to another set, used by ST's context menu. */
export const quickReplyContextLinkSchema = z
    .object({
        set: z.string().default(''),
        isChained: z.boolean().default(false),
    })
    .passthrough();
export type QuickReplyContextLink = z.infer<typeof quickReplyContextLinkSchema>;

export const quickReplyItemSchema = z
    .object({
        /** Unique within the set; the button that runs this reply. */
        id: z.number().int().min(0).default(0),
        /** Font Awesome class in SillyTavern; preserved but not rendered. */
        icon: z.string().max(200).default(''),
        label: z.string().max(200).default(''),
        /** Tooltip; falls back to the message. */
        title: z.string().max(500).default(''),
        /** What clicking runs: plain text, or a slash-command sequence. */
        message: z.string().max(20000).default(''),
        showLabel: z.boolean().default(false),
        /** Hide the button without removing the reply. */
        isHidden: z.boolean().default(false),
        /** ST auto-execution switches; stored but not run by CatCup yet. */
        preventAutoExecute: z.boolean().default(true),
        executeOnStartup: z.boolean().default(false),
        executeOnUser: z.boolean().default(false),
        executeOnAi: z.boolean().default(false),
        executeOnChatChange: z.boolean().default(false),
        executeOnGroupMemberDraft: z.boolean().default(false),
        executeOnNewChat: z.boolean().default(false),
        executeBeforeGeneration: z.boolean().default(false),
        automationId: z.string().max(200).default(''),
        contextList: z.array(quickReplyContextLinkSchema).default([]),
    })
    .passthrough();
export type QuickReplyItem = z.infer<typeof quickReplyItemSchema>;

export const quickReplySetSchema = z
    .object({
        /** SillyTavern stores the current format as version 2. */
        version: z.literal(2).default(2),
        name: z.string().trim().min(1).max(120),
        /** Paste into the message box instead of running the reply. */
        disableSend: z.boolean().default(false),
        /** When adding to existing input, put the reply before it. */
        placeBeforeInput: z.boolean().default(false),
        /** Append a plain-text reply to whatever is already in the message box. */
        injectInput: z.boolean().default(false),
        /** CSS color for the set's buttons; `transparent` means no tint. */
        color: z.string().max(100).default('transparent'),
        /** Tint only the border when a color is set. */
        onlyBorderColor: z.boolean().default(false),
        qrList: z.array(quickReplyItemSchema).default([]),
        /** Highest quick reply id handed out so far. */
        idIndex: z.number().int().min(0).default(0),
    })
    .passthrough();
export type QuickReplySet = z.infer<typeof quickReplySetSchema>;

/** A set shown in the chat's quick reply bar. */
export const quickReplySetLinkSchema = z.object({
    /** The set's name, as SillyTavern links sets from its settings. */
    set: z.string().min(1).max(120),
    isVisible: z.boolean().default(true),
});
export type QuickReplySetLink = z.infer<typeof quickReplySetLinkSchema>;

/**
 * Account-level quick reply configuration.
 *
 * SillyTavern keeps this in `extension_settings.quickReplyV2`; CatCup keeps it
 * in `settings.json` with the same set-list semantics. A chat can add its own
 * set list in `chat_metadata.quickReply`, which is read but not edited yet.
 */
export const quickReplySettingsSchema = z.object({
    /** Show the quick reply bar above the message box. */
    enabled: z.boolean().default(false),
    /** Sets in bar order. */
    setList: z.array(quickReplySetLinkSchema).default([]),
});
export type QuickReplySettings = z.infer<typeof quickReplySettingsSchema>;

export const DEFAULT_QUICK_REPLY_SETTINGS: QuickReplySettings = {
    enabled: false,
    setList: [],
};

/**
 * A partial quick reply update for `PATCH /api/settings`.
 *
 * `quickReplySettingsSchema.partial()` would apply each field's default in Zod
 * 4, so a patch carrying only `enabled` would clear the set list. This schema
 * keeps unspecified fields absent.
 */
export const quickReplySettingsPatchSchema = z.object({
    enabled: z.boolean().optional(),
    setList: z.array(quickReplySetLinkSchema).optional(),
});
export type QuickReplySettingsPatch = z.infer<typeof quickReplySettingsPatchSchema>;
