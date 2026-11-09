import type { ChatMessage } from '@catcup/shared';
import { ChevronLeft, ChevronRight, Copy, RefreshCw, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
    disabled?: boolean;
    onRegenerate?: () => void;
    onDelete?: () => void;
    onCopy?: () => void;
    onSwipe?: (delta: number) => void;
}

export function MessageBubble({
    message,
    index,
    characterName,
    avatarUrl,
    isLastAssistant,
    disabled,
    onRegenerate,
    onDelete,
    onCopy,
    onSwipe,
}: MessageBubbleProps) {
    const isUser = Boolean(message.is_user);
    const reasoning = typeof message.extra?.reasoning === 'string' ? message.extra.reasoning : '';
    const rawSwipes = message.extra?.swipes;
    const swipes = Array.isArray(rawSwipes)
        ? rawSwipes.filter((swipe): swipe is string => typeof swipe === 'string')
        : [];
    const swipeId = typeof message.extra?.swipe_id === 'number' ? message.extra.swipe_id : 0;
    const canSwipe = swipes.length > 1;

    return (
        <article
            className={cn('group animate-fade-up flex gap-3', isUser && 'flex-row-reverse')}
            data-message-index={index}
        >
            <CharacterAvatar
                name={isUser ? message.name || 'You' : characterName}
                src={isUser ? null : avatarUrl}
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
                        {message.name || (isUser ? 'You' : characterName)}
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

                <div
                    className={cn(
                        'w-full rounded-2xl border px-4 py-3 text-[15px] shadow-sm',
                        isUser
                            ? 'border-amber/20 bg-amber/10 text-parchment'
                            : 'border-line/80 bg-surface/85 text-parchment',
                    )}
                >
                    {message.mes.trim() ? (
                        <MarkdownText text={message.mes} />
                    ) : (
                        <span className="text-sm italic text-muted">Empty message</span>
                    )}
                </div>

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

                    <button
                        type="button"
                        className="icon-btn size-7"
                        onClick={onCopy}
                        title="Copy message"
                        aria-label="Copy message"
                    >
                        <Copy size={14} />
                    </button>

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
