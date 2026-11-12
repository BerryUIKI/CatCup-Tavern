import { isRecord, type ModelInfo, type ProviderConfig, type ProviderTestResult } from '@catcup/shared';

import { ensureOk, joinUrl, numberOrUndefined, parseSse } from './http.js';
import type { ProviderAdapter, ProviderRequest, StreamChunk } from './types.js';

function headersFor(config: ProviderConfig, apiKey: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...config.headers,
    };
    if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
    }
    if (config.kind === 'openrouter') {
        headers['HTTP-Referer'] = headers['HTTP-Referer'] ?? 'http://localhost:8000';
        headers['X-Title'] = headers['X-Title'] ?? 'CatCup Tavern';
    }
    return headers;
}

function requireBaseUrl(config: ProviderConfig): string {
    if (!config.baseUrl.trim()) {
        throw new Error('Provider base URL is not configured');
    }
    return config.baseUrl;
}

function textFromContent(content: unknown): string {
    if (typeof content === 'string') {
        return content;
    }
    if (Array.isArray(content)) {
        return content.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('');
    }
    return '';
}

async function* streamChat(
    config: ProviderConfig,
    apiKey: string | undefined,
    request: ProviderRequest,
): AsyncGenerator<StreamChunk> {
    const body = {
        model: request.model,
        messages: request.messages,
        stream: true,
        temperature: request.temperature,
        top_p: request.topP,
        max_tokens: request.maxTokens,
    };

    const response = await fetch(joinUrl(requireBaseUrl(config), 'chat/completions'), {
        method: 'POST',
        headers: headersFor(config, apiKey),
        body: JSON.stringify(body),
        signal: request.signal,
    });
    await ensureOk(response, config.name || 'OpenAI');

    for await (const event of parseSse(response)) {
        if (event.data === '[DONE]') {
            return;
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
        if (isRecord(payload.error)) {
            throw new Error(String(payload.error.message ?? 'Provider returned an error'));
        }

        const choices = Array.isArray(payload.choices) ? payload.choices : [];
        const choice = isRecord(choices[0]) ? choices[0] : null;
        const delta = choice && isRecord(choice.delta) ? choice.delta : null;

        if (delta) {
            const text = textFromContent(delta.content);
            if (text) {
                yield { type: 'text', text };
            }
            const reasoning = delta.reasoning_content ?? delta.reasoning;
            if (typeof reasoning === 'string' && reasoning) {
                yield { type: 'reasoning', text: reasoning };
            }
        }

        if (isRecord(payload.usage)) {
            yield {
                type: 'usage',
                promptTokens: numberOrUndefined(payload.usage.prompt_tokens),
                completionTokens: numberOrUndefined(payload.usage.completion_tokens),
            };
        }
    }
}

async function listModels(config: ProviderConfig, apiKey: string | undefined): Promise<ModelInfo[]> {
    const response = await fetch(joinUrl(requireBaseUrl(config), 'models'), {
        headers: headersFor(config, apiKey),
        signal: AbortSignal.timeout(15_000),
    });
    await ensureOk(response, config.name || 'OpenAI');

    const payload = (await response.json()) as unknown;
    const rawItems = isRecord(payload)
        ? Array.isArray(payload.data)
            ? payload.data
            : Array.isArray(payload.models)
              ? payload.models
              : []
        : [];

    const models: ModelInfo[] = [];
    for (const item of rawItems) {
        if (typeof item === 'string') {
            models.push({ id: item });
        } else if (isRecord(item) && typeof item.id === 'string') {
            models.push({
                id: item.id,
                name: typeof item.name === 'string' ? item.name : item.id,
            });
        }
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

export const openAiAdapter: ProviderAdapter = {
    streamChat,
    listModels,
    test,
};
