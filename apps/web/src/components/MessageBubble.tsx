import type { ChatMessage } from '@catcup/shared';
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    GitBranch,
    ImagePlus,
    Pencil,
    RefreshCw,
    Square,
    Trash2,
    Volume2,
    X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { galleryImageUrl } from '../lib/api';
import { cn } from '../lib/cn';
import { formatMessageTime } from '../lib/format';
import { CharacterAvatar } from './CharacterAvatar';

export function MarkdownText({ text }: { text: string }) {
    return (
        <div className="message-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
                {text}
            </ReactMarkdown>
        </div>
    );
}

interface MessageBubbleProps {
    message: ChatMessage;
    index: number;
    characterName: string;
    avatarUrl: string | null;
    isLastAssistant: boolean;
    /**
     * Text after render-time regex scripts. The stored message is untouched, so
     * editing still edits what was persisted.
     */
    displayText?: string;
    displayReasoning?: string;
    disabled?: boolean;
    onRegenerate?: () => void;
    onDelete?: () => void;
    onCopy?: () => void;
    onSwipe?: (delta: number) => void;
    onEdit?: (text: string) => void;
    onBranch?: () => void;
    /** Stop playback when the inline editor opens. */
    onEditStart?: () => void;
    /** Present when TTS is enabled for this message. */
    onSpeak?: () => void;
    /** Whether this message is the one currently being spoken. */
    speaking?: boolean;
    /** Open the image lightbox for a media attachment. */
    onOpenImage?: (url: string, title?: string) => void;
    /** Present when image generation is enabled and this message can seed a prompt. */
    onIllustrate?: () => void;
}

interface MessageMedia {
    url: string;
    title?: string;
}

function readMedia(message: ChatMessage): MessageMedia[] {
    const raw = message.extra?.media;
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.flatMap((item) => {
        if (!item || typeof item !== 'object') {
            return [];
        }
        const record = item as Record<string, unknown>;
        if (record.type !== undefined && record.type !== 'image') {
            return [];
        }
        if (typeof record.url !== 'string' || !record.url) {
            return [];
        }
        return [
            {
                url: record.url,
                ...(typeof record.title === 'string' && record.title ? { title: record.title } : {}),
            },
        ];
    });
}

export function MessageBubble({
    message,
    index,
    characterName,
    avatarUrl,
    isLastAssistant,
    displayText,
    displayReasoning,
    disabled,
    onRegenerate,
    onDelete,
    onCopy,
    onSwipe,
    onEdit,
    onBranch,
    onEditStart,
    onSpeak,
    speaking,
    onOpenImage,
    onIllustrate,
}: MessageBubbleProps) {
    const isUser = Boolean(message.is_user);
    /** SillyTavern narrator messages carry this type but are not user messages. */
    const isNarrator = message.extra?.type === 'narrator';
    const reasoning = displayReasoning ?? (typeof message.extra?.reasoning === 'string' ? message.extra.reasoning : '');
    const shown = displayText ?? message.mes;
    const rawSwipes = message.extra?.swipes;
    const swipes = Array.isArray(rawSwipes)
        ? rawSwipes.filter((swipe): swipe is string => typeof swipe === 'string')
        : [];
    const swipeId = typeof message.extra?.swipe_id === 'number' ? message.extra.swipe_id : 0;
    const canSwipe = swipes.length > 1;

    const media = readMedia(message);
    const savedMediaIndex = typeof message.extra?.media_index === 'number' ? message.extra.media_index : 0;
    const [mediaIndex, setMediaIndex] = useState(savedMediaIndex);
    const inlineImage = message.extra?.inline_image === true;

    useEffect(() => {
        setMediaIndex(Math.min(Math.max(savedMediaIndex, 0), Math.max(media.length - 1, 0)));
    }, [savedMediaIndex, media.length]);

    const activeMedia = media[mediaIndex];

    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(message.mes);
    const editRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (editing) {
            editRef.current?.focus();
        }
    }, [editing]);

    const startEditing = () => {
        onEditStart?.();
        setDraft(message.mes);
        setEditing(true);
    };

    const saveEdit = () => {
        setEditing(false);
        if (draft !== message.mes) {
            onEdit?.(draft);
        }
    };

    return (
        <article
            className={cn('group animate-fade-up flex gap-3', isUser && 'flex-row-reverse')}
            data-message-index={index}
        >
            <CharacterAvatar
                name={isUser ? message.name || 'You' : isNarrator ? message.name || 'System' : characterName}
                src={isUser || isNarrator ? null : avatarUrl}
                size={38}
                className="mt-1"
            />

            <div
                className={cn(
                    'flex min-w-0 flex-col',
                    isUser ? 'max-w-[min(720px,84%)] items-end' : 'max-w-[min(760px,86%)] items-start',
                )}
            >
                <header className={cn('mb-1 flex items-center gap-2 px-1 text-xs', isUser && 'flex-row-reverse')}>
                    <span className="font-medium text-parchment-dim">
                        {message.name || (isUser ? 'You' : isNarrator ? 'System' : characterName)}
                    </span>
                    {message.send_date ? (
                        <span className="text-[10px] text-muted/60">{formatMessageTime(message.send_date)}</span>
                    ) : null}
                </header>

                {reasoning ? (
                    <details className="mb-2 w-full rounded-lg border border-line-soft bg-ink-soft/60 px-3 py-2 text-xs text-muted">
                        <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wider text-muted/80">
                            Reasoning
                        </summary>
                        <div className="mt-2 whitespace-pre-wrap leading-relaxed">{reasoning}</div>
                    </details>
                ) : null}

                {editing ? (
                    <div className="w-full rounded-2xl border border-amber/40 bg-ink-soft/80 px-3 py-2 shadow-sm">
                        <textarea
                            ref={editRef}
                            className="input-shell min-h-28 w-full resize-y text-[15px] leading-relaxed"
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Escape') {
                                    setEditing(false);
                                } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                    saveEdit();
                                }
                            }}
                            aria-label="Edit message"
                        />
                        <div className="mt-2 flex justify-end gap-2">
                            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                                <X size={14} />
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="btn-primary"
                                onClick={saveEdit}
                                disabled={disabled || draft === message.mes}
                            >
                                <Check size={14} />
                                Save
                            </button>
                        </div>
                    </div>
                ) : (
                    <div
                        className={cn(
                            'w-full rounded-2xl border px-4 py-3 text-[15px] shadow-sm',
                            isNarrator
                                ? 'border-line/50 bg-ink-soft/50 text-parchment-dim italic'
                                : isUser
                                  ? 'border-amber/20 bg-amber/10 text-parchment'
                                  : 'border-line/80 bg-surface/85 text-parchment',
                        )}
                    >
                        {shown.trim() ? (
                            <MarkdownText text={shown} />
                        ) : (
                            <span className="text-sm italic text-muted">Empty message</span>
                        )}

                        {activeMedia ? (
                            <div
                                className={cn(
                                    'relative mx-auto mt-3 overflow-hidden rounded-xl border border-line-soft bg-ink-soft/60',
                                    inlineImage ? 'w-full' : 'max-w-sm',
                                )}
                            >
                                <button
                                    type="button"
                                    className="block w-full"
                                    onClick={() => onOpenImage?.(activeMedia.url, activeMedia.title)}
                                    aria-label={activeMedia.title || 'Open image'}
                                >
                                    <img
                                        src={galleryImageUrl(activeMedia.url)}
                                        alt={activeMedia.title || 'Generated image'}
                                        className={cn(
                                            'w-full object-contain',
                                            inlineImage ? 'max-h-[480px]' : 'max-h-64',
                                        )}
                                        loading="lazy"
                                    />
                                </button>
                                {media.length > 1 ? (
                                    <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-2 py-1 text-xs text-white">
                                        <button
                                            type="button"
                                            className="icon-btn size-6 text-white"
                                            onClick={() => setMediaIndex((current) => Math.max(0, current - 1))}
                                            disabled={mediaIndex <= 0}
                                            aria-label="Previous image"
                                        >
                                            <ChevronLeft size={14} />
                                        </button>
                                        <span className="tabular-nums">
                                            {mediaIndex + 1}/{media.length}
                                        </span>
                                        <button
                                            type="button"
                                            className="icon-btn size-6 text-white"
                                            onClick={() =>
                                                setMediaIndex((current) => Math.min(media.length - 1, current + 1))
                                            }
                                            disabled={mediaIndex >= media.length - 1}
                                            aria-label="Next image"
                                        >
                                            <ChevronRight size={14} />
                                        </button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                )}

                {editing ? null : (
                    <footer
                        className={cn(
                            'mt-1 flex min-h-7 w-full items-center gap-1 px-1 text-muted transition md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
                            isUser && 'justify-end',
                        )}
                    >
                        {canSwipe ? (
                            <div className="mr-auto flex items-center gap-0.5 rounded-lg bg-surface/60 px-1 py-0.5">
                                <button
                                    type="button"
                                    className="icon-btn size-6"
                                    onClick={() => onSwipe?.(-1)}
                                    disabled={disabled || swipeId <= 0}
                                    aria-label="Previous swipe"
                                >
                                    <ChevronLeft size={14} />
                                </button>
                                <span className="min-w-8 text-center text-[10px] tabular-nums text-muted">
                                    {Math.min(swipeId + 1, swipes.length)}/{swipes.length}
                                </span>
                                <button
                                    type="button"
                                    className="icon-btn size-6"
                                    onClick={() => onSwipe?.(1)}
                                    disabled={disabled || swipeId >= swipes.length - 1}
                                    aria-label="Next swipe"
                                >
                                    <ChevronRight size={14} />
                                </button>
                            </div>
                        ) : null}

                        {onSpeak ? (
                            <button
                                type="button"
                                className="icon-btn size-7"
                                onClick={onSpeak}
                                title={speaking ? 'Stop voice' : 'Play voice'}
                                aria-label={speaking ? 'Stop voice' : 'Play voice'}
                            >
                                {speaking ? <Square size={13} fill="currentColor" /> : <Volume2 size={14} />}
                            </button>
                        ) : null}

                        {onIllustrate ? (
                            <button
                                type="button"
                                className="icon-btn size-7"
                                onClick={onIllustrate}
                                title="Illustrate this message"
                                aria-label="Illustrate this message"
                            >
                                <ImagePlus size={14} />
                            </button>
                        ) : null}

                        <button
                            type="button"
                            className="icon-btn size-7"
                            onClick={onCopy}
                            title="Copy message"
                            aria-label="Copy message"
                        >
                            <Copy size={14} />
                        </button>

                        {onEdit ? (
                            <button
                                type="button"
                                className="icon-btn size-7"
                                onClick={startEditing}
                                disabled={disabled}
                                title="Edit message"
                                aria-label="Edit message"
                            >
                                <Pencil size={14} />
                            </button>
                        ) : null}

                        {onBranch ? (
                            <button
                                type="button"
                                className="icon-btn size-7"
                                onClick={onBranch}
                                disabled={disabled}
                                title="Branch from here"
                                aria-label="Branch from here"
                            >
                                <GitBranch size={14} />
                            </button>
                        ) : null}

                        {isLastAssistant && onRegenerate ? (
                            <button
                                type="button"
                                className="icon-btn size-7"
                                onClick={onRegenerate}
                                disabled={disabled}
                                title="Regenerate"
                                aria-label="Regenerate reply"
                            >
                                <RefreshCw size={14} />
                            </button>
                        ) : null}

                        {onDelete ? (
                            <button
                                type="button"
                                className="icon-btn size-7 hover:text-wine"
                                onClick={onDelete}
                                disabled={disabled}
                                title="Delete message"
                                aria-label="Delete message"
                            >
                                <Trash2 size={14} />
                            </button>
                        ) : null}
                    </footer>
                )}
            </div>
        </article>
    );
}

interface StreamingBubbleProps {
    name: string;
    avatarUrl: string | null;
    text: string;
    reasoning: string;
    streaming: boolean;
}

export function StreamingBubble({ name, avatarUrl, text, reasoning, streaming }: StreamingBubbleProps) {
    return (
        <article className="animate-fade-up flex gap-3">
            <CharacterAvatar name={name} src={avatarUrl} size={38} className="mt-1" />
            <div className="flex min-w-0 max-w-[min(760px,86%)] flex-col items-start">
                <header className="mb-1 flex items-center gap-2 px-1 text-xs">
                    <span className="font-medium text-parchment-dim">{name}</span>
                    <span className="text-[10px] text-muted/60">{streaming ? 'writing…' : 'just now'}</span>
                </header>

                {reasoning ? (
                    <details
                        open
                        className="mb-2 w-full rounded-lg border border-line-soft bg-ink-soft/60 px-3 py-2 text-xs text-muted"
                    >
                        <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wider text-muted/80">
                            Reasoning
                        </summary>
                        <div className="mt-2 whitespace-pre-wrap leading-relaxed">{reasoning}</div>
                    </details>
                ) : null}

                <div className="w-full rounded-2xl border border-line/80 bg-surface/85 px-4 py-3 text-[15px] text-parchment shadow-sm">
                    {text ? <MarkdownText text={text} /> : <span className="text-muted">…</span>}
                    {streaming ? <span className="streaming-caret" /> : null}
                </div>
            </div>
        </article>
    );
}
