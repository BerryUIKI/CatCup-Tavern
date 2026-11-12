import type {
    AuthStatus,
    CharacterDetail,
    CharacterPatch,
    CharacterSummary,
    ChatDetail,
    ChatMessage,
    ChatSummary,
    ContextPreview,
    GroupChatDetail,
    GroupCreate,
    GroupPatch,
    GroupView,
    HealthResponse,
    ImportCharactersResponse,
    ModelInfo,
    PresetDetail,
    PresetSummary,
    ProviderInput,
    ProviderPublic,
    ProviderTestResult,
    QuickReplyExecuteResponse,
    QuickReplySet,
    QuickReplySetView,
    RegexScript,
    RegexScriptPatch,
    SampleCharacterResponse,
    SettingsPatch,
    SettingsResponse,
    SillyTavernImportPlan,
    SillyTavernImportResult,
    SummarizeResponse,
    SummaryRecord,
    WorldDetail,
    WorldInfoEntryPatch,
    WorldSummary,
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

/** A chat addressed for the quick reply execute endpoints. */
export interface QuickReplyChatRef {
    kind: 'character' | 'group';
    /** Character id or group id, depending on `kind`. */
    id: string;
    chatId: string;
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
    health: () => request<HealthResponse>('/health'),
    worlds: {
        list: () => request<{ worlds: WorldSummary[] }>('/worlds'),
        get: (id: string) => request<{ world: WorldDetail }>(`/worlds/${encodeURIComponent(id)}`),
        import: (fileName: string | undefined, book: unknown) =>
            request<{ world: WorldDetail }>('/worlds/import', {
                method: 'POST',
                body: JSON.stringify({ fileName, book }),
            }),
        remove: (id: string) => request<{ ok: boolean }>(`/worlds/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        createEntry: (id: string) =>
            request<{ world: WorldDetail; uid?: number }>(`/worlds/${encodeURIComponent(id)}/entries`, {
                method: 'POST',
            }),
        duplicateEntry: (id: string, uid: number) =>
            request<{ world: WorldDetail; uid?: number }>(
                `/worlds/${encodeURIComponent(id)}/entries/${uid}/duplicate`,
                { method: 'POST' },
            ),
        updateEntry: (id: string, uid: number, patch: WorldInfoEntryPatch) =>
            request<{ world: WorldDetail; uid?: number }>(`/worlds/${encodeURIComponent(id)}/entries/${uid}`, {
                method: 'PATCH',
                body: JSON.stringify(patch),
            }),
        deleteEntry: (id: string, uid: number) =>
            request<{ world: WorldDetail; uid?: number }>(`/worlds/${encodeURIComponent(id)}/entries/${uid}`, {
                method: 'DELETE',
            }),
        reorderEntries: (id: string, uids: number[]) =>
            request<{ world: WorldDetail; uid?: number }>(`/worlds/${encodeURIComponent(id)}/entries/order`, {
                method: 'PUT',
                body: JSON.stringify({ uids }),
            }),
        exportUrl: (id: string) => `/api/worlds/${encodeURIComponent(id)}/export`,
    },
    context: {
        preview: async (characterId: string, chatId: string) => {
            const data = await request<{ context: ContextPreview }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}/context`,
            );
            return data.context;
        },
    },
    regex: {
        list: () => request<{ scripts: RegexScript[] }>('/regex'),
        create: (patch: RegexScriptPatch) =>
            request<{ script: RegexScript }>('/regex', { method: 'POST', body: JSON.stringify(patch) }),
        update: (id: string, patch: RegexScriptPatch) =>
            request<{ script: RegexScript }>(`/regex/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify(patch),
            }),
        remove: (id: string) => request<{ ok: true }>(`/regex/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        reorder: (ids: string[]) =>
            request<{ scripts: RegexScript[] }>('/regex/order', { method: 'PUT', body: JSON.stringify({ ids }) }),
        import: (data: unknown, mode: 'append' | 'replace') =>
            request<{ scripts: RegexScript[]; errors: string[] }>('/regex/import', {
                method: 'POST',
                body: JSON.stringify({ data, mode }),
            }),
        exportUrl: () => '/api/regex/export',
    },
    quickReplies: {
        list: () => request<{ sets: QuickReplySetView[] }>('/quick-replies'),
        create: (name: string) =>
            request<{ set: QuickReplySetView }>('/quick-replies', {
                method: 'POST',
                body: JSON.stringify({ name }),
            }),
        save: (id: string, set: QuickReplySet) =>
            request<{ set: QuickReplySetView; renamedFrom?: string }>(`/quick-replies/${encodeURIComponent(id)}`, {
                method: 'PUT',
                body: JSON.stringify(set),
            }),
        remove: (id: string) => request<{ ok: true }>(`/quick-replies/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        import: (data: unknown, name?: string) =>
            request<{ set: QuickReplySetView }>('/quick-replies/import', {
                method: 'POST',
                body: JSON.stringify({ data, name }),
            }),
        exportUrl: (id: string) => `/api/quick-replies/${encodeURIComponent(id)}/export`,
        execute: (target: QuickReplyChatRef, setId: string, qrId: number) => {
            const path =
                target.kind === 'character'
                    ? `/chats/${encodeURIComponent(target.id)}/${encodeURIComponent(target.chatId)}/quick-replies/execute`
                    : `/groups/${encodeURIComponent(target.id)}/chats/${encodeURIComponent(target.chatId)}/quick-replies/execute`;
            return request<QuickReplyExecuteResponse>(path, {
                method: 'POST',
                body: JSON.stringify({ setId, qrId }),
            });
        },
    },
    presets: {
        list: () => request<{ presets: PresetSummary[] }>('/presets'),
        get: (id: string) => request<{ preset: PresetDetail }>(`/presets/${encodeURIComponent(id)}`),
        import: (fileName: string | undefined, preset: unknown) =>
            request<{ preset: PresetDetail }>('/presets/import', {
                method: 'POST',
                body: JSON.stringify({ fileName, preset }),
            }),
        update: (id: string, patch: { prompts?: unknown[]; prompt_order?: unknown[] }) =>
            request<{ preset: PresetDetail }>(`/presets/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify(patch),
            }),
        remove: (id: string) => request<{ ok: boolean }>(`/presets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        exportUrl: (id: string) => `/api/presets/${encodeURIComponent(id)}/export`,
    },
    importFromSillyTavern: (path: string, dryRun: boolean) =>
        request<{ plan: SillyTavernImportPlan } | { result: SillyTavernImportResult }>('/import/sillytavern', {
            method: 'POST',
            body: JSON.stringify({ path, dryRun }),
        }),
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
        update: async (id: string, patch: CharacterPatch) => {
            const data = await request<{ character: CharacterDetail }>(`/characters/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify(patch),
            });
            return data.character;
        },
        exportUrl: (id: string, format: 'png' | 'json') =>
            `/api/characters/${encodeURIComponent(id)}/export?format=${format}`,
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
        sample: () => request<SampleCharacterResponse>('/characters/sample', { method: 'POST' }),
        lorebook: (id: string) =>
            request<{ world: WorldDetail; character: CharacterDetail; created: boolean }>(
                `/characters/${encodeURIComponent(id)}/lorebook`,
                { method: 'POST' },
            ),
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
        rename: async (characterId: string, chatId: string, name: string) => {
            const data = await request<{ chat: ChatDetail }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}`,
                { method: 'PATCH', body: JSON.stringify({ name }) },
            );
            return data.chat;
        },
        setPersona: async (characterId: string, chatId: string, personaId: string | null) => {
            const data = await request<{ chat: ChatDetail }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}`,
                { method: 'PATCH', body: JSON.stringify({ personaId }) },
            );
            return data.chat;
        },
        setGreeting: async (characterId: string, chatId: string, greetingIndex: number) => {
            const data = await request<{ chat: ChatDetail }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}/greeting`,
                { method: 'POST', body: JSON.stringify({ greetingIndex }) },
            );
            return data.chat;
        },
        branch: async (characterId: string, chatId: string, index: number, name?: string) => {
            const data = await request<{ chat: ChatDetail }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}/branch`,
                { method: 'POST', body: JSON.stringify({ index, name }) },
            );
            return data.chat;
        },
        summarize: (characterId: string, chatId: string) =>
            request<SummarizeResponse>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}/summarize`,
                { method: 'POST' },
            ),
        saveMemory: async (characterId: string, chatId: string, text: string) => {
            const data = await request<{ summary: SummaryRecord | null }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}/memory`,
                { method: 'PUT', body: JSON.stringify({ text }) },
            );
            return data.summary;
        },
        clearMemory: async (characterId: string, chatId: string) => {
            const data = await request<{ summary: SummaryRecord | null }>(
                `/chats/${encodeURIComponent(characterId)}/${encodeURIComponent(chatId)}/memory`,
                { method: 'DELETE' },
            );
            return data.summary;
        },
    },

    groups: {
        list: async () => {
            const data = await request<{ groups: GroupView[] }>('/groups');
            return data.groups;
        },
        get: async (id: string) => {
            const data = await request<{ group: GroupView }>(`/groups/${encodeURIComponent(id)}`);
            return data.group;
        },
        create: async (input: GroupCreate) => {
            const data = await request<{ group: GroupView }>('/groups', {
                method: 'POST',
                body: JSON.stringify(input),
            });
            return data.group;
        },
        update: async (id: string, patch: GroupPatch) => {
            const data = await request<{ group: GroupView }>(`/groups/${encodeURIComponent(id)}`, {
                method: 'PATCH',
                body: JSON.stringify(patch),
            });
            return data.group;
        },
        remove: (id: string) => request<{ ok: true }>(`/groups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
        chats: {
            list: async (groupId: string) => {
                const data = await request<{ chats: ChatSummary[] }>(`/groups/${encodeURIComponent(groupId)}/chats`);
                return data.chats;
            },
            create: async (groupId: string, body: { name?: string } = {}) => {
                const data = await request<{ chat: GroupChatDetail; group: GroupView }>(
                    `/groups/${encodeURIComponent(groupId)}/chats`,
                    { method: 'POST', body: JSON.stringify(body) },
                );
                return data;
            },
            get: async (groupId: string, chatId: string) => {
                const data = await request<{ chat: GroupChatDetail }>(
                    `/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}`,
                );
                return data.chat;
            },
            update: async (
                groupId: string,
                chatId: string,
                patch: { name?: string; personaId?: string | null; current?: boolean },
            ) => {
                const data = await request<{ chat: GroupChatDetail; group: GroupView }>(
                    `/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}`,
                    { method: 'PATCH', body: JSON.stringify(patch) },
                );
                return data;
            },
            remove: (groupId: string, chatId: string) =>
                request<{ ok: true; group: GroupView }>(
                    `/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}`,
                    { method: 'DELETE' },
                ),
            updateMessage: async (
                groupId: string,
                chatId: string,
                index: number,
                body: { message?: string; swipeId?: number },
            ) => {
                const data = await request<{ message: ChatMessage }>(
                    `/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}/messages/${index}`,
                    { method: 'PATCH', body: JSON.stringify(body) },
                );
                return data.message;
            },
            deleteMessage: async (groupId: string, chatId: string, index: number) => {
                const data = await request<{ chat: GroupChatDetail }>(
                    `/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}/messages/${index}`,
                    { method: 'DELETE' },
                );
                return data.chat;
            },
            summarize: (groupId: string, chatId: string) =>
                request<SummarizeResponse>(
                    `/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}/summarize`,
                    { method: 'POST' },
                ),
            saveMemory: async (groupId: string, chatId: string, text: string) => {
                const data = await request<{ summary: SummaryRecord | null }>(
                    `/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}/memory`,
                    { method: 'PUT', body: JSON.stringify({ text }) },
                );
                return data.summary;
            },
            clearMemory: async (groupId: string, chatId: string) => {
                const data = await request<{ summary: SummaryRecord | null }>(
                    `/groups/${encodeURIComponent(groupId)}/chats/${encodeURIComponent(chatId)}/memory`,
                    { method: 'DELETE' },
                );
                return data.summary;
            },
        },
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
