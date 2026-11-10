// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/openai.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import { type CharacterDetail, type ChatMessage, GLOBAL_PROMPT_ORDER_ID, type PersonaSettings } from '@catcup/shared';

import type { PromptMessage } from '../providers/types.js';
import { formatWorldInfo } from '../worldinfo/prompt.js';
import type { WorldInfoPrompt } from '../worldinfo/types.js';
import {
    DEFAULT_FORMATS,
    DEFAULT_MESSAGES,
    type GenerationType,
    IDENTIFIER,
    INJECTION_POSITION,
    RESERVED_TOKENS,
} from './definitions.js';
import { type ExampleMessage, parseExampleBlocks, toHistoryEntries } from './history.js';
import { type MacroContext, substituteMacros } from './macros.js';
import {
    buildPromptCollection,
    isPromptDisabled,
    type PreparedPrompt,
    type PromptSettings,
    sanitizePromptSettings,
} from './manager.js';
import { ChatCompletion, type CompletionMessage, type CompletionRole } from './messages.js';
import { estimateTokens } from './tokenizer.js';

export interface AssembleInput {
    promptSettings?: Partial<PromptSettings>;
    /** Order-list id. Defaults to SillyTavern's global Chat Completion id. */
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
    /** Token counter; defaults to the shared estimator. */
    countTokens?: (text: string) => number;
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
    const card = input.character.card;
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
    };
    const substitute = (text: string) => substituteMacros(text, macroContext);

    const collection = buildPromptCollection({
        settings,
        characterId,
        generationType,
        substitute,
    });

    // Phase 1: fixed system prompts, resolved from the card and the scan.
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

    if (input.persona.description.trim()) {
        literals.push({
            identifier: IDENTIFIER.PERSONA_DESCRIPTION,
            role: 'system',
            content: input.persona.description,
        });
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

    // Phase 2: character card overrides for main and jailbreak.
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

    // Phase 4: relative injections into main (the Author's Note in prompt).
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

    // Phase 5: in-chat injections.
    const injections: Injection[] = [];

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

    // Phase 6: chat history, with the injections spliced in by depth.
    const history = toHistoryEntries(input.messages).map(
        (entry, index): CompletionMessage => ({
            identifier: `chatHistory-${index}`,
            role: entry.role,
            content: entry.content,
        }),
    );

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

    if (collection.some((prompt) => prompt.identifier === IDENTIFIER.CHAT_HISTORY)) {
        const index = collection.findIndex((prompt) => prompt.identifier === IDENTIFIER.CHAT_HISTORY);

        let available = completion.remaining - completion.cost([newChatMessage]);
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
    }

    // Phase 7: dialogue examples.
    if (collection.some((prompt) => prompt.identifier === IDENTIFIER.DIALOGUE_EXAMPLES)) {
        const index = collection.findIndex((prompt) => prompt.identifier === IDENTIFIER.DIALOGUE_EXAMPLES);
        const blocks = buildExampleBlocks(input, worldInfo, substitute);

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

    // Phase 8: continue nudge.
    if (generationType === 'continue') {
        completion.add('continueNudge', null, [
            {
                identifier: 'continueNudge',
                role: 'system',
                content: substitute(input.continueNudgePrompt ?? DEFAULT_MESSAGES.continueNudge),
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

    const card = input.character.card;
    // SillyTavern expands macros in `mes_example` before parsing the blocks,
    // so the speaker prefixes are the real names.
    const cardBlocks = parseExampleBlocks(
        substitute(card.mes_example ?? ''),
        card.name || input.character.name,
        input.persona.name,
    );
    blocks.push(...cardBlocks.map((block) => block.map(exampleToMessage)));

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
