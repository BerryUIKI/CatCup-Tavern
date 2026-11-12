import { isRecord } from '@catcup/shared';

import type { ParsedCard } from './parse.js';

/**
 * Read SillyTavern's favorite flag from a parsed card.
 *
 * Derived from SillyTavern (AGPL-3.0):
 *   src/endpoints/characters.js (`readFromV2`, `charaFormatData`)
 *   https://github.com/SillyTavern/SillyTavern
 *
 * A spec'd V2/V3 card uses `data.extensions.fav`; a legacy flat card keeps the
 * flag at its root. ST ignores a stale root `fav` on a spec'd card, and accepts
 * the exact string `'true'` from older files.
 */
export function readFavorite(parsed: ParsedCard): boolean {
    const raw = isRecord(parsed.raw) ? parsed.raw : {};
    const specd = raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3';
    const value = specd ? parsed.card.extensions.fav : raw.fav;
    return value === true || value === 'true';
}
