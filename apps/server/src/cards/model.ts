import { CATCUP_MODEL_EXTENSION, isRecord } from '@catcup/shared';

import type { ParsedCard } from './parse.js';

/**
 * Read the character's model choice from a parsed card.
 *
 * The choice lives at `data.extensions.catcup_model`, next to SillyTavern's own
 * extension flags. A legacy flat card is normalised into the V2 card shape by
 * the parser, so one reader serves both.
 */
export function readCharacterModel(parsed: ParsedCard): string {
    const extensions = parsed.card.extensions;
    if (!isRecord(extensions)) {
        return '';
    }
    const value = extensions[CATCUP_MODEL_EXTENSION];
    return typeof value === 'string' ? value.trim() : '';
}
