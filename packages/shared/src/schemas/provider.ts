import { z } from 'zod';

export const providerKindSchema = z.enum(['openai', 'openrouter', 'anthropic', 'ollama', 'custom']);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const providerConfigSchema = z.object({
    id: z.string().min(1),
    kind: providerKindSchema,
    name: z.string().min(1),
    baseUrl: z.string().default(''),
    model: z.string().default(''),
    enabled: z.boolean().default(true),
    headers: z.record(z.string(), z.string()).default({}),
});
export type ProviderConfig = z.infer<typeof providerConfigSchema>;

export const providerInputSchema = z.object({
    kind: providerKindSchema,
    name: z.string().trim().min(1).max(80),
    baseUrl: z.string().trim().max(500).default(''),
    model: z.string().trim().max(200).default(''),
    enabled: z.boolean().default(true),
    headers: z.record(z.string(), z.string()).default({}),
    /** Omit to keep the existing key; empty string clears it. */
    apiKey: z.string().max(2000).optional(),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

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
