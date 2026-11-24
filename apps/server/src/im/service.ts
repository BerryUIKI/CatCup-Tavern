import type { ImSettings, ImStatusView } from '@catcup/shared';

import { getSettings, getTelegramToken } from '../storage/settings.js';
import { handleMessage } from './conversation.js';
import { loopbackGenerate } from './generate.js';
import { TelegramTransport } from './telegram.js';
import type { IncomingMessage, Transport, TransportHooks, TransportStatus } from './transport.js';

/**
 * The one bot this profile is running, and the rules for starting it.
 *
 * A profile has at most one IM transport. That is not a limitation being
 * apologised for: the app is single-user, the allowlist is one person, and two
 * bots answering the same story would be two ways to fork it.
 *
 * Starting is driven by settings rather than by an API call, so the state after
 * a restart is the state the person left — a bot that was on is on again, and
 * one that was off never surprises anyone by polling.
 */

let current: { transport: Transport; settings: ImSettings; token: string } | null = null;

/**
 * Where the server listens, so a reply can be produced by calling CatCup's own
 * generation route rather than by a second copy of prompt assembly.
 *
 * Set once the server has an address. Until then a message that tries to
 * generate answers with "the server has not finished starting" rather than
 * hanging.
 */
let baseUrl: string | null = null;

/** Record the address the server ended up on. Called after `listen`. */
export function setServerBaseUrl(url: string): void {
    baseUrl = url;
}

/**
 * Whose messages reach the transport.
 *
 * A message is answered by `handleMessage`, which resolves the binding, handles
 * the commands and calls back into generation. The sink stays replaceable so a
 * test can watch what arrives without a bot.
 */
let onMessage: (message: IncomingMessage) => void = (message) => {
    void handleMessage(message, {
        transport: { send: (chatId, text) => sendTo(chatId, text) },
        generate: loopbackGenerate({ baseUrl: () => baseUrl }),
    }).catch((error) => {
        // A conversation that fails must not take the poll loop with it.
        console.warn('[im] Conversation failed:', error);
    });
};

/** The running transport, for the notification path. `null` when nothing is on. */
export function getTransport(): Transport | null {
    return current?.transport ?? null;
}

/** Send through whichever transport is running, if any. */
async function sendTo(chatId: string, text: string): Promise<void> {
    if (!current) {
        return;
    }
    await current.transport.send(chatId, text);
}

/** Replace the message sink. Used by the binding, and by tests. */
export function setMessageSink(sink: (message: IncomingMessage) => void): void {
    // The transport calls `hooks.onMessage`, which reads `onMessage` at call
    // time rather than capturing it — so replacing the sink needs no restart,
    // and a generation in flight is not interrupted by it.
    onMessage = sink;
}

const hooks: TransportHooks = {
    onMessage: (message) => onMessage(message),
};

function statusOf(transport: Transport | null): TransportStatus {
    return transport ? transport.status() : { running: false, error: null, bot: null };
}

/**
 * Bring the transport in line with the settings.
 *
 * Called at startup and after every settings save. It stops what is running
 * when the settings say so, restarts when the token or the allowlist changed,
 * and does nothing when they did not — because a settings save that has nothing
 * to do with IM must not interrupt a poll.
 *
 * Two switches decide whether a transport exists at all, not one:
 *
 * - `enabled` — receive messages. Starts the long-polling loop.
 * - `notifyOnReply` — send them. Wants a transport to send *through*, but no
 *   loop, because a notification channel must not also listen.
 *
 * So a transport is built whenever the token is set and either switch wants it,
 * and `start()` — which owns the poll loop — is called only for `enabled`.
 * Building without starting is why "tell me when a reply finishes" works with
 * the bot's own switch off.
 */
export async function syncTransport(): Promise<void> {
    const settings = await getSettings();
    const im = settings.im;
    const token = await getTelegramToken();

    const wanted = Boolean(token) && (im.enabled || im.notifyOnReply);

    if (!wanted) {
        if (current) {
            await current.transport.stop();
            current = null;
        }
        return;
    }

    // A restart is needed when an input the transport was built from moved. The
    // token is one of them: it is a credential, and a stale one answers 401 on
    // every send with an error that reads like a network problem.
    const changed =
        !current ||
        current.settings.ownerId !== im.ownerId ||
        current.settings.enabled !== im.enabled ||
        current.token !== token;
    if (!changed) {
        return;
    }

    if (current) {
        await current.transport.stop();
        current = null;
    }

    const transport = new TelegramTransport({ token: token ?? '', ownerId: im.ownerId, hooks });
    current = { transport, settings: { ...im }, token: token ?? '' };

    // Polling is the switch's business, not the transport's: a transport that
    // exists only to send is built and left stopped.
    if (im.enabled) {
        await transport.start();
    }
}

/** Stop whatever is running, for a clean shutdown. */
export async function stopTransport(): Promise<void> {
    if (current) {
        await current.transport.stop();
        current = null;
    }
}

/** What the settings screen shows. Never includes the token. */
export async function imStatus(): Promise<ImStatusView> {
    const token = await getTelegramToken();
    return { hasToken: Boolean(token), ...statusOf(current?.transport ?? null) };
}
