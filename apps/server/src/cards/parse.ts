import {
    type CharacterCardData,
    type CharacterSpec,
    characterCardDataSchema,
    characterCardV2Schema,
    characterCardV3Schema,
    isRecord,
} from '@catcup/shared';
import PNGtext from 'png-chunk-text';
import extract from 'png-chunks-extract';

/**
 * Character card parsing.
 *
 * Derived from SillyTavern (AGPL-3.0):
 *   src/character-card-parser.js
 *   https://github.com/SillyTavern/SillyTavern
 *
 * The v3 chunk (`ccv3`) takes precedence over the v2 chunk (`chara`), matching
 * SillyTavern's behavior.
 */

export interface ParsedCard {
    card: CharacterCardData;
    raw: unknown;
    spec: CharacterSpec;
}

export function normalizeCard(raw: unknown): ParsedCard {
    if (!isRecord(raw)) {
        throw new Error('Character card must be a JSON object');
    }

    if (raw.spec === 'chara_card_v3') {
        const parsed = characterCardV3Schema.safeParse(raw);
        if (!parsed.success) {
            throw new Error(`Invalid V3 character card: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
        }
        return { card: parsed.data.data, raw, spec: 'v3' };
    }

    if (raw.spec === 'chara_card_v2') {
        const parsed = characterCardV2Schema.safeParse(raw);
        if (!parsed.success) {
            throw new Error(`Invalid V2 character card: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
        }
        return { card: parsed.data.data, raw, spec: 'v2' };
    }

    // Some cards wrap the payload in `data` without a spec marker.
    if (isRecord(raw.data) && (typeof raw.data.name === 'string' || typeof raw.data.first_mes === 'string')) {
        const parsed = characterCardDataSchema.safeParse(raw.data);
        if (parsed.success) {
            return { card: parsed.data, raw, spec: 'v2' };
        }
    }

    // Legacy flat card: name/first_mes live at the root.
    const parsed = characterCardDataSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error(`Invalid character card: ${parsed.error.issues[0]?.message ?? 'unknown error'}`);
    }
    return { card: parsed.data, raw, spec: 'legacy' };
}

export function parsePngCard(buffer: Uint8Array): ParsedCard {
    const chunks = extract(buffer);
    const textChunks = chunks.filter((chunk) => chunk.name === 'tEXt').map((chunk) => PNGtext.decode(chunk.data));

    const findChunk = (keyword: string) => textChunks.find((chunk) => chunk.keyword.toLowerCase() === keyword);

    const chunk = findChunk('ccv3') ?? findChunk('chara');
    if (!chunk) {
        throw new Error('PNG does not contain character metadata (chara / ccv3)');
    }

    const json = Buffer.from(chunk.text, 'base64').toString('utf8');
    let raw: unknown;
    try {
        raw = JSON.parse(json);
    } catch {
        throw new Error('PNG character metadata is not valid JSON');
    }
    return normalizeCard(raw);
}

export function parseJsonCard(buffer: Uint8Array): ParsedCard {
    let raw: unknown;
    try {
        raw = JSON.parse(Buffer.from(buffer).toString('utf8'));
    } catch {
        throw new Error('Character JSON is not valid JSON');
    }
    return normalizeCard(raw);
}

export function parseCardBuffer(buffer: Uint8Array, fileName: string): ParsedCard {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.png')) {
        return parsePngCard(buffer);
    }
    if (lower.endsWith('.json')) {
        return parseJsonCard(buffer);
    }
    throw new Error('Unsupported card format: expected .png or .json');
}
