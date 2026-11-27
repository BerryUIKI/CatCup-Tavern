import type {
    AuthStatus,
    CharacterBulkRequest,
    CharacterBulkResponse,
    CharacterCreateRequest,
    CharacterPatch,
    CharacterSummary,
    ChatDetail,
    ChatSummary,
    DistillAcceptInput,
    GroupChatDetail,
    GroupCreate,
    GroupPatch,
    GroupView,
    ImportCharactersResponse,
    ItemScope,
    Persona,
    ProfileCreate,
    ProfileRename,
    ProviderDraftTestInput,
    ProviderInput,
    QuickReplySet,
    RegexScriptPatch,
    SettingsPatch,
    SettingsResponse,
    SharedItemKind,
    SkinManifest,
    WorldDetail,
    WorldInfoEntryPatch,
} from '@catcup/shared';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api, type QuickReplyChatRef } from '../lib/api';

export const queryKeys = {
    auth: ['auth'] as const,
    characters: ['characters'] as const,
    character: (id: string) => ['character', id] as const,
    chats: (characterId: string | null) => ['chats', characterId] as const,
    chat: (characterId: string | null, chatId: string | null) => ['chat', characterId, chatId] as const,
    groups: ['groups'] as const,
    groupChats: (groupId: string | null) => ['groupChats', groupId] as const,
    groupChat: (groupId: string | null, chatId: string | null) => ['groupChat', groupId, chatId] as const,
    settings: ['settings'] as const,
    profiles: ['profiles'] as const,
    presets: ['presets'] as const,
    preset: (id: string | null) => ['preset', id] as const,
    worlds: ['worlds'] as const,
    world: (id: string | null) => ['world', id] as const,
    worldAliases: (id: string | null) => ['worldAliases', id] as const,
    aliasRuns: (id: string | null) => ['aliasRuns', id] as const,
    skins: ['skins'] as const,
    regex: ['regex'] as const,
    quickReplies: ['quickReplies'] as const,
    images: (folder: string) => ['images', folder] as const,
    distillBooks: ['distillBooks'] as const,
    distillRuns: ['distillRuns'] as const,
    distillRun: (id: string | null) => ['distillRun', id] as const,
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
        // `desktop` describes the shell, not the session, so it is carried over
        // from the status this response replaces rather than guessed here.
        const previous = queryClient.getQueryData<AuthStatus>(queryKeys.auth);
        queryClient.setQueryData<AuthStatus>(queryKeys.auth, {
            needsSetup: false,
            authenticated: true,
            openSession: false,
            desktop: previous?.desktop ?? false,
            titleBar: previous?.titleBar ?? null,
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

/**
 * End this device's session.
 *
 * The status is refetched rather than guessed: an open desktop install has no
 * password to sign out of, and writing `authenticated: false` into the cache
 * there paints a login screen the server will not honour. The server answers
 * `409 NO_PASSWORD` for that case, which the caller should present as "nothing
 * to sign out of", not as a failure.
 */
export function useLogout() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => api.auth.logout(),
        onSuccess: () =>
            queryClient.invalidateQueries({ queryKey: queryKeys.auth }).then(() =>
                queryClient.removeQueries({
                    predicate: (query) => query.queryKey[0] !== 'auth',
                }),
            ),
    });
}

/**
 * Set or remove the desktop password.
 *
 * Removing it (`password: ''`) puts the app back into open session, so the
 * cached status has to say so or the login screen reappears on every reload.
 */
export function useSetPassword() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ password, currentPassword }: { password: string; currentPassword?: string }) =>
            api.auth.setPassword(password, currentPassword),
        onSuccess: (result) => {
            // Changing the password does not change which shape is running, so
            // `desktop` is carried over instead of being reset to false.
            const previous = queryClient.getQueryData<AuthStatus>(queryKeys.auth);
            queryClient.setQueryData<AuthStatus>(queryKeys.auth, {
                needsSetup: false,
                authenticated: true,
                openSession: result.openSession,
                desktop: previous?.desktop ?? false,
                titleBar: previous?.titleBar ?? null,
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
    return useMutation<ImportCharactersResponse, Error, { files: File[]; scope?: ItemScope }>({
        mutationFn: (variables) => api.characters.import(variables.files, variables.scope),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
            // A new card can resolve a member a group lists as missing.
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
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
            // Group member names and avatars come from the card.
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

export function useAddSampleCharacter() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => api.characters.sample(),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
        },
    });
}

/**
 * Create a card from nothing.
 *
 * The response carries the whole card, so the caller can open the editor on it
 * without a second fetch. The library is invalidated for the same reason an
 * import invalidates it: a new card can resolve a group member a group lists as
 * missing.
 */
export function useCreateCharacter() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { body: CharacterCreateRequest; scope?: ItemScope }) =>
            api.characters.create(variables.body, variables.scope),
        onSuccess: (data) => {
            queryClient.setQueryData(queryKeys.character(data.character.id), data.character);
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

/** Set or clear the favorite flag on one card. */
export function useSetCharacterFavorite() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { id: string; favorite: boolean }) =>
            api.characters.setFavorite(variables.id, variables.favorite),
        onMutate: async (variables) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.characters });
            const previous = queryClient.getQueryData<CharacterSummary[]>(queryKeys.characters);
            queryClient.setQueryData<CharacterSummary[]>(queryKeys.characters, (current) =>
                current?.map((character) =>
                    character.id === variables.id ? { ...character, fav: variables.favorite } : character,
                ),
            );
            return { previous };
        },
        onError: (_error, _variables, context) => {
            if (context?.previous) {
                queryClient.setQueryData(queryKeys.characters, context.previous);
            }
        },
        onSuccess: (character) => {
            queryClient.setQueryData(queryKeys.character(character.id), character);
        },
        onSettled: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
        },
    });
}

/** Apply one action to several characters and refresh the affected caches. */
export function useBulkCharacters() {
    const queryClient = useQueryClient();
    return useMutation<CharacterBulkResponse, Error, CharacterBulkRequest>({
        mutationFn: (body) => api.characters.bulk(body),
        onSuccess: (result) => {
            for (const character of result.characters) {
                void queryClient.invalidateQueries({ queryKey: queryKeys.character(character.id) });
            }
            for (const id of result.deleted) {
                queryClient.removeQueries({ queryKey: queryKeys.character(id) });
            }
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
            // Group member names, avatars and missing-member state come from cards.
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

/**
 * Import a card's embedded lorebook and link it to the character.
 *
 * The server returns the refreshed card, whose `extensions.world` now names the
 * book, so the editor can show the link without a second fetch.
 */
export function useImportCharacterBook(characterId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => {
            if (!characterId) {
                throw new Error('No character selected');
            }
            return api.characters.lorebook(characterId);
        },
        onSuccess: ({ character }) => {
            queryClient.setQueryData(queryKeys.character(character.id), character);
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
            void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

export function useDeleteCharacter() {
    const queryClient = useQueryClient();
    return useMutation<{ ok: true }, Error, string>({
        mutationFn: (id) => api.characters.remove(id),
        onSuccess: (_data, id) => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
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

export function useSetChatPersona(characterId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { chatId: string; personaId: string | null }) => {
            if (!characterId) {
                throw new Error('No character selected');
            }
            return api.chats.setPersona(characterId, variables.chatId, variables.personaId);
        },
        onSuccess: (chat) => {
            queryClient.setQueryData(queryKeys.chat(characterId, chat.chatId), chat);
            void queryClient.invalidateQueries({ queryKey: queryKeys.chats(characterId) });
        },
    });
}

/** Replace a chat's opening message with another greeting from the card. */
export function useSetChatGreeting(characterId: string | null, chatId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (greetingIndex: number) => {
            if (!characterId || !chatId) {
                throw new Error('No chat selected');
            }
            return api.chats.setGreeting(characterId, chatId, greetingIndex);
        },
        onSuccess: (chat) => {
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

export function useGroups() {
    return useQuery({ queryKey: queryKeys.groups, queryFn: api.groups.list });
}

/**
 * Put a group into the list cache immediately.
 *
 * The list drives the sidebar and the selected-group lookup; waiting for the
 * invalidation refetch would briefly make a just-created group look deleted.
 */
function setGroupInCache(queryClient: QueryClient, group: GroupView): void {
    queryClient.setQueryData<GroupView[]>(queryKeys.groups, (current) => {
        if (!current) {
            return [group];
        }
        return current.some((item) => item.id === group.id)
            ? current.map((item) => (item.id === group.id ? group : item))
            : [group, ...current];
    });
}

export function useCreateGroup() {
    const queryClient = useQueryClient();
    return useMutation<GroupView, Error, GroupCreate>({
        mutationFn: (input) => api.groups.create(input),
        onSuccess: (group) => {
            setGroupInCache(queryClient, group);
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

export function useUpdateGroup(id: string | null) {
    const queryClient = useQueryClient();
    return useMutation<GroupView, Error, GroupPatch>({
        mutationFn: (patch) => {
            if (!id) {
                throw new Error('No group selected');
            }
            return api.groups.update(id, patch);
        },
        onSuccess: (group) => {
            setGroupInCache(queryClient, group);
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

export function useDeleteGroup() {
    const queryClient = useQueryClient();
    return useMutation<{ ok: true }, Error, string>({
        mutationFn: (id) => api.groups.remove(id),
        onSuccess: (_data, id) => {
            queryClient.setQueryData<GroupView[]>(queryKeys.groups, (current) =>
                current ? current.filter((item) => item.id !== id) : current,
            );
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
            queryClient.removeQueries({ queryKey: queryKeys.groupChats(id) });
        },
    });
}

export function useGroupChats(groupId: string | null) {
    return useQuery({
        queryKey: queryKeys.groupChats(groupId),
        queryFn: () => api.groups.chats.list(groupId as string),
        enabled: Boolean(groupId),
    });
}

export function useGroupChat(groupId: string | null, chatId: string | null) {
    return useQuery({
        queryKey: queryKeys.groupChat(groupId, chatId),
        queryFn: () => api.groups.chats.get(groupId as string, chatId as string),
        enabled: Boolean(groupId && chatId),
    });
}

/**
 * Start a chat in a group.
 *
 * The server seeds one greeting per member, so the returned chat already has
 * messages. Creating a group passes `groupId` explicitly because the store has
 * not selected the new group yet.
 */
export function useCreateGroupChat(groupId: string | null) {
    const queryClient = useQueryClient();
    return useMutation<
        { chat: GroupChatDetail; group: GroupView },
        Error,
        { groupId?: string; name?: string } | undefined
    >({
        mutationFn: (variables) => {
            const id = variables?.groupId ?? groupId;
            if (!id) {
                throw new Error('No group selected');
            }
            return api.groups.chats.create(id, variables?.name ? { name: variables.name } : {});
        },
        onSuccess: ({ chat, group }, variables) => {
            const id = variables?.groupId ?? groupId;
            if (!id) {
                return;
            }
            queryClient.setQueryData(queryKeys.groupChat(id, chat.chatId), chat);
            // Add the chat to the list cache before the invalidation refetch, so
            // selecting it cannot be undone by an effect that still sees the
            // previous list.
            queryClient.setQueryData<ChatSummary[]>(queryKeys.groupChats(id), (current) => [
                {
                    id: chat.chatId,
                    title: chat.chatId,
                    updatedAt: Date.now(),
                    messageCount: chat.messages.length,
                },
                ...(current ?? []).filter((item) => item.id !== chat.chatId),
            ]);
            setGroupInCache(queryClient, group);
            void queryClient.invalidateQueries({ queryKey: queryKeys.groupChats(id) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

export function useRenameGroupChat(groupId: string | null) {
    const queryClient = useQueryClient();
    return useMutation<{ chat: GroupChatDetail; group: GroupView }, Error, { chatId: string; name: string }>({
        mutationFn: (variables) => {
            if (!groupId) {
                throw new Error('No group selected');
            }
            return api.groups.chats.update(groupId, variables.chatId, { name: variables.name });
        },
        onSuccess: ({ chat, group }, variables) => {
            if (!groupId) {
                return;
            }
            if (variables.chatId !== chat.chatId) {
                queryClient.removeQueries({ queryKey: queryKeys.groupChat(groupId, variables.chatId) });
            }
            queryClient.setQueryData(queryKeys.groupChat(groupId, chat.chatId), chat);
            queryClient.setQueryData<ChatSummary[]>(queryKeys.groupChats(groupId), (current) =>
                (current ?? []).map((item) =>
                    item.id === variables.chatId
                        ? { ...item, id: chat.chatId, title: chat.chatId, updatedAt: Date.now() }
                        : item,
                ),
            );
            setGroupInCache(queryClient, group);
            void queryClient.invalidateQueries({ queryKey: queryKeys.groupChats(groupId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

export function useSetGroupChatPersona(groupId: string | null, chatId: string | null) {
    const queryClient = useQueryClient();
    return useMutation<{ chat: GroupChatDetail; group: GroupView }, Error, string | null>({
        mutationFn: (personaId) => {
            if (!groupId || !chatId) {
                throw new Error('No group chat selected');
            }
            return api.groups.chats.update(groupId, chatId, { personaId });
        },
        onSuccess: ({ chat, group }) => {
            if (!groupId) {
                return;
            }
            queryClient.setQueryData(queryKeys.groupChat(groupId, chat.chatId), chat);
            setGroupInCache(queryClient, group);
            void queryClient.invalidateQueries({ queryKey: queryKeys.groupChats(groupId) });
        },
    });
}

/** Persist which group chat is open, as `chat_id`, so it reopens next time. */
export function useSetCurrentGroupChat(groupId: string | null) {
    const queryClient = useQueryClient();
    return useMutation<{ chat: GroupChatDetail; group: GroupView }, Error, string>({
        mutationFn: (chatId) => {
            if (!groupId) {
                throw new Error('No group selected');
            }
            return api.groups.chats.update(groupId, chatId, { current: true });
        },
        onSuccess: ({ group }) => {
            if (!groupId) {
                return;
            }
            setGroupInCache(queryClient, group);
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

export function useDeleteGroupChat(groupId: string | null) {
    const queryClient = useQueryClient();
    return useMutation<{ ok: true; group: GroupView }, Error, string>({
        mutationFn: (chatId) => {
            if (!groupId) {
                throw new Error('No group selected');
            }
            return api.groups.chats.remove(groupId, chatId);
        },
        onSuccess: ({ group }, chatId) => {
            if (!groupId) {
                return;
            }
            queryClient.removeQueries({ queryKey: queryKeys.groupChat(groupId, chatId) });
            queryClient.setQueryData<ChatSummary[]>(queryKeys.groupChats(groupId), (current) =>
                current ? current.filter((item) => item.id !== chatId) : current,
            );
            setGroupInCache(queryClient, group);
            void queryClient.invalidateQueries({ queryKey: queryKeys.groupChats(groupId) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

export function useUpdateGroupMessage(groupId: string | null, chatId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { index: number; message?: string; swipeId?: number }) => {
            if (!groupId || !chatId) {
                throw new Error('No group chat selected');
            }
            return api.groups.chats.updateMessage(groupId, chatId, variables.index, {
                ...(variables.message !== undefined ? { message: variables.message } : {}),
                ...(variables.swipeId !== undefined ? { swipeId: variables.swipeId } : {}),
            });
        },
        onSuccess: (message, variables) => {
            if (!groupId || !chatId) {
                return;
            }
            queryClient.setQueryData<GroupChatDetail>(queryKeys.groupChat(groupId, chatId), (current) => {
                if (!current) {
                    return current;
                }
                return {
                    ...current,
                    messages: current.messages.map((item, index) => (index === variables.index ? message : item)),
                };
            });
            void queryClient.invalidateQueries({ queryKey: queryKeys.groupChats(groupId) });
        },
    });
}

export function useDeleteGroupMessage(groupId: string | null, chatId: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (index: number) => {
            if (!groupId || !chatId) {
                throw new Error('No group chat selected');
            }
            return api.groups.chats.deleteMessage(groupId, chatId, index);
        },
        onSuccess: (chat) => {
            if (!groupId) {
                return;
            }
            queryClient.setQueryData(queryKeys.groupChat(groupId, chat.chatId), chat);
            void queryClient.invalidateQueries({ queryKey: queryKeys.groupChats(groupId) });
        },
    });
}

/** A chat addressed for the memory endpoints. */
export interface MemoryChatRef {
    kind: 'character' | 'group';
    /** Character id or group id, depending on `kind`. */
    id: string;
    chatId: string;
}

function invalidateChatTarget(queryClient: QueryClient, target: MemoryChatRef | QuickReplyChatRef): void {
    if (target.kind === 'character') {
        void queryClient.invalidateQueries({ queryKey: queryKeys.chat(target.id, target.chatId) });
        return;
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.groupChat(target.id, target.chatId) });
}

/** Run one summary for the chat and store it on the covered message. */
export function useSummarizeMemory() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (target: MemoryChatRef) =>
            target.kind === 'character'
                ? api.chats.summarize(target.id, target.chatId)
                : api.groups.chats.summarize(target.id, target.chatId),
        onSuccess: (_result, target) => invalidateChatTarget(queryClient, target),
    });
}

/** Replace the stored summary with edited text. */
export function useSaveMemory() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { target: MemoryChatRef; text: string }) =>
            variables.target.kind === 'character'
                ? api.chats.saveMemory(variables.target.id, variables.target.chatId, variables.text)
                : api.groups.chats.saveMemory(variables.target.id, variables.target.chatId, variables.text),
        onSuccess: (_result, variables) => invalidateChatTarget(queryClient, variables.target),
    });
}

/** Remove the latest summary, falling back to an older one when present. */
export function useClearMemory() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (target: MemoryChatRef) =>
            target.kind === 'character'
                ? api.chats.clearMemory(target.id, target.chatId)
                : api.groups.chats.clearMemory(target.id, target.chatId),
        onSuccess: (_result, target) => invalidateChatTarget(queryClient, target),
    });
}

export function useRegexScripts() {
    return useQuery({ queryKey: queryKeys.regex, queryFn: api.regex.list });
}

export function useSkins() {
    return useQuery({ queryKey: queryKeys.skins, queryFn: api.skins.list });
}

export function useInstallSkin() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (manifest: SkinManifest) => api.skins.install(manifest),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.skins });
        },
    });
}

export function useImportSkin() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (file: File) => api.skins.import(file),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.skins });
        },
    });
}

export function useRemoveSkin() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.skins.remove(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.skins });
        },
    });
}

export function useQuickReplies() {
    return useQuery({ queryKey: queryKeys.quickReplies, queryFn: api.quickReplies.list });
}

export function useCreateQuickReplySet() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { name: string; scope?: ItemScope }) =>
            api.quickReplies.create(variables.name, variables.scope),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.quickReplies });
        },
    });
}

/**
 * Save a set. Renaming can move the file and rewrite the account set list, so
 * the settings query is refreshed too.
 */
export function useSaveQuickReplySet() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { id: string; set: QuickReplySet }) =>
            api.quickReplies.save(variables.id, variables.set),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.quickReplies });
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

export function useDeleteQuickReplySet() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.quickReplies.remove(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.quickReplies });
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

export function useImportQuickReplySet() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { data: unknown; name?: string; scope?: ItemScope }) =>
            api.quickReplies.import(variables.data, variables.name, variables.scope),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.quickReplies });
        },
    });
}

/** Run a quick reply against a chat; the server appends and returns directives. */
export function useExecuteQuickReply() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { target: QuickReplyChatRef; setId: string; qrId: number }) =>
            api.quickReplies.execute(variables.target, variables.setId, variables.qrId),
        // A failed script can still have persisted an earlier append, so refresh
        // the chat on errors as well as on success.
        onSettled: (_result, _error, variables) => {
            invalidateChatTarget(queryClient, variables.target);
        },
    });
}

export function useCreateRegexScript() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { patch: RegexScriptPatch; scope?: ItemScope }) =>
            api.regex.create(variables.patch, variables.scope),
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
        mutationFn: (variables: { ids: string[]; scope?: ItemScope }) =>
            api.regex.reorder(variables.ids, variables.scope),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.regex });
        },
    });
}

export function useImportRegexScripts() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { data: unknown; mode: 'append' | 'replace'; scope?: ItemScope }) =>
            api.regex.import(variables.data, variables.mode, variables.scope),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.regex });
        },
    });
}

/** The profile list and the one the server is serving. */
export function useProfiles() {
    return useQuery({
        queryKey: queryKeys.profiles,
        queryFn: api.profiles.list,
    });
}

/** Invalidate everything a profile switch changes: every scoped store. */
function invalidateAll(queryClient: ReturnType<typeof useQueryClient>, settings: SettingsResponse) {
    queryClient.setQueryData(queryKeys.settings, settings);
    void queryClient.invalidateQueries();
}

export function useActivateProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.profiles.activate(id),
        onSuccess: ({ settings }) => invalidateAll(queryClient, settings),
    });
}

export function useCreateProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: ProfileCreate) => api.profiles.create(input),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.profiles }),
    });
}

export function useRenameProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: ({ id, patch }: { id: string; patch: ProfileRename }) => api.profiles.rename(id, patch),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.profiles });
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

export function useArchiveProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.profiles.archive(id),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.profiles }),
    });
}

export function useRestoreProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.profiles.restore(id),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.profiles }),
    });
}

export function useDeleteProfile() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.profiles.remove(id),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.profiles }),
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
        mutationFn: (variables: { fileName?: string; book: unknown; scope?: ItemScope }) =>
            api.worlds.import(variables.fileName, variables.book, variables.scope),
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
 * A book's alias sets.
 *
 * Aliases live in a sidecar beside the book rather than in the entries, so they
 * are fetched separately and cannot be invalidated by an entry save.
 */
export function useWorldAliases(id: string | null) {
    return useQuery({
        queryKey: queryKeys.worldAliases(id),
        queryFn: () => api.worlds.aliases(id as string),
        enabled: Boolean(id),
    });
}

export function useSetWorldAliases(id: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { uid: number; aliases: string[] }) => {
            if (!id) {
                throw new Error('No world info book selected');
            }
            return api.worlds.setAliases(id, variables.uid, variables.aliases);
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.worldAliases(id) });
            // The scanner matches aliases as keys, so the book's cached view is
            // stale in the sense that matters: a scan run from another surface
            // must see the new list.
            void queryClient.invalidateQueries({ queryKey: queryKeys.world(id) });
        },
    });
}

/** The alias runs recorded for one book, newest first. */
export function useAliasRuns(id: string | null) {
    return useQuery({
        queryKey: queryKeys.aliasRuns(id),
        queryFn: () => api.worlds.aliasRuns(id as string),
        enabled: Boolean(id),
    });
}

/**
 * What generating this book's aliases would cost.
 *
 * `staleTime: 0` on purpose: the answer changes whenever an alias is typed, and
 * a person opening the dialog right after editing one must not read a count
 * from before the edit.
 */
export function useAliasEstimate(id: string | null, includeExisting: boolean) {
    return useQuery({
        queryKey: [...queryKeys.aliasRuns(id), 'estimate', includeExisting] as const,
        queryFn: () => api.worlds.estimateAliases(id as string, { includeExisting }),
        enabled: Boolean(id),
        staleTime: 0,
    });
}

/**
 * Write the rows a review sheet kept.
 *
 * Invalidates both the alias view and the book: the scanner matches aliases as
 * keys, so anything holding a cached scan has to see the new list too.
 */
export function useApplyAliases(id: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { runId: string | null; entries: Array<{ uid: number; aliases: string[] }> }) => {
            if (!id) {
                throw new Error('No world info book selected');
            }
            return api.worlds.applyAliases(id, variables.runId, variables.entries);
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.worldAliases(id) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.world(id) });
            void queryClient.invalidateQueries({ queryKey: queryKeys.aliasRuns(id) });
        },
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

export function useCreateProvider() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: ProviderInput) => api.providers.create(input),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

export function useDeleteProvider() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.providers.remove(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

export function useTestProviderDraft() {
    return useMutation({
        mutationFn: (body: ProviderDraftTestInput) => api.providers.testDraft(body),
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
        mutationFn: (variables: { fileName?: string; preset: unknown; scope?: ItemScope }) =>
            api.presets.import(variables.fileName, variables.preset, variables.scope),
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

/**
 * Move or copy one library item between the profile and the shared scope.
 *
 * Every scope change is answered by refetching every library list: a move
 * changes what the profile list holds, what the shared list holds, and — for a
 * character or a book — what a chat, a group or a preset link resolves to. One
 * blanket invalidation is simpler to keep right than enumerating the kinds, and
 * these are lists, not chat streams.
 */
export function useShareItem() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { kind: SharedItemKind; id: string; action: 'move' | 'copy'; scope: ItemScope }) =>
            api.share(variables.kind, variables.id, variables.action, variables.scope),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
            void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
            void queryClient.invalidateQueries({ queryKey: queryKeys.presets });
            void queryClient.invalidateQueries({ queryKey: queryKeys.quickReplies });
            void queryClient.invalidateQueries({ queryKey: queryKeys.regex });
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
            void queryClient.invalidateQueries({ queryKey: queryKeys.groups });
        },
    });
}

export function useCreatePersona() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: Omit<Persona, 'id'> & { scope: ItemScope }) => {
            const { scope, ...draft } = variables;
            return api.personas.create(draft, scope);
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

/**
 * Create a persona from a character card.
 *
 * The card stays where it is; the persona is a copy, so editing it later never
 * changes what other chats see of the card.
 */
export function usePersonaFromCard() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { characterId: string; scope: ItemScope }) =>
            api.personas.fromCard(variables.characterId, variables.scope),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

export function useUpdatePersona() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (variables: { id: string; patch: Partial<Omit<Persona, 'id'>> }) =>
            api.personas.update(variables.id, variables.patch),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
        },
    });
}

export function useDeletePersona() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.personas.remove(id),
        onSuccess: (data) => {
            queryClient.setQueryData(queryKeys.settings, data.settings);
        },
    });
}

export function useDistillBooks() {
    return useQuery({ queryKey: queryKeys.distillBooks, queryFn: api.distill.books.list });
}

export function useUploadBook() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (file: File) => api.distill.books.upload(file),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.distillBooks });
        },
    });
}

export function useDeleteBook() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.distill.books.remove(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.distillBooks });
        },
    });
}

export function useDistillRuns() {
    return useQuery({ queryKey: queryKeys.distillRuns, queryFn: api.distill.runs.list });
}

export function useDistillRun(id: string | null) {
    return useQuery({
        queryKey: queryKeys.distillRun(id),
        queryFn: () => api.distill.runs.get(id as string),
        enabled: Boolean(id),
    });
}

export function useDiscardDistillRun() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (id: string) => api.distill.runs.discard(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.distillRuns });
        },
    });
}

/**
 * Write an accepted draft.
 *
 * The run writes a new world info book and its cards, so everything a scoped
 * store holds may now be stale — characters, worlds, and the character queries
 * that key on an id which did not exist a moment ago.
 */
export function useAcceptDistill(id: string | null) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: DistillAcceptInput) => api.distill.runs.accept(id as string, input),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.characters });
            void queryClient.invalidateQueries({ queryKey: queryKeys.worlds });
            void queryClient.invalidateQueries({ queryKey: queryKeys.settings });
            void queryClient.invalidateQueries({ queryKey: queryKeys.distillRuns });
            void queryClient.invalidateQueries({ queryKey: queryKeys.distillRun(id) });
        },
    });
}
