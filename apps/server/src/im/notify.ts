import { getSettings } from '../storage/settings.js';
import { readBindings } from './bindings.js';
import { splitForTelegram } from './commands.js';
import { getTransport } from './service.js';

/**
 * Telling the owner that something finished.
 *
 * Off by default and separate from the bot's own switch, because the two are
 * different asks: a bot someone talks to is not necessarily a bot they want
 * buzzing at them, and a notification is the one part of this feature that
 * carries almost no message content — a character name and one sentence.
 *
 * Three rules, all of them about not being annoying:
 *
 * - **After persistence, never before.** A notification must not delay or
 *   endanger a reply.
 * - **A failure is dropped, not retried.** A "the reply is ready" message
 *   delivered ten minutes late is noise.
 * - **One sentence, not the reply.** The point is "it is done", not a second
 *   copy of the story in another chat.
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

/**
 * Where a notification goes.
 *
 * A bound conversation is the natural target: it is the chat the person is
 * already looking at, and it is a private chat with the owner because only the
 * owner could have bound it. With no binding there is nowhere safe to send — a
 * notification must never go to a stranger's chat id — so it is skipped rather
 * than guessed at.
 */
async function ownerChatId(): Promise<string | null> {
    const bindings = await readBindings();
    const [first] = Object.keys(bindings);
    return first ?? null;
}

/**
 * Notify that a generation finished.
 *
 * Called after persistence. Never throws: a notification that fails must not
 * turn a successful reply into an error, so the failure is logged and dropped.
 */
export async function notifyReply(event: { characterName: string; text: string }): Promise<void> {
    await send(`**${event.characterName}** replied:\n${previewOf(event.text)}`);
}

/** Notify that a generation failed. Silence is worst exactly here. */
export async function notifyFailure(characterName: string, reason: string): Promise<void> {
    await send(`The reply from **${characterName}** failed: ${reason}`);
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
