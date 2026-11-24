import type { ChatMessage } from '@catcup/shared';

import { getSettings } from '../storage/settings.js';
import { splitForTelegram } from './commands.js';
import { getTransport } from './service.js';

/**
 * Telling the owner that something finished.
 *
 * The point is the case the app cannot cover by itself: a generation was
 * started and then the window went away — another app, another desktop, a
 * sleeping lid. A reply that finishes while nobody is looking is otherwise
 * silent, and so is a reply that *fails*, which is worse, because a failure and
 * a slow answer look identical.
 *
 * Off by default and separate from the bot's switch, because the two are
 * different asks: a bot someone talks to is not necessarily a bot they want
 * buzzing at them, and a notification is the one part of this feature that
 * carries almost no message content — a character name and one sentence.
 *
 * Four rules, all of them about not being annoying:
 *
 * - **After persistence, never before.** A notification must not delay or
 *   endanger a reply.
 * - **Only when the app was not in front.** The browser says so when it starts
 *   the generation; a reply someone is watching needs no second telling.
 * - **Never for a reply that came over IM.** That reply is in the same
 *   conversation, so notifying would deliver it twice.
 * - **A failure is dropped, not retried.** A "the reply is ready" message
 *   delivered ten minutes late is noise.
 */

/** How much of a reply a notification carries. */
const PREVIEW_LENGTH = 120;

/**
 * The first sentence of a reply, trimmed to something that fits a notification.
 *
 * Split on the same boundaries the message splitter uses, so a Chinese reply
 * gives the same clean first sentence as an English one.
 */
export function previewOf(text: string): string {
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
        return '';
    }
    const [first = ''] = trimmed.split(/(?<=[.!?。！？…])\s*/u);
    const sentence = first.trim() || trimmed;
    return sentence.length > PREVIEW_LENGTH ? `${sentence.slice(0, PREVIEW_LENGTH - 1)}…` : sentence;
}

/** How a generation ended, as far as a notification is concerned. */
export type GenerationOutcome = { type: 'done'; message: ChatMessage } | { type: 'error'; message: string };

export interface NotificationContext {
    characterName: string;
    /** Whether the app was out of sight when the generation started. */
    background: boolean;
}

/**
 * The line to send, or `null` when there is nothing to say.
 *
 * Pure, and separate from sending, because the decisions here are the feature:
 * a stopped reply is not news, a foreground reply is not news, and a missing
 * outcome is not news. Keeping them out of the transport makes them testable
 * without a bot or a settings file.
 *
 * The text is plain — no `**bold**` — because the transport sends without a
 * `parse_mode`, so markers would arrive as literal asterisks, and because
 * Telegram's Markdown modes break on a character name containing `_` or `*`.
 */
export function notificationFor(outcome: GenerationOutcome | null, context: NotificationContext): string | null {
    if (!outcome || !context.background) {
        return null;
    }

    if (outcome.type === 'error') {
        // Silence is most expensive exactly here: without this, a stopped reply
        // and a slow reply look the same from another room.
        return `The reply from ${context.characterName} failed: ${outcome.message}`;
    }

    // A reply the person stopped is one they were watching. Telling them it
    // finished — after they pressed the button that ended it — is noise.
    if (outcome.message.extra?.stopped) {
        return null;
    }

    const preview = previewOf(outcome.message.mes);
    return preview ? `${context.characterName} replied: ${preview}` : null;
}

/**
 * Where a notification goes.
 *
 * The owner's own chat, which in a private Telegram conversation has the same
 * id as the user — so this needs no binding and works before anyone has ever
 * sent the bot a message. An empty allowlist means nobody, which is the same
 * answer the transport gives to an incoming message.
 */
async function ownerChatId(): Promise<string | null> {
    const settings = await getSettings();
    const ownerId = settings.im.ownerId.trim();
    return ownerId || null;
}

/**
 * Notify that a generation finished or failed.
 *
 * Called after persistence. Never throws: a notification that fails must not
 * turn a successful reply into an error, so the failure is logged and dropped.
 * Deliberately not awaited by its callers for the same reason.
 */
export async function notifyTurn(outcome: GenerationOutcome | null, context: NotificationContext): Promise<void> {
    const text = notificationFor(outcome, context);
    if (text) {
        await send(text);
    }
}

async function send(text: string): Promise<void> {
    try {
        const settings = await getSettings();
        if (!settings.im.notifyOnReply) {
            return;
        }

        const transport = getTransport();
        const chatId = await ownerChatId();
        if (!transport || !chatId) {
            return;
        }

        // One chunk, not a split: a notification longer than a Telegram message
        // means the preview logic is wrong, and sending several is worse than
        // sending the first.
        const [first] = splitForTelegram(text);
        if (first) {
            await transport.send(chatId, first);
        }
    } catch (error) {
        // A notification is a courtesy. Losing one costs nothing; throwing here
        // would cost the reply it was describing.
        console.warn('[im] Notification failed:', error);
    }
}
