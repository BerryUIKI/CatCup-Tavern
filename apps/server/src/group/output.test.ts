import { describe, expect, it } from 'vitest';

import { cleanGroupReply, stForceAvatarUrl } from './output.js';

describe('group reply cleanup', () => {
    it('strips the speaker prefix', () => {
        expect(cleanGroupReply('Mira: Sit down.', 'Mira', ['Aria'])).toBe('Sit down.');
    });

    it('strips the speaker prefix from every line', () => {
        expect(cleanGroupReply('Mira: The stew is ready.\nMira: Come and eat.', 'Mira', ['Aria'])).toBe(
            'The stew is ready.\nCome and eat.',
        );
    });

    it('cuts at another member line', () => {
        expect(cleanGroupReply('Mira: Sit down.\nAria: Thank you.', 'Mira', ['Aria', 'Bram'])).toBe('Sit down.');
    });

    it('cuts at another member line without a speaker prefix', () => {
        expect(cleanGroupReply('The stew is ready.\nBram: Finally.', 'Mira', ['Aria', 'Bram'])).toBe(
            'The stew is ready.',
        );
    });

    it('keeps the speaker name in the middle of a reply', () => {
        expect(cleanGroupReply('Mira looks up. Mira: not here.', 'Mira', ['Aria'])).toBe(
            'Mira looks up. Mira: not here.',
        );
    });

    it('normalizes Windows line endings', () => {
        expect(cleanGroupReply('Mira: Hello.\r\nAria: Hi.', 'Mira', ['Aria'])).toBe('Hello.');
    });

    it('leaves text alone when the member list is empty', () => {
        expect(cleanGroupReply('Hello.', 'Mira', [])).toBe('Hello.');
    });
});

describe('force avatar URL', () => {
    it('uses SillyTavern’s thumbnail shape and encodes the file name', () => {
        expect(stForceAvatarUrl('Mira Vale.png')).toBe('/thumbnail?type=avatar&file=Mira%20Vale.png');
    });
});
