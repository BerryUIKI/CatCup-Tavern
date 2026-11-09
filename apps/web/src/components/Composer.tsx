import { Send, Square } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';

interface ComposerProps {
    placeholder: string;
    disabled: boolean;
    streaming: boolean;
    onSend: (text: string) => void;
    onStop: () => void;
}

export function Composer({ placeholder, disabled, streaming, onSend, onStop }: ComposerProps) {
    const [value, setValue] = useState('');

    const send = () => {
        const text = value.trim();
        if (!text || disabled || streaming) {
            return;
        }
        setValue('');
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
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        onKeyDown={handleKeyDown}
                        minRows={1}
                        maxRows={8}
                        placeholder={placeholder}
                        disabled={disabled}
                        className="max-h-56 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-parchment outline-none placeholder:text-muted/70 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label="Message"
                    />

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
