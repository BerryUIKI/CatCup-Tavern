import { type GenerationSettings, isRecord, stOpenAiPresetSchema } from '@catcup/shared';

import { DEFAULT_FORMATS, DEFAULT_MESSAGES } from './definitions.js';
import type { PromptSettings } from './manager.js';

export interface ResolvedPreset {
    promptSettings: Partial<PromptSettings>;
    formats: { wi: string; personality: string; scenario: string };
    newChatPrompt: string;
    newExampleChatPrompt: string;
    continueNudgePrompt: string;
    impersonationPrompt: string;
    squashSystemMessages: boolean;
    /** Generation settings after the preset's sampling fields are applied. */
    generation: GenerationSettings;
}

/**
 * Turn a stored ST OpenAI preset into the values the assembler needs.
 *
 * SillyTavern presets own the prompt list, the assembly formats and the
 * sampling parameters; anything the preset omits falls back to the app's
 * generation settings or ST's own defaults.
 */
export function resolvePreset(raw: unknown, base: GenerationSettings): ResolvedPreset {
    const parsed = stOpenAiPresetSchema.safeParse(isRecord(raw) ? raw : {});
    const preset = parsed.success ? parsed.data : {};

    return {
        promptSettings: {
            prompts: preset.prompts ?? [],
            promptOrder: preset.prompt_order ?? [],
        },
        formats: {
            wi: preset.wi_format ?? DEFAULT_FORMATS.wi,
            personality: preset.personality_format ?? DEFAULT_FORMATS.personality,
            scenario: preset.scenario_format ?? DEFAULT_FORMATS.scenario,
        },
        newChatPrompt: preset.new_chat_prompt ?? DEFAULT_MESSAGES.newChat,
        newExampleChatPrompt: preset.new_example_chat_prompt ?? DEFAULT_MESSAGES.newExampleChat,
        continueNudgePrompt: preset.continue_nudge_prompt ?? DEFAULT_MESSAGES.continueNudge,
        impersonationPrompt: preset.impersonation_prompt ?? DEFAULT_MESSAGES.impersonation,
        squashSystemMessages: preset.squash_system_messages ?? false,
        generation: {
            ...base,
            temperature: preset.temperature ?? base.temperature,
            topP: preset.top_p ?? base.topP,
            maxTokens: preset.openai_max_tokens ?? base.maxTokens,
            contextSize: preset.openai_max_context ?? base.contextSize,
        },
    };
}

/** The resolved preset used when no preset is active. */
export function defaultPreset(base: GenerationSettings): ResolvedPreset {
    return resolvePreset({}, base);
}
