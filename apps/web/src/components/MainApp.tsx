import type { CharacterSummary, ChatSummary } from '@catcup/shared';
import { useEffect, useState } from 'react';

import {
    useAddSampleCharacter,
    useCharacter,
    useCharacters,
    useChats,
    useCreateChat,
    useImportCharacters,
    useLogout,
    useSetChatGreeting,
    useSettings,
    useUpdateSettings,
} from '../hooks/data';
import { pluralize } from '../lib/format';
import { useAppStore } from '../store/app';
import { CharacterEditor } from './CharacterEditor';
import { ChatView } from './ChatView';
import { Modal } from './Modal';
import { SettingsDialog } from './SettingsDialog';
import { Sidebar } from './Sidebar';
import { SillyTavernImport } from './SillyTavernImport';
import { ToastViewport } from './Toast';

const EMPTY_CHARACTERS: CharacterSummary[] = [];
const EMPTY_CHATS: ChatSummary[] = [];

export function MainApp() {
    const selectedCharacterId = useAppStore((state) => state.selectedCharacterId);
    const selectedChatId = useAppStore((state) => state.selectedChatId);
    const selectCharacter = useAppStore((state) => state.selectCharacter);
    const selectChat = useAppStore((state) => state.selectChat);
    const settingsOpen = useAppStore((state) => state.settingsOpen);
    const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
    const sidebarOpen = useAppStore((state) => state.sidebarOpen);
    const setSidebarOpen = useAppStore((state) => state.setSidebarOpen);
    const pushToast = useAppStore((state) => state.pushToast);

    const charactersQuery = useCharacters();
    const settingsQuery = useSettings();
    const chatsQuery = useChats(selectedCharacterId);
    const characterQuery = useCharacter(selectedCharacterId);
    const importMutation = useImportCharacters();
    const addSampleMutation = useAddSampleCharacter();
    const updateSettingsMutation = useUpdateSettings();

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
    const createChatMutation = useCreateChat(selectedCharacterId);
    const setGreetingMutation = useSetChatGreeting(selectedCharacterId, selectedChatId);

    /** Switch the provider every chat uses, from the library footer. */
    const handleSwitchProvider = async (id: string) => {
        try {
            const provider = settings?.providers.find((item) => item.id === id);
            await updateSettingsMutation.mutateAsync({ activeProviderId: id });
            pushToast(`${provider?.name ?? 'Provider'} is now active.`, 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not switch the provider.', 'error');
        }
    };
    const logoutMutation = useLogout();
    const [greetingMode, setGreetingMode] = useState<'new' | 'switch' | null>(null);
    const [editingCharacterId, setEditingCharacterId] = useState<string | null>(null);
    const [stImportOpen, setStImportOpen] = useState(false);

    const characters = charactersQuery.data ?? EMPTY_CHARACTERS;
    const chats = chatsQuery.data ?? EMPTY_CHATS;
    const settings = settingsQuery.data;
    const selectedCharacter = characters.find((character) => character.id === selectedCharacterId) ?? null;

    const activeProvider =
        settings?.providers.find((provider) => provider.id === settings.activeProviderId) ??
        settings?.providers.find((provider) => provider.enabled) ??
        null;
    const activeProviderReady = activeProvider ? activeProvider.kind === 'ollama' || activeProvider.hasKey : false;

    useEffect(() => {
        if (!charactersQuery.isSuccess) {
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
    }, [characters, charactersQuery.isSuccess, selectedCharacterId, selectCharacter]);

    useEffect(() => {
        if (!selectedCharacterId || !chatsQuery.isSuccess) {
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
    }, [chats, chatsQuery.isSuccess, selectedCharacterId, selectedChatId, selectChat]);

    const handleImport = async (files: File[]) => {
        if (files.length === 0) {
            return;
        }
        try {
            const result = await importMutation.mutateAsync(files);
            if (result.imported.length > 0) {
                pushToast(`Imported ${pluralize(result.imported.length, 'character')}.`, 'success');
                const first = result.imported[0];
                if (first && !selectedCharacterId) {
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
                    aria-label="Close character library"
                />
            ) : null}

            <Sidebar
                characters={characters}
                loading={charactersQuery.isLoading}
                selectedCharacterId={selectedCharacterId}
                onSelect={selectCharacter}
                onEditCharacter={(id) => setEditingCharacterId(id)}
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
                onOpenSettings={() => setSettingsOpen(true)}
                onLogout={() => void handleLogout()}
                loggingOut={logoutMutation.isPending}
                open={sidebarOpen}
                onClose={() => setSidebarOpen(false)}
            />

            <main className="flex min-w-0 flex-1 flex-col">
                <ChatView
                    character={selectedCharacter}
                    personas={settings?.personas ?? []}
                    activePersonaId={settings?.activePersonaId ?? null}
                    chats={chats}
                    chatsLoading={chatsQuery.isLoading}
                    selectedChatId={selectedChatId}
                    onSelectChat={selectChat}
                    onNewChat={handleNewChat}
                    onSwitchGreeting={() => setGreetingMode('switch')}
                    creatingChat={createChatMutation.isPending}
                    onOpenSettings={() => setSettingsOpen(true)}
                    onOpenSidebar={() => setSidebarOpen(true)}
                    onOpenLibrary={() => setSidebarOpen(true)}
                />
            </main>

            <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

            <SillyTavernImport open={stImportOpen} onClose={() => setStImportOpen(false)} />

            <CharacterEditor characterId={editingCharacterId} onClose={() => setEditingCharacterId(null)} />

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
                                {greeting.text}
                            </p>
                        </button>
                    ))}
                </div>
            </Modal>

            <ToastViewport />
        </div>
    );
}
