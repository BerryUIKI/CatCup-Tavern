import type { ChatMessage } from '@catcup/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What a notification says, and when it says nothing.
 *
 * Two halves, both of them the feature rather than its plumbing. `previewOf`
 * bounds what a message carries — a preview that quietly grows until it is the
 * whole reply is not noticed until someone's phone shows a chapter. And the
 * decision around it is what keeps the feature from becoming noise: a reply the
 * person is watching, a reply they stopped, and a reply that came over IM itself
 * are all silent.
 */

const state: {
    settings: { im: { notifyOnReply: boolean; ownerId: string } };
    transport: { sent: Array<{ chatId: string; text: string }>; fail: boolean } | null;
} = { settings: { im: { notifyOnReply: true, ownerId: '999' } }, transport: null };

vi.mock('../storage/settings.js', () => ({ getSettings: async () => state.settings }));
vi.mock('./service.js', () => ({
    getTransport: () => {
        if (!state.transport) {
            return null;
        }
        return {
            send: async (chatId: string, text: string) => {
                if (state.transport?.fail) {
                    throw new Error('Telegram refused the message');
                }
                state.transport?.sent.push({ chatId, text });
            },
        };
    },
}));

const { notificationFor, notifyTurn, previewOf } = await import('./notify.js');

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return {
        name: 'Aria',
        is_user: false,
        send_date: '2026-11-24T00:00:00.000Z',
        mes: 'The gate swings open. Mist pours through it.',
        extra: {},
        ...overrides,
    };
}

beforeEach(() => {
    state.settings = { im: { notifyOnReply: true, ownerId: '999' } };
    state.transport = { sent: [], fail: false };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('previewOf', () => {
    it('keeps a short reply whole', () => {
        expect(previewOf('The gate swings open.')).toBe('The gate swings open.');
    });

    it('takes the first sentence when there are several', () => {
        expect(previewOf('The gate swings open. Mist pours through it.')).toBe('The gate swings open.');
    });

    it('takes the first sentence of a Chinese reply', () => {
        // A CJK full stop is a sentence boundary; without handling it the whole
        // paragraph would be one "sentence" and get truncated mid-word instead.
        expect(previewOf('门开了。雾气涌进来。')).toBe('门开了。');
    });

    it('collapses whitespace so a paragraph does not arrive as a block', () => {
        expect(previewOf('Line one.\n\n   Line two.')).toBe('Line one.');
    });

    it('truncates an over-long first sentence rather than sending it whole', () => {
        const preview = previewOf(`${'word '.repeat(200)}`);
        expect(preview.length).toBeLessThanOrEqual(120);
        expect(preview.endsWith('…')).toBe(true);
    });

    it('returns nothing for empty text', () => {
        expect(previewOf('   ')).toBe('');
    });
});

describe('notificationFor', () => {
    it('says nothing when the app was in front', () => {
        // The whole reason this feature is opt-in per generation: someone
        // watching the reply already has it.
        expect(
            notificationFor({ type: 'done', message: message() }, { characterName: 'Aria', background: false }),
        ).toBeNull();
    });

    it('names the character and the first sentence when the app was not in front', () => {
        const text = notificationFor({ type: 'done', message: message() }, { characterName: 'Aria', background: true });

        expect(text).toBe('Aria replied: The gate swings open.');
    });

    it('says nothing about a reply the person stopped', () => {
        // They pressed the button. Telling them it finished is noise.
        const stopped = message({ extra: { stopped: true } });

        expect(
            notificationFor({ type: 'done', message: stopped }, { characterName: 'Aria', background: true }),
        ).toBeNull();
    });

    it('reports a failure, because silence looks exactly like a slow reply', () => {
        const text = notificationFor(
            { type: 'error', message: 'The provider refused the request' },
            { characterName: 'Aria', background: true },
        );

        expect(text).toBe('The reply from Aria failed: The provider refused the request');
    });

    it('reports a failure even when no message was stored', () => {
        const text = notificationFor(
            { type: 'error', message: 'Generation stopped' },
            { characterName: 'Aria', background: true },
        );

        expect(text).toContain('failed');
    });

    it('says nothing when the generation produced no terminal event', () => {
        expect(notificationFor(null, { characterName: 'Aria', background: true })).toBeNull();
    });

    it('says nothing when a stored reply has no text', () => {
        const blank = message({ mes: '   ' });

        expect(
            notificationFor({ type: 'done', message: blank }, { characterName: 'Aria', background: true }),
        ).toBeNull();
    });

    it('writes plain text, because the transport sends without a parse mode', () => {
        const text = notificationFor(
            { type: 'done', message: message() },
            { characterName: 'Aria_2', background: true },
        );

        // Markers would arrive as literal asterisks, and Telegram's Markdown
        // modes break on an underscore in a character name.
        expect(text).not.toContain('*');
        expect(text).toBe('Aria_2 replied: The gate swings open.');
    });
});

describe('notifyTurn', () => {
    it('sends nothing when the setting is off', async () => {
        state.settings = { im: { notifyOnReply: false, ownerId: '999' } };

        await notifyTurn({ type: 'done', message: message() }, { characterName: 'Aria', background: true });

        expect(state.transport?.sent).toEqual([]);
    });

    it('sends nothing when no allowlist is set', async () => {
        // An empty allowlist means nobody, which is the same answer the
        // transport gives to an incoming message.
        state.settings = { im: { notifyOnReply: true, ownerId: '  ' } };

        await notifyTurn({ type: 'done', message: message() }, { characterName: 'Aria', background: true });

        expect(state.transport?.sent).toEqual([]);
    });

    it('sends nothing when no bot is running', async () => {
        state.transport = null;

        await notifyTurn({ type: 'done', message: message() }, { characterName: 'Aria', background: true });

        expect(state.transport).toBeNull();
    });

    it('sends to the owner, not to whichever chat happens to be bound', async () => {
        await notifyTurn({ type: 'done', message: message() }, { characterName: 'Aria', background: true });

        expect(state.transport?.sent).toEqual([{ chatId: '999', text: 'Aria replied: The gate swings open.' }]);
    });

    it('swallows a delivery failure rather than costing the reply', async () => {
        if (state.transport) {
            state.transport.fail = true;
        }

        await expect(
            notifyTurn({ type: 'done', message: message() }, { characterName: 'Aria', background: true }),
        ).resolves.toBeUndefined();
    });
});
