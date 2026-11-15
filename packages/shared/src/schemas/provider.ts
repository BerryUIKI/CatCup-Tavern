import { z } from 'zod';

export const providerKindSchema = z.enum(['openai', 'openrouter', 'anthropic', 'ollama', 'custom']);
export type ProviderKind = z.infer<typeof providerKindSchema>;

/** One model a provider serves; the id is what a request sends. */
export const providerModelSchema = z.string().trim().min(1).max(200);

const modelListSchema = z.array(providerModelSchema).max(500);

/**
 * A provider serves a list of models and marks one as its default. A file
 * written before the list existed carries a single `model` string; the storage
 * layer migrates it into this shape.
 */
export const providerConfigSchema = z
    .object({
        id: z.string().min(1),
        kind: providerKindSchema,
        name: z.string().min(1),
        baseUrl: z.string().default(''),
        /** Every model this provider can serve, in the order the user keeps. */
        models: modelListSchema.default([]),
        /** The model a chat uses when the character names none. */
        defaultModel: z.string().default(''),
        enabled: z.boolean().default(true),
        headers: z.record(z.string(), z.string()).default({}),
    })
    .transform((value) => ({
        ...value,
        // An empty or unknown default resolves to the first listed model, so a
        // provider with any model at all always has one to use.
        defaultModel: value.models.includes(value.defaultModel) ? value.defaultModel : (value.models[0] ?? ''),
    }));
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

/** The input shape without its normalizing transform, so a draft can omit the key. */
const providerInputBase = z.object({
    kind: providerKindSchema,
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().trim().max(500).default(''),
    models: modelListSchema.default([]),
    defaultModel: z.string().trim().max(200).default(''),
    enabled: z.boolean().default(true),
    headers: z.record(z.string(), z.string()).default({}),
    /** Omit to keep the existing key; empty string clears it. */
    apiKey: z.string().max(2000).optional(),
});

function normalizeProviderInput<T extends { models: string[]; defaultModel: string }>(value: T): T {
    const models = [...new Set(value.models)];
    return {
        ...value,
        models,
        defaultModel: models.includes(value.defaultModel) ? value.defaultModel : (models[0] ?? ''),
    };
}

/** Resolve the duplicate and unknown-default cases a hand-edited form can send. */
export const providerInputSchema = providerInputBase.transform(normalizeProviderInput);
export type ProviderInput = z.infer<typeof providerInputBase>;

/**
 * Test an unsaved form. `savedProviderId` lets the server reuse a stored key
 * that the browser never sees; a supplied `apiKey` always wins, and an empty
 * string tests without a key.
 *
 * The nested provider drops any `apiKey` it is given: the top-level field is
 * the only one the handler reads, so a key cannot ride along in the wrong
 * place and reach the storage layer.
 */
export const providerDraftTestSchema = z
    .object({
        provider: providerInputSchema,
        savedProviderId: z.string().min(1).max(200).optional(),
        apiKey: z.string().max(2000).optional(),
    })
    .transform((value) => {
        const { apiKey: _dropped, ...provider } = value.provider;
        return { ...value, provider };
    });
export type ProviderDraftTestInput = z.infer<typeof providerDraftTestSchema>;

export interface ProviderPublic extends ProviderConfig {
    hasKey: boolean;
}

export interface ModelInfo {
    id: string;
    name?: string;
}

export interface ProviderTestResult {
    ok: boolean;
    message: string;
    models?: ModelInfo[];
}

export const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
    openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    anthropic: 'https://api.anthropic.com/v1',
    ollama: 'http://127.0.0.1:11434',
    custom: '',
};

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    anthropic: 'Anthropic',
    ollama: 'Ollama',
    custom: 'OpenAI-compatible',
};
