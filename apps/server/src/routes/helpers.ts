import type { CharacterDetail } from '@catcup/shared';

import { badRequest, notFound } from '../http/errors.js';
import { getCharacter } from '../storage/characters.js';

export async function requireCharacter(id: string): Promise<CharacterDetail> {
    const character = await getCharacter(id);
    if (!character) {
        throw notFound('Character not found');
    }
    return character;
}

export function parseMessageIndex(value: string): number {
    const index = Number(value);
    if (!Number.isInteger(index) || index < 0) {
        throw badRequest('Invalid message index');
    }
    return index;
}
