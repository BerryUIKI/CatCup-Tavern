import type { ChatMessage, Group } from '@catcup/shared';

/** A member the server can make speak, resolved from the character library. */
export interface GroupSpeaker {
    id: string;
    /** Avatar file name stored in the group's `members` array. */
    fileName: string;
    name: string;
}

export type GroupActivationReason =
    | 'explicit'
    | 'current'
    | 'manual'
    | 'list'
    | 'pooled'
    | 'natural-mention'
    | 'natural-next';

export interface GroupSpeakerSelection {
    speaker: GroupSpeaker;
    reason: GroupActivationReason;
}

export interface SelectGroupSpeakerInput {
    group: Group;
    /** Enabled members resolved to characters, in group order. */
    members: readonly GroupSpeaker[];
    messages: readonly ChatMessage[];
    action: 'send' | 'regenerate' | 'continue';
    /** The typed message, for name mentions in natural order. */
    message?: string;
    /** Explicit member file name, id or name. */
    speaker?: string | null;
    /** Injectable for deterministic tests. */
    random?: () => number;
}

/** Members that may speak, in group order. */
export function enabledGroupSpeakers(group: Group, candidates: readonly GroupSpeaker[]): GroupSpeaker[] {
    const disabled = new Set(group.disabled_members);
    return candidates.filter((member) => group.members.includes(member.fileName) && !disabled.has(member.fileName));
}

/** SillyTavern narrator messages are `is_system: false` but carry this type. */
export function isNarratorMessage(message: ChatMessage): boolean {
    return message.extra?.type === 'narrator';
}

/** The most recent speaking member's avatar file name, if any. */
export function lastAssistantSpeaker(messages: readonly ChatMessage[]): string | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message || message.is_user || message.is_system || isNarratorMessage(message)) {
            continue;
        }
        return typeof message.original_avatar === 'string' ? message.original_avatar : null;
    }
    return null;
}

export type CurrentSpeakerResult<T> = { speaker: T } | { missing: true } | null;

/**
 * The member who wrote the last reply, for swipe and continue.
 *
 * SillyTavern's `activateSwipe` works on every group member, muted ones
 * included. A message whose card is gone returns `missing` so the caller can
 * refuse it instead of handing the reply to another member.
 */
export function findCurrentSpeaker<T extends { speaker: GroupSpeaker }>(
    resolved: readonly T[],
    messages: readonly ChatMessage[],
): CurrentSpeakerResult<T> {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (!message || message.is_user || message.is_system || isNarratorMessage(message)) {
            continue;
        }
        const avatar = typeof message.original_avatar === 'string' ? message.original_avatar : '';
        const byAvatar = avatar ? resolved.find((member) => member.speaker.fileName === avatar) : undefined;
        if (byAvatar) {
            return { speaker: byAvatar };
        }
        const byName = resolved.find((member) => member.speaker.name === message.name);
        return byName ? { speaker: byName } : { missing: true };
    }
    return null;
}

function wordsOf(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter(Boolean);
}

/** SillyTavern's mention rule: any word of the member's name appears in the text. */
function isMentioned(name: string, textWords: ReadonlySet<string>): boolean {
    const nameWords = wordsOf(name);
    return nameWords.length > 0 && nameWords.some((word) => textWords.has(word));
}

function nextAfter(list: readonly GroupSpeaker[], fileName: string | null): GroupSpeaker {
    if (!fileName) {
        return list[0] as GroupSpeaker;
    }
    const index = list.findIndex((member) => member.fileName === fileName);
    if (index < 0) {
        return list[0] as GroupSpeaker;
    }
    return list[(index + 1) % list.length] as GroupSpeaker;
}

/**
 * Choose who replies next.
 *
 * SillyTavern can activate several members per turn and generates a reply for
 * each. CatCup generates one reply per call, so list order rotates after the
 * last speaker and natural order picks the first mention or the next member.
 */
export function selectGroupSpeaker(input: SelectGroupSpeakerInput): GroupSpeakerSelection | null {
    const enabled = enabledGroupSpeakers(input.group, input.members);
    if (enabled.length === 0) {
        return null;
    }

    const explicit = input.speaker?.trim().toLowerCase();
    if (explicit) {
        const match = enabled.find(
            (member) =>
                member.fileName.toLowerCase() === explicit ||
                member.id.toLowerCase() === explicit ||
                member.name.toLowerCase() === explicit,
        );
        if (match) {
            return { speaker: match, reason: 'explicit' };
        }
    }

    const current = lastAssistantSpeaker(input.messages);

    // Regenerate and continue rewrite the same member's message, as ST's
    // `activateSwipe` does.
    if (input.action !== 'send' && current) {
        const match = enabled.find((member) => member.fileName === current);
        if (match) {
            return { speaker: match, reason: 'current' };
        }
    }

    switch (input.group.activation_strategy) {
        case 2: {
            // Manual groups: the client picks the speaker. Falling back to the
            // first member keeps an API caller without a pick from failing.
            return { speaker: enabled[0] as GroupSpeaker, reason: 'manual' };
        }
        case 1: {
            return { speaker: nextAfter(enabled, current), reason: 'list' };
        }
        case 3: {
            return { speaker: selectPooled(enabled, input), reason: 'pooled' };
        }
        default: {
            return selectNatural(enabled, input, current);
        }
    }
}

/**
 * ST chooses randomly among members who have not spoken since the user's last
 * message, and otherwise avoids the member who just spoke.
 */
function selectPooled(enabled: readonly GroupSpeaker[], input: SelectGroupSpeakerInput): GroupSpeaker {
    const random = input.random ?? Math.random;

    if (input.action === 'send') {
        return enabled[Math.floor(random() * enabled.length)] as GroupSpeaker;
    }

    const spokenSinceUser = new Set<string>();
    for (let index = input.messages.length - 1; index >= 0; index -= 1) {
        const message = input.messages[index];
        if (!message || message.is_user) {
            break;
        }
        if (message.is_system || isNarratorMessage(message)) {
            continue;
        }
        if (typeof message.original_avatar === 'string') {
            spokenSinceUser.add(message.original_avatar);
        }
    }

    const silent = enabled.filter((member) => !spokenSinceUser.has(member.fileName));
    if (silent.length > 0) {
        return silent[Math.floor(random() * silent.length)] as GroupSpeaker;
    }

    const last = lastAssistantSpeaker(input.messages);
    const pool = enabled.length > 1 && last ? enabled.filter((member) => member.fileName !== last) : enabled;
    const candidates = pool.length > 0 ? pool : enabled;
    return candidates[Math.floor(random() * candidates.length)] as GroupSpeaker;
}

/**
 * ST's natural order: a name mention in the activation text wins; otherwise a
 * member speaks in turn. ST rolls each member's talkativeness and may activate
 * several; one reply per turn makes rotation the predictable equivalent.
 */
function selectNatural(
    enabled: readonly GroupSpeaker[],
    input: SelectGroupSpeakerInput,
    current: string | null,
): GroupSpeakerSelection {
    const banned = input.action !== 'send' && !input.group.allow_self_responses ? current : null;
    const eligible = banned ? enabled.filter((member) => member.fileName !== banned) : enabled;
    const pool = eligible.length > 0 ? eligible : enabled;

    const text = input.action === 'send' ? (input.message ?? '') : lastMessageText(input.messages);
    const textWords = new Set(wordsOf(text));
    if (textWords.size > 0) {
        const mentioned = pool.find((member) => isMentioned(member.name, textWords));
        if (mentioned) {
            return { speaker: mentioned, reason: 'natural-mention' };
        }
    }

    return { speaker: nextAfter(pool, current), reason: 'natural-next' };
}

function lastMessageText(messages: readonly ChatMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && !message.is_system) {
            return message.mes;
        }
    }
    return '';
}
