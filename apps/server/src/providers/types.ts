import type { ModelInfo, ProviderConfig, ProviderTestResult } from '@catcup/shared';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface PromptMessage {
    role: ChatRole;
    content: string;
}

export interface ProviderRequest {
    model: string;
    messages: PromptMessage[];
    temperature: number;
    topP: number;
    maxTokens: number;
    signal: AbortSignal;
}

export type StreamChunk =
    | { type: 'text'; text: string }
    | { type: 'reasoning'; text: string }
    | { type: 'usage'; promptTokens?: number; completionTokens?: number };

export interface ProviderAdapter {
    streamChat(
        config: ProviderConfig,
        apiKey: string | undefined,
        request: ProviderRequest,
    ): AsyncIterable<StreamChunk>;
    listModels(config: ProviderConfig, apiKey: string | undefined): Promise<ModelInfo[]>;
    test(config: ProviderConfig, apiKey: string | undefined): Promise<ProviderTestResult>;
}
