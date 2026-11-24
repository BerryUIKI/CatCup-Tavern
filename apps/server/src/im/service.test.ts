import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which switches build a transport, and which one starts it.
 *
 * The distinction matters because the two switches answer different questions.
 * *Receive messages* means a long-polling loop; *tell me when a reply finishes*
 * means one outbound call. Wiring both to a single switch is the bug this file
 * exists to prevent — it is what made a notification channel silently require the
 * bot to be listening, and what would have made a notification-only setup poll
 * Telegram forever for messages nobody asked to receive.
 */

const state = {
    settings: {
        im: { enabled: false, ownerId: '', notifyOnReply: false },
    },
    token: null as string | null,
};

/** Every transport the service built, in order. */
const built: Array<{ token: string; ownerId: string; started: boolean; stopped: boolean }> = [];

vi.mock('../storage/settings.js', () => ({
    getSettings: async () => state.settings,
    getTelegramToken: async () => state.token,
}));

vi.mock('./telegram.js', () => ({
    TelegramTransport: class {
        readonly kind = 'telegram';
        private record = { token: '', ownerId: '', started: false, stopped: false };

        constructor(options: { token: string; ownerId: string }) {
            this.record = { token: options.token, ownerId: options.ownerId, started: false, stopped: false };
            built.push(this.record);
        }

        status() {
            return { running: this.record.started && !this.record.stopped, error: null, bot: null };
        }

        async start() {
            this.record.started = true;
        }

        async stop() {
            this.record.stopped = true;
        }

        async send() {}
    },
}));

const { getTransport, imStatus, stopTransport, syncTransport } = await import('./service.js');

beforeEach(async () => {
    await stopTransport();
    built.length = 0;
    state.settings = { im: { enabled: false, ownerId: '999', notifyOnReply: false } };
    state.token = 'token-1';
});

describe('building a transport', () => {
    it('builds nothing without a token', async () => {
        state.token = null;
        state.settings.im.enabled = true;

        await syncTransport();

        expect(built).toHaveLength(0);
        expect(getTransport()).toBeNull();
    });

    it('builds nothing when both switches are off', async () => {
        await syncTransport();

        expect(built).toHaveLength(0);
    });

    it('builds and starts one when receiving is on', async () => {
        state.settings.im.enabled = true;

        await syncTransport();

        expect(built).toHaveLength(1);
        expect(built[0]?.started).toBe(true);
        expect(getTransport()).not.toBeNull();
    });

    it('builds one for notifications alone, and never starts polling', async () => {
        // The bot's own switch is off: nothing should be listening, but there is
        // still somewhere to send "it is done".
        state.settings.im.notifyOnReply = true;

        await syncTransport();

        expect(built).toHaveLength(1);
        expect(built[0]?.started).toBe(false);
        expect(getTransport()).not.toBeNull();
    });

    it('starts polling when receiving is turned on later, without rebuilding', async () => {
        state.settings.im.notifyOnReply = true;
        await syncTransport();
        expect(built).toHaveLength(1);

        state.settings.im.enabled = true;
        await syncTransport();

        // A settings save that changes the poll switch is a change the transport
        // was built from, so it is rebuilt — and the old one is stopped first.
        expect(built).toHaveLength(2);
        expect(built[0]?.stopped).toBe(true);
        expect(built[1]?.started).toBe(true);
    });

    it('rebuilds when the token changes', async () => {
        state.settings.im.notifyOnReply = true;
        await syncTransport();

        state.token = 'token-2';
        await syncTransport();

        // A stale token answers 401 on every send, with an error that reads like
        // a network problem.
        expect(built).toHaveLength(2);
        expect(built[1]?.token).toBe('token-2');
    });

    it('rebuilds when the allowlist changes', async () => {
        state.settings.im.notifyOnReply = true;
        await syncTransport();

        state.settings.im.ownerId = '1000';
        await syncTransport();

        expect(built).toHaveLength(2);
        expect(built[1]?.ownerId).toBe('1000');
    });

    it('does nothing when nothing it was built from moved', async () => {
        state.settings.im.enabled = true;
        await syncTransport();

        await syncTransport();

        // A settings save unrelated to IM must not interrupt a poll.
        expect(built).toHaveLength(1);
        expect(built[0]?.stopped).toBe(false);
    });

    it('tears the transport down when both switches go off', async () => {
        state.settings.im.enabled = true;
        await syncTransport();

        state.settings.im.enabled = false;
        await syncTransport();

        expect(built[0]?.stopped).toBe(true);
        expect(getTransport()).toBeNull();
    });
});

describe('status', () => {
    it('reports whether a token is stored without ever returning it', async () => {
        const status = await imStatus();

        expect(status.hasToken).toBe(true);
        expect(JSON.stringify(status)).not.toContain('token-1');
    });

    it('reports not running when nothing was built', async () => {
        const status = await imStatus();

        expect(status.running).toBe(false);
    });

    it('reports a notification-only transport as not running', async () => {
        state.settings.im.notifyOnReply = true;
        await syncTransport();

        expect((await imStatus()).running).toBe(false);
    });
});
