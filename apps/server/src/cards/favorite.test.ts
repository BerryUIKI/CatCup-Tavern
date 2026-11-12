import { describe, expect, it } from 'vitest';

import { readFavorite } from './favorite.js';
import { normalizeCard } from './parse.js';

describe('readFavorite', () => {
    it('uses the V2/V3 extension flag and ignores a stale root flag', () => {
        const favorited = normalizeCard({
            spec: 'chara_card_v2',
            data: { name: 'Aria', extensions: { fav: true } },
            fav: false,
        });
        expect(readFavorite(favorited)).toBe(true);

        const stale = normalizeCard({
            spec: 'chara_card_v3',
            data: { name: 'Aria' },
            fav: true,
        });
        expect(readFavorite(stale)).toBe(false);
    });

    it('uses the root flag on a legacy flat card', () => {
        expect(readFavorite(normalizeCard({ name: 'Aria', fav: true }))).toBe(true);
        expect(readFavorite(normalizeCard({ name: 'Aria', fav: 'true' }))).toBe(true);
        expect(readFavorite(normalizeCard({ name: 'Aria', fav: 'TRUE' }))).toBe(false);
        expect(readFavorite(normalizeCard({ name: 'Aria' }))).toBe(false);
    });
});
