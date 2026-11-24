import { errorMessage } from '@catcup/shared';

import { formatForTelegram, hasBalancedTags } from './format.js';
import { readOffset, writeOffset } from './offset.js';

import {
    backoffMs,
    type IncomingMessage,
    type Transport,
    type TransportHooks,
    type TransportStatus,
} from './transport.js';

/**
 * Telegram, by long polling.
 *
 * Polling rather than a webhook is the whole point: it needs no public address,
 * no TLS certificate and no domain, so an install at home or on a laptop
 * exposes nothing to the network. A webhook would be a better fit for a server
 * with a fixed address, and is a separate decision with its own story.
 *
 * The allowlist is enforced here rather than by a caller, because "who may
 * reach the bot" is a property of the connection and not of whatever consumes
 * the messages. A message from anyone but the owner is dropped without a reply:
 * answering "not allowed" would confirm the bot is listening.
 */

const API_BASE = 'https://api.telegram.org';

/** Telegram's `getUpdates` long-poll timeout, in seconds. */
const POLL_TIMEOUT = 25;

/** How long one HTTP request may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = (POLL_TIMEOUT + 10) * 1000;

interface TelegramUser {
    id?: number;
    is_bot?: boolean;
    username?: string;
}

interface TelegramChat {
    id?: number;
    /** `private`, `group`, `supergroup` or `channel`. */
    type?: string;
}

interface TelegramMessage {
    message_id?: number;
    from?: TelegramUser;
    chat?: TelegramChat;
    text?: string;
}

interface TelegramUpdate {
    update_id?: number;
    message?: TelegramMessage;
}

interface TelegramResponse<T> {
    ok?: boolean;
    result?: T;
    description?: string;
    error_code?: number;
}

export interface TelegramOptions {
    token: string;
    /** The one user id allowed to talk. Empty means nobody. */
    ownerId: string;
    hooks: TransportHooks;
    /** Overridden in tests so a stub can stand in for the Bot API. */
    apiBase?: string;
    /** Overridden in tests so a failure does not wait a real second. */
    sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class TelegramTransport implements Transport {
    readonly kind = 'telegram';

    private readonly token: string;
    private readonly ownerId: string;
    private readonly hooks: TransportHooks;
    private readonly apiBase: string;
    private readonly sleep: (ms: number) => Promise<void>;

    /** The next `offset` for `getUpdates`; `0` means "everything so far is seen". */
    private offset = 0;
    private running = false;
    private stopping: AbortController | null = null;
    private loop: Promise<void> | null = null;
    private lastError: string | null = null;
    private bot: { id: string; username: string } | null = null;

    constructor(options: TelegramOptions) {
        this.token = options.token;
        this.ownerId = options.ownerId.trim();
        this.hooks = options.hooks;
        this.apiBase = options.apiBase ?? API_BASE;
        this.sleep = options.sleep ?? realSleep;
    }

    status(): TransportStatus {
        return { running: this.running, error: this.lastError, bot: this.bot };
    }

    async start(): Promise<void> {
        // A second start must not create a second poll loop; two loops sharing
        // one offset would each see half the updates and answer at random.
        if (this.running) {
            return;
        }

        this.running = true;
        this.stopping = new AbortController();
        // Resumed from the sidecar, so a restart does not re-deliver everything
        // Telegram still holds. Read before the loop starts, or the first poll
        // would ask for offset 0 and the stored value would arrive too late.
        this.offset = await readOffset();
        this.loop = this.pollUntilStopped(this.stopping.signal);
        this.announce();
    }

    async stop(): Promise<void> {
        if (!this.running) {
            return;
        }
        this.running = false;
        this.stopping?.abort();
        // Wait for the in-flight request to unwind, so a caller that stops and
        // immediately restarts cannot end up with two loops after all.
        await this.loop?.catch(() => {});
        this.loop = null;
        this.stopping = null;
        this.announce();
    }

    async send(chatId: string, text: string): Promise<void> {
        // Sent as HTML so a reply's emphasis renders instead of showing its
        // markers. The fallback is deliberate: Telegram rejects a whole message
        // on a parse error, and a reply nobody sees is worse than one with a
        // visible asterisk — so an unbalanced conversion goes out as plain text.
        const html = formatForTelegram(text);
        const useHtml = hasBalancedTags(html);

        const response = await fetch(`${this.apiBase}/bot${this.token}/sendMessage`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                chat_id: chatId,
                text: useHtml ? html : text,
                ...(useHtml ? { parse_mode: 'HTML' } : {}),
                disable_web_page_preview: true,
            }),
            signal: AbortSignal.timeout(20_000),
        });

        const body = (await response.json().catch(() => ({}))) as TelegramResponse<unknown>;
        if (!response.ok || body.ok !== true) {
            throw new Error(body.description ?? `Telegram refused the message (${response.status})`);
        }
    }

    /** Whether a message's sender is the one allowlisted user. */
    isAllowed(userId: string | undefined): boolean {
        // An empty allowlist means nobody, not everybody. Getting this backwards
        // would make an unconfigured bot answer the first stranger who finds it.
        if (!this.ownerId || !userId) {
            return false;
        }
        return userId === this.ownerId;
    }

    /**
     * Whether this message belongs in a private conversation.
     *
     * Only private ones are answered. RFC 0004 §8 settles why: a Telegram group
     * has several humans and a CatCup group chat has several characters, so
     * mapping one to the other is confusing — and the failure is public. A
     * message in a group would be answered *into that group*, where the owner
     * cannot take it back.
     *
     * Silent, like the allowlist: a refusal posted into a group would announce
     * that the bot exists.
     *
     * A missing `type` is **not** private. Failing open here would mean a
     * payload this code does not understand gets the public answer, and the
     * mistake cannot be taken back once Telegram has delivered it.
     */
    private isPrivateChat(chat: TelegramChat | undefined): boolean {
        return chat?.type === 'private';
    }

    private announce(): void {
        this.hooks.onStatusChange?.(this.status());
    }

    /** The poll loop. Never throws: a transport must not take the server down. */
    private async pollUntilStopped(signal: AbortSignal): Promise<void> {
        let attempt = 0;

        while (!signal.aborted) {
            try {
                const updates = await this.getUpdates(signal);
                if (signal.aborted) {
                    return;
                }
                // A successful poll clears the error: the status line should stop
                // showing a blip the moment it recovers.
                if (this.lastError !== null) {
                    this.lastError = null;
                    this.announce();
                }
                attempt = 0;

                for (const update of updates) {
                    this.handle(update);
                }
                // Written after the batch is handled, not before: a crash in
                // the middle of a batch then repeats that batch rather than
                // losing it. At-least-once, with the window as small as the
                // platform allows.
                if (updates.length > 0) {
                    await writeOffset(this.offset);
                }
            } catch (error) {
                if (signal.aborted) {
                    return;
                }
                this.lastError = errorMessage(error) || 'The poll failed';
                this.announce();
                await this.sleep(backoffMs(attempt));
                attempt += 1;
            }
        }
    }

    /** Drain the updates since `offset`, waiting up to Telegram's poll timeout. */
    private async getUpdates(signal: AbortSignal): Promise<TelegramUpdate[]> {
        const url = new URL(`${this.apiBase}/bot${this.token}/getUpdates`);
        url.searchParams.set('offset', String(this.offset));
        url.searchParams.set('timeout', String(POLL_TIMEOUT));
        // Only the kinds this transport understands. Telegram then never sends
        // an edited-message or callback update that would be silently dropped.
        url.searchParams.set('allowed_updates', JSON.stringify(['message']));

        const response = await fetch(url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        });

        const body = (await response.json().catch(() => ({}))) as TelegramResponse<TelegramUpdate[]>;

        if (!response.ok || body.ok !== true) {
            // 409 means another process is polling this token. Saying so is the
            // difference between "figure out your token" and "figure out why it
            // is secretly running twice".
            const detail = body.description ?? response.statusText ?? 'unknown error';
            throw new Error(
                body.error_code === 409
                    ? `Another process is already polling this bot (${detail})`
                    : `Telegram refused the poll: ${detail}`,
            );
        }

        return body.result ?? [];
    }

    /** Act on one update, advancing the offset so it is never seen twice. */
    private handle(update: TelegramUpdate): void {
        if (typeof update.update_id === 'number') {
            this.offset = update.update_id + 1;
        }

        const message = update.message;
        if (!message) {
            return;
        }

        const text = message.text?.trim() ?? '';
        const chatId = message.chat?.id;
        const userId = message.from?.id;
        if (!text || chatId === undefined || userId === undefined) {
            return;
        }

        // Checked before anything else that costs work, and before the binding
        // can see it: a group message must not create a binding for the group
        // either, or the next message there would have a history to write to.
        if (!this.isPrivateChat(message.chat)) {
            return;
        }

        // Record the bot's identity the first time a message arrives, so the
        // settings screen can say which bot is connected without a separate
        // `getMe` call on every status read.
        if (!this.bot && message.from?.is_bot === false) {
            void this.identify();
        }

        const incoming: IncomingMessage = {
            chatId: String(chatId),
            userId: String(userId),
            text,
            messageId: String(message.message_id ?? ''),
        };

        // Dropped silently, which is the point: a reply would confirm the bot.
        if (!this.isAllowed(incoming.userId)) {
            return;
        }

        this.hooks.onMessage(incoming);
    }

    /** Ask Telegram who this bot is, for the status line. Best-effort. */
    private async identify(): Promise<void> {
        try {
            const response = await fetch(`${this.apiBase}/bot${this.token}/getMe`, {
                signal: AbortSignal.timeout(10_000),
            });
            const body = (await response.json().catch(() => ({}))) as TelegramResponse<TelegramUser>;
            const user = body.result;
            if (body.ok === true && user?.id !== undefined) {
                this.bot = { id: String(user.id), username: user.username ?? '' };
                this.announce();
            }
        } catch {
            // A status line is not worth failing a poll over.
        }
    }
}
