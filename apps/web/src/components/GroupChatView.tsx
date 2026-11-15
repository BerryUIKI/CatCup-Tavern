import {
    applyRegexScripts,
    type ChatMessage,
    type ChatSummary,
    chatPersonaId,
    type GroupMember,
    type GroupView,
    getLatestSummary,
    type Persona,
    prepareSpeechText,
    type QuickReplyAction,
    REGEX_PLACEMENT,
    regexPlacementForMessage,
    resolveModel,
    resolvePersona,
    substituteMacros,
} from '@catcup/shared';
import {
    Brain,
    ImagePlus,
    Images,
    Menu,
    MessageSquarePlus,
    Pencil,
    Play,
    Plus,
    Trash2,
    TriangleAlert,
    Users,
    X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
    useDeleteGroupChat,
    useDeleteGroupMessage,
    useGroupChat,
    useRegexScripts,
    useRenameGroupChat,
    useSetCurrentGroupChat,
    useSetGroupChatPersona,
    useSettings,
    useUpdateGroupMessage,
} from '../hooks/data';
import { useGeneration } from '../hooks/useGeneration';
import type { ImageChatTarget } from '../hooks/useImages';
import { useTts } from '../hooks/useTts';
import { useAppStore } from '../store/app';
import { CharacterAvatar } from './CharacterAvatar';
import { Composer } from './Composer';
import { ConfirmDialog } from './ConfirmDialog';
import { EmptyState } from './EmptyState';
import { ImageGalleryDialog } from './ImageGalleryDialog';
import { ImageGenerationDialog } from './ImageGenerationDialog';
import { ImageLightbox, type LightboxImage } from './ImageLightbox';
import { MemoryDialog } from './MemoryDialog';
import { MessageBubble, StreamingBubble } from './MessageBubble';
import { Modal } from './Modal';
import { QuickReplyBar } from './QuickReplyBar';
import { Spinner } from './Spinner';
import { ToolsMenu, type ToolsMenuItem } from './ToolsMenu';

interface GroupChatViewProps {
    group: GroupView;
    personas: Persona[];
    activePersonaId: string | null;
    chats: ChatSummary[];
    chatsLoading: boolean;
    selectedChatId: string | null;
    creatingChat: boolean;
    onSelectChat: (id: string) => void;
    onNewChat: () => void;
    onOpenSidebar: () => void;
    /** Opens Settings; `providers` deep-links to the panel the header's pill names. */
    onOpenSettings: (section?: 'providers') => void;
    onEditGroup: () => void;
}

const ACTIVATION_LABELS = ['Natural order', 'List order', 'Manual', 'Pooled order'];

/** SillyTavern narrator messages are `is_system: false` but carry this type. */
function isNarrator(message: ChatMessage): boolean {
    return message.extra?.type === 'narrator';
}

function findLastAssistantIndex(messages: ChatMessage[]): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message && !message.is_user && !message.is_system && !isNarrator(message)) {
            return index;
        }
    }
    return -1;
}

/** A cheap identity for "did the newest message change?" after a generation. */
function messageSignature(message: ChatMessage | undefined): string {
    return message ? `${message.send_date ?? ''}|${message.mes.length}|${message.mes.slice(-24)}` : '';
}

export function GroupChatView({
    group,
    personas,
    activePersonaId,
    chats,
    chatsLoading,
    selectedChatId,
    creatingChat,
    onSelectChat,
    onNewChat,
    onOpenSidebar,
    onOpenSettings,
    onEditGroup,
}: GroupChatViewProps) {
    const pushToast = useAppStore((state) => state.pushToast);
    const chatQuery = useGroupChat(group.id, selectedChatId);
    const updateMessageMutation = useUpdateGroupMessage(group.id, selectedChatId);
    const deleteMessageMutation = useDeleteGroupMessage(group.id, selectedChatId);
    const renameChatMutation = useRenameGroupChat(group.id);
    const deleteChatMutation = useDeleteGroupChat(group.id);
    const setCurrentChatMutation = useSetCurrentGroupChat(group.id);
    const setPersona = useSetGroupChatPersona(group.id, selectedChatId);
    // Render-time scripts (`markdownOnly`) transform the display only.
    const regexScripts = useRegexScripts().data?.scripts ?? [];

    const memberByFile = useMemo(
        () => new Map<string, GroupMember>(group.memberDetails.map((member) => [member.fileName, member])),
        [group.memberDetails],
    );
    const enabledMembers = useMemo(
        () =>
            group.memberDetails.filter(
                (member) => member.id !== null && !group.disabled_members.includes(member.fileName),
            ),
        [group.memberDetails, group.disabled_members],
    );

    const pinnedPersonaId = chatPersonaId(chatQuery.data?.header.chat_metadata);
    const persona = resolvePersona({ personas, activePersonaId }, pinnedPersonaId);

    const [renameOpen, setRenameOpen] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [manualSpeaker, setManualSpeaker] = useState('');
    const [memoryOpen, setMemoryOpen] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<{ kind: 'message'; index: number } | { kind: 'chat' } | null>(
        null,
    );
    const [imageDialog, setImageDialog] = useState<{ messageIndex?: number } | null>(null);
    const [galleryOpen, setGalleryOpen] = useState(false);
    const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
    const [draft, setDraft] = useState('');
    const [focusRequest, setFocusRequest] = useState(0);
    /**
     * Auto mode: after a reply lands, wait `auto_mode_delay` seconds and ask
     * for the next member's reply, until it is switched off, the user types,
     * or the group runs out of members who may speak.
     */
    const [autoMode, setAutoMode] = useState(false);
    /** Why auto mode stopped itself, shown beside the toggle. */
    const [autoStopReason, setAutoStopReason] = useState<string | null>(null);
    // A quick reply result arrives after a round trip; read the latest draft
    // instead of the one captured when the button was clicked.
    const draftRef = useRef(draft);
    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);
    const chatSummary = getLatestSummary(chatQuery.data?.messages ?? []);

    // A quick reply can leave text in the box; switching chats starts fresh.
    // biome-ignore lint/correctness/useExhaustiveDependencies: only a different chat should clear the draft
    useEffect(() => {
        setDraft('');
        setImageDialog(null);
        setGalleryOpen(false);
        setAutoMode(false);
        setAutoStopReason(null);
    }, [selectedChatId]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: stop the old chat's audio on a chat switch
    useEffect(() => {
        tts.stop();
    }, [selectedChatId]);

    useEffect(() => {
        if (!enabledMembers.some((member) => member.fileName === manualSpeaker)) {
            setManualSpeaker(enabledMembers[0]?.fileName ?? '');
        }
    }, [enabledMembers, manualSpeaker]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollToBottom = useCallback((smooth = false) => {
        const element = scrollRef.current;
        if (!element) {
            return;
        }
        element.scrollTo({ top: element.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
    }, []);

    const generation = useGeneration({ kind: 'group', groupId: group.id }, selectedChatId, () => scrollToBottom(true));
    const tts = useTts();
    const settingsData = useSettings().data;
    const imageEnabled = settingsData?.imageGeneration.enabled ?? false;
    const imageTarget: ImageChatTarget | null = selectedChatId
        ? { kind: 'group', id: group.id, chatId: selectedChatId, name: group.name }
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
        !isNarrator(lastMessage);
    const visibleMessages = hideLastAssistant ? messages.slice(0, -1) : messages;

    const speakerOf = useCallback(
        (message: ChatMessage): GroupMember | null => {
            if (message.is_user) {
                return null;
            }
            const byAvatar = message.original_avatar ? memberByFile.get(message.original_avatar) : undefined;
            if (byAvatar) {
                return byAvatar;
            }
            return group.memberDetails.find((member) => member.name === message.name) ?? null;
        },
        [memberByFile, group.memberDetails],
    );

    /** The member whose card supplies macros for a message. */
    const contextMember = useCallback(
        (message: ChatMessage, index: number): GroupMember | null => {
            const direct = speakerOf(message);
            if (direct) {
                return direct;
            }
            // A user message refers to whichever character last spoke.
            for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
                const previous = messages[cursor];
                if (!previous) {
                    continue;
                }
                const member = speakerOf(previous);
                if (member) {
                    return member;
                }
            }
            return enabledMembers[0] ?? group.memberDetails[0] ?? null;
        },
        [speakerOf, messages, enabledMembers, group.memberDetails],
    );

    const display = (message: ChatMessage, index: number, text: string, isReasoning = false) => {
        const member = contextMember(message, index);
        const macroContext = {
            char: member?.name ?? '',
            user: persona.name,
            description: member?.description ?? '',
            personality: member?.personality ?? '',
            scenario: member?.scenario ?? '',
            group: group.memberDetails.map((entry) => entry.name),
            groupNotMuted: enabledMembers.map((entry) => entry.name),
            ...(chatSummary ? { summary: chatSummary.value } : {}),
        };
        return substituteMacros(
            applyRegexScripts(
                regexScripts,
                text,
                isReasoning ? REGEX_PLACEMENT.REASONING : regexPlacementForMessage(Boolean(message.is_user)),
                { isMarkdown: true, depth: messages.length - index - 1 },
            ),
            macroContext,
        );
    };

    const optimisticMessage: ChatMessage | null = generation.optimisticUser
        ? {
              name: persona.name,
              is_user: true,
              mes: generation.optimisticUser,
              extra: {},
          }
        : null;

    const streamingMember = generation.speaker
        ? {
              name: generation.speaker.name,
              avatarUrl: generation.speaker.avatarUrl,
          }
        : lastMessage
          ? speakerOf(lastMessage)
          : (enabledMembers[0] ?? null);
    const streamingName = streamingMember?.name ?? 'The group';
    const streamingAvatar = streamingMember?.avatarUrl ?? null;

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
        if (reply.extra?.stopped || reply.is_user || reply.is_system || isNarrator(reply)) {
            return;
        }
        const text = prepareSpeechText(display(reply, Math.max(0, messages.length - 1), reply.mes), {
            skipCodeBlocks: tts.settings?.skipCodeBlocks,
            stripTags: tts.settings?.stripTags,
            stripAsterisks: tts.settings?.stripAsterisks,
        });
        if (text) {
            void tts.speak(messageSignature(reply), text, tts.voiceFor(speakerOf(reply)?.id));
        }
    }, [generation.replySequence]);

    const handleSend = (text: string) => {
        if (!selectedChatId) {
            return;
        }
        // Typing is a request to speak; auto mode hands the turn back, as
        // SillyTavern's composer does.
        if (autoMode) {
            setAutoMode(false);
            setAutoStopReason(null);
        }
        tts.stop();
        void generation.start('send', text, group.activation_strategy === 2 ? manualSpeaker || undefined : undefined);
    };

    /**
     * Auto mode's next turn. SillyTavern asks for the following member's reply
     * after `auto_mode_delay` seconds; the server's activation strategy picks
     * who that is, exactly as a `/trigger` does.
     */
    const requestAutoReply = useCallback(() => {
        if (!selectedChatId) {
            setAutoMode(false);
            return;
        }
        void generation.start(
            'trigger',
            undefined,
            group.activation_strategy === 2 ? manualSpeaker || undefined : undefined,
        );
    }, [selectedChatId, generation, group.activation_strategy, manualSpeaker]);

    // A reply landing is the moment to schedule the next one. The delay is the
    // group's own `auto_mode_delay`, so a group configured in SillyTavern keeps
    // its pace here.
    // biome-ignore lint/correctness/useExhaustiveDependencies: one tick per completed reply
    useEffect(() => {
        if (!autoMode || generation.replySequence === 0 || generation.streaming) {
            return;
        }
        const reply = generation.lastReply;
        if (reply?.extra?.stopped) {
            setAutoMode(false);
            setAutoStopReason('Auto mode stopped when the reply was interrupted.');
            return;
        }
        const delay = Math.max(0, group.auto_mode_delay ?? 5);
        const timer = window.setTimeout(() => requestAutoReply(), delay * 1000);
        return () => window.clearTimeout(timer);
    }, [autoMode, generation.replySequence, generation.streaming, group.auto_mode_delay]);

    // Nothing to say when fewer than two members can speak: a group of one
    // would otherwise answer itself forever.
    const canAutoMode = enabledMembers.length > 1;

    const toggleAutoMode = () => {
        setAutoStopReason(null);
        setAutoMode((current) => !current);
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
            void generation.start(
                'send',
                outgoing,
                group.activation_strategy === 2 ? manualSpeaker || undefined : undefined,
            );
        }
    };

    const handleQuickReplyGenerate = (action: Extract<QuickReplyAction, { type: 'generate' }>) => {
        if (!selectedChatId) {
            return;
        }
        // `/trigger <member>` names a speaker; a manual group otherwise uses the
        // member picked in the studio strip.
        const speaker =
            action.mode === 'trigger'
                ? (action.speaker ?? (group.activation_strategy === 2 ? manualSpeaker || undefined : undefined))
                : undefined;
        tts.stop();
        void generation.start(action.mode, undefined, speaker);
    };

    const handleSpeak = (index: number, message: ChatMessage) => {
        const key = messageSignature(message);
        if (tts.speakingKey === key) {
            tts.stop();
            return;
        }
        if (!tts.enabled) {
            return;
        }
        const narrator = isNarrator(message);
        const text = prepareSpeechText(display(message, index, message.mes), {
            skipCodeBlocks: tts.settings?.skipCodeBlocks,
            stripTags: tts.settings?.stripTags,
            stripAsterisks: tts.settings?.stripAsterisks,
        });
        if (!text) {
            pushToast('This message has nothing to speak.', 'info');
            return;
        }
        void tts.speak(key, text, tts.voiceFor(narrator ? undefined : speakerOf(message)?.id, narrator));
    };

    const handleRegenerate = () => {
        if (!selectedChatId) {
            return;
        }
        tts.stop();
        void generation.start('regenerate');
    };

    const handleContinue = () => {
        if (!selectedChatId) {
            return;
        }
        tts.stop();
        void generation.start('continue');
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
        tts.stop();
        deleteMessageMutation.mutate(index, {
            onSuccess: () => setPendingDelete(null),
            onError: (error) => {
                setPendingDelete(null);
                pushToast(error.message, 'error');
            },
        });
    };

    const handleEditMessage = (index: number, text: string) => {
        tts.stop();
        updateMessageMutation.mutate(
            { index, message: text },
            { onError: (error) => pushToast(error.message, 'error') },
        );
    };

    const handleCopy = (text: string) => {
        void navigator.clipboard
            .writeText(text)
            .then(() => pushToast('Copied to clipboard.', 'success'))
            .catch(() => pushToast('Could not copy the message.', 'error'));
    };

    const handlePersonaChange = (personaId: string | null) => {
        if (!selectedChatId) {
            return;
        }
        setPersona.mutate(personaId, {
            onError: (error) => pushToast(error.message, 'error'),
        });
    };

    /** Open a chat and remember it as the group's `chat_id`, as ST does. */
    const handleSelectChat = (chatId: string) => {
        if (!chatId) {
            return;
        }
        onSelectChat(chatId);
        setCurrentChatMutation.mutate(chatId, {
            onError: (error) => pushToast(error.message, 'error'),
        });
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
                onSuccess: (result) => {
                    setRenameOpen(false);
                    handleSelectChat(result.chat.chatId);
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
        deleteChatMutation.mutate(selectedChatId, {
            onSuccess: () => {
                setPendingDelete(null);
                pushToast('Chat deleted.', 'success');
            },
            onError: (error) => {
                setPendingDelete(null);
                pushToast(error.message, 'error');
            },
        });
    };

    const actionsDisabled = generation.streaming || updateMessageMutation.isPending || deleteMessageMutation.isPending;

    const provider = settingsData?.providers.find((item) => item.id === settingsData.activeProviderId) ?? null;
    const providerReady = provider ? provider.kind === 'ollama' || provider.hasKey : false;
    // The model this chat will use: the character's own choice when the
    // provider serves it, otherwise the provider default. The streaming start
    // event reports the same value once a request is under way.
    const characterModel = generation.speaker?.model ?? '';
    const resolvedModel = provider ? resolveModel(provider, characterModel) : null;
    const shownModel = generation.model ?? resolvedModel?.model ?? '';
    const modelFallback =
        resolvedModel?.source === 'fallback' && resolvedModel.requested
            ? `${resolvedModel.requested} is not on this provider; using ${resolvedModel.model}.`
            : null;
    const disabledReason = !selectedChatId ? 'Start a chat first.' : undefined;

    const tools: ToolsMenuItem[] = [
        {
            id: 'rename',
            label: 'Rename chat',
            icon: Pencil,
            onSelect: handleOpenRename,
            disabled: !selectedChatId,
            ...(disabledReason ? { hint: disabledReason } : {}),
        },
        {
            id: 'memory',
            label: 'Memory',
            icon: Brain,
            onSelect: () => setMemoryOpen(true),
            disabled: !selectedChatId || messages.length === 0,
            hint: !selectedChatId ? disabledReason : 'This chat has no messages to summarize yet.',
        },
        {
            id: 'generate-image',
            label: 'Generate image',
            icon: ImagePlus,
            onSelect: () => setImageDialog({}),
            disabled: !selectedChatId || !imageEnabled,
            hint: 'Enable image generation in Settings → Images.',
        },
        {
            id: 'gallery',
            label: 'Image gallery',
            icon: Images,
            onSelect: () => setGalleryOpen(true),
            disabled: !imageEnabled,
            hint: 'Enable image generation in Settings → Images.',
        },
        {
            id: 'edit-group',
            label: 'Edit group',
            icon: Users,
            onSelect: onEditGroup,
        },
        {
            id: 'delete-chat',
            label: 'Delete chat',
            icon: Trash2,
            onSelect: () => setPendingDelete({ kind: 'chat' }),
            disabled: !selectedChatId || deleteChatMutation.isPending,
            ...(disabledReason ? { hint: disabledReason } : {}),
            danger: true,
            separate: true,
        },
    ];

    const header = (
        <header className="relative z-20 flex shrink-0 items-center gap-3 border-b border-line-soft bg-ink/60 px-3 py-3 backdrop-blur md:px-6">
            <button type="button" className="icon-btn md:hidden" onClick={onOpenSidebar} aria-label="Open library">
                <Menu size={19} />
            </button>

            <CharacterAvatar
                name={group.name}
                src={group.memberDetails.find((member) => member.avatarUrl)?.avatarUrl ?? null}
                size={40}
            />

            <div className="min-w-0 flex-1">
                <h2 className="truncate font-display text-lg leading-tight text-parchment">{group.name}</h2>
                <p className="truncate text-xs text-muted">
                    {enabledMembers.length === group.memberDetails.length
                        ? `${group.memberDetails.length} members`
                        : `${enabledMembers.length} of ${group.memberDetails.length} members`}
                    {' · '}
                    {ACTIVATION_LABELS[group.activation_strategy] ?? 'Natural order'}
                </p>
            </div>

            <div className="flex min-w-0 items-center justify-end gap-1.5">
                <select
                    value={selectedChatId ?? ''}
                    onChange={(event) => handleSelectChat(event.target.value)}
                    disabled={chats.length === 0 || chatsLoading}
                    className="max-w-[150px] truncate rounded-lg border border-line bg-surface px-2.5 py-1.5 pr-7 text-xs text-parchment-dim outline-none transition focus:border-amber/50 disabled:opacity-60 sm:max-w-[190px]"
                    aria-label="Select group chat"
                >
                    {chats.length === 0 ? <option value="">No chats</option> : null}
                    {chats.map((chat) => (
                        <option key={chat.id} value={chat.id}>
                            {chat.title}
                        </option>
                    ))}
                </select>

                {personas.length > 1 ? (
                    <select
                        className="hidden max-w-[140px] rounded-lg border border-line bg-ink px-2 py-1.5 text-xs text-parchment-dim sm:block"
                        value={pinnedPersonaId ?? ''}
                        onChange={(event) => handlePersonaChange(event.target.value || null)}
                        disabled={!selectedChatId || setPersona.isPending}
                        title="Persona for this chat"
                        aria-label="Persona for this chat"
                    >
                        <option value="">
                            Default ({personas.find((item) => item.id === activePersonaId)?.name ?? personas[0]?.name})
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
                    title="New group chat"
                    aria-label="New group chat"
                >
                    {creatingChat ? <Spinner size={16} /> : <Plus size={18} />}
                </button>

                {provider ? (
                    <button
                        type="button"
                        className="hidden max-w-[170px] items-center gap-1.5 rounded-lg border border-line/70 px-2.5 py-1.5 text-xs transition hover:border-amber/40 hover:text-parchment lg:flex"
                        onClick={() => onOpenSettings('providers')}
                        title={
                            providerReady
                                ? `${provider.name} is ready`
                                : `${provider.name} may need an API key. Open Settings → Providers.`
                        }
                    >
                        <span
                            className={
                                providerReady
                                    ? 'size-1.5 shrink-0 rounded-full bg-sage'
                                    : 'size-1.5 shrink-0 rounded-full bg-amber/80'
                            }
                            aria-hidden="true"
                        />
                        <span className="truncate text-parchment-dim">
                            {provider.name}
                            {shownModel ? ` · ${shownModel}` : ''}
                        </span>
                        {modelFallback ? (
                            <span className="shrink-0 text-amber" title={modelFallback}>
                                <TriangleAlert size={12} aria-hidden="true" />
                            </span>
                        ) : null}
                        <span className="sr-only">
                            {providerReady ? 'Active provider is ready' : 'Active provider may need a key'}
                            {modelFallback ? ` ${modelFallback}` : ''}
                        </span>
                    </button>
                ) : null}

                <ToolsMenu items={tools} />
            </div>
        </header>
    );

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {header}

            <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto px-3 py-5 md:px-6">
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
                    {!selectedChatId ? (
                        <EmptyState
                            icon={<Users size={34} className="text-amber/80" />}
                            title="The table is set"
                            description={
                                chatsLoading
                                    ? 'Looking for your group chats…'
                                    : 'Start a group chat and every member introduces themselves before you speak.'
                            }
                            action={
                                <button
                                    type="button"
                                    className="btn-primary"
                                    onClick={onNewChat}
                                    disabled={creatingChat || chatsLoading}
                                >
                                    {creatingChat ? <Spinner size={16} /> : <MessageSquarePlus size={17} />}
                                    Start a group chat
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
                            title="This group chat could not be opened"
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
                                    icon={<Users size={30} className="text-amber/70" />}
                                    title="Nobody has spoken yet"
                                    description="Say something, and the group will answer in turn."
                                />
                            ) : null}

                            {visibleMessages.map((message, index) => {
                                const member = speakerOf(message);
                                return (
                                    <MessageBubble
                                        key={`${message.send_date ?? 'message'}-${message.name}-${message.mes.length}-${message.mes.slice(0, 48)}`}
                                        message={message}
                                        index={index}
                                        characterName={member?.name ?? message.name}
                                        avatarUrl={member?.avatarUrl ?? null}
                                        isLastAssistant={index === lastAssistantIndex}
                                        displayText={display(message, index, message.mes)}
                                        displayReasoning={
                                            typeof message.extra?.reasoning === 'string'
                                                ? display(message, index, message.extra.reasoning, true)
                                                : ''
                                        }
                                        disabled={actionsDisabled}
                                        onRegenerate={enabledMembers.length > 0 ? handleRegenerate : undefined}
                                        onDelete={() => setPendingDelete({ kind: 'message', index })}
                                        onCopy={() => handleCopy(message.mes)}
                                        onSwipe={(delta) => handleSwipe(index, delta)}
                                        onEdit={(text) => handleEditMessage(index, text)}
                                        onEditStart={tts.stop}
                                        onOpenImage={(url, title) => setLightbox({ url, title })}
                                        onIllustrate={
                                            imageEnabled &&
                                            !message.is_user &&
                                            !message.is_system &&
                                            !isNarrator(message)
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
                                    characterName={persona.name}
                                    avatarUrl={null}
                                    isLastAssistant={false}
                                    displayText={display(optimisticMessage, messages.length, optimisticMessage.mes)}
                                    disabled
                                    onCopy={() => handleCopy(optimisticMessage.mes)}
                                />
                            ) : null}

                            {generation.speaker || generation.assistantText ? (
                                <StreamingBubble
                                    name={streamingName}
                                    avatarUrl={streamingAvatar}
                                    text={generation.assistantText}
                                    reasoning={generation.reasoningText}
                                    streaming={generation.streaming}
                                />
                            ) : null}

                            {lastMessage &&
                            !lastMessage.is_user &&
                            !lastMessage.is_system &&
                            !isNarrator(lastMessage) &&
                            !generation.streaming ? (
                                <div className="flex justify-center pt-1">
                                    <button
                                        type="button"
                                        className="btn-ghost"
                                        onClick={handleContinue}
                                        disabled={actionsDisabled || enabledMembers.length === 0}
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

            <QuickReplyBar
                target={selectedChatId ? { kind: 'group', id: group.id, chatId: selectedChatId } : null}
                metadata={chatQuery.data?.header.chat_metadata}
                disabled={!selectedChatId || enabledMembers.length === 0 || generation.streaming}
                onInput={handleQuickReplyInput}
                onGenerate={handleQuickReplyGenerate}
            />

            {group.activation_strategy === 2 || canAutoMode ? (
                <div className="bg-ink/70 px-3 pt-2 md:px-6">
                    <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2 text-xs text-muted">
                        {group.activation_strategy === 2 ? (
                            <>
                                <span>Reply as</span>
                                <select
                                    className="rounded-lg border border-line bg-ink px-2 py-1 text-xs text-parchment-dim"
                                    value={manualSpeaker}
                                    onChange={(event) => setManualSpeaker(event.target.value)}
                                    disabled={enabledMembers.length === 0}
                                    aria-label="Who replies next"
                                >
                                    {enabledMembers.map((member) => (
                                        <option key={member.fileName} value={member.fileName}>
                                            {member.name}
                                        </option>
                                    ))}
                                </select>
                                <span className="hidden text-muted sm:inline">
                                    Manual group: you choose who answers.
                                </span>
                            </>
                        ) : null}
                        {canAutoMode ? (
                            <label
                                className="ml-auto flex items-center gap-2"
                                title="Ask for the next member's reply a few seconds after each one finishes."
                            >
                                <input
                                    type="checkbox"
                                    className="size-3.5 accent-amber"
                                    checked={autoMode}
                                    onChange={toggleAutoMode}
                                    disabled={!selectedChatId || generation.streaming}
                                />
                                <span>Auto mode</span>
                                <span className="text-muted">{group.auto_mode_delay ?? 5}s</span>
                            </label>
                        ) : null}
                        {autoStopReason ? <span className="text-amber/80">{autoStopReason}</span> : null}
                    </div>
                </div>
            ) : null}

            <Composer
                placeholder={
                    enabledMembers.length === 0 && group.memberDetails.length > 0
                        ? 'All members are muted or missing their cards'
                        : `Message ${group.name}…`
                }
                disabled={!selectedChatId || enabledMembers.length === 0}
                streaming={generation.streaming}
                value={draft}
                onChange={setDraft}
                focusRequest={focusRequest}
                onSend={handleSend}
                onStop={() => void generation.stop()}
            />

            <MemoryDialog
                open={memoryOpen}
                onClose={() => setMemoryOpen(false)}
                target={selectedChatId ? { kind: 'group', id: group.id, chatId: selectedChatId } : null}
                messages={messages}
                title={group.name}
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

            <ConfirmDialog
                open={pendingDelete !== null}
                tone="danger"
                title={pendingDelete?.kind === 'chat' ? 'Delete this group chat?' : 'Delete this message?'}
                description={
                    pendingDelete?.kind === 'chat'
                        ? 'The group chat file is removed from disk. The group and its other chats are kept.'
                        : 'The message is removed from the group chat file. Messages after it move up one place.'
                }
                confirmLabel={pendingDelete?.kind === 'chat' ? 'Delete chat' : 'Delete message'}
                onCancel={() => setPendingDelete(null)}
                onConfirm={() => {
                    if (pendingDelete?.kind === 'chat') {
                        handleDeleteChat();
                    } else if (pendingDelete?.kind === 'message') {
                        handleDelete(pendingDelete.index);
                    }
                }}
                busy={deleteMessageMutation.isPending || deleteChatMutation.isPending}
            />

            <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title="Rename chat">
                <div className="space-y-4 p-5">
                    <div>
                        <label className="label-text" htmlFor="group-chat-name">
                            Chat name
                        </label>
                        <input
                            id="group-chat-name"
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
