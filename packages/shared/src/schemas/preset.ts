import { z } from 'zod';

/**
 * SillyTavern OpenAI preset format (data/default-user/openai-presets/*.json).
 * Only the fields we actively use are typed; everything else is preserved.
 */

export const promptEntrySchema = z
    .object({
        identifier: z.string(),
        name: z.string().default(''),
        system_prompt: z.boolean().default(false),
        role: z.enum(['system', 'user', 'assistant']).default('system'),
        content: z.string().default(''),
        injection_position: z.number().default(0),
        injection_depth: z.number().default(4),
        injection_order: z.number().default(100),
        forbid_overrides: z.boolean().default(false),
        marker: z.boolean().default(false),
        enabled: z.boolean().optional(),
    })
    .passthrough();

export const promptOrderEntrySchema = z
    .object({
        identifier: z.string(),
        enabled: z.boolean().default(true),
    })
    .passthrough();

export const promptOrderSchema = z
    .object({
        character_id: z.number().optional(),
        order: z.array(promptOrderEntrySchema).default([]),
    })
    .passthrough();

export const stOpenAiPresetSchema = z
    .object({
        temperature: z.number().optional(),
        frequency_penalty: z.number().optional(),
        presence_penalty: z.number().optional(),
        top_p: z.number().optional(),
        top_k: z.number().optional(),
        max_context_unlocked: z.boolean().optional(),
        openai_max_context: z.number().optional(),
        openai_max_tokens: z.number().optional(),
        openai_model: z.string().optional(),
        stream_openai: z.boolean().optional(),
        wi_format: z.string().optional(),
        scenario_format: z.string().optional(),
        personality_format: z.string().optional(),
        prompts: z.array(promptEntrySchema).optional(),
        prompt_order: z.array(promptOrderSchema).optional(),
    })
    .passthrough();

export type PromptEntry = z.infer<typeof promptEntrySchema>;
export type PromptOrderEntry = z.infer<typeof promptOrderEntrySchema>;
export type PromptOrder = z.infer<typeof promptOrderSchema>;
export type StOpenAiPreset = z.infer<typeof stOpenAiPresetSchema>;

/** SillyTavern's default prompt identifiers, useful for prompt-order fallback. */
export const DEFAULT_PROMPT_ORDER = [
    'main',
    'worldInfoBefore',
    'charDescription',
    'charPersonality',
    'scenario',
    'enhanceDefinitions',
    'nsfw',
    'worldInfoAfter',
    'dialogueExamples',
    'chatHistory',
    'jailbreak',
] as const;
