import { isRecord, type ModelInfo, type ProviderConfig, type ProviderTestResult } from '@catcup/shared';

import { ensureOk, joinUrl, numberOrUndefined, parseNdjson } from './http.js';
import type { ProviderAdapter, ProviderRequest, StreamChunk } from './types.js';

function nativeBase(config: ProviderConfig): string {
    // Some users paste the OpenAI-compatible endpoint (…:11434/v1). Strip it so
    // native /api/chat and /api/tags always work.
    return config.baseUrl.trim().replace(/\/v1\/?$/i, '');
}

function requireBaseUrl(config: ProviderConfig): string {
    const base = nativeBase(config);
    if (!base) {
        throw new Error('Ollama base URL is not configured');
    }
    return base;
}

function headersFor(config: ProviderConfig): Record<string, string> {
    return { 'content-type': 'application/json', ...config.headers };
}

async function* streamChat(
    config: ProviderConfig,
    _apiKey: string | undefined,
    request: ProviderRequest,
): AsyncGenerator<StreamChunk> {
    const response = await fetch(joinUrl(requireBaseUrl(config), 'api/chat'), {
        method: 'POST',
        headers: headersFor(config),
        body: JSON.stringify({
            model: request.model,
            messages: request.messages,
            stream: true,
            options: {
                temperature: request.temperature,
                top_p: request.topP,
                num_predict: request.maxTokens,
            },
        }),
        signal: request.signal,
    });
    await ensureOk(response, config.name || 'Ollama');

    for await (const line of parseNdjson(response)) {
        let payload: unknown;
        try {
            payload = JSON.parse(line);
        } catch {
            continue;
        }
        if (!isRecord(payload)) {
            continue;
        }
        if (typeof payload.error === 'string') {
            throw new Error(payload.error);
        }

        const message = isRecord(payload.message) ? payload.message : null;
        if (message) {
            if (typeof message.content === 'string' && message.content) {
                yield { type: 'text', text: message.content };
            }
            if (typeof message.thinking === 'string' && message.thinking) {
                yield { type: 'reasoning', text: message.thinking };
            }
        }

        if (payload.done === true) {
            yield {
                type: 'usage',
                promptTokens: numberOrUndefined(payload.prompt_eval_count),
                completionTokens: numberOrUndefined(payload.eval_count),
            };
            return;
        }
    }
}

async function listModels(config: ProviderConfig, _apiKey: string | undefined): Promise<ModelInfo[]> {
    const response = await fetch(joinUrl(requireBaseUrl(config), 'api/tags'), {
        headers: headersFor(config),
        signal: AbortSignal.timeout(15_000),
    });
    await ensureOk(response, config.name || 'Ollama');

    const payload = (await response.json()) as unknown;
    const items = isRecord(payload) && Array.isArray(payload.models) ? payload.models : [];
    const models: ModelInfo[] = [];
    for (const item of items) {
        if (!isRecord(item)) {
            continue;
        }
        const id = typeof item.name === 'string' ? item.name : typeof item.model === 'string' ? item.model : null;
        if (id) {
            models.push({ id, name: id });
        }
    }
    return models;
}

async function test(config: ProviderConfig, apiKey: string | undefined): Promise<ProviderTestResult> {
    try {
        const models = await listModels(config, apiKey);
        return {
            ok: true,
            message: `Connected. ${models.length} local model(s) available`,
            models,
        };
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : 'Could not reach Ollama',
        };
    }
}

export const ollamaAdapter: ProviderAdapter = {
    streamChat,
    listModels,
    test,
};
