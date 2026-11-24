// Written for CatCup. Turning a card, a persona, a preset and a world info
// scan into the message array a provider receives.

import type { WorldInfoPrompt } from '@catcup/compat-st';
import {
    ChatCompletion,
    type CompletionMessage,
    type CompletionRole,
    DEFAULT_FORMATS,
    DEFAULT_MESSAGES,
    type ExampleMessage,
    estimateTokens,
    formatWorldInfo,
    type GenerationType,
    IDENTIFIER,
    INJECTION_POSITION,
    parseExampleBlocks,
    RESERVED_TOKENS,
    toHistoryEntries,
} from '@catcup/compat-st';
import {
    applyRegexScripts,
    type CharacterDetail,
    type ChatMessage,
    GLOBAL_PROMPT_ORDER_ID,
    type GroupDepthPrompt,
    type JoinedCardFields,
    type PersonaSettings,
    type RegexScript,
    regexPlacementForMessage,
} from '@catcup/shared';
import type { PromptMessage } from '../providers/types.js';
import { type MacroContext, substituteMacros } from './macros.js';
import {
    buildPromptCollection,
    isPromptDisabled,
    type PreparedPrompt,
    type PromptSettings,
    sanitizePromptSettings,
} from './manager.js';
import type { GroupMacroMembers } from './worldInfoTurn.js';

export interface AssembleInput {
    promptSettings?: Partial<PromptSettings>;
    /** Which order list applies; the global one when the caller names none. */
    characterId?: string | number;
    generationType?: GenerationType;
    character: CharacterDetail;
    persona: PersonaSettings;
    /** Full stored chat; `is_system` messages are dropped. */
    messages: readonly ChatMessage[];
    /** Result of the world info scan, or `null` for none. */
    worldInfo?: WorldInfoPrompt | null;
    contextSize: number;
    maxTokens: number;
    squashSystemMessages?: boolean;
    formats?: { wi?: string; personality?: string; scenario?: string };
    newChatPrompt?: string;
    newExampleChatPrompt?: string;
    continueNudgePrompt?: string;
    /** Instruction that makes the model answer as `{{user}}`. */
    impersonationPrompt?: string;
    /** Token counter; defaults to the shared estimator. */
    countTokens?: (text: string) => number;
    /** Scripts with `promptOnly`, applied to the history while assembling. */
    regexScripts?: readonly RegexScript[];
    /** Macro expansion for those scripts. */
    substitute?: (text: string, escapeValues: boolean) => string;
    /**
     * Prefix assistant history messages with the speaker's name, the way
     * SillyTavern's default `names_behavior` formats group chats.
     */
    prefixCharacterNames?: boolean;
    /**
     * A system instruction appended after the history. Group chats use
     * `[Write the next reply only as {{char}}.]`.
     */
    groupNudge?: string;
    /** Member names for `{{group}}` and the other group macros. */
    group?: GroupMacroMembers;
    /** Latest summary, for `{{summary}}` expansion. */
    summaryText?: string;
    /** Formatted summary to inject, at the position the memory settings choose. */
    summaryInjection?: SummaryInjection;
    /**
     * Card fields merged from every group member, replacing the speaking
     * member's own description, personality, scenario and examples. Set only
     * for SillyTavern's two append (join) generation modes.
     */
    joinedCard?: JoinedCardFields | null;
    /**
     * In-chat asides carried by the members' cards. In swap mode the caller
     * passes the speaking member's own `depth_prompt` as a single entry.
     */
    cardDepthPrompts?: readonly GroupDepthPrompt[];
    /**
     * The director's standing rules plus its generated cast block.
     *
     * Empty when the chat has no enabled director, which is what makes an
     * ordinary chat produce exactly the prompt it always did: the marker is in
     * the order either way, but an empty literal adds nothing.
     */
    directorRules?: string;
}

/**
 * A summary ready to enter the prompt.
 *
 * `position` mirrors SillyTavern's `extension_prompt_types`: `-1` none, `0`
 * after the main prompt, `1` in chat at `depth`, `2` before the main prompt.
 * `role` is `0` system, `1` user, `2` assistant.
 */
export interface SummaryInjection {
    content: string;
    position: number;
    role: number;
    depth: number;
}

export interface AssembleResult {
    messages: PromptMessage[];
    /** True when a prompt or the history did not fit the context budget. */
    budgetExceeded: boolean;
    /** Token cost per prompt identifier, for the context inspector. */
    tokenCounts: Record<string, number>;
}

/** A prompt that is injected into the chat rather than the prompt list. */
interface Injection {
    depth: number;
    order: number;
    role: CompletionRole;
    content: string;
}

const PER_MESSAGE_OVERHEAD = 4;

function roleOf(value: number | undefined): CompletionRole {
    if (value === 1) {
        return 'user';
    }
    if (value === 2) {
        return 'assistant';
    }
    return 'system';
}

function toMessage(prompt: PreparedPrompt): CompletionMessage {
    // `name` is a UI label on the definition; SillyTavern never sends it.
    return {
        identifier: prompt.identifier,
        role: prompt.role ?? 'system',
        content: prompt.content,
    };
}

function exampleToMessage(example: ExampleMessage): CompletionMessage {
    return {
        identifier: `example-${example.name}`,
        role: example.role,
        content: example.content,
        name: example.name,
    };
}

/**
 * A persona's text for the `personaDescription` slot.
 *
 * The description comes first and alone when it is all there is. The optional
 * fields follow it as labelled paragraphs, because an unlabelled block would
 * read as more description and the model would not know which part is a way of
 * speaking and which part is a place.
 *
 * Returns `''` when the persona has no text at all, so the slot is not inserted.
 */
export function personaPromptText(persona: PersonaSettings): string {
    const description = persona.description.trim();
    const parts: string[] = [];
    if (description) {
        parts.push(description);
    }
    if (persona.personality?.trim()) {
        parts.push(`Personality: ${persona.personality.trim()}`);
    }
    if (persona.scenario?.trim()) {
        parts.push(`Scenario: ${persona.scenario.trim()}`);
    }

    return parts.join('\n\n');
}

/** Group injections at one depth into the order SillyTavern ends up emitting. */
function buildDepthMessages(injections: readonly Injection[]): CompletionMessage[] {
    const orders = [...new Set(injections.map((injection) => injection.order))].sort((a, b) => a - b);
    const messages: CompletionMessage[] = [];

    for (const order of orders) {
        // ST builds system, user, assistant and the final reversal flips it.
        for (const role of ['assistant', 'user', 'system'] as const) {
            const parts = injections
                .filter((injection) => injection.order === order && injection.role === role && injection.content)
                .map((injection) => injection.content);
            if (parts.length === 0) {
                continue;
            }
            messages.push({ identifier: `depth-${role}-${order}`, role, content: parts.join('\n') });
        }
    }

    return messages;
}

/**
 * Assemble a SillyTavern-compatible Chat Completion prompt.
 *
 * Steps follow ST's `prepareOpenAIMessages`: build the ordered collection,
 * merge the fixed system prompts, apply card overrides, then populate slots in
 * ST's call order with the token budget applied.
 */
export function assemblePrompt(input: AssembleInput): AssembleResult {
    const countTokens = input.countTokens ?? estimateTokens;
    const settings = sanitizePromptSettings(input.promptSettings);
    const characterId = input.characterId ?? GLOBAL_PROMPT_ORDER_ID;
    const generationType = input.generationType ?? 'normal';
    // In a joined group the speaking member's fields are replaced by the joined
    // card text, so the prompt, the `{{description}}` macros and the card
    // overrides all read the same values. Letting them read different copies is
    // how a group chat ends up with a description that disagrees with its own
    // macro expansion.
    const joined = input.joinedCard ?? null;
    const card = joined
        ? {
              ...input.character.card,
              description: joined.description,
              personality: joined.personality,
              scenario: joined.scenario,
              mes_example: joined.mesExample,
          }
        : input.character.card;
    const formats = {
        wi: input.formats?.wi ?? DEFAULT_FORMATS.wi,
        personality: input.formats?.personality ?? DEFAULT_FORMATS.personality,
        scenario: input.formats?.scenario ?? DEFAULT_FORMATS.scenario,
    };

    const macroContext: MacroContext = {
        char: card.name || input.character.name,
        user: input.persona.name,
        description: card.description,
        personality: card.personality,
        scenario: card.scenario,
        ...(input.group ? { group: input.group.members, groupNotMuted: input.group.enabled } : {}),
        ...(input.summaryText ? { summary: input.summaryText } : {}),
    };
    const substitute = (text: string) => substituteMacros(text, macroContext);

    const collection = buildPromptCollection({
        settings,
        characterId,
        generationType,
        substitute,
    });

    // Phase 1 — the fixed system prompts. Each is resolved once here so the
    // order list can place it by identifier without knowing where it came from.
    const worldInfo = input.worldInfo ?? null;
    const literals: Array<{ identifier: string; role: CompletionRole; content: string }> = [
        {
            identifier: IDENTIFIER.WORLD_INFO_BEFORE,
            role: 'system',
            content: formatWorldInfo(worldInfo?.worldInfoBefore ?? '', formats.wi),
        },
        {
            identifier: IDENTIFIER.WORLD_INFO_AFTER,
            role: 'system',
            content: formatWorldInfo(worldInfo?.worldInfoAfter ?? '', formats.wi),
        },
        { identifier: IDENTIFIER.CHAR_DESCRIPTION, role: 'system', content: card.description },
        {
            identifier: IDENTIFIER.CHAR_PERSONALITY,
            role: 'system',
            content: card.personality ? substituteMacros(formats.personality, macroContext) : '',
        },
        {
            identifier: IDENTIFIER.SCENARIO,
            role: 'system',
            content: card.scenario ? substituteMacros(formats.scenario, macroContext) : '',
        },
    ];

    // The persona occupies one slot, so the prompt order keeps treating it as
    // one thing rather than gaining a slot per optional field.
    //
    // The extras are appended in a fixed order and only when they carry
    // something, which keeps an older settings file — a persona with just a name
    // and a description — producing exactly the text it always did.
    const personaText = personaPromptText(input.persona);
    if (personaText) {
        literals.push({
            identifier: IDENTIFIER.PERSONA_DESCRIPTION,
            role: 'system',
            content: personaText,
        });
    }

    // The director's rules sit with the other system material, after the
    // persona and before the character description. Putting them in the
    // dialogue would make them read as something a character said.
    if (input.directorRules?.trim()) {
        const at = literals.findIndex((literal) => literal.identifier === IDENTIFIER.CHAR_DESCRIPTION);
        const entry = {
            identifier: IDENTIFIER.DIRECTOR_RULES,
            role: 'system' as CompletionRole,
            content: input.directorRules.trim(),
        };
        if (at >= 0) {
            literals.splice(at, 0, entry);
        } else {
            literals.push(entry);
        }
    }

    for (const literal of literals) {
        const index = collection.findIndex((prompt) => prompt.identifier === literal.identifier);
        const existing = index >= 0 ? collection[index] : undefined;

        if (!existing) {
            // A marker missing from the order is appended at the end, exactly
            // as SillyTavern does; disabling it in the order still wins.
            collection.push({
                identifier: literal.identifier,
                role: literal.role,
                content: literal.content,
                injection_order: 100,
                injection_trigger: [],
                extension: false,
            });
            continue;
        }

        // The replacement is built from the literal, so the definition's
        // marker/name/system_prompt do not survive, matching ST.
        collection[index] = {
            identifier: literal.identifier,
            role: existing.role ?? literal.role,
            content: literal.content,
            injection_position: existing.injection_position,
            injection_depth: existing.injection_depth,
            injection_order: existing.injection_order,
            injection_trigger: existing.injection_trigger,
            extension: false,
        };
    }

    // Phase 2 — the card's overrides for the main and jailbreak prompts. Done
    // after phase 1 because an override replaces text phase 1 produced.
    applyCardOverride(collection, settings, characterId, IDENTIFIER.MAIN, card.system_prompt, macroContext);
    applyCardOverride(
        collection,
        settings,
        characterId,
        IDENTIFIER.JAILBREAK,
        card.post_history_instructions,
        macroContext,
    );

    // Phase 3: populate.
    const budget = Math.max(1, input.contextSize - input.maxTokens - RESERVED_TOKENS);
    const completion = new ChatCompletion(budget, (message) => countTokens(message.content) + PER_MESSAGE_OVERHEAD);

    const addByIdentifier = (identifier: string): void => {
        const prompt = collection.find((candidate) => candidate.identifier === identifier);
        if (!prompt) {
            return;
        }
        if (identifier !== IDENTIFIER.MAIN && isPromptDisabled(settings, characterId, identifier)) {
            return;
        }
        if (prompt.injection_position === INJECTION_POSITION.ABSOLUTE) {
            return;
        }
        const index = collection.findIndex((candidate) => candidate.identifier === identifier);
        completion.add(identifier, index, [toMessage(prompt)]);
    };

    addByIdentifier(IDENTIFIER.WORLD_INFO_BEFORE);
    addByIdentifier(IDENTIFIER.MAIN);
    addByIdentifier(IDENTIFIER.WORLD_INFO_AFTER);
    addByIdentifier(IDENTIFIER.CHAR_DESCRIPTION);
    addByIdentifier(IDENTIFIER.CHAR_PERSONALITY);
    addByIdentifier(IDENTIFIER.SCENARIO);
    addByIdentifier(IDENTIFIER.PERSONA_DESCRIPTION);

    const userRelative = collection
        .filter((prompt) => prompt.system_prompt === false && prompt.injection_position !== INJECTION_POSITION.ABSOLUTE)
        .map((prompt) => prompt.identifier);

    for (const identifier of [IDENTIFIER.NSFW, IDENTIFIER.JAILBREAK, ...userRelative]) {
        addByIdentifier(identifier);
    }
    addByIdentifier(IDENTIFIER.ENHANCE_DEFINITIONS);

    // Phase 3.5: summary memory. SillyTavern inserts the formatted memory into
    // the main prompt ("after"/"before") or adds it as an in-chat injection.
    const summaryInjection = input.summaryInjection;
    let summaryFallback: Injection | null = null;
    if (summaryInjection?.content && summaryInjection.position !== -1) {
        const summaryMessage: CompletionMessage = {
            identifier: 'summary',
            role: roleOf(summaryInjection.role),
            content: summaryInjection.content,
        };

        if (summaryInjection.position !== 1) {
            if (completion.has(IDENTIFIER.MAIN)) {
                completion.insert(IDENTIFIER.MAIN, summaryMessage, summaryInjection.position === 2 ? 'start' : 'end');
            } else {
                // When the preset moves the main prompt in chat, ST converts a
                // relative summary into an in-chat injection beside main,
                // inheriting main's role, depth and order.
                const mainPrompt = collection.find((prompt) => prompt.identifier === IDENTIFIER.MAIN);
                if (mainPrompt?.injection_position === INJECTION_POSITION.ABSOLUTE) {
                    summaryFallback = {
                        depth: mainPrompt.injection_depth ?? 4,
                        order: mainPrompt.injection_order,
                        role: mainPrompt.role ?? 'system',
                        content: summaryInjection.content,
                    };
                }
                // With no main prompt at all, SillyTavern sends no summary.
            }
        }
    }

    // Phase 4 — injections positioned relative to the main prompt, which is the
    // Author's Note in its "in prompt" mode.
    if (worldInfo?.authorNote?.value) {
        const note = worldInfo.authorNote;
        const message: CompletionMessage = {
            identifier: 'authorsNote',
            role: roleOf(note.role),
            content: note.value,
        };
        if (note.position === 0) {
            completion.insert(IDENTIFIER.MAIN, message, 'end');
        } else if (note.position === 2) {
            completion.insert(IDENTIFIER.MAIN, message, 'start');
        }
    }

    // Phase 5 — in-chat injections, collected before the history so they can be
    // spliced into it at their depths.
    const injections: Injection[] = [];

    if (summaryInjection?.content && summaryInjection.position === 1) {
        injections.push({
            depth: summaryInjection.depth,
            order: 100,
            role: roleOf(summaryInjection.role),
            content: summaryInjection.content,
        });
    }

    if (summaryFallback) {
        injections.push(summaryFallback);
    }

    for (const bucket of worldInfo?.worldInfoDepth ?? []) {
        injections.push({
            depth: bucket.depth,
            order: 100,
            role: roleOf(bucket.role),
            content: bucket.entries.join('\n'),
        });
    }

    for (const prompt of collection) {
        if (prompt.injection_position !== INJECTION_POSITION.ABSOLUTE || !prompt.content) {
            continue;
        }
        injections.push({
            depth: prompt.injection_depth ?? 4,
            order: prompt.injection_order,
            role: prompt.role ?? 'system',
            content: prompt.content,
        });
    }

    if (worldInfo?.authorNote && worldInfo.authorNote.position === 1 && worldInfo.authorNote.value) {
        injections.push({
            depth: worldInfo.authorNote.depth,
            order: 100,
            role: roleOf(worldInfo.authorNote.role),
            content: worldInfo.authorNote.value,
        });
    }

    // Card asides (`depth_prompt` in the card's extensions): the card's own in
    // a single chat, every non-muted member's in a joined group. Each goes in at
    // the depth that card asked for, which is why they are not merged into one.
    for (const [index, aside] of (input.cardDepthPrompts ?? []).entries()) {
        if (!aside.text.trim()) {
            continue;
        }
        injections.push({
            depth: aside.depth,
            order: 100 + index,
            role: aside.role,
            content: aside.text,
        });
    }

    // Phase 6 — the chat history, with the phase 5 injections spliced in at
    // their depths.
    //
    // This is a copy: `promptOnly` scripts run on it and macros expand on it, so
    // the stored message keeps its original text. Order matters within the copy
    // — scripts first, then macros — because a script is written against the
    // stored text, including any `{{char}}` still in it, and expanding first
    // would change what the script's pattern sees.
    const rawHistory = toHistoryEntries(input.messages);
    const depthOffset = generationType === 'continue' ? 2 : 1;
    const history = rawHistory.map((entry, index): CompletionMessage => {
        const content = substitute(
            applyRegexScripts(
                input.regexScripts ?? [],
                entry.content,
                regexPlacementForMessage(entry.role === 'user'),
                {
                    isPrompt: true,
                    depth: rawHistory.length - index - depthOffset,
                    substitute: input.substitute,
                },
            ),
        );

        // In a group chat each turn is prefixed with its speaker, after the
        // content transforms. The rule is "not the user", not "the assistant" —
        // a narrator line and a `sendas` message need their speaker named as
        // much as a character's reply does, and the model has to tell several
        // characters apart.
        return {
            identifier: `chatHistory-${index}`,
            role: entry.role,
            content:
                input.prefixCharacterNames && entry.name && entry.name !== input.persona.name
                    ? `${entry.name}: ${content}`
                    : content,
        };
    });

    const historyLength = history.length;
    const byIndex = new Map<number, Injection[]>();
    for (const injection of injections) {
        const index = Math.max(0, historyLength - injection.depth);
        const list = byIndex.get(index) ?? [];
        list.push(injection);
        byIndex.set(index, list);
    }

    const chronological: CompletionMessage[] = [];
    for (let index = 0; index <= historyLength; index += 1) {
        const bucket = byIndex.get(index);
        if (bucket) {
            chronological.push(...buildDepthMessages(bucket));
        }
        if (index < historyLength) {
            const message = history[index];
            if (message) {
                chronological.push(message);
            }
        }
    }

    const newChatMessage: CompletionMessage = {
        identifier: 'newMainChat',
        role: 'system',
        content: substitute(input.newChatPrompt ?? DEFAULT_MESSAGES.newChat),
    };

    // The group nudge reserves its budget beside the new-chat marker and is
    // appended after the history. It is one of the prompts the squash refuses
    // to merge, because it is a boundary rather than instruction.
    const groupNudgeMessage: CompletionMessage | null = input.groupNudge
        ? { identifier: 'groupNudge', role: 'system', content: substitute(input.groupNudge) }
        : null;

    if (collection.some((prompt) => prompt.identifier === IDENTIFIER.CHAT_HISTORY)) {
        const index = collection.findIndex((prompt) => prompt.identifier === IDENTIFIER.CHAT_HISTORY);

        let available =
            completion.remaining -
            completion.cost([newChatMessage]) -
            (groupNudgeMessage ? completion.cost([groupNudgeMessage]) : 0);
        const kept: CompletionMessage[] = [];

        for (let position = chronological.length - 1; position >= 0; position -= 1) {
            const message = chronological[position];
            if (!message) {
                continue;
            }
            const cost = completion.cost([message]);
            if (cost > available) {
                break;
            }
            available -= cost;
            kept.unshift(message);
        }

        completion.add(IDENTIFIER.CHAT_HISTORY, index, [newChatMessage, ...kept]);
        if (groupNudgeMessage) {
            completion.insert(IDENTIFIER.CHAT_HISTORY, groupNudgeMessage, 'end');
        }
    } else if (groupNudgeMessage) {
        completion.add('groupNudge', null, [groupNudgeMessage]);
    }

    // Phase 7 — dialogue examples, after the history so the model reads them as
    // a sample of the style rather than as part of the conversation.
    if (collection.some((prompt) => prompt.identifier === IDENTIFIER.DIALOGUE_EXAMPLES)) {
        const index = collection.findIndex((prompt) => prompt.identifier === IDENTIFIER.DIALOGUE_EXAMPLES);
        const blocks = buildExampleBlocks(input, worldInfo, substitute, card);

        let available = completion.remaining;
        const items: CompletionMessage[] = [];

        for (const block of blocks) {
            const separator: CompletionMessage = {
                identifier: 'newChat',
                role: 'system',
                content: substitute(input.newExampleChatPrompt ?? DEFAULT_MESSAGES.newExampleChat),
            };
            const candidate = [separator, ...block];
            const cost = completion.cost(candidate);
            if (cost > available) {
                break;
            }
            available -= cost;
            items.push(...candidate);
        }

        if (items.length > 0) {
            completion.add(IDENTIFIER.DIALOGUE_EXAMPLES, index, items);
        }
    }

    // Phase 8 — the continue nudge, appended last among the ordinary prompts
    // because it instructs the model about the reply it is about to write.
    if (generationType === 'continue') {
        completion.add('continueNudge', null, [
            {
                identifier: 'continueNudge',
                role: 'system',
                content: substitute(input.continueNudgePrompt ?? DEFAULT_MESSAGES.continueNudge),
            },
        ]);
    }

    // Phase 9 — the impersonation instruction. Last, and after the history,
    // because it changes who is speaking for this one request.
    //
    // SillyTavern adds this as a control prompt, after the history. Anchoring
    // it at the end is what makes it read as an instruction to write the next
    // turn rather than another line of lore — except for Anthropic, whose
    // adapter hoists every system message to the top-level `system` block.
    if (generationType === 'impersonate') {
        completion.add('impersonate', null, [
            {
                identifier: 'impersonate',
                role: 'system',
                content: substitute(input.impersonationPrompt ?? DEFAULT_MESSAGES.impersonation),
            },
        ]);
    }

    if (input.squashSystemMessages) {
        completion.squashSystemMessages();
    }

    const chat = completion.getChat();

    return {
        messages: chat.map((message) => ({
            role: message.role,
            content: message.content,
            ...(message.name ? { name: message.name } : {}),
        })),
        budgetExceeded: completion.overBudget,
        tokenCounts: completion.tokenCounts(),
    };
}

function applyCardOverride(
    collection: PreparedPrompt[],
    settings: PromptSettings,
    characterId: string | number,
    identifier: string,
    override: string | undefined,
    macroContext: MacroContext,
): void {
    if (!override) {
        return;
    }

    const index = collection.findIndex((prompt) => prompt.identifier === identifier);
    if (index < 0) {
        return;
    }

    const prompt = collection[index];
    if (!prompt || prompt.forbid_overrides === true) {
        return;
    }
    if (isPromptDisabled(settings, characterId, identifier)) {
        return;
    }

    collection[index] = {
        ...prompt,
        // `{{original}}` expands once to the prompt text being replaced.
        content: substituteMacros(override, { ...macroContext, original: prompt.content }),
    };
}

function buildExampleBlocks(
    input: AssembleInput,
    worldInfo: WorldInfoPrompt | null,
    substitute: (text: string) => string,
    card: CharacterDetail['card'],
): CompletionMessage[][] {
    const blocks: CompletionMessage[][] = [];

    // World info example entries sit before or after the card's blocks,
    // depending on their anchor position.
    for (const example of worldInfo?.worldInfoExamples ?? []) {
        if (example.position !== 0 || !example.content) {
            continue;
        }
        blocks.push([
            {
                identifier: 'wi-example',
                role: 'system',
                content: example.content,
                name: 'example_assistant',
            },
        ]);
    }

    // SillyTavern expands macros in `mes_example` before parsing the blocks,
    // so the speaker prefixes are the real names. In a group, every member's
    // name is a speaker, and each turn keeps its prefix so the examples read
    // as three people rather than one.
    const exampleOptions = input.group
        ? { otherNames: input.group.members.filter((name) => name !== input.persona.name), appendNames: true }
        : {};
    const cardName = card.name || input.character.name;

    const cardBlocks = parseExampleBlocks(
        substitute(card.mes_example ?? ''),
        cardName,
        input.persona.name,
        exampleOptions,
    );
    blocks.push(...cardBlocks.map((block) => block.map(exampleToMessage)));

    // A persona made from a card carries that card's exchanges. They are parsed
    // with the same seating: the persona's lines are the `example_user` turns
    // and the character's are `example_assistant`, because an example written
    // the other way round would teach the model to speak the persona's lines
    // from the assistant's seat.
    //
    // The `<START>` is prepended rather than relied on, so a persona text
    // written without one still parses; it is skipped entirely when empty,
    // which leaves a persona that has no examples producing exactly the blocks
    // it always did.
    if (input.persona.mesExample?.trim()) {
        const personaBlocks = parseExampleBlocks(
            `<START>\n${substitute(input.persona.mesExample)}`,
            cardName,
            input.persona.name,
            exampleOptions,
        );
        blocks.push(...personaBlocks.map((block) => block.map(exampleToMessage)));
    }

    for (const example of worldInfo?.worldInfoExamples ?? []) {
        if (example.position !== 1 || !example.content) {
            continue;
        }
        blocks.push([
            {
                identifier: 'wi-example',
                role: 'system',
                content: example.content,
                name: 'example_assistant',
            },
        ]);
    }

    return blocks;
}
