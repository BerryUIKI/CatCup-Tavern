import type { CharacterDetail, Group } from '@catcup/shared';

import { getCharacter } from '../storage/characters.js';
import type { GroupSpeaker } from './selection.js';

export interface ResolvedMember {
    speaker: GroupSpeaker;
    character: CharacterDetail;
    /** False when the member is muted in the group. */
    enabled: boolean;
}

/** Every member whose card still exists, in group order. */
export async function resolveMembers(group: Group): Promise<ResolvedMember[]> {
    const members: ResolvedMember[] = [];
    for (const fileName of group.members) {
        const character = await getCharacter(fileName).catch(() => null);
        if (!character) {
            continue;
        }
        members.push({
            speaker: { id: character.id, fileName, name: character.name },
            character,
            enabled: !group.disabled_members.includes(fileName),
        });
    }
    return members;
}
