import type { PromptEntry, PromptOrder, PromptOrderEntry } from '@catcup/shared';
import { GLOBAL_PROMPT_ORDER_ID } from '@catcup/shared';

import {
    DEFAULT_INJECTION_ORDER,
    defaultPromptOrder,
    type GenerationType,
    IDENTIFIER,
    ST_DEFAULT_PROMPTS,
} from './definitions.js';

export interface PromptSettings {
    prompts: PromptEntry[];
    promptOrder: PromptOrder[];
}

/**
 * A prompt definition prepared for assembly: macros expanded and SillyTavern's
 * constructor defaults applied. `marker` is intentionally absent, mirroring
 * `new Prompt(prompt)`.
 */
export interface PreparedPrompt {
    identifier: string;
    role?: 'system' | 'user' | 'assistant';
    content: string;
    system_prompt?: boolean;
    position?: 'start' | 'end' | false;
    injection_position?: number;
    injection_depth?: number;
    injection_order: number;
    injection_trigger: string[];
    forbid_overrides?: boolean;
    extension: boolean;
    name?: string;
}

function clonePrompt(prompt: PromptEntry): PromptEntry {
    return { ...prompt };
}

function cloneOrder(order: PromptOrderEntry[]): PromptOrderEntry[] {
    return order.map((entry) => ({ ...entry }));
}

/**
 * Fill in whatever a preset or settings file leaves out, following
 * SillyTavern's sanitize order.
 *
 * One deliberate divergence: when a global order list exists but is empty,
 * SillyTavern appends a second default list while `find()` keeps returning the
 * empty first one, leaving the prompt with no main, history or examples. This
 * port replaces the empty list instead.
 */
export function sanitizePromptSettings(settings: Partial<PromptSettings> | undefined): PromptSettings {
    const prompts = (settings?.prompts ?? []).map(clonePrompt);
    const promptOrder = (settings?.promptOrder ?? []).map((list) => ({
        character_id: list.character_id,
        order: cloneOrder(list.order ?? []),
    }));

    let global = promptOrder.find((list) => String(list.character_id) === String(GLOBAL_PROMPT_ORDER_ID));
    if (!global) {
        global = { character_id: GLOBAL_PROMPT_ORDER_ID, order: defaultPromptOrder() };
        promptOrder.push(global);
    } else if (global.order.length === 0) {
        global.order = defaultPromptOrder();
    }

    if (prompts.length === 0) {
        prompts.push(...ST_DEFAULT_PROMPTS.map(clonePrompt));
    } else {
        const known = new Set(prompts.map((prompt) => prompt.identifier));
        for (const definition of ST_DEFAULT_PROMPTS) {
            if (!known.has(definition.identifier)) {
                prompts.push(clonePrompt(definition));
            }
        }
    }

    const definitions = new Set(prompts.map((prompt) => prompt.identifier));
    for (const list of promptOrder) {
        list.order = list.order.filter((entry) => definitions.has(entry.identifier));
    }

    return { prompts, promptOrder };
}

/** The order list SillyTavern uses for Chat Completion. */
export function getPromptOrderForCharacter(
    settings: PromptSettings,
    characterId: string | number = GLOBAL_PROMPT_ORDER_ID,
): PromptOrderEntry[] {
    const list = settings.promptOrder.find((candidate) => String(candidate.character_id) === String(characterId));
    return list?.order ?? [];
}

export function getPromptById(prompts: PromptEntry[], identifier: string): PromptEntry | undefined {
    return prompts.find((prompt) => prompt.identifier === identifier);
}

/**
 * True only when the identifier has an order entry that is turned off.
 * An identifier missing from the order counts as enabled.
 */
export function isPromptDisabled(settings: PromptSettings, characterId: string | number, identifier: string): boolean {
    const entry = getPromptOrderForCharacter(settings, characterId).find((item) => item.identifier === identifier);
    return entry ? !entry.enabled : false;
}

/** `injection_trigger` gating: an absent or empty list means every generation type. */
export function shouldTrigger(prompt: PromptEntry, generationType: string): boolean {
    const triggers = prompt.injection_trigger ?? [];
    return triggers.length === 0 || triggers.includes(generationType);
}

export function preparePrompt(prompt: PromptEntry, substitute: (text: string) => string): PreparedPrompt {
    return {
        identifier: prompt.identifier,
        role: prompt.role,
        content: substitute(prompt.content ?? ''),
        system_prompt: prompt.system_prompt,
        position: prompt.position,
        injection_position: prompt.injection_position,
        injection_depth: prompt.injection_depth,
        injection_order: prompt.injection_order ?? DEFAULT_INJECTION_ORDER,
        injection_trigger: prompt.injection_trigger ?? [],
        forbid_overrides: prompt.forbid_overrides,
        extension: prompt.extension ?? false,
        name: prompt.name,
    };
}

export interface BuildCollectionOptions {
    settings: PromptSettings;
    characterId?: string | number;
    generationType?: GenerationType | string;
    substitute?: (text: string) => string;
}

/**
 * Turn the order list into an ordered collection of prepared prompts.
 *
 * Disabled and trigger-mismatched prompts are skipped, except `main`, which is
 * kept as an empty placeholder so relative injections still have a target.
 */
export function buildPromptCollection(options: BuildCollectionOptions): PreparedPrompt[] {
    const { settings, characterId = GLOBAL_PROMPT_ORDER_ID, generationType = 'normal' } = options;
    const substitute = options.substitute ?? ((text: string) => text);
    const type = String(generationType || 'normal')
        .toLowerCase()
        .trim();

    const collection: PreparedPrompt[] = [];

    for (const entry of getPromptOrderForCharacter(settings, characterId)) {
        const prompt = getPromptById(settings.prompts, entry.identifier);
        if (!prompt) {
            continue;
        }

        if (entry.enabled === true && shouldTrigger(prompt, type)) {
            collection.push(preparePrompt(prompt, substitute));
            continue;
        }

        if (entry.identifier === IDENTIFIER.MAIN) {
            collection.push(preparePrompt({ ...prompt, content: '' }, substitute));
        }
    }

    return collection;
}
