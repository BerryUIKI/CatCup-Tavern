import { z } from 'zod';

/**
 * Text-to-speech configuration.
 *
 * `openai-compatible` calls a server-side `/audio/speech` endpoint, which
 * covers OpenAI and local servers that implement the same API. `system` uses
 * the browser's speech synthesis and needs no key or network.
 */
export const TTS_BACKENDS = ['openai-compatible', 'system'] as const;
export type TtsBackend = (typeof TTS_BACKENDS)[number];

/** Audio formats the OpenAI speech endpoint accepts and a browser can play. */
export const TTS_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav'] as const;
export type TtsFormat = (typeof TTS_FORMATS)[number];

export const ttsSettingsSchema = z.object({
    /** Master switch for playback buttons and autoplay. */
    enabled: z.boolean().default(false),
    backend: z.enum(TTS_BACKENDS).default('system'),

    /** OpenAI-compatible backend. */
    baseUrl: z.string().trim().max(500).default('https://api.openai.com/v1'),
    model: z.string().trim().max(200).default('tts-1'),
    /** Default voice id; empty uses the backend default (alloy for OpenAI). */
    voice: z.string().trim().max(200).default(''),
    format: z.enum(TTS_FORMATS).default('mp3'),
    speed: z.number().min(0.25).max(4).default(1),
    /** Only sent to models that accept it, such as gpt-4o-mini-tts. */
    instructions: z.string().max(2000).default(''),

    /** Browser speech synthesis backend. */
    rate: z.number().min(0.1).max(2).default(1),
    pitch: z.number().min(0).max(2).default(1),

    /** Speak each new character reply after it finishes. */
    autoplay: z.boolean().default(true),
    /** Voice for narrator notes; empty uses the default voice. */
    narratorVoice: z.string().max(200).default(''),
    /** Character id to voice id, overriding the default voice. */
    characterVoices: z.record(z.string(), z.string().max(200)).default({}),

    /** Text preparation before speaking. */
    skipCodeBlocks: z.boolean().default(true),
    stripTags: z.boolean().default(true),
    stripAsterisks: z.boolean().default(true),
});
export type TtsSettings = z.infer<typeof ttsSettingsSchema>;

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
    enabled: false,
    backend: 'system',
    baseUrl: 'https://api.openai.com/v1',
    model: 'tts-1',
    voice: '',
    format: 'mp3',
    speed: 1,
    instructions: '',
    rate: 1,
    pitch: 1,
    autoplay: true,
    narratorVoice: '',
    characterVoices: {},
    skipCodeBlocks: true,
    stripTags: true,
    stripAsterisks: true,
};

/**
 * A partial TTS update for `PATCH /api/settings`.
 *
 * `ttsSettingsSchema.partial()` would apply each field's default in Zod 4, so a
 * patch carrying only `enabled` would reset the voice and backend. This schema
 * keeps unspecified fields absent.
 */
export const ttsSettingsPatchSchema = z.object({
    enabled: z.boolean().optional(),
    backend: z.enum(TTS_BACKENDS).optional(),
    baseUrl: z.string().trim().max(500).optional(),
    model: z.string().trim().max(200).optional(),
    voice: z.string().trim().max(200).optional(),
    format: z.enum(TTS_FORMATS).optional(),
    speed: z.number().min(0.25).max(4).optional(),
    instructions: z.string().max(2000).optional(),
    rate: z.number().min(0.1).max(2).optional(),
    pitch: z.number().min(0).max(2).optional(),
    autoplay: z.boolean().optional(),
    narratorVoice: z.string().max(200).optional(),
    characterVoices: z.record(z.string(), z.string().max(200)).optional(),
    skipCodeBlocks: z.boolean().optional(),
    stripTags: z.boolean().optional(),
    stripAsterisks: z.boolean().optional(),
});
export type TtsSettingsPatch = z.infer<typeof ttsSettingsPatchSchema>;
