import type { ImSettings, ImStatusView } from '@catcup/shared';

import { getSettings, getTelegramToken } from '../storage/settings.js';
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

let current: { transport: Transport; settings: ImSettings } | null = null;

/**
 * Whose messages reach the transport.
 *
 * Replaced when the binding slice (#144) lands. Until then a transport has
 * nowhere to put a message, so the default records it and does nothing — the
 * transport itself is the thing this slice proves, and it is provable without
 * a chat on the other end.
 */
let onMessage: (message: IncomingMessage) => void = () => {};

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
 */
export async function syncTransport(): Promise<void> {
    const settings = await getSettings();
    const im = settings.im;
    const token = await getTelegramToken();

    const wanted = im.enabled && Boolean(token);

    if (!wanted) {
        if (current) {
            await current.transport.stop();
            current = null;
        }
        return;
    }

    // A restart is needed when either input the transport was built from moved.
    const changed = !current || current.settings.ownerId !== im.ownerId || current.settings.enabled !== im.enabled;
    if (!changed) {
        return;
    }

    if (current) {
        await current.transport.stop();
        current = null;
    }

    const transport = new TelegramTransport({ token: token ?? '', ownerId: im.ownerId, hooks });
    current = { transport, settings: { ...im } };
    await transport.start();
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
