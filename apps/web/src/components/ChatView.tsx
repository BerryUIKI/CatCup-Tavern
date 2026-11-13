import {
    applyRegexScripts,
    type CharacterDetail,
    type CharacterSummary,
    type ChatMessage,
    type ChatSummary,
    chatPersonaId,
    getLatestSummary,
    type Persona,
    prepareSpeechText,
    type QuickReplyAction,
    REGEX_PLACEMENT,
    regexPlacementForMessage,
    resolvePersona,
    substituteMacros,
} from '@catcup/shared';
import {
    Brain,
    Eye,
    ImagePlus,
    Images,
    Menu,
    MessageSquarePlus,
    Pencil,
    Play,
    Plus,
    Settings2,
    Sparkles,
    Trash2,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
    useBranchChat,
    useChat,
    useDeleteChat,
    useDeleteMessage,
    useRegexScripts,
    useRenameChat,
    useSetChatPersona,
    useSettings,
    useUpdateMessage,
} from '../hooks/data';
import { useGeneration } from '../hooks/useGeneration';
import type { ImageChatTarget } from '../hooks/useImages';
import { useImpersonation } from '../hooks/useImpersonation';
import { useTts } from '../hooks/useTts';
import { useAppStore } from '../store/app';
import { CharacterAvatar } from './CharacterAvatar';
import { Composer } from './Composer';
import { ContextInspector } from './ContextInspector';
import { EmptyState } from './EmptyState';
import { ImageGalleryDialog } from './ImageGalleryDialog';
import { ImageGenerationDialog } from './ImageGenerationDialog';
import { ImageLightbox, type LightboxImage } from './ImageLightbox';
import { Logo } from './Logo';
import { MemoryDialog } from './MemoryDialog';
import { MessageBubble, StreamingBubble } from './MessageBubble';
import { Modal } from './Modal';
import { QuickReplyBar } from './QuickReplyBar';
import { Spinner } from './Spinner';

interface ChatViewProps {
    character: CharacterSummary | null;
    /** Full card, for macros that refer to fields other than the name. */
    characterDetail: CharacterDetail | null;
    personas: Persona[];
    activePersonaId: string | null;
    chats: ChatSummary[];
    chatsLoading: boolean;
    selectedChatId: string | null;
    onSelectChat: (id: string) => void;
    onNewChat: () => void;
    onSwitchGreeting: () => void;
    creatingChat: boolean;
    onOpenSettings: () => void;
    onOpenSidebar: () => void;
    onOpenLibrary: () => void;
}

function findLastAssistantIndex(messages: ChatMessage[]): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && !message.is_user && !message.is_system && message.extra?.type !== 'narrator') {
            return index;
        }
    }
    return -1;
}

/** A cheap identity for "did the newest message change?" after a generation. */
function messageSignature(message: ChatMessage | undefined): string {
    return message ? `${message.send_date ?? ''}|${message.mes.length}|${message.mes.slice(-24)}` : '';
}

function subtitleFor(character: CharacterSummary): string {
    if (character.tags.length > 0) {
        return character.tags.slice(0, 3).join(' · ');
    }
    if (character.creator) {
        return `by ${character.creator}`;
    }
    if (character.spec === 'v3') {
        return 'Character card v3';
    }
    if (character.spec === 'v2') {
        return 'Character card v2';
    }
    return 'Character card';
}

export function ChatView({
    character,
    characterDetail,
    personas,
    activePersonaId,
    chats,
    chatsLoading,
    selectedChatId,
    onSelectChat,
    onNewChat,
    onSwitchGreeting,
    creatingChat,
    onOpenSettings,
    onOpenSidebar,
    onOpenLibrary,
}: ChatViewProps) {
    const pushToast = useAppStore((state) => state.pushToast);
    const chatQuery = useChat(character?.id ?? null, selectedChatId);
    const updateMessageMutation = useUpdateMessage(character?.id ?? null, selectedChatId);
    const deleteMessageMutation = useDeleteMessage(character?.id ?? null, selectedChatId);
    const renameChatMutation = useRenameChat(character?.id ?? null);
    const branchChatMutation = useBranchChat(character?.id ?? null);
    const deleteChatMutation = useDeleteChat(character?.id ?? null);
    // Render-time scripts (`markdownOnly`) transform the display only; the
    // stored message keeps its text, which is what editing edits.
    const regexScripts = useRegexScripts().data?.scripts ?? [];

    // A chat may pin its own persona; otherwise the account default applies.
    const pinnedPersonaId = chatPersonaId(chatQuery.data?.header.chat_metadata);
    const persona = resolvePersona({ personas, activePersonaId }, pinnedPersonaId);

    // Stored messages keep their raw macros, as SillyTavern does; the same
    // expansion the server applies to the prompt is applied here for display.
    const card = characterDetail?.card;
    const chatSummary = getLatestSummary(chatQuery.data?.messages ?? []);
    const macroContext = {
        char: card?.name || character?.name || '',
        user: persona.name,
        description: card?.description ?? '',
        personality: card?.personality ?? '',
        scenario: card?.scenario ?? '',
        ...(chatSummary ? { summary: chatSummary.value } : {}),
    };
    const display = (text: string, isUser: boolean, depth: number, isReasoning = false) =>
        substituteMacros(
            applyRegexScripts(
                regexScripts,
                text,
                isReasoning ? REGEX_PLACEMENT.REASONING : regexPlacementForMessage(isUser),
                { isMarkdown: true, depth },
            ),
            macroContext,
        );
    const setPersona = useSetChatPersona(character?.id ?? null);

    const handlePersonaChange = (personaId: string | null) => {
        if (!selectedChatId) {
            return;
        }
        setPersona.mutate(
            { chatId: selectedChatId, personaId },
            {
                onError: (error) => {
                    pushToast(error instanceof Error ? error.message : 'Could not change the persona.', 'error');
                },
            },
        );
    };

    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [inspectorOpen, setInspectorOpen] = useState(false);
    const [memoryOpen, setMemoryOpen] = useState(false);
    const [imageDialog, setImageDialog] = useState<{ messageIndex?: number } | null>(null);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
    const [draft, setDraft] = useState('');
    const [focusRequest, setFocusRequest] = useState(0);
    // A quick reply result arrives after a round trip; read the latest draft
    // instead of the one captured when the button was clicked.
    const draftRef = useRef(draft);
    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);

    // A quick reply can leave text in the box; switching chats starts fresh.
    // biome-ignore lint/correctness/useExhaustiveDependencies: only a different chat should clear the draft
    useEffect(() => {
        setDraft('');
        setImageDialog(null);
        setGalleryOpen(false);
    }, [selectedChatId]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: stop the old chat's audio on a chat switch
    useEffect(() => {
        tts.stop();
    }, [selectedChatId]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollToBottom = useCallback((smooth = false) => {
        const element = scrollRef.current;
        if (!element) {
            return;
        }
        element.scrollTo({
            top: element.scrollHeight,
            behavior: smooth ? 'smooth' : 'auto',
        });
    }, []);

    const generation = useGeneration(
        character?.id ? { kind: 'character', characterId: character.id } : null,
        selectedChatId,
        () => scrollToBottom(true),
    );
    const tts = useTts();
    const impersonation = useImpersonation({
        characterId: character?.id ?? null,
        chatId: selectedChatId,
        onDraft: setDraft,
    });
    // One strip for both kinds of generation failure, so a failed impersonation
    // is not silent.
    const composerError = impersonation.error ?? generation.error;
    const dismissComposerError = impersonation.error ? impersonation.clearError : generation.clearError;
    const imageEnabled = useSettings().data?.imageGeneration.enabled ?? false;
    const imageTarget: ImageChatTarget | null =
        character && selectedChatId
            ? { kind: 'character', id: character.id, chatId: selectedChatId, name: character.name }
            : null;

    const messages = chatQuery.data?.messages ?? [];
    const lastAssistantIndex = findLastAssistantIndex(messages);
    const lastMessage = messages[messages.length - 1];
    const hideLastAssistant =
        generation.streaming &&
        generation.action === 'regenerate' &&
        lastMessage !== undefined &&
        !lastMessage.is_user &&
        !lastMessage.is_system &&
        lastMessage.extra?.type !== 'narrator';
    const visibleMessages = hideLastAssistant ? messages.slice(0, -1) : messages;

    const optimisticMessage: ChatMessage | null = generation.optimisticUser
        ? {
              name: persona.name,
              is_user: true,
              mes: generation.optimisticUser,
              extra: {},
          }
        : null;

    // biome-ignore lint/correctness/useExhaustiveDependencies: switching chats should jump to the latest message
    useEffect(() => {
        scrollToBottom();
    }, [selectedChatId, scrollToBottom]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: streaming output intentionally re-triggers the scroll
    useEffect(() => {
        scrollToBottom();
    }, [
        messages.length,
        generation.optimisticUser,
        generation.assistantText,
        generation.reasoningText,
        generation.streaming,
        scrollToBottom,
    ]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: speak once per completed reply
    useEffect(() => {
        const reply = generation.lastReply;
        if (!reply || generation.replySequence === 0) {
            return;
        }
        if (!tts.enabled || !tts.autoplay) {
            return;
        }
        if (reply.extra?.stopped || reply.is_user || reply.is_system || reply.extra?.type === 'narrator') {
            return;
        }
        const text = prepareSpeechText(display(reply.mes, false, 0), {
            skipCodeBlocks: tts.settings?.skipCodeBlocks,
            stripTags: tts.settings?.stripTags,
            stripAsterisks: tts.settings?.stripAsterisks,
        });
        if (text) {
            void tts.speak(messageSignature(reply), text, tts.voiceFor(character?.id));
        }
    }, [generation.replySequence]);

    // The greeting picker replaces the first message in place, without a chat
    // switch; silence the old opening when that happens.
    // biome-ignore lint/correctness/useExhaustiveDependencies: only the first message's text matters here
    useEffect(() => {
        tts.stop();
    }, [messages[0]?.mes]);

    const handleSend = (text: string) => {
        if (!selectedChatId) {
            return;
        }
        tts.stop();
        void generation.start('send', text);
    };

    const handleQuickReplyInput = (action: Extract<QuickReplyAction, { type: 'input' }>) => {
        const current = draftRef.current;
        let text = action.text;
        if (action.inject) {
            text = action.placeBefore
                ? [action.text, current].filter(Boolean).join(' ')
                : [current, action.text].filter(Boolean).join(' ');
        }
        if (!action.submit) {
            setDraft(text);
            setFocusRequest((current) => current + 1);
            return;
        }
        const outgoing = text.trim();
        setDraft('');
        if (outgoing) {
            tts.stop();
            void generation.start('send', outgoing);
        }
    };

    const handleQuickReplyGenerate = (action: Extract<QuickReplyAction, { type: 'generate' }>) => {
        if (!selectedChatId) {
            return;
        }
        tts.stop();
        void generation.start(action.mode);
    };

    const handleSpeak = (index: number, message: ChatMessage) => {
        const key = messageSignature(message);
        if (tts.speakingKey === key) {
            tts.stop();
            return;
        }
        if (!tts.enabled || !character) {
            return;
        }
        const text = prepareSpeechText(display(message.mes, false, visibleMessages.length - index - 1), {
            skipCodeBlocks: tts.settings?.skipCodeBlocks,
            stripTags: tts.settings?.stripTags,
            stripAsterisks: tts.settings?.stripAsterisks,
        });
        if (!text) {
            pushToast('This message has nothing to speak.', 'info');
            return;
        }
        void tts.speak(key, text, tts.voiceFor(character.id, message.extra?.type === 'narrator'));
    };

    const handleRegenerate = () => {
        if (!selectedChatId) {
            return;
        }
        tts.stop();
        void generation.start('regenerate');
    };

    const handleSwipe = (index: number, delta: number) => {
        const message = messages[index];
        if (!message) {
            return;
        }
        const swipes = Array.isArray(message.extra?.swipes)
            ? message.extra.swipes.filter((swipe): swipe is string => typeof swipe === 'string')
            : [];
        const current = typeof message.extra?.swipe_id === 'number' ? message.extra.swipe_id : 0;
        const next = current + delta;
        if (next < 0 || next >= swipes.length) {
            return;
        }
        tts.stop();
        updateMessageMutation.mutate(
            { index, swipeId: next },
            { onError: (error) => pushToast(error.message, 'error') },
        );
    };

    const handleDelete = (index: number) => {
        if (!window.confirm('Delete this message? This cannot be undone.')) {
            return;
        }
        tts.stop();
        deleteMessageMutation.mutate(index, {
            onError: (error) => pushToast(error.message, 'error'),
        });
    };

    const handleCopy = (text: string) => {
        void navigator.clipboard
            .writeText(text)
            .then(() => pushToast('Copied to clipboard.', 'success'))
            .catch(() => pushToast('Could not copy the message.', 'error'));
    };

    const handleContinue = () => {
        if (!selectedChatId) {
            return;
        }
        tts.stop();
        void generation.start('continue');
    };

    const handleEditMessage = (index: number, text: string) => {
        tts.stop();
        updateMessageMutation.mutate(
            { index, message: text },
            { onError: (error) => pushToast(error.message, 'error') },
        );
    };

    const handleBranch = (index: number) => {
        if (!selectedChatId) {
            return;
        }
        branchChatMutation.mutate(
            { chatId: selectedChatId, index },
            {
                onSuccess: (chat) => {
                    onSelectChat(chat.chatId);
                    pushToast('Branch created.', 'success');
                },
                onError: (error) => pushToast(error.message, 'error'),
            },
        );
    };

    const handleOpenRename = () => {
        if (!selectedChatId) {
            return;
        }
        setRenameValue(selectedChatId);
        setRenameOpen(true);
    };

    const handleRename = () => {
        if (!selectedChatId || !renameValue.trim()) {
            return;
        }
        renameChatMutation.mutate(
            { chatId: selectedChatId, name: renameValue.trim() },
            {
                onSuccess: (chat) => {
                    setRenameOpen(false);
                    onSelectChat(chat.chatId);
                    pushToast('Chat renamed.', 'success');
                },
                onError: (error) => pushToast(error.message, 'error'),
            },
        );
    };

    const handleDeleteChat = () => {
        if (!selectedChatId) {
            return;
        }
        if (!window.confirm('Delete this chat? This cannot be undone.')) {
            return;
        }
        deleteChatMutation.mutate(selectedChatId, {
            onSuccess: () => pushToast('Chat deleted.', 'success'),
            onError: (error) => pushToast(error.message, 'error'),
        });
    };

    const actionsDisabled = generation.streaming || updateMessageMutation.isPending || deleteMessageMutation.isPending;

    const header = (
        <header className="flex shrink-0 items-center gap-3 border-b border-line-soft bg-ink/60 px-3 py-3 backdrop-blur md:px-6">
            <button type="button" className="icon-btn md:hidden" onClick={onOpenSidebar} aria-label="Open library">
                <Menu size={19} />
            </button>

            {character ? <CharacterAvatar name={character.name} src={character.avatarUrl} size={40} /> : null}

            <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-lg leading-tight text-parchment">
                    {character?.name ?? 'CatCup Tavern'}
                </h2>
                <p className="truncate text-xs text-muted">
                    {character ? subtitleFor(character) : 'Choose a character to begin'}
                </p>
            </div>

            {character ? (
                <div className="flex items-center gap-1.5">
                    <div className="relative hidden sm:block">
                        <select
                            value={selectedChatId ?? ''}
                            onChange={(event) => onSelectChat(event.target.value)}
                            disabled={chats.length === 0 || chatsLoading}
                            className="max-w-[190px] truncate rounded-lg border border-line bg-surface px-2.5 py-1.5 pr-7 text-xs text-parchment-dim outline-none transition focus:border-amber/50 disabled:opacity-60"
                            aria-label="Select chat"
                        >
                            {chats.length === 0 ? <option value="">No chats</option> : null}
                            {chats.map((chat) => (
                                <option key={chat.id} value={chat.id}>
                                    {chat.title}
                                </option>
                            ))}
                        </select>
                        {chatsLoading ? (
                            <span className="pointer-events-none absolute right-8 top-1/2 -translate-y-1/2">
                                <Spinner size={12} className="text-muted" />
                            </span>
                        ) : null}
                    </div>
                    {personas.length > 1 ? (
                        <select
                            className="max-w-[140px] rounded-lg border border-line bg-ink px-2 py-1.5 text-xs text-parchment-dim"
                            value={pinnedPersonaId ?? ''}
                            onChange={(event) => handlePersonaChange(event.target.value || null)}
                            disabled={!selectedChatId || setPersona.isPending}
                            title="Persona for this chat"
                            aria-label="Persona for this chat"
                        >
                            <option value="">
                                Default (
                                {personas.find((item) => item.id === activePersonaId)?.name ?? personas[0]?.name})
                            </option>
                            {personas.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {item.name}
                                </option>
                            ))}
                        </select>
                    ) : null}
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onNewChat}
                        disabled={creatingChat}
                        title="New chat"
                        aria-label="New chat"
                    >
                        {creatingChat ? <Spinner size={16} /> : <Plus size={18} />}
                    </button>{' '}
                    <div className="hidden items-center gap-1 sm:flex">
                        <button
                            type="button"
                            className="icon-btn"
                            onClick={onSwitchGreeting}
                            disabled={!selectedChatId}
                            title="Switch greeting"
                            aria-label="Switch greeting"
                        >
                            <Sparkles size={16} />
                        </button>
                        <button
                            type="button"
                            className="icon-btn"
                            onClick={handleOpenRename}
                            disabled={!selectedChatId}
                            title="Rename chat"
                            aria-label="Rename chat"
                        >
                            <Pencil size={16} />
                        </button>
                        <button
                            type="button"
                            className="icon-btn hover:text-wine"
                            onClick={handleDeleteChat}
                            disabled={!selectedChatId || deleteChatMutation.isPending}
                            title="Delete chat"
                            aria-label="Delete chat"
                        >
                            {deleteChatMutation.isPending ? <Spinner size={16} /> : <Trash2 size={16} />}
                        </button>
                    </div>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onOpenSettings}
                        title="Settings"
                        aria-label="Settings"
                    >
                        <Settings2 size={18} />
                    </button>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setImageDialog({})}
                        disabled={!selectedChatId || !imageEnabled}
                        title={imageEnabled ? 'Generate image' : 'Enable image generation in Settings'}
                        aria-label="Generate image"
                    >
                        <ImagePlus size={18} />
                    </button>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setGalleryOpen(true)}
                        disabled={!imageEnabled}
                        title={imageEnabled ? 'Image gallery' : 'Enable image generation in Settings'}
                        aria-label="Image gallery"
                    >
                        <Images size={18} />
                    </button>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setMemoryOpen(true)}
                        disabled={!selectedChatId || messages.length === 0}
                        title="Memory"
                        aria-label="Memory"
                    >
                        <Brain size={18} />
                    </button>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={() => setInspectorOpen(true)}
                        disabled={!selectedChatId}
                        title="Inspect context"
                        aria-label="Inspect context"
                    >
                        <Eye size={18} />
                    </button>
                </div>
            ) : null}
        </header>
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {header}

            <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-5 md:px-6">
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
                    {!character ? (
                        <EmptyState
                            icon={<Logo size={44} className="text-amber/80" />}
                            title="Pull up a chair"
                            description="Choose a character from the library, or import a PNG or JSON card to open the first door."
                            action={
                                <button type="button" className="btn-ghost" onClick={onOpenLibrary}>
                                    Open the library
                                </button>
                            }
                        />
                    ) : !selectedChatId ? (
                        <EmptyState
                            icon={<Sparkles size={34} className="text-amber/80" />}
                            title="The room is quiet"
                            description={
                                chatsLoading
                                    ? 'Looking for your conversations…'
                                    : `Start a new chat with ${character.name}.`
                            }
                            action={
                                <button
                                    type="button"
                                    className="btn-primary"
                                    onClick={onNewChat}
                                    disabled={creatingChat || chatsLoading}
                                >
                                    {creatingChat ? <Spinner size={16} /> : <MessageSquarePlus size={17} />}
                                    Start a new chat
                                </button>
                            }
                        />
                    ) : chatQuery.isLoading ? (
                        <div className="flex justify-center py-20">
                            <Spinner size={22} className="text-muted" />
                        </div>
                    ) : chatQuery.isError ? (
                        <EmptyState
                            icon={<X size={30} className="text-wine" />}
                            title="This chat could not be opened"
                            description={chatQuery.error instanceof Error ? chatQuery.error.message : 'Unknown error'}
                            action={
                                <button type="button" className="btn-ghost" onClick={() => void chatQuery.refetch()}>
                                    Try again
                                </button>
                            }
                        />
                    ) : (
                        <>
                            {visibleMessages.length === 0 && !generation.streaming && !optimisticMessage ? (
                                <EmptyState
                                    icon={<Sparkles size={30} className="text-amber/70" />}
                                    title="The first word is yours"
                                    description={`Say hello to ${character.name}. The story starts here.`}
                                />
                            ) : null}

                            {visibleMessages.map((message, index) => {
                                const depth = visibleMessages.length - index - 1;
                                return (
                                    <MessageBubble
                                        key={`${message.send_date ?? 'message'}-${message.name}-${message.mes.length}-${message.mes.slice(0, 48)}`}
                                        message={message}
                                        index={index}
                                        characterName={character.name}
                                        avatarUrl={character.avatarUrl}
                                        isLastAssistant={index === lastAssistantIndex}
                                        displayText={display(message.mes, Boolean(message.is_user), depth)}
                                        displayReasoning={
                                            typeof message.extra?.reasoning === 'string'
                                                ? display(message.extra.reasoning, false, depth, true)
                                                : ''
                                        }
                                        disabled={actionsDisabled}
                                        onRegenerate={handleRegenerate}
                                        onDelete={() => handleDelete(index)}
                                        onCopy={() => handleCopy(message.mes)}
                                        onSwipe={(delta) => handleSwipe(index, delta)}
                                        onEdit={(text) => handleEditMessage(index, text)}
                                        onEditStart={tts.stop}
                                        onBranch={() => handleBranch(index)}
                                        onOpenImage={(url, title) => setLightbox({ url, title })}
                                        onIllustrate={
                                            imageEnabled &&
                                            !message.is_user &&
                                            !message.is_system &&
                                            message.extra?.type !== 'narrator'
                                                ? () => setImageDialog({ messageIndex: index })
                                                : undefined
                                        }
                                        onSpeak={
                                            tts.enabled && !message.is_user && !message.is_system
                                                ? () => handleSpeak(index, message)
                                                : undefined
                                        }
                                        speaking={tts.speakingKey === messageSignature(message)}
                                    />
                                );
                            })}

                            {optimisticMessage ? (
                                <MessageBubble
                                    message={optimisticMessage}
                                    index={messages.length}
                                    characterName={character.name}
                                    avatarUrl={character.avatarUrl}
                                    isLastAssistant={false}
                                    displayText={display(optimisticMessage.mes, true, 0)}
                                    disabled
                                    onCopy={() => handleCopy(optimisticMessage.mes)}
                                />
                            ) : null}

                            {generation.streaming || generation.assistantText ? (
                                <StreamingBubble
                                    name={character.name}
                                    avatarUrl={character.avatarUrl}
                                    text={generation.assistantText}
                                    reasoning={generation.reasoningText}
                                    streaming={generation.streaming}
                                />
                            ) : null}

                            {lastMessage &&
                            !lastMessage.is_user &&
                            !lastMessage.is_system &&
                            lastMessage.extra?.type !== 'narrator' &&
                            !generation.streaming ? (
                                <div className="flex justify-center pt-1">
                                    <button
                                        type="button"
                                        className="btn-ghost"
                                        onClick={handleContinue}
                                        disabled={actionsDisabled}
                                        title="Continue the last reply"
                                    >
                                        <Play size={15} />
                                        Continue
                                    </button>
                                </div>
                            ) : null}
                        </>
                    )}

                    <div className="h-1" />
                </div>
            </div>

            {composerError ? (
                <div role="alert" className="border-t border-wine/30 bg-wine/10 px-3 py-2 md:px-6">
                    <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 text-sm text-parchment">
                        <span className="min-w-0 flex-1 leading-relaxed">{composerError}</span>
                        <button
                            type="button"
                            className="icon-btn size-7 shrink-0"
                            onClick={dismissComposerError}
                            aria-label="Dismiss error"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            ) : null}

            <QuickReplyBar
                target={
                    character && selectedChatId ? { kind: 'character', id: character.id, chatId: selectedChatId } : null
                }
                metadata={chatQuery.data?.header.chat_metadata}
                disabled={!selectedChatId || !character || generation.streaming}
                onInput={handleQuickReplyInput}
                onGenerate={handleQuickReplyGenerate}
            />

            <Composer
                placeholder={character ? `Message ${character.name}…` : 'Choose a character to begin'}
                disabled={!selectedChatId || !character || impersonation.streaming}
                streaming={generation.streaming || impersonation.streaming}
                value={draft}
                onChange={setDraft}
                focusRequest={focusRequest}
                onSend={handleSend}
                onStop={() => {
                    if (impersonation.streaming) {
                        impersonation.stop();
                    } else {
                        void generation.stop();
                    }
                }}
                onImpersonate={() => void impersonation.start()}
                impersonating={impersonation.streaming}
            />

            <ContextInspector
                open={inspectorOpen}
                onClose={() => setInspectorOpen(false)}
                characterId={character?.id ?? null}
                chatId={selectedChatId}
            />

            <MemoryDialog
                open={memoryOpen}
                onClose={() => setMemoryOpen(false)}
                target={
                    character && selectedChatId ? { kind: 'character', id: character.id, chatId: selectedChatId } : null
                }
                messages={messages}
                title={character?.name ?? 'Memory'}
            />

            {imageDialog && imageTarget ? (
                <ImageGenerationDialog
                    target={imageTarget}
                    messageIndex={imageDialog.messageIndex}
                    onClose={() => setImageDialog(null)}
                />
            ) : null}

            {imageTarget ? (
                <ImageGalleryDialog open={galleryOpen} onClose={() => setGalleryOpen(false)} target={imageTarget} />
            ) : null}

            <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />

            <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title="Rename chat">
                <div className="space-y-4 p-5">
                    <div>
                        <label className="label-text" htmlFor="chat-name">
                            Chat name
                        </label>
                        <input
                            id="chat-name"
                            className="input-shell"
                            value={renameValue}
                            onChange={(event) => setRenameValue(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    handleRename();
                                }
                            }}
                        />
                        <p className="mt-1 text-xs text-parchment-dim">
                            The chat is stored as a file, so renaming moves it. A name already in use gets a numeric
                            suffix.
                        </p>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" className="btn-ghost" onClick={() => setRenameOpen(false)}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={handleRename}
                            disabled={!renameValue.trim() || renameChatMutation.isPending}
                        >
                            {renameChatMutation.isPending ? <Spinner size={15} /> : null}
                            Rename
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}
