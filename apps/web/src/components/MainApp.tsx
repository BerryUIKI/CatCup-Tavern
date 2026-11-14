import { type CharacterSummary, type ChatSummary, resolvePersona, substituteMacros } from '@catcup/shared';
import { useEffect, useRef, useState } from 'react';

import {
    useActivateProfile,
    useAddSampleCharacter,
    useBulkCharacters,
    useCharacter,
    useCharacters,
    useChats,
    useCreateChat,
    useCreateGroupChat,
    useGroupChats,
    useGroups,
    useImportCharacters,
    useLogout,
    useProfiles,
    useSetCharacterFavorite,
    useSetChatGreeting,
    useSettings,
    useShareItem,
    useUpdateSettings,
} from '../hooks/data';
import { pluralize } from '../lib/format';
import { useAppStore } from '../store/app';
import { CharacterEditor } from './CharacterEditor';
import { ChatView } from './ChatView';
import { GroupChatView } from './GroupChatView';
import { GroupEditor } from './GroupEditor';
import { Modal } from './Modal';
import { SettingsDialog } from './SettingsDialog';
import { Sidebar } from './Sidebar';
import { SillyTavernImport } from './SillyTavernImport';
import { ToastViewport } from './Toast';

const EMPTY_CHARACTERS: CharacterSummary[] = [];
const EMPTY_CHATS: ChatSummary[] = [];

type GroupEditorState = { mode: 'create' } | { mode: 'edit'; id: string } | null;

/** The card formats the server imports; a drop of anything else is refused. */
const CARD_FILE = /\.(png|json|charx|catcup)$/i;

export function MainApp() {
    const selectedCharacterId = useAppStore((state) => state.selectedCharacterId);
    const selectedGroupId = useAppStore((state) => state.selectedGroupId);
    const selectedChatId = useAppStore((state) => state.selectedChatId);
    const libraryTab = useAppStore((state) => state.libraryTab);
    const selectCharacter = useAppStore((state) => state.selectCharacter);
    const selectGroup = useAppStore((state) => state.selectGroup);
    const selectChat = useAppStore((state) => state.selectChat);
    const setLibraryTab = useAppStore((state) => state.setLibraryTab);
    const settingsOpen = useAppStore((state) => state.settingsOpen);
    const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
    const openSettings = useAppStore((state) => state.openSettings);
    const resetSelection = useAppStore((state) => state.resetSelection);
    const sidebarOpen = useAppStore((state) => state.sidebarOpen);
    const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
    const pushToast = useAppStore((state) => state.pushToast);

    const charactersQuery = useCharacters();
    const groupsQuery = useGroups();
    const settingsQuery = useSettings();
    const chatsQuery = useChats(selectedCharacterId);
    const groupChatsQuery = useGroupChats(selectedGroupId);
    const characterQuery = useCharacter(selectedCharacterId);
    const importMutation = useImportCharacters();
    const addSampleMutation = useAddSampleCharacter();
    const shareItem = useShareItem();
    const favoriteMutation = useSetCharacterFavorite();
    const bulkMutation = useBulkCharacters();
    const updateSettingsMutation = useUpdateSettings();
    const profilesQuery = useProfiles();
    const activateProfile = useActivateProfile();

    // A character and a group are mutually exclusive; the store enforces it.
    const [groupEditor, setGroupEditor] = useState<GroupEditorState>(null);
    const [greetingMode, setGreetingMode] = useState<'new' | 'switch' | null>(null);
    const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
    const [stImportOpen, setStImportOpen] = useState(false);

    const characters = charactersQuery.data ?? EMPTY_CHARACTERS;
    const groups = groupsQuery.data ?? [];
    const chats = chatsQuery.data ?? EMPTY_CHATS;
    const groupChats = groupChatsQuery.data ?? EMPTY_CHATS;
    const settings = settingsQuery.data;
    const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? null;
    const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
    const editingGroup =
        groupEditor?.mode === 'edit' ? (groups.find((group) => group.id === groupEditor.id) ?? null) : null;

    // The greeting picker has no chat yet, so it uses the account persona.
    const persona = resolvePersona({
        personas: settings?.personas ?? [],
        activePersonaId: settings?.activePersonaId ?? null,
    });
    const macroContext = characterQuery.data
        ? {
              char: characterQuery.data.card.name || characterQuery.data.name,
              user: persona.name,
              description: characterQuery.data.card.description,
              personality: characterQuery.data.card.personality,
              scenario: characterQuery.data.card.scenario,
          }
        : null;

    const activeProvider =
        settings?.providers.find((provider) => provider.id === settings.activeProviderId) ??
        settings?.providers.find((provider) => provider.enabled) ??
        null;
    const activeProviderReady = activeProvider ? activeProvider.kind === 'ollama' || activeProvider.hasKey : false;

    const createChatMutation = useCreateChat(selectedCharacterId);
    const createGroupChatMutation = useCreateGroupChat(selectedGroupId);
    const setGreetingMutation = useSetChatGreeting(selectedCharacterId, selectedChatId);

    useEffect(() => {
        // A selected group owns the main pane; do not pull a character back in.
        if (selectedGroupId || !charactersQuery.isSuccess) {
            return;
        }
        if (characters.length === 0) {
            if (selectedCharacterId) {
                selectCharacter(null);
            }
            return;
        }
        if (!selectedCharacterId || !characters.some((character) => character.id === selectedCharacterId)) {
            selectCharacter(characters[0]?.id ?? null);
        }
    }, [characters, charactersQuery.isSuccess, selectedCharacterId, selectCharacter, selectedGroupId]);

    useEffect(() => {
        if (selectedGroupId || !selectedCharacterId || !chatsQuery.isSuccess) {
            return;
        }
        if (chats.length === 0) {
            if (selectedChatId) {
                selectChat(null);
            }
            return;
        }
        if (!selectedChatId || !chats.some((chat) => chat.id === selectedChatId)) {
            selectChat(chats[0]?.id ?? null);
        }
    }, [chats, chatsQuery.isSuccess, selectedCharacterId, selectedChatId, selectChat, selectedGroupId]);

    // Open the group's last chat (SillyTavern stores it in `chat_id`), or the
    // most recently modified one when that chat is gone.
    useEffect(() => {
        if (!selectedGroupId || !groupChatsQuery.isSuccess) {
            return;
        }
        if (groupChats.length === 0) {
            if (selectedChatId) {
                selectChat(null);
            }
            return;
        }
        if (!selectedChatId || !groupChats.some((chat) => chat.id === selectedChatId)) {
            const remembered = selectedGroup?.chat_id;
            const preferred =
                remembered && groupChats.some((chat) => chat.id === remembered) ? remembered : groupChats[0]?.id;
            selectChat(preferred ?? null);
        }
    }, [groupChats, groupChatsQuery.isSuccess, selectedGroupId, selectedGroup?.chat_id, selectedChatId, selectChat]);

    // A deleted group must not stay selected. Wait out a refetch so a group
    // that was just created cannot be mistaken for one that vanished.
    useEffect(() => {
        if (!selectedGroupId || !groupsQuery.isSuccess || groupsQuery.isFetching) {
            return;
        }
        if (!groups.some((group) => group.id === selectedGroupId)) {
            selectGroup(null);
        }
    }, [groups, groupsQuery.isSuccess, groupsQuery.isFetching, selectedGroupId, selectGroup]);

    const handleAddSample = async () => {
        try {
            const result = await addSampleMutation.mutateAsync();
            selectCharacter(result.character.id);
            pushToast(
                result.created ? 'Added the sample character.' : 'The sample character is already in your library.',
                'success',
            );
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not add the sample character.', 'error');
        }
    };

    /**
     * Move a card between this profile and the shared scope.
     *
     * A move keeps the id, so chats and group memberships keep resolving; the
     * toast names where the card went, because the library row moves with it.
     */
    const handleShareCharacter = async (character: CharacterSummary, action: 'move' | 'copy') => {
        const target = character.scope === 'shared' ? 'profile' : 'shared';
        try {
            await shareItem.mutateAsync({ kind: 'characters', id: character.id, action, scope: target });
            pushToast(
                target === 'shared'
                    ? `"${character.name}" is now shared by every profile.`
                    : `"${character.name}" belongs to this profile again.`,
                'success',
            );
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not change where this card lives.', 'error');
        }
    };

    /** Switch the provider every chat uses, from the library footer. */
    const handleSwitchProvider = async (id: string) => {
        const provider = settings?.providers.find((item) => item.id === id);
        if (!provider) {
            pushToast('That provider no longer exists.', 'error');
            return;
        }
        if (!provider.enabled) {
            pushToast('Enable this provider before using it.', 'error');
            return;
        }
        try {
            await updateSettingsMutation.mutateAsync({ activeProviderId: id });
            pushToast(`${provider.name} is now active.`, 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not switch the provider.', 'error');
        }
    };
    const logoutMutation = useLogout();

    /**
     * Switch profiles. Every id on screen belongs to the old one, so the
     * selection is cleared before the refetch lands; the activate mutation
     * invalidates every query, which is what brings the new cast in.
     */
    const handleSwitchProfile = async (id: string) => {
        try {
            await activateProfile.mutateAsync(id);
            resetSelection();
            const name = profilesQuery.data?.profiles.find((profile) => profile.id === id)?.name ?? 'profile';
            pushToast(`Switched to ${name}.`, 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not switch the profile.', 'error');
        }
    };

    const handleImport = async (files: File[]) => {
        if (files.length === 0) {
            return;
        }
        try {
            const result = await importMutation.mutateAsync({ files });
            if (result.imported.length > 0) {
                pushToast(`Imported ${pluralize(result.imported.length, 'character')}.`, 'success');
                const first = result.imported[0];
                if (first && !selectedCharacterId && !selectedGroupId) {
                    selectCharacter(first.id);
                }
            }
            for (const error of result.errors) {
                pushToast(`${error.fileName}: ${error.message}`, 'error');
            }
            if (result.imported.length === 0 && result.errors.length === 0) {
                pushToast('No character files were found in the selection.', 'info');
            }
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Import failed.', 'error');
        }
    };

    // Dropping a card anywhere in the app imports it, like the library button.
    // The depth counter keeps the overlay from flickering as the pointer moves
    // between child elements.
    const [dragging, setDragging] = useState(false);
    const importRef = useRef(handleImport);
    importRef.current = handleImport;

    useEffect(() => {
        let depth = 0;

        const carriesFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

        const onDragEnter = (event: DragEvent) => {
            if (!carriesFiles(event)) {
                return;
            }
            event.preventDefault();
            depth += 1;
            setDragging(true);
        };

        const onDragOver = (event: DragEvent) => {
            if (!carriesFiles(event)) {
                return;
            }
            // Without this the browser opens the file instead of firing `drop`.
            event.preventDefault();
        };

        const onDragLeave = (event: DragEvent) => {
            if (!carriesFiles(event)) {
                return;
            }
            depth = Math.max(0, depth - 1);
            if (depth === 0) {
                setDragging(false);
            }
        };

        const onDrop = (event: DragEvent) => {
            if (!carriesFiles(event)) {
                return;
            }
            event.preventDefault();
            depth = 0;
            setDragging(false);

            const cards = Array.from(event.dataTransfer?.files ?? []).filter((file) => CARD_FILE.test(file.name));
            if (cards.length === 0) {
                pushToast('Drop a .png, .json, .charx or .catcup character card.', 'info');
                return;
            }
            void importRef.current(cards);
        };

        window.addEventListener('dragenter', onDragEnter);
        window.addEventListener('dragover', onDragOver);
        window.addEventListener('dragleave', onDragLeave);
        window.addEventListener('drop', onDrop);
        return () => {
            window.removeEventListener('dragenter', onDragEnter);
            window.removeEventListener('dragover', onDragOver);
            window.removeEventListener('dragleave', onDragLeave);
            window.removeEventListener('drop', onDrop);
        };
    }, [pushToast]);

    const handleBulkErrors = (errors: Array<{ message: string }>) => {
        if (errors.length === 0) {
            return;
        }
        pushToast(
            `${pluralize(errors.length, 'character')} could not be updated: ${errors[0]?.message ?? 'unknown error'}`,
            'warning',
        );
    };

    const handleToggleFavorite = (character: CharacterSummary) => {
        favoriteMutation.mutate(
            { id: character.id, favorite: !character.fav },
            {
                onSuccess: () =>
                    pushToast(
                        character.fav
                            ? `Removed "${character.name}" from favorites.`
                            : `Added "${character.name}" to favorites.`,
                        'success',
                    ),
                onError: (error) => pushToast(error.message, 'error'),
            },
        );
    };

    const handleBulkFavorite = (ids: string[], favorite: boolean) => {
        bulkMutation.mutate(
            { action: favorite ? 'favorite' : 'unfavorite', ids },
            {
                onSuccess: (result) => {
                    if (result.characters.length > 0) {
                        pushToast(
                            `${favorite ? 'Added' : 'Removed'} ${pluralize(result.characters.length, 'character')} ${favorite ? 'to' : 'from'} favorites.`,
                            'success',
                        );
                    }
                    handleBulkErrors(result.errors);
                },
                onError: (error) => pushToast(error.message, 'error'),
            },
        );
    };

    const handleBulkTag = (ids: string[], mode: 'add' | 'remove', tag: string) => {
        bulkMutation.mutate(
            { action: mode === 'add' ? 'add-tags' : 'remove-tags', ids, tags: [tag] },
            {
                onSuccess: (result) => {
                    if (result.characters.length > 0) {
                        pushToast(
                            `${mode === 'add' ? 'Added' : 'Removed'} the tag "${tag}" ${mode === 'add' ? 'to' : 'from'} ${pluralize(result.characters.length, 'character')}.`,
                            'success',
                        );
                    }
                    handleBulkErrors(result.errors);
                },
                onError: (error) => pushToast(error.message, 'error'),
            },
        );
    };

    const handleBulkDelete = (ids: string[]) => {
        bulkMutation.mutate(
            { action: 'delete', ids },
            {
                onSuccess: (result) => {
                    if (result.deleted.length > 0) {
                        pushToast(`Deleted ${pluralize(result.deleted.length, 'character')}.`, 'success');
                    }
                    handleBulkErrors(result.errors);
                },
                onError: (error) => pushToast(error.message, 'error'),
            },
        );
    };

    const handleCreateChat = async (greetingIndex?: number) => {
        if (!selectedCharacterId) {
            return;
        }
        try {
            const chat = await createChatMutation.mutateAsync(
                greetingIndex === undefined ? undefined : { greetingIndex },
            );
            selectChat(chat.chatId);
            setGreetingMode(null);
            pushToast('New chat started.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not create a chat.', 'error');
        }
    };

    const handleSwitchGreeting = async (greetingIndex: number) => {
        try {
            await setGreetingMutation.mutateAsync(greetingIndex);
            setGreetingMode(null);
            pushToast('Greeting switched.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not switch the greeting.', 'error');
        }
    };

    const greetings = characterQuery.data
        ? [
              { index: 0, text: characterQuery.data.card.first_mes },
              ...characterQuery.data.card.alternate_greetings.map((text, index) => ({ index: index + 1, text })),
          ].filter((greeting) => greeting.text.trim().length > 0)
        : [];

    const handleNewChat = () => {
        if (!selectedCharacterId) {
            return;
        }
        // Only interrupt with a picker when there is something to choose.
        if (greetings.length > 1) {
            setGreetingMode('new');
            return;
        }
        void handleCreateChat();
    };

    const handleNewGroupChat = async () => {
        if (!selectedGroupId) {
            return;
        }
        const groupId = selectedGroupId;
        try {
            const { chat } = await createGroupChatMutation.mutateAsync(undefined);
            // The user may have switched away while the greetings were seeded.
            if (useAppStore.getState().selectedGroupId === groupId) {
                selectChat(chat.chatId);
            }
            pushToast('New group chat started.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not create a group chat.', 'error');
        }
    };

    /**
     * Creating a group also opens its first chat: the server seeds one greeting
     * from each member, so the group is ready to talk to immediately. Editing
     * the selected group keeps the chat the user is reading.
     */
    const handleGroupSaved = async (group: { id: string }, created: boolean) => {
        if (!created) {
            if (selectedGroupId !== group.id) {
                selectGroup(group.id);
            }
            return;
        }

        selectGroup(group.id);
        try {
            const { chat } = await createGroupChatMutation.mutateAsync({ groupId: group.id });
            // Do not move a different view onto the new group's chat.
            if (useAppStore.getState().selectedGroupId === group.id) {
                selectChat(chat.chatId);
            }
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not start the first group chat.', 'error');
        }
    };

    const handleLogout = async () => {
        try {
            await logoutMutation.mutateAsync();
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Sign out failed.', 'error');
        }
    };

    return (
        <div className="flex h-dvh overflow-hidden">
            {sidebarOpen ? (
                <button
                    type="button"
                    className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[2px] md:hidden"
                    onClick={() => setSidebarOpen(false)}
                    aria-label="Close library"
                />
            ) : null}

            <Sidebar
                characters={characters}
                loading={charactersQuery.isLoading}
                selectedCharacterId={selectedCharacterId}
                onSelect={selectCharacter}
                onEditCharacter={(id) => setEditingCharacterId(id)}
                onToggleFavorite={handleToggleFavorite}
                onBulkFavorite={handleBulkFavorite}
                onBulkTag={handleBulkTag}
                onBulkDelete={handleBulkDelete}
                libraryBusy={favoriteMutation.isPending || bulkMutation.isPending}
                groups={groups}
                groupsLoading={groupsQuery.isLoading}
                selectedGroupId={selectedGroupId}
                libraryTab={libraryTab}
                onSelectLibraryTab={setLibraryTab}
                onSelectGroup={selectGroup}
                onNewGroup={() => setGroupEditor({ mode: 'create' })}
                onEditGroup={(id) => setGroupEditor({ mode: 'edit', id })}
                onImportSillyTavern={() => setStImportOpen(true)}
                onAddSample={() => handleAddSample()}
                addingSample={addSampleMutation.isPending}
                onImport={(files) => void handleImport(files)}
                importing={importMutation.isPending}
                providers={settings?.providers ?? []}
                activeProviderId={activeProvider?.id ?? null}
                onSwitchProvider={(id) => void handleSwitchProvider(id)}
                activeProviderName={activeProvider?.name ?? null}
                activeProviderReady={activeProviderReady}
                profiles={profilesQuery.data?.profiles ?? []}
                activeProfileId={profilesQuery.data?.activeProfileId ?? null}
                switchingProfile={activateProfile.isPending}
                onShareCharacter={(character, action) => void handleShareCharacter(character, action)}
                onSwitchProfile={(id) => void handleSwitchProfile(id)}
                onManageProfiles={() => openSettings('profiles')}
                onOpenSettings={() => openSettings()}
                onLogout={() => void handleLogout()}
                loggingOut={logoutMutation.isPending}
                open={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />

            <main className="flex min-w-0 flex-1 flex-col">
                {selectedGroup ? (
                    <GroupChatView
                        group={selectedGroup}
                        personas={settings?.personas ?? []}
                        activePersonaId={settings?.activePersonaId ?? null}
                        chats={groupChats}
                        chatsLoading={groupChatsQuery.isLoading}
                        selectedChatId={selectedChatId}
                        creatingChat={createGroupChatMutation.isPending}
                        onSelectChat={selectChat}
                        onNewChat={() => void handleNewGroupChat()}
                        onOpenSidebar={() => setSidebarOpen(true)}
                        onOpenSettings={(section) => openSettings(section)}
                        onEditGroup={() => setGroupEditor({ mode: 'edit', id: selectedGroup.id })}
                    />
                ) : (
                    <ChatView
                        character={selectedCharacter}
                        characterDetail={characterQuery.data ?? null}
                        personas={settings?.personas ?? []}
                        activePersonaId={settings?.activePersonaId ?? null}
                        chats={chats}
                        chatsLoading={chatsQuery.isLoading}
                        selectedChatId={selectedChatId}
                        onSelectChat={selectChat}
                        onNewChat={handleNewChat}
                        onSwitchGreeting={() => setGreetingMode('switch')}
                        creatingChat={createChatMutation.isPending}
                        onOpenSettings={(section) => openSettings(section)}
                        onOpenSidebar={() => setSidebarOpen(true)}
                        onOpenLibrary={() => setSidebarOpen(true)}
                    />
                )}
            </main>

            <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

            <SillyTavernImport open={stImportOpen} onClose={() => setStImportOpen(false)} />

            <CharacterEditor characterId={editingCharacterId} onClose={() => setEditingCharacterId(null)} />

            <GroupEditor
                open={groupEditor !== null}
                group={editingGroup}
                characters={characters}
                onClose={() => setGroupEditor(null)}
                onSaved={(group, created) => void handleGroupSaved(group, created)}
                onDeleted={(id) => {
                    if (selectedGroupId === id) {
                        selectGroup(null);
                    }
                }}
            />

            <Modal
                open={greetingMode !== null}
                onClose={() => setGreetingMode(null)}
                title={greetingMode === 'switch' ? 'Switch greeting' : 'Start a new chat'}
                widthClassName="max-w-2xl"
            >
                <div className="max-h-[70vh] space-y-2 overflow-y-auto p-5">
                    <p className="text-sm leading-relaxed text-muted">
                        {greetingMode === 'switch'
                            ? 'Replace the opening message. The rest of the conversation is kept.'
                            : 'Choose the greeting this chat opens with. Alternate greetings come from the character card.'}
                    </p>
                    {greetings.map((greeting) => (
                        <button
                            key={greeting.index}
                            type="button"
                            className="w-full rounded-xl border border-line bg-surface/60 p-3 text-left transition hover:border-amber/40"
                            onClick={() =>
                                void (greetingMode === 'switch'
                                    ? handleSwitchGreeting(greeting.index)
                                    : handleCreateChat(greeting.index))
                            }
                            disabled={createChatMutation.isPending || setGreetingMutation.isPending}
                        >
                            <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">
                                {greeting.index === 0 ? 'First message' : `Alternate greeting ${greeting.index}`}
                            </div>
                            <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-parchment-dim">
                                {macroContext ? substituteMacros(greeting.text, macroContext) : greeting.text}
                            </p>
                        </button>
                    ))}
                </div>
            </Modal>

            {dragging ? (
                <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
                    <div className="rounded-2xl border-2 border-dashed border-amber/60 px-10 py-8 text-center">
                        <p className="font-display text-lg text-parchment">Drop a character card</p>
                        <p className="mt-1 text-sm text-muted">PNG, JSON, CharX or CatCup package</p>
                    </div>
                </div>
            ) : null}

            <ToastViewport />
        </div>
    );
}
