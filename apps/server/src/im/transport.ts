/**
 * A way to reach CatCup from an instant-messaging client.
 *
 * Modelled on `providers/index.ts`'s `getAdapter`: one object per platform, a
 * factory that returns one, and a fixed interface the rest of the server can
 * use without knowing which platform is behind it. RFC 0004 settles why this
 * exists at all; this file settles only its shape.
 *
 * A transport is deliberately **not** allowed to talk to a character. It
 * receives messages, applies the allowlist, and hands each one to a callback.
 * Where a message goes — which chat, which character — is the binding's job
 * (issue #144), and keeping that out of here is what lets a second platform be
 * a second implementation rather than a second design.
 */

/** One message that survived the allowlist. */
export interface IncomingMessage {
    /** The platform's chat id. A group chat and a private chat are different ids. */
    chatId: string;
    /** The platform's user id of whoever sent it. */
    userId: string;
    /** The text, already trimmed. Empty messages never reach here. */
    text: string;
    /** The platform's id for the message, so a reply can be threaded to it. */
    messageId: string;
}

/** What a transport reports about itself, for the settings screen. */
export interface TransportStatus {
    running: boolean;
    /** The last problem, worded for a person. Cleared by a successful poll. */
    error: string | null;
    /** The bot's own identity, once one has been confirmed. */
    bot: { id: string; username: string } | null;
}

export interface TransportHooks {
    /**
     * A message from the allowlisted owner.
     *
     * The transport does not await anything meaningful here: it must keep
     * polling so a second message can arrive (and be refused by the binding)
     * rather than queueing at the network layer.
     */
    onMessage: (message: IncomingMessage) => void;
    /** Called whenever `status()` would answer differently, for a live UI. */
    onStatusChange?: (status: TransportStatus) => void;
}

export interface Transport {
    /** The platform, for a log line and the settings screen. */
    readonly kind: string;
    /**
     * Begin receiving. Must return quickly — the loop runs in the background —
     * and must be a no-op when one is already running.
     */
    start(): Promise<void>;
    /** Stop receiving. Safe to call whether or not anything is running. */
    stop(): Promise<void>;
    /** The current state, for `GET /api/im/status`. */
    status(): TransportStatus;
    /** Send one already-formatted message to a chat. */
    send(chatId: string, text: string): Promise<void>;
}

/** How long to wait before retrying after a failed request, in milliseconds. */
export function backoffMs(attempt: number): number {
    // 1s, 2s, 4s, 8s, capped at 30s. A Telegram outage should not turn into a
    // tight retry loop against a service that is already struggling, and a
    // network blip should not cost more than a second of latency.
    const base = Math.min(1000 * 2 ** Math.max(0, attempt), 30_000);
    // A little jitter, so two CatCup instances behind one NAT do not retry in
    // lockstep. `Math.random` is fine here: this is not a test, and retries do
    // not need to be reproducible.
    return Math.round(base * (0.8 + Math.random() * 0.4));
}
