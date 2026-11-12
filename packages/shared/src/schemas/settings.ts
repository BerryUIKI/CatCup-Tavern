import { z } from 'zod';

import { DEFAULT_MEMORY_PROMPT, DEFAULT_MEMORY_TEMPLATE } from '../memory.js';
import { type ProviderPublic, providerConfigSchema } from './provider.js';
import {
    DEFAULT_QUICK_REPLY_SETTINGS,
    quickReplySettingsPatchSchema,
    quickReplySettingsSchema,
} from './quickreplies.js';
import { DEFAULT_TTS_SETTINGS, ttsSettingsPatchSchema, ttsSettingsSchema } from './tts.js';

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

/** One of the personas a user can switch between. */
export const personaEntrySchema = personaSchema.extend({
    id: z.string().min(1),
});
export type Persona = z.infer<typeof personaEntrySchema>;

export const DEFAULT_PERSONA: PersonaSettings = {
    name: 'You',
    description: '',
};

/**
 * Id given to the persona derived from the single-persona field that files
 * written before the persona list existed carry.
 */
export const LEGACY_PERSONA_ID = 'default';

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

/**
 * Summary memory, mirroring SillyTavern's Memory extension.
 *
 * `enabled` is CatCup's opt-in for automatic updates; a summary that already
 * exists is still injected (unless `position` is -1) and can always be created
 * or edited by hand. SillyTavern instead has a `memoryFrozen` pause switch and
 * opt-in by enabling the extension.
 */
export const memorySettingsSchema = z.object({
    /** Update the summary automatically after replies. */
    enabled: z.boolean().default(false),
    /** Prompt sent to the model to request a summary; `{{words}}` is expanded. */
    prompt: z.string().max(10000).default(DEFAULT_MEMORY_PROMPT),
    /** Template wrapped around the summary when it enters the prompt. */
    template: z.string().max(2000).default(DEFAULT_MEMORY_TEMPLATE),
    /** `-1` none, `0` after the main prompt, `1` in chat at `depth`, `2` before it. */
    position: z.number().int().min(-1).max(2).default(0),
    /** `0` system, `1` user, `2` assistant. */
    role: z.number().int().min(0).max(2).default(0),
    depth: z.number().int().min(0).max(10000).default(2),
    /** Let world info scan the summary. */
    scan: z.boolean().default(false),
    /** Target summary length, in words. */
    promptWords: z.number().int().min(25).max(1000).default(200),
    /** Update every N messages since the last summary; `0` disables. */
    promptInterval: z.number().int().min(0).max(250).default(10),
    /** Update every N words since the last summary; `0` disables. */
    promptForceWords: z.number().int().min(0).max(10000).default(0),
    /** Cap on messages sent in one summary request; `0` uses the context budget. */
    maxMessages: z.number().int().min(0).max(250).default(0),
    /** Summary response length; `0` uses the generation setting. */
    responseLength: z.number().int().min(0).max(4096).default(0),
});
export type MemorySettings = z.infer<typeof memorySettingsSchema>;

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
    enabled: false,
    prompt: DEFAULT_MEMORY_PROMPT,
    template: DEFAULT_MEMORY_TEMPLATE,
    position: 0,
    role: 0,
    depth: 2,
    scan: false,
    promptWords: 200,
    promptInterval: 10,
    promptForceWords: 0,
    maxMessages: 0,
    responseLength: 0,
};

/**
 * A partial memory update for `PATCH /api/settings`.
 *
 * `memorySettingsSchema.partial()` still applies each field's default in Zod 4,
 * so a patch carrying only `enabled` would reset every other memory setting.
 * This schema keeps unspecified fields absent.
 */
export const memorySettingsPatchSchema = z.object({
    enabled: z.boolean().optional(),
    prompt: z.string().max(10000).optional(),
    template: z.string().max(2000).optional(),
    position: z.number().int().min(-1).max(2).optional(),
    role: z.number().int().min(0).max(2).optional(),
    depth: z.number().int().min(0).max(10000).optional(),
    scan: z.boolean().optional(),
    promptWords: z.number().int().min(25).max(1000).optional(),
    promptInterval: z.number().int().min(0).max(250).optional(),
    promptForceWords: z.number().int().min(0).max(10000).optional(),
    maxMessages: z.number().int().min(0).max(250).optional(),
    responseLength: z.number().int().min(0).max(4096).optional(),
});
export type MemorySettingsPatch = z.infer<typeof memorySettingsPatchSchema>;

export const appSettingsSchema = z.object({
    version: z.literal(1).default(1),
    activeProviderId: z.string().nullable().default(null),
    providers: z.array(providerConfigSchema).default([]),
    /** Active ST OpenAI preset id under `data/presets`, or `null`. */
    activePresetId: z.string().nullable().default(null),
    generation: generationSettingsSchema.default(DEFAULT_GENERATION_SETTINGS),
    /** The personas a user can switch between. Empty only before migration. */
    personas: z.array(personaEntrySchema).default([]),
    /** Default persona for chats that do not pin one. */
    activePersonaId: z.string().nullable().default(null),
    ui: uiSettingsSchema.default(DEFAULT_UI_SETTINGS),
    worldInfo: worldInfoConfigSchema.default(DEFAULT_WORLD_INFO_CONFIG),
    authorNote: authorNoteSchema.default(DEFAULT_AUTHOR_NOTE),
    memory: memorySettingsSchema.default(DEFAULT_MEMORY_SETTINGS),
    quickReplies: quickReplySettingsSchema.default(DEFAULT_QUICK_REPLY_SETTINGS),
    tts: ttsSettingsSchema.default(DEFAULT_TTS_SETTINGS),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

export interface SettingsResponse extends Omit<AppSettings, 'providers'> {
    providers: ProviderPublic[];
    /** Whether a TTS API key is stored; the key itself never leaves the server. */
    ttsHasKey: boolean;
}

export const settingsPatchSchema = z.object({
    activeProviderId: z.string().nullable().optional(),
    activePresetId: z.string().nullable().optional(),
    generation: generationSettingsSchema.partial().optional(),
    personas: z.array(personaEntrySchema).optional(),
    activePersonaId: z.string().nullable().optional(),
    ui: uiSettingsSchema.partial().optional(),
    worldInfo: worldInfoConfigSchema.partial().optional(),
    authorNote: authorNoteSchema.partial().optional(),
    memory: memorySettingsPatchSchema.optional(),
    quickReplies: quickReplySettingsPatchSchema.optional(),
    tts: ttsSettingsPatchSchema.optional(),
    /** Write-only: stored in data/secrets.json, never returned. Empty clears. */
    ttsApiKey: z.string().max(2000).optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
