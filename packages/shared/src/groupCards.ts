import { groupGenerationMode } from './schemas/group.js';

/** One member's card, as the joined-mode builders need it. */
export interface JoinedMemberCard {
    /** Avatar file name, as stored in `group.members`. */
    fileName: string;
    /** The name the model should see; macros use it as `{{char}}`. */
    name: string;
    description: string;
    personality: string;
    scenario: string;
    /** `mes_example`, with `<START>` blocks intact. */
    mesExample: string;
}

export interface JoinedCardInput {
    /** Every member in group order, including muted ones. */
    members: readonly JoinedMemberCard[];
    /** Avatar file names of the muted members. */
    disabledMembers: readonly string[];
    /** Wanted reply mode; SWAP leaves each member on its own card. */
    generationMode: number;
    /** Avatar file name of the member being made to speak. */
    speaker: string;
    /** Free text placed before every member's field. */
    joinPrefix?: string;
    /** Free text placed after every member's field. */
    joinSuffix?: string;
    /** Field-level macro expansion, called with the member's name. */
    substitute?: (text: string, charName: string) => string;
    /** Per-chat overrides, as SillyTavern stores them on `chat_metadata`. */
    scenarioOverride?: string;
    mesExampleOverride?: string;
}

/** Every card field appended mode replaces. */
export interface JoinedCardFields {
    description: string;
    personality: string;
    scenario: string;
    mesExample: string;
}

/**
 * Whether a group's reply mode merges every member's card into one.
 *
 * SillyTavern's `group_generation_mode`: 0 swap, 1 join excluding muted
 * members, 2 join including them. Swap keeps the speaking member's own card,
 * so nothing is merged.
 */
export function joinsGroupCards(generationMode: number): boolean {
    return generationMode === groupGenerationMode.APPEND || generationMode === groupGenerationMode.APPEND_DISABLED;
}

/**
 * Apply a member's field to the join prefix/suffix.
 *
 * SillyTavern's `customTransform`: `<FIELDNAME>` becomes the field's display
 * name, macros expand with the member as `{{char}}`, and the value itself is
 * trimmed before it is wrapped.
 */
function transform(value: string, fieldName: string, charName: string, substitute?: JoinedCardInput['substitute']) {
    const named = value.replace(/<FIELDNAME>/gi, fieldName);
    return substitute ? substitute(named, charName) : named;
}

function prepared(value: string, fieldName: string, charName: string, input: JoinedCardInput): string {
    const body = value.trim();
    if (!body) {
        return '';
    }
    const prefix = transform(input.joinPrefix ?? '', fieldName, charName, input.substitute);
    const suffix = transform(input.joinSuffix ?? '', fieldName, charName, input.substitute);
    return `${prefix}${transform(body, fieldName, charName, input.substitute).trim()}${suffix}`;
}

function collectField(
    fieldName: string,
    members: readonly JoinedMemberCard[],
    input: JoinedCardInput,
    getter: (member: JoinedMemberCard) => string,
    preprocess?: (value: string) => string,
): string {
    const disabled = new Set(input.disabledMembers);
    const values: string[] = [];

    for (const member of members) {
        // Under "join including muted", a muted member's card is merged too;
        // the speaker's own card always joins, as in SillyTavern.
        const muted = disabled.has(member.fileName);
        if (
            muted &&
            input.generationMode !== groupGenerationMode.APPEND_DISABLED &&
            member.fileName !== input.speaker
        ) {
            continue;
        }
        const raw = getter(member) ?? '';
        const value = preprocess ? preprocess(raw.trim()) : raw;
        if (!value.trim()) {
            continue;
        }
        values.push(prepared(value, fieldName, member.name, input));
    }

    return values.filter((value) => value.length > 0).join('\n');
}

/**
 * SillyTavern's `getGroupCharacterCards`: merge every member's description,
 * personality, scenario and examples into the four card fields the prompt
 * builder reads, for the two append (join) modes.
 *
 * Returns `null` for swap mode or an empty group, so the caller keeps the
 * speaking member's own card.
 */
export function buildJoinedCardFields(input: JoinedCardInput): JoinedCardFields | null {
    if (!joinsGroupCards(input.generationMode) || input.members.length === 0) {
        return null;
    }

    return {
        description: collectField('Description', input.members, input, (member) => member.description),
        personality: collectField('Personality', input.members, input, (member) => member.personality),
        // A chat may pin one scenario or example set for the whole group.
        scenario:
            input.scenarioOverride?.trim() ||
            collectField('Scenario', input.members, input, (member) => member.scenario),
        mesExample:
            input.mesExampleOverride?.trim() ||
            collectField(
                'Example Messages',
                input.members,
                input,
                (member) => member.mesExample,
                (value) => (value.startsWith('<START>') ? value : `<START>\n${value}`),
            ),
    };
}

/** A card's `extensions.depth_prompt`, the in-chat aside a card can carry. */
export interface CardDepthPrompt {
    prompt: string;
    depth: number;
    role: 'system' | 'user' | 'assistant';
}

/** SillyTavern's `depth_prompt_depth_default` and `depth_prompt_role_default`. */
export const DEPTH_PROMPT_DEFAULT_DEPTH = 4;
export const DEPTH_PROMPT_DEFAULT_ROLE: CardDepthPrompt['role'] = 'system';

/**
 * Read a card's depth prompt, with SillyTavern's defaults for a partial one.
 *
 * `extensions` is a passthrough record on every card version, so the shape is
 * checked here rather than in the schema.
 */
export function readCardDepthPrompt(extensions: Record<string, unknown> | undefined): CardDepthPrompt | null {
    const value = extensions?.depth_prompt;
    if (!value || typeof value !== 'object') {
        return null;
    }
    const record = value as Record<string, unknown>;
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
    if (!prompt) {
        return null;
    }
    const depth =
        typeof record.depth === 'number' && Number.isFinite(record.depth) ? record.depth : DEPTH_PROMPT_DEFAULT_DEPTH;
    const role =
        record.role === 'user' || record.role === 'assistant' || record.role === 'system'
            ? record.role
            : DEPTH_PROMPT_DEFAULT_ROLE;
    return { prompt, depth, role };
}

/** One in-chat injection a group's cards contribute. */
export interface GroupDepthPrompt {
    fileName: string;
    charName: string;
    text: string;
    depth: number;
    role: CardDepthPrompt['role'];
}

/**
 * SillyTavern's `getGroupDepthPrompts`: in swap mode the speaking member's own
 * depth prompt is used, so this returns an empty list. In the join modes every
 * member's depth prompt is injected, muted members included, because their card
 * text is part of the prompt too.
 */
export function buildGroupDepthPrompts(input: {
    members: readonly JoinedMemberCard[];
    depthPrompts: ReadonlyMap<string, CardDepthPrompt>;
    disabledMembers: readonly string[];
    generationMode: number;
    speaker: string;
    substitute?: (text: string, charName: string) => string;
}): GroupDepthPrompt[] {
    if (!joinsGroupCards(input.generationMode)) {
        return [];
    }

    const disabled = new Set(input.disabledMembers);
    const result: GroupDepthPrompt[] = [];

    for (const member of input.members) {
        if (disabled.has(member.fileName) && member.fileName !== input.speaker) {
            continue;
        }
        const depthPrompt = input.depthPrompts.get(member.fileName);
        if (!depthPrompt) {
            continue;
        }
        const text = input.substitute ? input.substitute(depthPrompt.prompt, member.name) : depthPrompt.prompt;
        if (!text.trim()) {
            continue;
        }
        result.push({
            fileName: member.fileName,
            charName: member.name,
            text,
            depth: depthPrompt.depth,
            role: depthPrompt.role,
        });
    }

    return result;
}
