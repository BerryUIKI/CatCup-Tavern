import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn';

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    widthClassName?: string;
}

export function Modal({ open, onClose, title, children, widthClassName }: ModalProps) {
    useEffect(() => {
        if (!open) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            document.body.style.overflow = previousOverflow;
        };
    }, [open, onClose]);

    if (!open) {
        return null;
    }

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className={cn(
                    'tavern-panel animate-fade-up relative z-10 flex max-h-[90dvh] w-full flex-col overflow-hidden',
                    widthClassName ?? 'max-w-3xl',
                )}
            >
                <header className="flex shrink-0 items-center justify-between border-b border-line-soft px-5 py-4">
                    <h2 className="font-display text-lg tracking-wide text-parchment">{title}</h2>
                    <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
                        <X size={18} />
                    </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
            </div>
        </div>,
        document.body,
    );
}
