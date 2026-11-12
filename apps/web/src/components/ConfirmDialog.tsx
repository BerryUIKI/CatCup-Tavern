import { AlertTriangle } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn';
import { isTopFocusLayer, pushFocusLayer, trapTab } from '../lib/focus';

interface ConfirmDialogProps {
    open: boolean;
    title: string;
    description?: ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    /** Optional middle action, e.g. "Discard changes". Requires `onAlternate`. */
    alternateLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    onAlternate?: () => void;
    tone?: 'default' | 'danger';
    busy?: boolean;
    /** Which action receives focus when the dialog opens. Defaults to Cancel. */
    initialFocus?: 'confirm' | 'cancel' | 'alternate';
}

/**
 * A small confirmation layer that can sit above an open Modal.
 *
 * Escape and Tab are handled in the capture phase and stopped there, so the
 * Settings dialog underneath does not also close or move focus.
 */
export function ConfirmDialog({
    open,
    title,
    description,
    confirmLabel,
    cancelLabel = 'Cancel',
    alternateLabel,
    onConfirm,
    onCancel,
    onAlternate,
    tone = 'default',
    busy = false,
    initialFocus = 'cancel',
}: ConfirmDialogProps) {
    const titleId = useId();
    const descriptionId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const confirmRef = useRef<HTMLButtonElement>(null);
    const cancelRef = useRef<HTMLButtonElement>(null);
    const alternateRef = useRef<HTMLButtonElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const callbacksRef = useRef({ onConfirm, onCancel, onAlternate, busy });

    useEffect(() => {
        callbacksRef.current = { onConfirm, onCancel, onAlternate, busy };
    }, [onConfirm, onCancel, onAlternate, busy]);

    useEffect(() => {
        if (!open) {
            return;
        }

        restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        const target =
            initialFocus === 'confirm'
                ? confirmRef.current
                : initialFocus === 'alternate'
                  ? alternateRef.current
                  : cancelRef.current;
        target?.focus({ preventScroll: true });
        const releaseLayer = panelRef.current ? pushFocusLayer(panelRef.current) : () => {};

        const onKeyDown = (event: KeyboardEvent) => {
            const panel = panelRef.current;
            if (panel && !isTopFocusLayer(panel)) {
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                if (!callbacksRef.current.busy) {
                    callbacksRef.current.onCancel();
                }
                return;
            }

            if (event.key === 'Tab' && panel) {
                trapTab(event, panel);
                event.stopPropagation();
            }
        };

        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('keydown', onKeyDown, true);
            releaseLayer();
            const previous = restoreFocusRef.current;
            if (previous?.isConnected) {
                previous.focus({ preventScroll: true });
            }
            restoreFocusRef.current = null;
        };
    }, [open, initialFocus]);

    if (!open) {
        return null;
    }

    const cancelAndRestore = () => {
        if (!busy) {
            onCancel();
        }
    };

    return createPortal(
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/75 backdrop-blur-sm"
                onClick={cancelAndRestore}
                aria-hidden="true"
            />
            <div
                ref={panelRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={description ? descriptionId : undefined}
                tabIndex={-1}
                className="animate-fade-up relative z-10 w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-2xl shadow-black/40 outline-none sm:p-6"
            >
                <div className="flex items-start gap-3">
                    {tone === 'danger' ? (
                        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-wine/15 text-wine">
                            <AlertTriangle size={18} />
                        </span>
                    ) : null}
                    <div className="min-w-0 flex-1">
                        <h2 id={titleId} className="font-display text-lg leading-snug text-parchment">
                            {title}
                        </h2>
                        {description ? (
                            <div id={descriptionId} className="mt-2 text-sm leading-relaxed text-parchment-dim">
                                {description}
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                    <button ref={cancelRef} type="button" className="btn-ghost" onClick={onCancel} disabled={busy}>
                        {cancelLabel}
                    </button>
                    {alternateLabel && onAlternate ? (
                        <button
                            ref={alternateRef}
                            type="button"
                            className="btn-ghost hover:border-wine/50 hover:text-wine"
                            onClick={onAlternate}
                            disabled={busy}
                        >
                            {alternateLabel}
                        </button>
                    ) : null}
                    <button
                        ref={confirmRef}
                        type="button"
                        className={cn(
                            'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink disabled:cursor-not-allowed disabled:opacity-40',
                            tone === 'danger'
                                ? 'bg-wine text-parchment hover:bg-wine/85'
                                : 'bg-amber text-ink hover:bg-amber-strong',
                        )}
                        onClick={onConfirm}
                        disabled={busy}
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
