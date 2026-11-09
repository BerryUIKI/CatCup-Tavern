import { isRecord, type ModelInfo, type ProviderConfig, type ProviderTestResult } from '@catcup/shared';

import { ensureOk, joinUrl, numberOrUndefined, parseSse } from './http.js';
import type { PromptMessage, ProviderAdapter, ProviderRequest, StreamChunk } from './types.js';

interface AnthropicMessage {
    role: 'user' | 'assistant';
    content: string;
}

/**
 * Convert our flat prompt into Anthropic's system + alternating messages.
 * Consecutive same-role messages are merged because the Messages API rejects
 * them. The first message must be a user message; an assistant greeting is
 * therefore preceded by a small start marker.
 */
function convertMessages(messages: PromptMessage[]): { system: string; messages: AnthropicMessage[] } {
    const systemParts: string[] = [];
    const converted: AnthropicMessage[] = [];

    for (const message of messages) {
        if (message.role === 'system') {
            if (message.content.trim()) {
                systemParts.push(message.content);
            }
            continue;
        }

        const role: AnthropicMessage['role'] = message.role === 'assistant' ? 'assistant' : 'user';
        if (!message.content.trim()) {
            continue;
        }

        const last = converted[converted.length - 1];
        if (last && last.role === role) {
            last.content += `\n\n${message.content}`;
        } else {
            converted.push({ role, content: message.content });
        }
    }

    if (converted.length === 0) {
        converted.push({ role: 'user', content: '[Start of chat]' });
    } else if (converted[0]?.role === 'assistant') {
        converted.unshift({ role: 'user', content: '[Start of chat]' });
    }

    return { system: systemParts.join('\n\n'), messages: converted };
}

function headersFor(config: ProviderConfig, apiKey: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...config.headers,
    };
    if (apiKey) {
        headers['x-api-key'] = apiKey;
    }
    return headers;
}

function requireBaseUrl(config: ProviderConfig): string {
    if (!config.baseUrl.trim()) {
        throw new Error('Anthropic base URL is not configured');
    }
    return config.baseUrl;
}

async function* streamChat(
    config: ProviderConfig,
    apiKey: string | undefined,
    request: ProviderRequest,
): AsyncGenerator<StreamChunk> {
    const converted = convertMessages(request.messages);
    const body: Record<string, unknown> = {
        model: request.model,
        max_tokens: request.maxTokens,
        messages: converted.messages,
        stream: true,
        temperature: request.temperature,
        top_p: request.topP,
    };
    if (converted.system) {
        body.system = converted.system;
    }

    const response = await fetch(joinUrl(requireBaseUrl(config), 'messages'), {
        method: 'POST',
        headers: headersFor(config, apiKey),
        body: JSON.stringify(body),
        signal: request.signal,
    });
    await ensureOk(response, config.name || 'Anthropic');

    let promptTokens: number | undefined;

    for await (const event of parseSse(response)) {
        if (event.event === 'ping') {
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

        if (event.event === 'error') {
            const error = isRecord(payload.error) ? payload.error : null;
            throw new Error(String(error?.message ?? 'Anthropic returned an error'));
        }

        if (event.event === 'message_start') {
            const message = isRecord(payload.message) ? payload.message : null;
            const usage = message && isRecord(message.usage) ? message.usage : null;
            if (usage) {
                promptTokens = numberOrUndefined(usage.input_tokens);
            }
            continue;
        }

        if (event.event === 'content_block_delta') {
            const delta = isRecord(payload.delta) ? payload.delta : null;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
                yield { type: 'text', text: delta.text };
            } else if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
                yield { type: 'reasoning', text: delta.thinking };
            }
            continue;
        }

        if (event.event === 'message_delta') {
            const usage = isRecord(payload.usage) ? payload.usage : null;
            if (usage) {
                yield {
                    type: 'usage',
                    promptTokens: promptTokens ?? numberOrUndefined(usage.input_tokens),
                    completionTokens: numberOrUndefined(usage.output_tokens),
                };
            }
            continue;
        }

        if (event.event === 'message_stop') {
            return;
        }
    }
}

async function listModels(config: ProviderConfig, apiKey: string | undefined): Promise<ModelInfo[]> {
    const response = await fetch(joinUrl(requireBaseUrl(config), 'models?limit=1000'), {
        headers: headersFor(config, apiKey),
    });
    await ensureOk(response, config.name || 'Anthropic');

    const payload = (await response.json()) as unknown;
    const items = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];
    const models: ModelInfo[] = [];
    for (const item of items) {
        if (isRecord(item) && typeof item.id === 'string') {
            models.push({
                id: item.id,
                name: typeof item.display_name === 'string' ? item.display_name : item.id,
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

export const anthropicAdapter: ProviderAdapter = {
    streamChat,
    listModels,
    test,
};
