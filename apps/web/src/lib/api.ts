import type {
    AuthStatus,
    CharacterDetail,
    CharacterSummary,
    ChatDetail,
    ChatMessage,
    ChatSummary,
    ImportCharactersResponse,
    ModelInfo,
    ProviderInput,
    ProviderPublic,
    ProviderTestResult,
    SettingsPatch,
    SettingsResponse,
} from '@catcup/shared';

export class ApiError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code?: string,
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    const isFormData = init.body instanceof FormData;
    if (init.body && !isFormData && !headers.has('content-type')) {
        headers.set('content-type', 'application/json');
    }

    const response = await fetch(`/api${path}`, {
        credentials: 'same-origin',
        ...init,
        headers,
    });

    if (response.status === 401 && !path.startsWith('/auth/')) {
        window.dispatchEvent(new Event('catcup:unauthorized'));
    }

    if (!response.ok) {
        let body: unknown = null;
        try {
            body = await response.json();
        } catch {
            // Some errors have no JSON body.
        }
        const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
        throw new ApiError(
            typeof record.error === 'string' ? record.error : response.statusText || 'Request failed',
            response.status,
            typeof record.code === 'string' ? record.code : undefined,
        );
    }

    if (response.status === 204) {
        return undefined as T;
    }
    return (await response.json()) as T;
}

export const api = {
    auth: {
        status: () => request<AuthStatus>('/auth/status'),
        setup: (password: string) =>
            request<{ ok: true }>('/auth/setup', {
                method: 'POST',
                body: JSON.stringify({ password }),
            }),
        login: (password: string) =>
            request<{ ok: true }>('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ password }),
            }),
        logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
    },

    characters: {
        list: async () => {
            const data = await request<{ characters: CharacterSummary[] }>('/characters');
            return data.characters;
        },
        get: async (id: string) => {
            const data = await request<{ character: CharacterDetail }>(`/characters/${encodeURIComponent(id)}`);
            return data.character;
        },
        import: (files: File[]) => {
            const form = new FormData();
            for (const file of files) {
                form.append('files', file, file.name);
            }
            return request<ImportCharactersResponse>('/characters/import', {
                method: 'POST',
                body: form,
            });
        },
        remove: (id: string) =>
            request<{ ok: true }>(`/characters/${encodeURIComponent(id)}`, {
                method: 'DELETE',
            }),
    },

    chats: {
        list: async (characterId: string) => {
            const data = await request<{ chats: ChatSummary[] }>(
                `/characters/${encodeURIComponent(characterId)}/chats`,
            );
            return data.chats;
        },
        create: async (characterId: string, body: { name?: string; greetingIndex?: number } = {}) => {
            const data = await request<{ chat: ChatDetail }>(`/characters/${encodeURIComponent(characterId)}/chats`, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            return data.chat;
        },
        get: async (characterId: string, chatId: string) => {
            const data = await request<{ chat: ChatDetail }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}`,
            );
            return data.chat;
        },
        updateMessage: async (
            characterId: string,
            chatId: string,
            index: number,
            body: { message?: string; swipeId?: number },
        ) => {
            const data = await request<{ message: ChatMessage }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}/messages/${index}`,
                {
                    method: 'PATCH',
                    body: JSON.stringify(body),
                },
            );
            return data.message;
        },
        deleteMessage: async (characterId: string, chatId: string, index: number) => {
            const data = await request<{ chat: ChatDetail }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}/messages/${index}`,
                { method: 'DELETE' },
            );
            return data.chat;
        },
        remove: (characterId: string, chatId: string) =>
            request<{ ok: true }>(`/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}`, {
                method: 'DELETE',
            }),
    },

    settings: {
        get: async () => {
            const data = await request<{ settings: SettingsResponse }>('/settings');
            return data.settings;
        },
        patch: async (patch: SettingsPatch) => {
            const data = await request<{ settings: SettingsResponse }>('/settings', {
                method: 'PATCH',
                body: JSON.stringify(patch),
            });
            return data.settings;
        },
    },

    providers: {
        list: async () => {
            const data = await request<{ providers: ProviderPublic[] }>('/providers');
            return data.providers;
        },
        create: async (input: ProviderInput) => {
            const data = await request<{ provider: ProviderPublic }>('/providers', {
                method: 'POST',
                body: JSON.stringify(input),
            });
            return data.provider;
        },
        update: async (id: string, input: ProviderInput) => {
            const data = await request<{ provider: ProviderPublic }>(`/providers/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify(input),
            });
            return data.provider;
        },
        remove: (id: string) => request<{ ok: true }>(`/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        test: async (id: string, apiKey?: string) => {
            const data = await request<{ result: ProviderTestResult }>(`/providers/${encodeURIComponent(id)}/test`, {
                method: 'POST',
                body: JSON.stringify(apiKey === undefined ? {} : { apiKey }),
            });
            return data.result;
        },
        models: async (id: string) => {
            const data = await request<{ models: ModelInfo[] }>(`/providers/${encodeURIComponent(id)}/models`);
            return data.models;
        },
    },

    generate: {
        stop: (generationId: string) =>
            request<{ ok: boolean }>(`/generate/${encodeURIComponent(generationId)}/stop`, {
                method: 'POST',
            }),
    },
};
