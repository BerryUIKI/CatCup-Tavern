import { z } from 'zod';

import type { ChatFile, ChatSummary } from './chat.js';

/**
 * SillyTavern group chat metadata, stored as `data/groups/<id>.json`.
 *
 * Group files are shared with SillyTavern: `members` holds character avatar
 * file names rather than CatCup ids, the numeric settings keep ST's values, and
 * unknown fields survive a round trip.
 */
export const groupActivationStrategy = {
    /** The model decides who replies. */
    NATURAL: 0,
    /** Members reply in list order. */
    LIST: 1,
    /** The user picks the speaker. */
    MANUAL: 2,
    /** Weighted random choice. */
    POOLED: 3,
} as const;

export const groupGenerationMode = {
    /** Each reply replaces the previous one; one message per turn. */
    SWAP: 0,
    /** Replies are appended; every member may answer. */
    APPEND: 1,
    /** Appended replies skip disabled members. */
    APPEND_DISABLED: 2,
} as const;

export const DEFAULT_AUTO_MODE_DELAY = 5;

const memberListSchema = z.array(z.string().min(1).max(300)).min(1).max(64);

export const groupSchema = z
    .object({
        /** File name without `.json`; the server always takes it from the file name. */
        id: z.string(),
        name: z.string().default('New Group'),
        /** Character avatar file names, in display order, as SillyTavern stores them. */
        members: z.array(z.string()).default([]),
        avatar_url: z.string().optional(),
        allow_self_responses: z.boolean().default(false),
        activation_strategy: z.number().int().min(0).max(3).default(groupActivationStrategy.NATURAL),
        generation_mode: z.number().int().min(0).max(2).default(groupGenerationMode.SWAP),
        disabled_members: z.array(z.string()).default([]),
        fav: z.boolean().optional(),
        /** The chat the group last opened, as SillyTavern stores it. */
        chat_id: z.string().default(''),
        /** Every chat id belonging to this group, oldest first. */
        chats: z.array(z.string()).default([]),
        auto_mode_delay: z.number().min(0).max(3600).default(DEFAULT_AUTO_MODE_DELAY),
        generation_mode_join_prefix: z.string().default(''),
        generation_mode_join_suffix: z.string().default(''),
    })
    .passthrough();

export const groupCreateSchema = z
    .object({
        name: z.string().trim().min(1).max(200).optional(),
        members: memberListSchema,
        avatar_url: z.string().max(2000).optional(),
        allow_self_responses: z.boolean().optional(),
        activation_strategy: z.number().int().min(0).max(3).optional(),
        generation_mode: z.number().int().min(0).max(2).optional(),
        auto_mode_delay: z.number().min(0).max(3600).optional(),
        fav: z.boolean().optional(),
    })
    .strict();

/**
 * Fields a group edit may change. Membership and per-chat state have their own
 * endpoints, so `id`, `chats` and `chat_id` are not patchable here.
 */
export const groupPatchSchema = z
    .object({
        name: z.string().trim().min(1).max(200).optional(),
        members: memberListSchema.optional(),
        avatar_url: z.string().max(2000).optional(),
        allow_self_responses: z.boolean().optional(),
        activation_strategy: z.number().int().min(0).max(3).optional(),
        generation_mode: z.number().int().min(0).max(2).optional(),
        disabled_members: z.array(z.string().min(1).max(300)).optional(),
        fav: z.boolean().optional(),
        auto_mode_delay: z.number().min(0).max(3600).optional(),
        generation_mode_join_prefix: z.string().max(300).optional(),
        generation_mode_join_suffix: z.string().max(300).optional(),
    })
    .strict();

export type Group = z.infer<typeof groupSchema>;
export type GroupCreate = z.infer<typeof groupCreateSchema>;
export type GroupPatch = z.infer<typeof groupPatchSchema>;

/** One group member resolved against the character library. */
export interface GroupMember {
    /** The avatar file name stored in the group's `members` array. */
    fileName: string;
    /** The character id used by the rest of the API, or null when the card is gone. */
    id: string | null;
    name: string;
    avatarUrl: string | null;
}

/** A group as the client sees it: the stored metadata plus resolved members. */
export type GroupView = Group & {
    memberDetails: GroupMember[];
    /** Modification time of the group file, in milliseconds. */
    updatedAt: number;
};

/** A chat that belongs to a group; group chats live in `data/group chats/`. */
export interface GroupChatDetail extends ChatFile {
    groupId: string;
    chatId: string;
}

export type GroupChatSummary = ChatSummary;
