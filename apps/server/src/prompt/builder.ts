import type { CharacterDetail, ChatMessage, GenerationSettings, PersonaSettings } from '@catcup/shared';

import type { WorldInfoPrompt } from '../worldinfo/types.js';
import { type AssembleResult, assemblePrompt } from './assemble.js';
import type { GenerationType } from './definitions.js';
import type { PromptSettings } from './manager.js';

export type { MacroContext } from './macros.js';
export { substituteMacros } from './macros.js';

export interface BuildPromptInput {
    character: CharacterDetail;
    /** Full stored chat. `is_system` messages are dropped by the assembler. */
    messages: readonly ChatMessage[];
    persona: PersonaSettings;
    settings: GenerationSettings;
    /** Active preset prompt definitions and order, if one is selected. */
    promptSettings?: Partial<PromptSettings>;
    /** Result of the world info scan for this turn. */
    worldInfo?: WorldInfoPrompt | null;
    generationType?: GenerationType;
    squashSystemMessages?: boolean;
    /** `wi_format`, `personality_format` and `scenario_format` overrides. */
    formats?: { wi?: string; personality?: string; scenario?: string };
    /** Token counter override, used by tests. */
    countTokens?: (text: string) => number;
}

/**
 * Assemble the prompt using SillyTavern's Prompt Manager semantics.
 *
 * The previous M0 builder merged the character sheet into one labelled system
 * message; this one emits each marker as its own message in prompt-order
 * order, which is what makes world info, persona and examples land where a
 * SillyTavern user expects.
 */
export function buildPrompt(input: BuildPromptInput): AssembleResult {
    return assemblePrompt({
        promptSettings: input.promptSettings,
        generationType: input.generationType ?? 'normal',
        character: input.character,
        persona: input.persona,
        messages: input.messages,
        worldInfo: input.worldInfo ?? null,
        contextSize: input.settings.contextSize,
        maxTokens: input.settings.maxTokens,
        squashSystemMessages: input.squashSystemMessages,
        formats: input.formats,
        countTokens: input.countTokens,
    });
}
