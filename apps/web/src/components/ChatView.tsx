import type { CharacterSummary, ChatMessage, ChatSummary } from '@catcup/shared';
import { Menu, MessageSquarePlus, Plus, Settings2, Sparkles, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';

import { useChat, useDeleteMessage, useUpdateMessage } from '../hooks/data';
import { useGeneration } from '../hooks/useGeneration';
import { useAppStore } from '../store/app';
import { CharacterAvatar } from './CharacterAvatar';
import { Composer } from './Composer';
import { Logo } from './Logo';
import { MessageBubble, StreamingBubble } from './MessageBubble';
import { Spinner } from './Spinner';

interface ChatViewProps {
    character: CharacterSummary | null;
    personaName: string;
    chats: ChatSummary[];
    chatsLoading: boolean;
    selectedChatId: string | null;
    onSelectChat: (id: string) => void;
    onNewChat: () => void;
    creatingChat: boolean;
    onOpenSettings: () => void;
    onOpenSidebar: () => void;
    onOpenLibrary: () => void;
}

function findLastAssistantIndex(messages: ChatMessage[]): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && !message.is_user && !message.is_system) {
            return index;
        }
    }
    return -1;
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

function EmptyState({
    icon,
    title,
    description,
    action,
}: {
    icon: ReactNode;
    title: string;
    description: string;
    action?: ReactNode;
}) {
    return (
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-line bg-surface/60">
                {icon}
            </div>
            <h3 className="font-display text-xl text-parchment">{title}</h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
            {action ? <div className="mt-5">{action}</div> : null}
        </div>
    );
}

export function ChatView({
    character,
    personaName,
    chats,
    chatsLoading,
    selectedChatId,
    onSelectChat,
    onNewChat,
    creatingChat,
    onOpenSettings,
    onOpenSidebar,
    onOpenLibrary,
}: ChatViewProps) {
    const pushToast = useAppStore((state) => state.pushToast);
    const chatQuery = useChat(character?.id ?? null, selectedChatId);
    const updateMessageMutation = useUpdateMessage(character?.id ?? null, selectedChatId);
    const deleteMessageMutation = useDeleteMessage(character?.id ?? null, selectedChatId);

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

    const generation = useGeneration(character?.id ?? null, selectedChatId, () => scrollToBottom(true));

    const messages = chatQuery.data?.messages ?? [];
    const lastAssistantIndex = findLastAssistantIndex(messages);
    const lastMessage = messages[messages.length - 1];
    const hideLastAssistant =
        generation.streaming &&
        generation.action === 'regenerate' &&
        lastMessage !== undefined &&
        !lastMessage.is_user &&
        !lastMessage.is_system;
    const visibleMessages = hideLastAssistant ? messages.slice(0, -1) : messages;

    const optimisticMessage: ChatMessage | null = generation.optimisticUser
        ? {
              name: personaName,
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

    const handleSend = (text: string) => {
        if (!selectedChatId) {
            return;
        }
        void generation.start('send', text);
    };

    const handleRegenerate = () => {
        if (!selectedChatId) {
            return;
        }
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
        updateMessageMutation.mutate(
            { index, swipeId: next },
            { onError: (error) => pushToast(error.message, 'error') },
        );
    };

    const handleDelete = (index: number) => {
        if (!window.confirm('Delete this message? This cannot be undone.')) {
            return;
        }
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

    const actionsDisabled = generation.streaming || updateMessageMutation.isPending || deleteMessageMutation.isPending;

    const header = (
        <header className="flex shrink-0 items-center gap-3 border-b border-line-soft bg-ink/60 px-3 py-3 backdrop-blur md:px-6">
            <button
                type="button"
                className="icon-btn md:hidden"
                onClick={onOpenSidebar}
                aria-label="Open character library"
            >
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

                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onNewChat}
                        disabled={creatingChat}
                        title="New chat"
                        aria-label="New chat"
                    >
                        {creatingChat ? <Spinner size={16} /> : <Plus size={18} />}
                    </button>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onOpenSettings}
                        title="Settings"
                        aria-label="Settings"
                    >
                        <Settings2 size={18} />
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
                                    Open character library
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

                            {visibleMessages.map((message, index) => (
                                <MessageBubble
                                    key={`${message.send_date ?? 'message'}-${message.name}-${message.mes.length}-${message.mes.slice(0, 48)}`}
                                    message={message}
                                    index={index}
                                    characterName={character.name}
                                    avatarUrl={character.avatarUrl}
                                    isLastAssistant={index === lastAssistantIndex}
                                    disabled={actionsDisabled}
                                    onRegenerate={handleRegenerate}
                                    onDelete={() => handleDelete(index)}
                                    onCopy={() => handleCopy(message.mes)}
                                    onSwipe={(delta) => handleSwipe(index, delta)}
                                />
                            ))}

                            {optimisticMessage ? (
                                <MessageBubble
                                    message={optimisticMessage}
                                    index={messages.length}
                                    characterName={character.name}
                                    avatarUrl={character.avatarUrl}
                                    isLastAssistant={false}
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
                        </>
                    )}

                    <div className="h-1" />
                </div>
            </div>

            {generation.error ? (
                <div className="border-t border-wine/30 bg-wine/10 px-3 py-2 md:px-6">
                    <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 text-sm text-parchment">
                        <span className="min-w-0 flex-1 leading-relaxed">{generation.error}</span>
                        <button
                            type="button"
                            className="icon-btn size-7 shrink-0"
                            onClick={generation.clearError}
                            aria-label="Dismiss error"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            ) : null}

            <Composer
                placeholder={character ? `Message ${character.name}…` : 'Choose a character to begin'}
                disabled={!selectedChatId || !character}
                streaming={generation.streaming}
                onSend={handleSend}
                onStop={() => void generation.stop()}
            />
        </div>
    );
}
