// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/src/character-card-parser.js
// See docs/REUSE.md.

import { type CharacterPatch, isRecord } from '@catcup/shared';

import { withTextChunks } from './png.js';

function applyPatch(data: Record<string, unknown>, patch: CharacterPatch): Record<string, unknown> {
    const merged = { ...data };
    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined) {
            merged[key] = value;
        }
    }
    return merged;
}

/**
 * Merge an edit into a stored card.
 *
 * A wrapped V2/V3 card keeps its wrapper and every field the editor does not
 * show. A legacy flat card is promoted into a V2 wrapper on the way out, since
 * a card without a `spec` cannot be written back losslessly either.
 */
export function buildCardPayload(raw: unknown, patch: CharacterPatch): Record<string, unknown> {
    const source = isRecord(raw) ? raw : {};

    if (isRecord(source.data) && (source.spec === 'chara_card_v2' || source.spec === 'chara_card_v3')) {
        return { ...source, data: applyPatch(source.data, patch) };
    }

    const flat = { ...source };
    delete flat.spec;
    delete flat.spec_version;
    delete flat.data;

    return {
        spec: 'chara_card_v2',
        spec_version: '2.0',
        data: applyPatch(flat, patch),
    };
}

/** Base64 text for a `tEXt` chunk, as the card format requires. */
function encodeChunkPayload(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

/**
 * Write a card back into a PNG.
 *
 * Both chunks are written, as SillyTavern does: `chara` carries the card as it
 * is stored and `ccv3` carries the same payload under the V3 spec, so a reader
 * that prefers V3 and one that only knows V2 see the same character.
 */
export function writePngCard(buffer: Uint8Array, payload: Record<string, unknown>): Uint8Array {
    const v3 = { ...payload, spec: 'chara_card_v3', spec_version: '3.0' };

    return withTextChunks(buffer, [
        { keyword: 'chara', text: encodeChunkPayload(payload) },
        { keyword: 'ccv3', text: encodeChunkPayload(v3) },
    ]);
}
