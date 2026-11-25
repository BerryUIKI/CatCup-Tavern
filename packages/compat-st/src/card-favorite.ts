// Implements the card format's favourite flag: `data.extensions.fav` on a spec'd
// V2/V3 card, the root `fav` on a legacy flat one. Reading it is a format
// obligation, not an adaptation — see docs/REUSE.md.

import { isRecord } from '@catcup/shared';

import type { ParsedCard } from './card-parse.js';

/**
 * Read the favorite flag from a parsed card.
 *
 * A spec'd V2/V3 card keeps it at `data.extensions.fav`; a legacy flat card
 * keeps it at its root. A stale root `fav` on a spec'd card is ignored, and the
 * exact string `'true'` is accepted from older files.
 */
export function readFavorite(parsed: ParsedCard): boolean {
    const raw = isRecord(parsed.raw) ? parsed.raw : {};
    const specd = raw.spec === 'chara_card_v2' || raw.spec === 'chara_card_v3';
    const value = specd ? parsed.card.extensions.fav : raw.fav;
    return value === true || value === 'true';
}
