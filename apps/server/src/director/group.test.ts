import { directorConfigSchema } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { directorBlock, directorRefusal, playedNamesOf } from './config.js';

/**
 * The director in a group chat.
 *
 * A group is the case the design was built for — several characters, one of
 * them the player — and it is also the case where the single-chat refusal must
 * *not* fire, because a group has no contradiction between "you are {{char}}"
 * and "never write this member".
 */

const cast = [
    { id: 'Aurelia.png', name: 'Aurelia' },
    { id: 'Bram.png', name: 'Bram' },
    { id: 'Narrator.png', name: 'Narrator' },
];

/**
 * The first cast member.
 *
 * `character` is only used for its id when a member list is supplied, so any
 * entry would do — this is `cast[0]` with the assertion made explicit rather
 * than asserted with `!`.
 */
const lead = cast[0] ?? { id: '', name: '' };

function director(overrides: Record<string, unknown> = {}) {
    return directorConfigSchema.parse({ enabled: true, ...overrides });
}

describe('a group plays any member', () => {
    it('is never refused, even for the member who could speak', () => {
        // Unlike a single chat: the speaker is chosen per turn and a played
        // member is muted for the whole chat, so there is no contradiction.
        for (const member of cast) {
            expect(
                directorRefusal({
                    director: director({ playedMembers: [member.id] }),
                    character: { id: member.id, name: member.name },
                    isGroup: true,
                }),
            ).toBeNull();
        }
    });

    it('names the played member by the name the prompt uses', () => {
        const block = directorBlock({
            character: lead,
            members: cast,
            director: director({ playedMembers: ['Bram.png'] }),
        });

        expect(block).toContain('The player controls Bram');
        // And never the others, which is the whole point of the cast block.
        expect(block).not.toContain('The player controls Aurelia');
    });

    it('renders nobody for a member who is no longer in the group', () => {
        // A card removed from the group leaves a stale entry; it must cost
        // nothing rather than putting a file name in the prompt.
        const names = playedNamesOf({
            character: lead,
            members: cast,
            director: director({ playedMembers: ['Gone.png'] }),
        });

        expect(names).toEqual([]);
    });

    it('keeps the cast line even when several members are played', () => {
        const block = directorBlock({
            character: lead,
            members: cast,
            director: director({ playedMembers: ['Aurelia.png', 'Bram.png'] }),
        });

        expect(block).toContain('The player controls Aurelia, Bram');
    });

    it('emits nothing for a group whose director is off', () => {
        expect(
            directorBlock({
                character: lead,
                members: cast,
                director: director({ enabled: false, playedMembers: ['Bram.png'] }),
            }),
        ).toBe('');
    });
});
