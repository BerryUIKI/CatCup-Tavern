import type {
    AuthStatus,
    CharacterPatch,
    ChatDetail,
    ImportCharactersResponse,
    ProviderInput,
    RegexScriptPatch,
    SettingsPatch,
    WorldDetail,
    WorldInfoEntryPatch,
} from '@catcup/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';

export const queryKeys = {
    auth: ['auth'] as const,
    characters: ['characters'] as const,
    character: (id: string) => ['character', id] as const,
    chats: (characterId: string | null) => ['chats', characterId] as const,
    chat: (characterId: string | null, chatId: string | null) => ['chat', characterId, chatId] as const,
    settings: ['settings'] as const,
    presets: ['presets'] as const,
    preset: (id: string | null) => ['preset', id] as const,
    worlds: ['worlds'] as const,
    world: (id: string | null) => ['world', id] as const,
    regex: ['regex'] as const,
};

export function useAuthStatus() {
    return useQuery({
        queryKey: queryKeys.auth,
        queryFn: api.auth.status,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
    });
}

function useAuthenticated() {
    const queryClient = useQueryClient();
    return () => {
        queryClient.setQueryData<AuthStatus>(queryKeys.auth, {
            needsSetup: false,
            authenticated: true,
        });
        queryClient.removeQueries({
            predicate: (query) => query.queryKey[0] !== 'auth',
        });
    };
}

export function useSetup() {
    const onAuthenticated = useAuthenticated();
    return useMutation({
        mutationFn: (password: string) => api.auth.setup(password),
        onSuccess: onAuthenticated,
    });
}

export function useLogin() {
    const onAuthenticated = useAuthenticated();
    return useMutation({
        mutationFn: (password: string) => api.auth.login(password),
        onSuccess: onAuthenticated,
    });
}

export function useLogout() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => api.auth.logout(),
        onSuccess: () => {
            queryClient.setQueryData<AuthStatus>(queryKeys.auth, {
                needsSetup: false,
                authenticated: false,
            });
            queryClient.removeQueries({
                predicate: (query) => query.queryKey[0] !== 'auth',
            });
        },
    });
}

export function useCharacters() {
    return useQuery({
        queryKey: queryKeys.characters,
        queryFn: api.characters.list,
    });
}

export function useCharacter(id: string | null) {
    return useQuery({
        queryKey: queryKeys.character(id ?? ''),
        queryFn: () => api.characters.get(id as string),
        enabled: Boolean(id),
    });
}

export function useImportCharacters() {
    const queryClient = useQueryClient();
    return useMutation<ImportCharactersResponse, Error, File[]>({
        mutationFn: (files) => api.characters.import(files),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
        },
    });
}

export function useUpdateCharacter() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { id: string; patch: CharacterPatch }) =>
            api.characters.update(variables.id, variables.patch),
        onSuccess: (character) => {
            // `useCharacter` caches the detail itself, not a `{ character }`
            // wrapper: the API client already unwraps it.
            queryClient.setQueryData(queryKeys.character(character.id), character);
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
        },
    });
}

export function useDeleteCharacter() {
    const queryClient = useQueryClient();
    return useMutation<{ ok: true }, Error, string>({
        mutationFn: (id) => api.characters.remove(id),
        onSuccess: (_data, id) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
            queryClient.removeQueries({ queryKey: queryKeys.character(id) });
            queryClient.removeQueries({ queryKey: queryKeys.chats(id) });
        },
    });
}

export function useChats(characterId: string | null) {
    return useQuery({
        queryKey: queryKeys.chats(characterId),
        queryFn: () => api.chats.list(characterId as string),
        enabled: Boolean(characterId),
    });
}

export function useChat(characterId: string | null, chatId: string | null) {
    return useQuery({
        queryKey: queryKeys.chat(characterId, chatId),
        queryFn: () => api.chats.get(characterId as string, chatId as string),
        enabled: Boolean(characterId && chatId),
    });
}

export function useCreateChat(characterId: string | null) {
    const queryClient = useQueryClient();
    return useMutation<ChatDetail, Error, { name?: string; greetingIndex?: number } | undefined>({
        mutationFn: (body) => {
            if (!characterId) {
                throw new Error('No character selected');
            }
            return api.chats.create(characterId, body ?? {});
        },
        onSuccess: (chat) => {
            queryClient.setQueryData(queryKeys.chat(characterId, chat.chatId), chat);
            void queryClient.invalidateQueries({ queryKey: queryKeys.chats(characterId) });
        },
    });
}

export function useUpdateMessage(characterId: string | null, chatId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { index: number; message?: string; swipeId?: number }) => {
            if (!characterId || !chatId) {
                throw new Error('No chat selected');
            }
            return api.chats.updateMessage(characterId, chatId, variables.index, {
                ...(variables.message !== undefined ? { message: variables.message } : {}),
                ...(variables.swipeId !== undefined ? { swipeId: variables.swipeId } : {}),
            });
        },
        onSuccess: (message, variables) => {
            if (!characterId || !chatId) {
                return;
            }
            queryClient.setQueryData<ChatDetail>(queryKeys.chat(characterId, chatId), (current) => {
                if (!current) {
                    return current;
                }
                return {
                    ...current,
                    messages: current.messages.map((item, index) => (index === variables.index ? message : item)),
                };
            });
            void queryClient.invalidateQueries({ queryKey: queryKeys.chats(characterId) });
        },
    });
}

export function useDeleteMessage(characterId: string | null, chatId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (index: number) => {
            if (!characterId || !chatId) {
                throw new Error('No chat selected');
            }
            return api.chats.deleteMessage(characterId, chatId, index);
        },
        onSuccess: (chat) => {
            queryClient.setQueryData(queryKeys.chat(chat.characterId, chat.chatId), chat);
            void queryClient.invalidateQueries({ queryKey: queryKeys.chats(chat.characterId) });
        },
    });
}

export function useDeleteChat(characterId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (chatId: string) => {
            if (!characterId) {
                throw new Error('No character selected');
            }
            return api.chats.remove(characterId, chatId);
        },
        onSuccess: (_data, chatId) => {
            queryClient.removeQueries({ queryKey: queryKeys.chat(characterId, chatId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.chats(characterId) });
        },
    });
}

export function useRenameChat(characterId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { chatId: string; name: string }) => {
            if (!characterId) {
                throw new Error('No character selected');
            }
            return api.chats.rename(characterId, variables.chatId, variables.name);
        },
        onSuccess: (chat, variables) => {
            queryClient.removeQueries({ queryKey: queryKeys.chat(characterId, variables.chatId) });
            queryClient.setQueryData(queryKeys.chat(characterId, chat.chatId), chat);
            void queryClient.invalidateQueries({ queryKey: queryKeys.chats(characterId) });
        },
    });
}

export function useBranchChat(characterId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { chatId: string; index: number; name?: string }) => {
            if (!characterId) {
                throw new Error('No character selected');
            }
            return api.chats.branch(characterId, variables.chatId, variables.index, variables.name);
        },
        onSuccess: (chat) => {
            queryClient.setQueryData(queryKeys.chat(characterId, chat.chatId), chat);
            void queryClient.invalidateQueries({ queryKey: queryKeys.chats(characterId) });
        },
    });
}

export function useRegexScripts() {
    return useQuery({ queryKey: queryKeys.regex, queryFn: api.regex.list });
}

export function useCreateRegexScript() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (patch: RegexScriptPatch) => api.regex.create(patch),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.regex });
        },
    });
}

export function useUpdateRegexScript() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { id: string; patch: RegexScriptPatch }) =>
            api.regex.update(variables.id, variables.patch),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.regex });
        },
    });
}

export function useDeleteRegexScript() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.regex.remove(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.regex });
        },
    });
}

export function useReorderRegexScripts() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (ids: string[]) => api.regex.reorder(ids),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.regex });
        },
    });
}

export function useImportRegexScripts() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { data: unknown; mode: 'append' | 'replace' }) =>
            api.regex.import(variables.data, variables.mode),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.regex });
        },
    });
}

export function useSettings() {
    return useQuery({
        queryKey: queryKeys.settings,
        queryFn: api.settings.get,
    });
}

export function useWorlds() {
    return useQuery({ queryKey: queryKeys.worlds, queryFn: api.worlds.list });
}

export function useImportWorld() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { fileName?: string; book: unknown }) =>
            api.worlds.import(variables.fileName, variables.book),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
        },
    });
}

export function useDeleteWorld() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.worlds.remove(id),
        onSuccess: (_data, id) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
            queryClient.removeQueries({ queryKey: queryKeys.world(id) });
        },
    });
}

export function useWorld(id: string | null) {
    return useQuery({
        queryKey: queryKeys.world(id),
        queryFn: () => api.worlds.get(id as string),
        enabled: Boolean(id),
    });
}

/**
 * Write a mutated book back into the cache.
 *
 * The server returns the whole book after every entry change, so the editor
 * renders from what was actually stored — including the uid a new entry got and
 * the display order that resulted.
 */
function useWorldCacheWriter(id: string | null) {
    const queryClient = useQueryClient();
    return (data: { world: WorldDetail; uid?: number }) => {
        queryClient.setQueryData(queryKeys.world(id), data);
        void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
    };
}

export function useCreateWorldEntry(id: string | null) {
    const onSuccess = useWorldCacheWriter(id);
    return useMutation({
        mutationFn: () => {
            if (!id) {
                throw new Error('No world info book selected');
            }
            return api.worlds.createEntry(id);
        },
        onSuccess,
    });
}

export function useDuplicateWorldEntry(id: string | null) {
    const onSuccess = useWorldCacheWriter(id);
    return useMutation({
        mutationFn: (uid: number) => {
            if (!id) {
                throw new Error('No world info book selected');
            }
            return api.worlds.duplicateEntry(id, uid);
        },
        onSuccess,
    });
}

export function useUpdateWorldEntry(id: string | null) {
    const onSuccess = useWorldCacheWriter(id);
    return useMutation({
        mutationFn: (variables: { uid: number; patch: WorldInfoEntryPatch }) => {
            if (!id) {
                throw new Error('No world info book selected');
            }
            return api.worlds.updateEntry(id, variables.uid, variables.patch);
        },
        onSuccess,
    });
}

export function useDeleteWorldEntry(id: string | null) {
    const onSuccess = useWorldCacheWriter(id);
    return useMutation({
        mutationFn: (uid: number) => {
            if (!id) {
                throw new Error('No world info book selected');
            }
            return api.worlds.deleteEntry(id, uid);
        },
        onSuccess,
    });
}

export function useReorderWorldEntries(id: string | null) {
    const onSuccess = useWorldCacheWriter(id);
    return useMutation({
        mutationFn: (uids: number[]) => {
            if (!id) {
                throw new Error('No world info book selected');
            }
            return api.worlds.reorderEntries(id, uids);
        },
        onSuccess,
    });
}

/** Rebuild the prompt for a chat without generating. Used by the inspector. */
export function useContextPreview(characterId: string | null, chatId: string | null, enabled: boolean) {
    return useQuery({
        queryKey: [...queryKeys.chat(characterId, chatId), 'context'] as const,
        queryFn: () => api.context.preview(characterId as string, chatId as string),
        enabled: Boolean(enabled && characterId && chatId),
        gcTime: 0,
        staleTime: 0,
    });
}

export function useUpdateSettings() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (patch: SettingsPatch) => api.settings.patch(patch),
        onSuccess: (settings) => {
            queryClient.setQueryData(queryKeys.settings, settings);
        },
    });
}

export function useUpdateProvider() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { id: string; input: ProviderInput }) =>
            api.providers.update(variables.id, variables.input),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

export function useTestProvider() {
    return useMutation({
        mutationFn: (variables: { id: string; apiKey?: string }) => api.providers.test(variables.id, variables.apiKey),
    });
}

export function useProviderModels() {
    return useMutation({
        mutationFn: (id: string) => api.providers.models(id),
    });
}

export function usePresets() {
    return useQuery({ queryKey: queryKeys.presets, queryFn: api.presets.list });
}

export function usePreset(id: string | null) {
    return useQuery({
        queryKey: queryKeys.preset(id),
        queryFn: () => api.presets.get(id as string),
        enabled: Boolean(id),
    });
}

export function useUpdatePreset(id: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (patch: { prompts?: unknown[]; prompt_order?: unknown[] }) =>
            api.presets.update(id as string, patch),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.preset(id) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.presets });
        },
    });
}

export function useImportPreset() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { fileName?: string; preset: unknown }) =>
            api.presets.import(variables.fileName, variables.preset),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.presets });
        },
    });
}

export function useDeletePreset() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.presets.remove(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.presets });
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}
