import { describe, expect, it } from 'vitest';

import { buildChatMessages, flattenText, mediaMarker, scanTelegramExport } from './telegram.js';

/**
 * The Telegram export parser.
 *
 * Every case here is one where guessing wrong is silent: a media row invented
 * into prose, a service row imported as a conversation turn, a name mismatch
 * that reverses every "I" in the story. The parser's job is to be boring and
 * countable, and these tests hold it to that.
 */

describe('flattenText', () => {
    it('reads a plain string', () => {
        expect(flattenText('Hello.')).toBe('Hello.');
    });

    it('reads the array form Telegram uses for formatted text', () => {
        expect(flattenText(['Hello, ', { type: 'bold', text: 'world' }, '.'])).toBe('Hello, world.');
    });

    it('takes the visible label of a text_link, not the URL behind it', () => {
        // The URL is not part of what the two people said to each other.
        expect(flattenText([{ type: 'text_link', text: 'the post', href: 'https://example.com/x' }])).toBe('the post');
    });

    it('returns nothing for a missing or unusable value', () => {
        expect(flattenText(undefined)).toBe('');
        expect(flattenText(42)).toBe('');
        expect(flattenText([])).toBe('');
    });
});

describe('mediaMarker', () => {
    it('names the kind of media instead of a path', () => {
        // A path from the exporting machine must never reach a chat file, which
        // can be exported to SillyTavern or shared.
        expect(mediaMarker({ photo: 'photos/photo_1.jpg' })).toBe('[photo]');
        expect(mediaMarker({ sticker: { emoji: '🙂' } })).toBe('[sticker]');
        expect(mediaMarker({ voice_message: 'voice_messages/1.ogg' })).toBe('[voice message]');
        expect(mediaMarker({ video_file: 'video_files/1.mp4' })).toBe('[video]');
        expect(mediaMarker({ file: 'files/report.pdf' })).toBe('[file]');
    });

    it('returns null for a row with no media at all', () => {
        expect(mediaMarker({})).toBeNull();
    });
});

describe('scanTelegramExport', () => {
    const exportFile = {
        name: 'Aurelia',
        type: 'personal_chat',
        messages: [
            { id: 1, type: 'message', date: '2026-01-01T10:00:00', from: 'Aurelia', text: 'The gate is warded.' },
            { id: 2, type: 'message', date: '2026-01-01T10:01:00', from: 'You', text: 'I touch it.' },
            // A join: no text, no conversation.
            { id: 3, type: 'service', date: '2026-01-01T10:02:00', actor: 'You', action: 'join_group_by_link' },
            // A photo with a caption is a message; without one it is a marker.
            { id: 4, type: 'message', date: '2026-01-01T10:03:00', from: 'Aurelia', photo: 'photos/1.jpg' },
            {
                id: 5,
                type: 'message',
                date: '2026-01-01T10:04:00',
                from: 'Aurelia',
                photo: 'photos/2.jpg',
                text: 'Look at this.',
            },
            // A row with nothing at all.
            { id: 6, type: 'message', date: '2026-01-01T10:05:00', from: 'You' },
        ],
    };

    it('keeps the messages and counts what it dropped', () => {
        const scan = scanTelegramExport(exportFile);

        expect(scan.title).toBe('Aurelia');
        expect(scan.messages.map((message) => message.text)).toEqual([
            'The gate is warded.',
            'I touch it.',
            '[photo]',
            'Look at this.',
        ]);
        // The service row and the empty row are counted, not invented into text.
        expect(scan.skipped.service).toBe(1);
        expect(scan.skipped.empty).toBe(1);
    });

    it('reports who spoke and how often, which is what the owner picker needs', () => {
        const scan = scanTelegramExport(exportFile);

        expect(scan.participants).toEqual([
            { name: 'Aurelia', count: 3 },
            { name: 'You', count: 1 },
        ]);
    });

    it('reports the date range of the messages it kept', () => {
        // 10:05 is the row with no text, which was dropped. A range that
        // included it would claim the import covers a moment it does not.
        expect(scanTelegramExport(exportFile).range).toEqual({
            from: '2026-01-01T10:00:00',
            to: '2026-01-01T10:04:00',
        });
    });

    it('survives a file that is not an export at all', () => {
        expect(scanTelegramExport(null).messages).toEqual([]);
        expect(scanTelegramExport({ messages: 'nope' }).messages).toEqual([]);
        expect(scanTelegramExport({}).skipped).toEqual({ service: 0, empty: 0, malformed: 0 });
    });

    it('counts a non-object row as malformed rather than crashing', () => {
        expect(scanTelegramExport({ messages: [42, null] }).skipped.malformed).toBe(2);
    });
});

describe('buildChatMessages', () => {
    const scan = scanTelegramExport({
        name: 'Aurelia',
        messages: [
            { id: 1, type: 'message', date: '2026-01-01T10:00:00', from: 'Aurelia', text: 'Welcome.' },
            { id: 2, type: 'message', date: '2026-01-01T10:01:00', from: 'You', text: 'Thank you.' },
        ],
    });

    it('maps the chosen owner to the user and everyone else to the character', () => {
        const messages = buildChatMessages(scan, 'You', { characterName: 'Aurelia' });

        expect(messages).toEqual(
            [
                { name: 'You', is_user: true, mes: 'Thank you.', send_date: '2026-01-01T10:01:00' },
                { name: 'Aurelia', is_user: false, mes: 'Welcome.', send_date: '2026-01-01T10:00:00' },
            ]?.reverse(),
        );
    });

    it('refuses an owner who never speaks instead of silently importing nothing as the user', () => {
        // Reversing every "I" in the story is the failure this prevents, and it
        // is invisible until someone reads the import back.
        expect(buildChatMessages(scan, 'Nobody', { characterName: 'Aurelia' })).toBeNull();
    });

    it('refuses a group rather than collapsing two speakers into one name', () => {
        const group = scanTelegramExport({
            name: 'Table',
            messages: [
                { id: 1, type: 'message', from: 'You', text: 'One.' },
                { id: 2, type: 'message', from: 'Ana', text: 'Two.' },
                { id: 3, type: 'message', from: 'Bo', text: 'Three.' },
            ],
        });

        // Collapsing Ana and Bo into the character's name would rewrite who said
        // what, which is worse than refusing.
        expect(buildChatMessages(group, 'You', { characterName: 'Aurelia' })).toBeNull();
    });

    it('puts a system note first when one is asked for', () => {
        const messages = buildChatMessages(scan, 'You', {
            characterName: 'Aurelia',
            systemNote: 'Imported from Telegram.',
        });

        expect(messages?.[0]).toMatchObject({ is_system: true, mes: 'Imported from Telegram.' });
        expect(messages).toHaveLength(3);
    });
});
