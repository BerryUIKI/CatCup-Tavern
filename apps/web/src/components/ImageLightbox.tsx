import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { galleryImageUrl } from '../lib/api';
import { isTopFocusLayer, pushFocusLayer, trapTab } from '../lib/focus';

export interface LightboxImage {
    url: string;
    title?: string;
}

/** A full-screen image preview for chat media and gallery thumbnails. */
export function ImageLightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
    const panelRef = useRef<HTMLDivElement>(null);
    const closeRef = useRef<HTMLButtonElement>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);
    const onCloseRef = useRef(onClose);

    useEffect(() => {
        onCloseRef.current = onClose;
    }, [onClose]);

    useEffect(() => {
        if (!image) {
            return;
        }
        const panel = panelRef.current;
        if (!panel) {
            return;
        }

        restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        closeRef.current?.focus({ preventScroll: true });
        const releaseLayer = pushFocusLayer(panel);

        const onKeyDown = (event: KeyboardEvent) => {
            if (!isTopFocusLayer(panel)) {
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current();
                return;
            }
            trapTab(event, panel);
        };

        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
            releaseLayer();
            const previous = restoreFocusRef.current;
            if (previous?.isConnected) {
                previous.focus({ preventScroll: true });
            }
            restoreFocusRef.current = null;
        };
    }, [image]);

    if (!image) {
        return null;
    }

    return createPortal(
        <div
            ref={panelRef}
            className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/85 p-4 outline-none"
            role="dialog"
            aria-modal="true"
            aria-label={image.title || 'Image preview'}
            tabIndex={-1}
        >
            <button
                type="button"
                className="absolute inset-0 h-full w-full cursor-default"
                onClick={onClose}
                tabIndex={-1}
                aria-label="Close image"
            />
            <button
                ref={closeRef}
                type="button"
                className="icon-btn absolute right-4 top-4 z-20 text-parchment"
                onClick={onClose}
                aria-label="Close image"
            >
                <X size={20} />
            </button>
            <img
                src={galleryImageUrl(image.url)}
                alt={image.title || 'Generated image'}
                className="relative z-10 max-h-[85dvh] max-w-[92vw] rounded-lg object-contain shadow-2xl"
            />
            {image.title ? (
                <p className="relative z-10 max-w-[92vw] text-center text-xs leading-relaxed text-parchment-dim">
                    {image.title}
                </p>
            ) : null}
        </div>,
        document.body,
    );
}
