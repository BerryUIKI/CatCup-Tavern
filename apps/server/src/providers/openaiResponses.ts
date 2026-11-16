// The OpenAI Responses API (`POST /v1/responses`).
//
// This is OpenAI's newer interface, not a rename of Chat Completions: the body
// takes `input` rather than `messages`, streaming arrives as typed events
// (`response.output_text.delta`, `response.reasoning_summary_text.delta`, …)
// instead of `choices[].delta`, and the reply is a list of typed output items.
// The shapes are different enough to be their own adapter; see
// https://platform.openai.com/docs/api-reference/responses-streaming
//
// Only the subset CatCup needs is sent. `store: false` keeps the request
// stateless, which matches how every other adapter here behaves: the
// conversation lives in CatCup's chat log, not on the provider's side.

import { isRecord, type ModelInfo, type ProviderConfig, type ProviderTestResult } from '@catcup/shared';

import { ensureOk, joinUrl, numberOrUndefined, parseSse } from './http.js';
import type { PromptMessage, ProviderAdapter, ProviderRequest, StreamChunk } from './types.js';

function headersFor(config: ProviderConfig, apiKey: string | undefined): Record<string, string> {
    const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...config.headers,
    };
    if (apiKey) {
        headers.authorization = `Bearer ${apiKey}`;
    }
    return headers;
}

function requireBaseUrl(config: ProviderConfig): string {
    if (!config.baseUrl.trim()) {
        throw new Error('Provider base URL is not configured');
    }
    return config.baseUrl;
}

/**
 * Convert the shared prompt shape into `input` items.
 *
 * The Responses API keeps the system prompt in a separate top-level field and
 * takes the conversation as `input`, so system turns are pulled out here. An
 * assistant prefill becomes a trailing assistant item, which is how this
 * protocol expresses "continue from here".
 */
export function toInput(messages: PromptMessage[], assistantPrefill: string | undefined) {
    const instructions: string[] = [];
    const input: Array<{ role: string; content: string }> = [];

    for (const message of messages) {
        if (message.role === 'system') {
            instructions.push(message.content);
            continue;
        }
        input.push({ role: message.role, content: message.content });
    }

    if (assistantPrefill) {
        input.push({ role: 'assistant', content: assistantPrefill });
    }

    return { instructions: instructions.join('\n\n'), input };
}

async function* streamChat(
    config: ProviderConfig,
    apiKey: string | undefined,
    request: ProviderRequest,
): AsyncGenerator<StreamChunk> {
    const { instructions, input } = toInput(request.messages, request.assistantPrefill);

    const body: Record<string, unknown> = {
        model: request.model,
        input,
        stream: true,
        // Keeps the call stateless, like every other adapter here.
        store: false,
        temperature: request.temperature,
        top_p: request.topP,
        max_output_tokens: request.maxTokens,
    };
    if (instructions) {
        body.instructions = instructions;
    }

    const response = await fetch(joinUrl(requireBaseUrl(config), 'responses'), {
        method: 'POST',
        headers: headersFor(config, apiKey),
        body: JSON.stringify(body),
        signal: request.signal,
    });
    await ensureOk(response, config.name || 'OpenAI Responses');

    for await (const event of parseSse(response)) {
        if (!event.data || event.data === '[DONE]') {
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

        // Errors arrive as their own event rather than an HTTP status, because
        // the response has already started streaming by then.
        if (isRecord(payload.error)) {
            throw new Error(String(payload.error.message ?? 'Provider returned an error'));
        }

        switch (payload.type) {
            case 'response.output_text.delta':
                if (typeof payload.delta === 'string' && payload.delta) {
                    yield { type: 'text', text: payload.delta };
                }
                break;
            // Reasoning models stream a summary rather than raw reasoning; both
            // event names are handled so either arrives as reasoning text.
            case 'response.reasoning_summary_text.delta':
            case 'response.reasoning_text.delta':
                if (typeof payload.delta === 'string' && payload.delta) {
                    yield { type: 'reasoning', text: payload.delta };
                }
                break;
            case 'response.completed': {
                const usage =
                    isRecord(payload.response) && isRecord(payload.response.usage) ? payload.response.usage : null;
                if (usage) {
                    yield {
                        type: 'usage',
                        promptTokens: numberOrUndefined(usage.input_tokens),
                        completionTokens: numberOrUndefined(usage.output_tokens),
                    };
                }
                break;
            }
            case 'response.failed': {
                const error =
                    isRecord(payload.response) && isRecord(payload.response.error) ? payload.response.error : null;
                throw new Error(String(error?.message ?? 'The provider failed to complete the response'));
            }
            default:
                // `response.created`, `response.in_progress`, content-part
                // events and the like carry nothing the chat needs.
                break;
        }
    }
}

async function listModels(config: ProviderConfig, apiKey: string | undefined): Promise<ModelInfo[]> {
    const response = await fetch(joinUrl(requireBaseUrl(config), 'models'), {
        headers: headersFor(config, apiKey),
        signal: AbortSignal.timeout(15_000),
    });
    await ensureOk(response, config.name || 'OpenAI Responses');

    const payload = (await response.json()) as unknown;
    const rawItems = isRecord(payload) && Array.isArray(payload.data) ? payload.data : [];

    const models: ModelInfo[] = [];
    for (const item of rawItems) {
        if (isRecord(item) && typeof item.id === 'string') {
            models.push({ id: item.id, name: typeof item.name === 'string' ? item.name : item.id });
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

export const openAiResponsesAdapter: ProviderAdapter = {
    streamChat,
    listModels,
    test,
};
