// Google Gemini's native API (`generateContent`).
//
// Not OpenAI-shaped, so it needs its own adapter. Three things differ from
// every other adapter here:
//
// - The model is in the path (`models/{model}:streamGenerateContent`), not the
//   body, and the key is a query parameter rather than a header.
// - Turns are `contents: [{ role: 'user' | 'model', parts: [{ text }] }]`, so
//   `assistant` becomes `model`, and the system prompt is a separate
//   `systemInstruction`.
// - Streaming is SSE only when `alt=sse` is asked for; otherwise the endpoint
//   returns a JSON array once the generation is finished. `alt=sse` is always
//   sent here, because the chat is rendered as it arrives.
//
// See https://ai.google.dev/api/generate-content

import { isRecord, type ModelInfo, type ProviderConfig, type ProviderTestResult } from '@catcup/shared';

import { ensureOk, joinUrl, numberOrUndefined, parseSse } from './http.js';
import type { ProviderAdapter, PromptMessage, ProviderRequest, StreamChunk } from './types.js';

/**
 * The key travels in the `x-goog-api-key` header rather than the `?key=`
 * query parameter: a URL ends up in proxy logs and error messages, and a key
 * should not.
 */
function authHeaders(apiKey: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (apiKey) {
        headers['x-goog-api-key'] = apiKey;
    }
    return headers;
}

function requireBaseUrl(config: ProviderConfig): string {
    if (!config.baseUrl.trim()) {
        throw new Error('Provider base URL is not configured');
    }
    return config.baseUrl;
}

interface GeminiTurn {
    role: 'user' | 'model';
    parts: Array<{ text: string }>;
}

/**
 * Convert the shared prompt shape into Gemini's.
 *
 * `assistant` becomes `model`, and system turns are collected into
 * `systemInstruction` because the API has no system role.
 */
export function toContents(messages: PromptMessage[], assistantPrefill: string | undefined) {
    const systemParts: string[] = [];
    const contents: GeminiTurn[] = [];

    for (const message of messages) {
        if (message.role === 'system') {
            systemParts.push(message.content);
            continue;
        }
        contents.push({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
        });
    }

    if (assistantPrefill) {
        contents.push({ role: 'model', parts: [{ text: assistantPrefill }] });
    }

    // Gemini rejects a conversation that does not start with a user turn, which
    // a prefilled or oddly branched chat can produce.
    while (contents.length > 0 && contents[0]?.role === 'model') {
        contents.shift();
    }

    return { systemInstruction: systemParts.join('\n\n'), contents };
}

/** The generation config, omitting values the API would reject at zero. */
function generationConfig(request: ProviderRequest): Record<string, unknown> {
    const config: Record<string, unknown> = {
        maxOutputTokens: request.maxTokens,
        temperature: request.temperature,
        topP: request.topP,
    };
    return config;
}

async function* streamChat(
    config: ProviderConfig,
    apiKey: string | undefined,
    request: ProviderRequest,
): AsyncGenerator<StreamChunk> {
    const { systemInstruction, contents } = toContents(request.messages, request.assistantPrefill);

    const body: Record<string, unknown> = {
        contents,
        generationConfig: generationConfig(request),
    };
    if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const headers = authHeaders(apiKey);
    const base = joinUrl(requireBaseUrl(config), '');
    const url = `${base}/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;

    const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, ...config.headers },
        body: JSON.stringify(body),
        signal: request.signal,
    });
    await ensureOk(response, config.name || 'Gemini');

    for await (const event of parseSse(response)) {
        if (!event.data) {
            continue;
        }

        let payload: unknown;
        try {
            payload = JSON.parse(event.data);
        } catch {
            continue;
        }
        if (!isRecord(payload)) {
            continue;
        }

        // A blocked or failed candidate reports why in `promptFeedback`, which
        // otherwise looks like an empty answer.
        if (isRecord(payload.promptFeedback) && typeof payload.promptFeedback.blockReason === 'string') {
            throw new Error(`Gemini blocked the prompt (${payload.promptFeedback.blockReason})`);
        }

        const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
        const candidate = isRecord(candidates[0]) ? candidates[0] : null;
        const content = candidate && isRecord(candidate.content) ? candidate.content : null;
        const parts = content && Array.isArray(content.parts) ? content.parts : [];

        for (const part of parts) {
            if (!isRecord(part)) {
                continue;
            }
            // A thinking model marks reasoning parts; `thought` is how the API
            // distinguishes them from the answer.
            if (typeof part.text !== 'string' || !part.text) {
                continue;
            }
            yield part.thought === true ? { type: 'reasoning', text: part.text } : { type: 'text', text: part.text };
        }

        if (isRecord(payload.usageMetadata)) {
            yield {
                type: 'usage',
                promptTokens: numberOrUndefined(payload.usageMetadata.promptTokenCount),
                completionTokens: numberOrUndefined(payload.usageMetadata.candidatesTokenCount),
            };
        }
    }
}

async function listModels(config: ProviderConfig, apiKey: string | undefined): Promise<ModelInfo[]> {
    const headers = authHeaders(apiKey);
    const response = await fetch(joinUrl(requireBaseUrl(config), 'models'), {
        headers: { ...headers, ...config.headers },
        signal: AbortSignal.timeout(15_000),
    });
    await ensureOk(response, config.name || 'Gemini');

    const payload = (await response.json()) as unknown;
    const rawItems = isRecord(payload) && Array.isArray(payload.models) ? payload.models : [];

    const models: ModelInfo[] = [];
    for (const item of rawItems) {
        if (!isRecord(item) || typeof item.name !== 'string') {
            continue;
        }
        // Names arrive as `models/gemini-2.5-pro`; the request path adds the
        // `models/` prefix itself, so it is stripped here.
        const id = item.name.replace(/^models\//, '');
        models.push({ id, name: typeof item.displayName === 'string' ? item.displayName : id });
    }
    return models;
}

async function test(config: ProviderConfig, apiKey: string | undefined): Promise<ProviderTestResult> {
    try {
        const models = await listModels(config, apiKey);
        return { ok: true, message: `Connected. ${models.length} model(s) available`, models };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : 'Connection failed' };
    }
}

export const geminiAdapter: ProviderAdapter = {
    streamChat,
    listModels,
    test,
};
