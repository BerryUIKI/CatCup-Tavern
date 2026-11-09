import type { CharacterSummary } from './character.js';
import type { ChatMessage } from './chat.js';
import type { ModelInfo } from './provider.js';

export interface AuthStatus {
    needsSetup: boolean;
    authenticated: boolean;
}

export interface AuthSetupRequest {
    password: string;
}

export interface AuthLoginRequest {
    password: string;
}

export interface ApiErrorBody {
    error: string;
    code?: string;
}

export type GenerateAction = 'send' | 'regenerate' | 'continue';

export interface GenerateRequest {
    characterId: string;
    chatId: string;
    action: GenerateAction;
    message?: string;
}

export type GenerationEvent =
    | { type: 'start'; generationId: string }
    | { type: 'token'; text: string }
    | { type: 'reasoning'; text: string }
    | {
          type: 'done';
          message: ChatMessage;
          usage?: { promptTokens?: number; completionTokens?: number };
      }
    | { type: 'error'; message: string };

export interface UsageInfo {
    promptTokens?: number;
    completionTokens?: number;
}

export interface ImportCharactersResponse {
    imported: CharacterSummary[];
    errors: { fileName: string; message: string }[];
}

export interface ModelsResponse {
    models: ModelInfo[];
}

export interface HealthResponse {
    ok: boolean;
    version: string;
    needsSetup: boolean;
}

export interface NewChatRequest {
    name?: string;
    greetingIndex?: number;
}

export interface UpdateMessageRequest {
    message: string;
}

export interface ProviderTestRequest {
    apiKey?: string;
}
