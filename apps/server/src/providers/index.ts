import type { ProviderConfig } from '@catcup/shared';

import { anthropicAdapter } from './anthropic.js';
import { geminiAdapter } from './gemini.js';
import { ollamaAdapter } from './ollama.js';
import { openAiAdapter } from './openai.js';
import { openAiResponsesAdapter } from './openaiResponses.js';
import type { ProviderAdapter } from './types.js';

export function getAdapter(config: ProviderConfig): ProviderAdapter {
    switch (config.kind) {
        case 'anthropic':
            return anthropicAdapter;
        case 'ollama':
            return ollamaAdapter;
        case 'openai-responses':
            return openAiResponsesAdapter;
        case 'gemini':
            return geminiAdapter;
        default:
            // `openai`, `openrouter` and `custom` all speak Chat Completions.
            return openAiAdapter;
    }
}

export type { PromptMessage, ProviderAdapter, ProviderRequest, StreamChunk } from './types.js';
