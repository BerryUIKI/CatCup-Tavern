import { z } from 'zod';

/**
 * SillyTavern OpenAI preset format (data/default-user/openai-presets/*.json).
 * Only the fields we actively use are typed; everything else is preserved.
 */

export const promptEntrySchema = z
    .object({
        identifier: z.string(),
        name: z.string().optional(),
        /**
         * `true` on SillyTavern's built-ins and markers, `false` on user
         * prompts, absent on merged literals. The distinction is load-bearing,
         * so it has no default.
         */
        system_prompt: z.boolean().optional(),
        role: z.enum(['system', 'user', 'assistant']).optional(),
        content: z.string().optional(),
        marker: z.boolean().optional(),
        injection_position: z.number().default(0),
        injection_depth: z.number().default(4),
        injection_order: z.number().default(100),
        injection_trigger: z.array(z.string()).default([]),
        forbid_overrides: z.boolean().optional(),
        extension: z.boolean().default(false),
        position: z.union([z.literal('start'), z.literal('end'), z.literal(false)]).optional(),
    })
    .passthrough();

export const promptOrderEntrySchema = z
    .object({
        identifier: z.string(),
        /** Absent means disabled: SillyTavern tests the value for truthiness. */
        enabled: z.boolean().optional(),
    })
    .passthrough();

export const promptOrderSchema = z
    .object({
        character_id: z.union([z.number(), z.string()]).optional(),
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
        new_chat_prompt: z.string().optional(),
        new_example_chat_prompt: z.string().optional(),
        continue_nudge_prompt: z.string().optional(),
        impersonation_prompt: z.string().optional(),
        send_if_empty: z.string().optional(),
        squash_system_messages: z.boolean().optional(),
        names_behavior: z.number().optional(),
        continue_prefill: z.boolean().optional(),
        pin_examples: z.boolean().optional(),
        prompts: z.array(promptEntrySchema).optional(),
        prompt_order: z.array(promptOrderSchema).optional(),
    })
    .passthrough();

export type PromptEntry = z.infer<typeof promptEntrySchema>;
export type PromptOrderEntry = z.infer<typeof promptOrderEntrySchema>;
export type PromptOrder = z.infer<typeof promptOrderSchema>;
export type StOpenAiPreset = z.infer<typeof stOpenAiPresetSchema>;

/**
 * SillyTavern's global Chat Completion order id. Character-specific order
 * lists are keyed by this dummy id for the "global" strategy.
 */
export const GLOBAL_PROMPT_ORDER_ID = 100001;

/** Legacy id used by the shipped SillyTavern settings file. Not read at runtime. */
export const LEGACY_PROMPT_ORDER_ID = 100000;

/** SillyTavern's default prompt order, in assembly order. */
export const DEFAULT_PROMPT_ORDER: PromptOrderEntry[] = [
    { identifier: 'main', enabled: true },
    { identifier: 'worldInfoBefore', enabled: true },
    { identifier: 'personaDescription', enabled: true },
    { identifier: 'charDescription', enabled: true },
    { identifier: 'charPersonality', enabled: true },
    { identifier: 'scenario', enabled: true },
    { identifier: 'enhanceDefinitions', enabled: false },
    { identifier: 'nsfw', enabled: true },
    { identifier: 'worldInfoAfter', enabled: true },
    { identifier: 'dialogueExamples', enabled: true },
    { identifier: 'chatHistory', enabled: true },
    { identifier: 'jailbreak', enabled: true },
];
