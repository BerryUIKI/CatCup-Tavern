import type { ChatMessage } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { findMessageIndex, withMemoryLock } from './service.js';

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
    return { name: 'Seraphina', is_user: false, mes: 'Hello.', ...overrides };
}

describe('findMessageIndex', () => {
    const anchor = message({ send_date: '2026-11-11T10:00:00.000Z' });

    it('finds the same message after the list shifts', () => {
        const messages = [message({ mes: 'New first.' }), message({ mes: 'Another.' }), anchor];
        expect(findMessageIndex(messages, anchor)).toBe(2);
    });

    it('returns -1 when the message was edited or deleted', () => {
        expect(findMessageIndex([anchor], { ...anchor, mes: 'Changed.' })).toBe(-1);
        expect(findMessageIndex([message({ mes: 'Other.' })], anchor)).toBe(-1);
    });

    it('matches by content when the stored message has no send date', () => {
        const bare = message();
        expect(findMessageIndex([message({ mes: 'First.' }), bare], bare)).toBe(1);
    });

    it('does not confuse a user message with a character message', () => {
        const user = message({ name: 'Alex', is_user: true, mes: 'Hi.' });
        expect(findMessageIndex([message({ name: 'Alex', is_user: false, mes: 'Hi.' })], user)).toBe(-1);
    });
});

describe('withMemoryLock', () => {
    it('serializes work for one chat and releases it afterwards', async () => {
        const order: string[] = [];
        const first = withMemoryLock('chat:one', async () => {
            order.push('a-start');
            await Promise.resolve();
            order.push('a-end');
        });
        const second = withMemoryLock('chat:one', async () => {
            order.push('b');
        });

        await Promise.all([first, second]);
        expect(order).toEqual(['a-start', 'a-end', 'b']);

        // A failed task must not poison the lock.
        await expect(withMemoryLock('chat:one', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
        await expect(withMemoryLock('chat:one', async () => 'after')).resolves.toBe('after');
    });

    it('does not block another chat', async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const first = withMemoryLock('chat:one', () => gate);
        await expect(withMemoryLock('chat:two', async () => 'free')).resolves.toBe('free');
        release();
        await first;
    });
});
