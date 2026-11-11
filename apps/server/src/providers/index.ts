import type { ProviderConfig } from '@catcup/shared';

import { anthropicAdapter } from './anthropic.js';
import { ollamaAdapter } from './ollama.js';
import { openAiAdapter } from './openai.js';
import type { ProviderAdapter } from './types.js';

export function getAdapter(config: ProviderConfig): ProviderAdapter {
    if (config.kind === 'anthropic') {
        return anthropicAdapter;
    }
    if (config.kind === 'ollama') {
        return ollamaAdapter;
    }
    return openAiAdapter;
}

export type { PromptMessage, ProviderAdapter, ProviderRequest, StreamChunk } from './types.js';
