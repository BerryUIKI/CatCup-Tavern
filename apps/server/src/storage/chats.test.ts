import { describe, expect, it } from 'vitest';

import { parseChatContent, serializeChat } from './chats.js';

const content = [
    JSON.stringify({
        chat_metadata: { title: 'A test chat' },
        user_name: 'unused',
        character_name: 'unused',
    }),
    JSON.stringify({
        name: 'Seraphina',
        is_user: false,
        mes: 'Welcome, traveler.',
        send_date: '2026-11-09T10:00:00.000Z',
        extra: { swipes: ['Welcome, traveler.'] },
    }),
    JSON.stringify({
        name: 'You',
        is_user: true,
        mes: 'Thank you.',
        extra: {},
    }),
].join('\n');

describe('chat JSONL', () => {
    it('parses SillyTavern JSONL', () => {
        const chat = parseChatContent(content);
        expect(chat.header.chat_metadata.title).toBe('A test chat');
        expect(chat.messages).toHaveLength(2);
        expect(chat.messages[0]?.mes).toBe('Welcome, traveler.');
        expect(chat.messages[1]?.is_user).toBe(true);
    });

    it('round-trips header and messages', () => {
        const chat = parseChatContent(content);
        const roundTripped = parseChatContent(serializeChat(chat));
        expect(roundTripped.header.chat_metadata).toEqual({ title: 'A test chat' });
        expect(roundTripped.messages).toHaveLength(2);
        expect(roundTripped.messages[0]?.extra).toEqual({ swipes: ['Welcome, traveler.'] });
    });

    it('synthesizes a header when the file starts with a message', () => {
        const chat = parseChatContent(JSON.stringify({ name: 'A', mes: 'Hello.' }));
        expect(chat.header.user_name).toBe('unused');
        expect(chat.messages).toHaveLength(1);
    });
});
