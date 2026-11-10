import { z } from 'zod';

import { type ProviderPublic, providerConfigSchema } from './provider.js';

export const generationSettingsSchema = z.object({
    temperature: z.number().min(0).max(2).default(1),
    topP: z.number().min(0).max(1).default(1),
    maxTokens: z.number().int().min(1).max(200000).default(2048),
    contextSize: z.number().int().min(512).max(2000000).default(32768),
    stream: z.boolean().default(true),
});
export type GenerationSettings = z.infer<typeof generationSettingsSchema>;

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
    temperature: 1,
    topP: 1,
    maxTokens: 2048,
    contextSize: 32768,
    stream: true,
};

export const personaSchema = z.object({
    name: z.string().trim().min(1).max(80).default('You'),
    description: z.string().max(10000).default(''),
});
export type PersonaSettings = z.infer<typeof personaSchema>;

export const DEFAULT_PERSONA: PersonaSettings = {
    name: 'You',
    description: '',
};

export const uiSettingsSchema = z.object({
    /** Reserved for future i18n; the UI is English-only for now. */
    language: z.string().default('en'),
    theme: z.string().default('tavern-dark'),
});
export type UiSettings = z.infer<typeof uiSettingsSchema>;

export const DEFAULT_UI_SETTINGS: UiSettings = {
    language: 'en',
    theme: 'tavern-dark',
};

/**
 * World info configuration. Field names follow SillyTavern's settings so the
 * values stay recognizable; `globalBooks` is ST's `world_info.globalSelect`.
 */
export const worldInfoConfigSchema = z.object({
    /** Book ids (file names without `.json`) applied to every chat. */
    globalBooks: z.array(z.string()).default([]),
    depth: z.number().int().min(0).max(1000).default(2),
    budgetPercent: z.number().min(0).max(100).default(25),
    budgetCap: z.number().int().min(0).default(0),
    caseSensitive: z.boolean().default(false),
    matchWholeWords: z.boolean().default(false),
    useGroupScoring: z.boolean().default(false),
    recursive: z.boolean().default(false),
    minActivations: z.number().int().min(0).max(100).default(0),
    minActivationsDepthMax: z.number().int().min(0).max(100).default(0),
    maxRecursionSteps: z.number().int().min(0).max(10).default(0),
});
export type WorldInfoConfig = z.infer<typeof worldInfoConfigSchema>;

export const DEFAULT_WORLD_INFO_CONFIG: WorldInfoConfig = {
    globalBooks: [],
    depth: 2,
    budgetPercent: 25,
    budgetCap: 0,
    caseSensitive: false,
    matchWholeWords: false,
    useGroupScoring: false,
    recursive: false,
    minActivations: 0,
    minActivationsDepthMax: 0,
    maxRecursionSteps: 0,
};

/** Author's Note settings, mirroring SillyTavern's note extension. */
export const authorNoteSchema = z.object({
    enabled: z.boolean().default(false),
    /** Injected text; empty disables the note even when `enabled` is true. */
    prompt: z.string().default(''),
    /** Insert the note every N user messages. */
    interval: z.number().int().min(1).max(100).default(1),
    /** `0` in prompt, `1` in chat, `2` before prompt. */
    position: z.number().int().min(0).max(2).default(1),
    depth: z.number().int().min(0).max(10000).default(4),
    /** `0` system, `1` user, `2` assistant. */
    role: z.number().int().min(0).max(2).default(0),
    /** Let world info scan the composed note. */
    scan: z.boolean().default(false),
});
export type AuthorNoteSettings = z.infer<typeof authorNoteSchema>;

export const DEFAULT_AUTHOR_NOTE: AuthorNoteSettings = {
    enabled: false,
    prompt: '',
    interval: 1,
    position: 1,
    depth: 4,
    role: 0,
    scan: false,
};

export const appSettingsSchema = z.object({
    version: z.literal(1).default(1),
    activeProviderId: z.string().nullable().default(null),
    providers: z.array(providerConfigSchema).default([]),
    generation: generationSettingsSchema.default(DEFAULT_GENERATION_SETTINGS),
    persona: personaSchema.default(DEFAULT_PERSONA),
    ui: uiSettingsSchema.default(DEFAULT_UI_SETTINGS),
    worldInfo: worldInfoConfigSchema.default(DEFAULT_WORLD_INFO_CONFIG),
    authorNote: authorNoteSchema.default(DEFAULT_AUTHOR_NOTE),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export interface SettingsResponse extends Omit<AppSettings, 'providers'> {
    providers: ProviderPublic[];
}

export const settingsPatchSchema = z.object({
    activeProviderId: z.string().nullable().optional(),
    generation: generationSettingsSchema.partial().optional(),
    persona: personaSchema.partial().optional(),
    ui: uiSettingsSchema.partial().optional(),
    worldInfo: worldInfoConfigSchema.partial().optional(),
    authorNote: authorNoteSchema.partial().optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
