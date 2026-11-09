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

export const appSettingsSchema = z.object({
    version: z.literal(1).default(1),
    activeProviderId: z.string().nullable().default(null),
    providers: z.array(providerConfigSchema).default([]),
    generation: generationSettingsSchema.default(DEFAULT_GENERATION_SETTINGS),
    persona: personaSchema.default(DEFAULT_PERSONA),
    ui: uiSettingsSchema.default(DEFAULT_UI_SETTINGS),
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
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
