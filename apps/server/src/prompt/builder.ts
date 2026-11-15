import type {
    CharacterDetail,
    ChatMessage,
    GenerationSettings,
    GroupDepthPrompt,
    JoinedCardFields,
    PersonaSettings,
    RegexScript,
} from '@catcup/shared';

import type { WorldInfoPrompt } from '../worldinfo/types.js';
import { type AssembleResult, assemblePrompt, type SummaryInjection } from './assemble.js';
import type { GenerationType } from './definitions.js';
import type { PromptSettings } from './manager.js';
import type { GroupMacroMembers } from './worldInfoTurn.js';

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
    newChatPrompt?: string;
    newExampleChatPrompt?: string;
    continueNudgePrompt?: string;
    /** Instruction that makes the model answer as `{{user}}`. */
    impersonationPrompt?: string;
    /** Token counter override, used by tests. */
    countTokens?: (text: string) => number;
    /** Scripts with `promptOnly`, applied to the history. */
    regexScripts?: readonly RegexScript[];
    /** Macro expansion for those scripts. */
    substitute?: (text: string, escapeValues: boolean) => string;
    /** Prefix assistant history messages with the speaker name (group chats). */
    prefixCharacterNames?: boolean;
    /** Instruction appended after the history (group chats). */
    groupNudge?: string;
    /** Member names for `{{group}}` and the other group macros. */
    group?: GroupMacroMembers;
    /** Latest summary, for `{{summary}}` expansion. */
    summaryText?: string;
    /** Formatted summary to inject, following SillyTavern's Memory positions. */
    summaryInjection?: SummaryInjection;
    /** Card fields merged from every group member (append modes only). */
    joinedCard?: JoinedCardFields | null;
    /** In-chat asides from the cards' `extensions.depth_prompt`. */
    cardDepthPrompts?: readonly GroupDepthPrompt[];
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
        newChatPrompt: input.newChatPrompt,
        newExampleChatPrompt: input.newExampleChatPrompt,
        continueNudgePrompt: input.continueNudgePrompt,
        impersonationPrompt: input.impersonationPrompt,
        countTokens: input.countTokens,
        regexScripts: input.regexScripts,
        substitute: input.substitute,
        prefixCharacterNames: input.prefixCharacterNames,
        groupNudge: input.groupNudge,
        group: input.group,
        summaryText: input.summaryText,
        summaryInjection: input.summaryInjection,
        joinedCard: input.joinedCard,
        cardDepthPrompts: input.cardDepthPrompts,
    });
}
