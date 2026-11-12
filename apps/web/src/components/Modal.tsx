import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn';
import { isTopFocusLayer, pushFocusLayer, trapTab } from '../lib/focus';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    widthClassName?: string;
    /** Extra classes for the scroll container, e.g. `overflow-hidden` for a panel that scrolls itself. */
    bodyClassName?: string;
}

export function Modal({ open, onClose, title, children, widthClassName, bodyClassName }: ModalProps) {
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);

    // Keep the latest callback without re-running the open/close effect, which
    // would steal focus back to the panel on every parent render.
    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!open) {
            return;
        }

        restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        const panel = panelRef.current;
        panel?.focus({ preventScroll: true });
        const releaseLayer = panel ? pushFocusLayer(panel) : () => {};

        const onKeyDown = (event: KeyboardEvent) => {
            if (panel && !isTopFocusLayer(panel)) {
                return;
            }
            if (event.key === 'Escape') {
                onCloseRef.current();
                return;
            }
            if (panel) {
                trapTab(event, panel);
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            releaseLayer();
            document.body.style.overflow = previousOverflow;
            const previous = restoreFocusRef.current;
            if (previous?.isConnected) {
                previous.focus({ preventScroll: true });
            }
            restoreFocusRef.current = null;
        };
    }, [open]);

    if (!open) {
        return null;
    }

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
            <div
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                className={cn(
                    'tavern-panel animate-fade-up relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden outline-none',
                    widthClassName ?? 'max-w-3xl',
                )}
            >
                <header className="flex shrink-0 items-center justify-between border-b border-line-soft px-5 py-4">
                    <h2 id={titleId} className="font-display text-lg tracking-wide text-parchment">
                        {title}
                    </h2>
                    <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </header>
                <div className={cn('min-h-0 flex-1 overflow-y-auto', bodyClassName)}>{children}</div>
            </div>
        </div>,
        document.body,
    );
}
