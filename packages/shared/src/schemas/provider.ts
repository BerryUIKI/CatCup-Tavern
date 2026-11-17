import { z } from 'zod';

/**
 * The wire protocol a provider is called with.
 *
 * This is the stored discriminator on a provider and it is what the adapter
 * layer switches on. Three of the five values are the same protocol —
 * `openai`, `openrouter` and `custom` all post to `/chat/completions` in
 * OpenAI's shape — and differ only in their default base URL and the two
 * attribution headers `openrouter` adds. They stay separate values because a
 * `kind` written by 0.3.x must keep loading unchanged; the UI presents them as
 * what they are, one protocol with a service prefill, and calls the field
 * **protocol**.
 */
export const providerKindSchema = z.enum([
    'openai',
    'openrouter',
    'anthropic',
    'ollama',
    'custom',
    'openai-responses',
    'gemini',
]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

/**
 * The protocol each kind speaks, for display and for adapters that want to
 * group kinds together. Every kind resolves to the adapter that serves it.
 */
export const PROVIDER_PROTOCOLS = ['openai', 'openai-responses', 'anthropic', 'gemini', 'ollama'] as const;
export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number];

export function protocolFor(kind: ProviderKind): ProviderProtocol {
    switch (kind) {
        case 'anthropic':
            return 'anthropic';
        case 'ollama':
            return 'ollama';
        case 'openai-responses':
            return 'openai-responses';
        case 'gemini':
            return 'gemini';
        default:
            return 'openai';
    }
}

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

/** What each kind calls by default — a prefill, not a definition. */
export const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
    openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    anthropic: 'https://api.anthropic.com/v1',
    ollama: 'http://127.0.0.1:11434',
    custom: '',
    'openai-responses': 'https://api.openai.com/v1',
    gemini: 'https://generativelanguage.googleapis.com/v1beta',
};

/**
 * The protocol names shown in the UI, one line each.
 *
 * These say what goes on the wire, not who sells it. `openai`, `openrouter` and
 * `custom` share one label because they share one protocol; the service
 * templates below carry the vendor names.
 */
export const PROTOCOL_LABELS: Record<ProviderProtocol, string> = {
    openai: 'OpenAI Chat Completions',
    'openai-responses': 'OpenAI Responses',
    anthropic: 'Anthropic Messages',
    gemini: 'Gemini native',
    ollama: 'Ollama native',
};

export const PROTOCOL_HINTS: Record<ProviderProtocol, string> = {
    openai: 'POST /chat/completions, streamed as SSE. OpenAI, OpenRouter, DeepSeek, LM Studio, vLLM and most gateways speak it.',
    'openai-responses':
        "POST /responses, streamed as SSE. OpenAI's newer API: server-side state, reasoning summaries and hosted tools. Not every OpenAI-compatible gateway implements it.",
    anthropic: "POST /messages with x-api-key and anthropic-version, streamed as SSE. Anthropic's own API.",
    gemini: 'POST /models/{model}:streamGenerateContent, streamed as SSE. Google’s own API, with the key as a query parameter.',
    ollama: 'POST /api/chat, streamed as NDJSON. A local Ollama server; usually no key.',
};

/**
 * A service template: the name, kind and endpoint a person usually wants for a
 * given provider. Choosing one prefills those three fields; it does not define
 * a new kind, and the provider can be edited into anything afterwards.
 */
export interface ProviderTemplate {
    /** A stable key for the card; also the default provider name. */
    id: string;
    kind: ProviderKind;
    /** Shown as the card's title. */
    label: string;
    hint: string;
    /** Two-letter mark on the card and in the provider list. */
    initials: string;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
    {
        id: 'openai',
        kind: 'openai',
        label: 'OpenAI',
        hint: 'OpenAI, Azure OpenAI and compatible gateways.',
        initials: 'OA',
    },
    {
        id: 'anthropic',
        kind: 'anthropic',
        label: 'Anthropic',
        hint: "Anthropic's Messages API.",
        initials: 'AN',
    },
    {
        id: 'openrouter',
        kind: 'openrouter',
        label: 'OpenRouter',
        hint: 'One key for many hosted models.',
        initials: 'OR',
    },
    {
        id: 'ollama',
        kind: 'ollama',
        label: 'Ollama',
        hint: 'A local Ollama server; usually no key.',
        initials: 'OL',
    },
    {
        id: 'gemini',
        kind: 'gemini',
        label: 'Google Gemini',
        hint: "Google's Gemini API, through its own generateContent protocol.",
        initials: 'GE',
    },
];

/**
 * The mark a provider carries in a list row: its service template when it still
 * matches one, otherwise `CP` for a custom configuration.
 */
export function providerInitials(kind: ProviderKind): string {
    return PROVIDER_TEMPLATES.find((template) => template.id === kind)?.initials ?? 'CP';
}

/**
 * The one-line description of a provider in a list row.
 *
 * A custom provider says nothing about a vendor, because its kind does not name
 * one; the protocol it speaks is the only fact the stored value carries.
 */
export function providerSummary(kind: ProviderKind, defaultModel: string): string {
    const template = PROVIDER_TEMPLATES.find((candidate) => candidate.id === kind);
    const label = template?.label ?? PROTOCOL_LABELS[protocolFor(kind)];
    return defaultModel ? `${label} · ${defaultModel}` : label;
}

/**
 * Whether a provider of this kind is expected to need a key.
 *
 * Advisory only: an OpenAI-compatible local server needs none, and an endpoint
 * that does need one says so with a `401`. The UI uses it for the "no API key
 * saved" mark, never to block a request.
 */
export const KEY_REQUIRED_KINDS: ProviderKind[] = ['openai', 'openrouter', 'anthropic', 'openai-responses', 'gemini'];

export function expectsKey(kind: ProviderKind): boolean {
    return KEY_REQUIRED_KINDS.includes(kind);
}
