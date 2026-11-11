import type { ModelInfo, ProviderConfig, ProviderTestResult } from '@catcup/shared';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface PromptMessage {
    role: ChatRole;
    content: string;
    /**
     * SillyTavern sets this on example messages (`example_user` /
     * `example_assistant`) and, in one history mode, on history messages.
     * OpenAI-compatible providers accept it; providers without the field
     * ignore it.
     */
    name?: string;
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
