import type { CharacterDetail } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { buildGreetingMessage, parseChatContent, serializeChat } from './chats.js';

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

const character = {
    id: 'seraphina',
    name: 'Seraphina',
    card: {
        name: 'Seraphina',
        first_mes: 'Welcome.',
        alternate_greetings: ['Hello again.', 'You are late.'],
    },
} as unknown as CharacterDetail;

describe('greeting messages', () => {
    it('stores every greeting as a swipe on the first message', () => {
        const message = buildGreetingMessage(character, 1);

        expect(message?.mes).toBe('Hello again.');
        expect(message?.extra).toMatchObject({
            swipes: ['Welcome.', 'Hello again.', 'You are late.'],
            swipe_id: 1,
        });
    });

    it('skips empty greetings without renumbering the alternates', () => {
        const sparse = {
            ...character,
            card: { ...character.card, first_mes: '   ', alternate_greetings: ['Only one'] },
        } as CharacterDetail;

        const message = buildGreetingMessage(sparse, 1);

        expect(message?.mes).toBe('Only one');
        expect(message?.extra?.swipes).toEqual(['Only one']);
    });

    it('falls back to the first message for an out-of-range index', () => {
        expect(buildGreetingMessage(character, 9)?.mes).toBe('Welcome.');
    });

    it('returns null when the chosen greeting is empty', () => {
        const sparse = {
            ...character,
            card: { ...character.card, first_mes: '   ', alternate_greetings: ['Only one'] },
        } as CharacterDetail;

        expect(buildGreetingMessage(sparse, 0)).toBeNull();
    });

    it('applies the transform to every greeting', () => {
        const message = buildGreetingMessage(character, 0, (text) => text.toUpperCase());

        expect(message?.mes).toBe('WELCOME.');
        expect(message?.extra?.swipes).toEqual(['WELCOME.', 'HELLO AGAIN.', 'YOU ARE LATE.']);
    });
});
