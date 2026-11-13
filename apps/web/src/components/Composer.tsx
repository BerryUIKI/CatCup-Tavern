import { Send, Square, UserRoundPen } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

interface ComposerProps {
    placeholder: string;
    disabled: boolean;
    streaming: boolean;
    /** Controlled so a quick reply can insert or replace the draft. */
    value: string;
    onChange: (value: string) => void;
    /** Bump to focus the box after a quick reply fills it. */
    focusRequest?: number;
    onSend: (text: string) => void;
    onStop: () => void;
    /** Ask the model to write the next message as the user, into this box. */
    onImpersonate?: () => void;
    /** True while that draft is streaming. */
    impersonating?: boolean;
}

export function Composer({
    placeholder,
    disabled,
    streaming,
    value,
    onChange,
    focusRequest,
    onSend,
    onStop,
    onImpersonate,
    impersonating = false,
}: ComposerProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (focusRequest) {
            textareaRef.current?.focus();
        }
    }, [focusRequest]);

    const send = () => {
        const text = value.trim();
        if (!text || disabled || streaming) {
            return;
        }
        onChange('');
        onSend(text);
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== 'Enter' || event.shiftKey) {
            return;
        }
        if (event.nativeEvent.isComposing) {
            return;
        }
        event.preventDefault();
        send();
    };

    return (
        <div className="shrink-0 border-t border-line-soft bg-ink/70 px-3 py-3 backdrop-blur md:px-6">
            <div className="mx-auto w-full max-w-4xl">
                <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface/85 p-2 shadow-lg shadow-black/25 transition focus-within:border-amber/50 focus-within:ring-2 focus-within:ring-amber/10">
                    <TextareaAutosize
                        ref={textareaRef}
                        value={value}
                        onChange={(event) => onChange(event.target.value)}
                        onKeyDown={handleKeyDown}
                        minRows={1}
                        maxRows={8}
                        placeholder={placeholder}
                        disabled={disabled}
                        className="max-h-56 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-parchment outline-none placeholder:text-muted/70 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Message"
                    />

                    {onImpersonate ? (
                        <button
                            type="button"
                            onClick={onImpersonate}
                            disabled={disabled || streaming}
                            className="icon-btn h-10 w-10 shrink-0"
                            title={impersonating ? 'Writing as you…' : 'Write the next message as me'}
                            aria-label="Write the next message as me"
                        >
                            <UserRoundPen size={16} />
                        </button>
                    ) : null}

                    {streaming ? (
                        <button
                            type="button"
                            onClick={onStop}
                            className="inline-flex h-10 items-center gap-2 rounded-xl bg-wine/80 px-3.5 text-sm font-medium text-parchment transition hover:bg-wine"
                        >
                            <Square size={14} fill="currentColor" />
                            Stop
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={send}
                            disabled={disabled || !value.trim()}
                            className="btn-primary h-10 px-3.5"
                        >
                            <Send size={16} />
                            Send
                        </button>
                    )}
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[11px] text-muted/60">
                    <span>Enter to send · Shift+Enter for a new line</span>
                    <span className="hidden sm:inline">Model output can be inaccurate. Characters are fictional.</span>
                </div>
            </div>
        </div>
    );
}
