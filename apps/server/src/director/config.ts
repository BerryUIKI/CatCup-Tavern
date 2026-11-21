import type { CharacterDetail, DirectorConfig } from '@catcup/shared';
import { directorOf } from '@catcup/shared';

/**
 * The director's block in the prompt, and the one validation it cannot skip.
 *
 * The block is small — a standing instruction plus a generated cast list — and
 * that is the point. Most of what a director does is *not* add text: it removes
 * the played character from the model's job and keeps them in the prompt, which
 * the group machinery already knows how to express.
 */

export interface CastMember {
    /** Avatar file name, which is what a group's `disabled_members` holds. */
    id: string;
    name: string;
}

export interface CastInput {
    /** The chat's own card. */
    character: Pick<CharacterDetail, 'id' | 'name'>;
    /** Members of a group chat, when there is one. */
    members?: readonly CastMember[];
    /** The chat's director config, already validated. */
    director: DirectorConfig;
}

/**
 * The names the person is playing, resolved to display names.
 *
 * `playedMembers` holds avatar file names so a card rename does not unbind the
 * person; the prompt needs names, so they are looked up here. A played member
 * the chat does not contain is dropped rather than rendered as a file name —
 * a stale entry should cost nothing, not leak a path into the prompt.
 */
export function playedNamesOf(input: CastInput): string[] {
    const cast = input.members ?? [{ id: input.character.id, name: input.character.name }];
    const byId = new Map(cast.map((member) => [member.id, member.name]));

    return input.director.playedMembers.map((id) => byId.get(id)).filter((name): name is string => Boolean(name));
}

/**
 * Build the `directorRules` block.
 *
 * An empty `rules` still emits the cast block, because the cast block is the
 * useful half: "the player controls X, never write their dialogue" is what
 * makes a guided scene work, and it needs no authoring.
 *
 * Returns an empty string when there is nothing to say, which is what keeps an
 * ordinary chat's prompt byte-identical.
 */
export function directorBlock(input: CastInput): string {
    const played = playedNamesOf(input);
    if (!input.director.enabled) {
        return '';
    }
    // A director with no rules and nobody played would inject a block that says
    // nothing; the cast line is the only part that carries an instruction.
    if (!input.director.rules.trim() && played.length === 0) {
        return '';
    }

    const lines: string[] = [];
    if (input.director.rules.trim()) {
        lines.push(input.director.rules.trim());
    }

    if (played.length > 0) {
        lines.push('');
        lines.push('You run this scene. Write the world and every character the player is not playing.');
        lines.push(`The player controls ${played.join(', ')}. Never write their dialogue, thoughts or decisions.`);
    }

    return lines.join('\n');
}

/**
 * Why a director config cannot be used on this chat, or `null` when it can.
 *
 * A single chat's card block says "you are {{char}}" (`assemble.ts`), so a chat
 * that both speaks as its character and forbids writing them contradicts
 * itself. That is refused rather than warned about, because the warning would
 * be lost and the contradiction would show up as a model that occasionally
 * speaks for the person.
 *
 * A group has no such collision: the speaking member is chosen per turn, and a
 * played member is muted for the whole chat.
 */
export function directorRefusal(input: {
    director: DirectorConfig | null;
    character: Pick<CharacterDetail, 'id' | 'name'>;
    isGroup: boolean;
}): string | null {
    const { director, character, isGroup } = input;
    if (!director?.enabled || isGroup) {
        return null;
    }

    const playsOwnCard = director.playedMembers.includes(character.id);
    if (!playsOwnCard) {
        return null;
    }

    return (
        `A single chat cannot play its own character (${character.name}): the prompt tells the model to be ` +
        `that character, so also forbidding it from writing them contradicts itself. ` +
        `Put the cast in a group chat, or keep this card as the narrator and play someone the world book describes.`
    );
}

/** Read a chat's director config, as every caller does. */
export function readDirector(metadata: Record<string, unknown> | null | undefined): DirectorConfig | null {
    return directorOf(metadata);
}
