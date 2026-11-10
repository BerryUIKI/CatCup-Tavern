import type { ChatMessage } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { dedupeBooks, isAuthorNoteDue } from './worldInfoTurn.js';

const user = { is_user: true } as ChatMessage;
const bot = { is_user: false } as ChatMessage;

describe('world info turn helpers', () => {
    it('dedupes book ids ignoring case and blanks', () => {
        expect(dedupeBooks(['eldoria', 'Eldoria', ' other ', '', 'other'])).toEqual(['eldoria', 'other']);
    });

    it('schedules the author note on the interval', () => {
        expect(isAuthorNoteDue([], 1)).toBe(false);
        expect(isAuthorNoteDue([bot], 1)).toBe(false);
        expect(isAuthorNoteDue([user], 1)).toBe(true);
        expect(isAuthorNoteDue([user, bot, user], 2)).toBe(true);
        expect(isAuthorNoteDue([user], 2)).toBe(false);
        expect(isAuthorNoteDue([user, bot, user], 0)).toBe(false);
    });
});
