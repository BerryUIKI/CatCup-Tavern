import { z } from 'zod';

/**
 * SillyTavern chat JSONL format.
 *
 * The first line is a header object:
 *   { chat_metadata, user_name: "unused", character_name: "unused" }
 * Every following line is a message.
 */

export const chatHeaderSchema = z
    .object({
        chat_metadata: z.record(z.string(), z.unknown()).default({}),
        user_name: z.string().default('unused'),
        character_name: z.string().default('unused'),
    })
    .passthrough();

export const chatMessageSchema = z
    .object({
        name: z.string().default(''),
        is_user: z.boolean().default(false),
        is_system: z.boolean().optional(),
        send_date: z.string().optional(),
        mes: z.string().default(''),
        extra: z.record(z.string(), z.unknown()).optional(),
        /**
         * Group chats record the speaker's avatar file name at the top level,
         * as SillyTavern does; `force_avatar` is the URL it renders from.
         */
        original_avatar: z.string().optional(),
        force_avatar: z.string().optional(),
    })
    .passthrough();

export type ChatHeader = z.infer<typeof chatHeaderSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export interface ChatFile {
    header: ChatHeader;
    messages: ChatMessage[];
}

export interface ChatSummary {
    id: string;
    title: string;
    updatedAt: number;
    messageCount: number;
}

export interface ChatDetail extends ChatFile {
    characterId: string;
    chatId: string;
}

/** Convenience shape mirrored by SillyTavern's `extra` field. */
export interface ChatMessageExtra {
    api?: string;
    model?: string;
    reasoning?: string;
    reasoning_duration?: number;
    gen_started?: string;
    gen_finished?: string;
    swipes?: string[];
    swipe_id?: number;
    swipe_info?: unknown[];
    stopped?: boolean;
    [key: string]: unknown;
}
