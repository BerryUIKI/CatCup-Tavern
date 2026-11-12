import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

import { galleryImageUrl } from '../lib/api';

export interface LightboxImage {
    url: string;
    title?: string;
}

/** A full-screen image preview for chat media and gallery thumbnails. */
export function ImageLightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
    useEffect(() => {
        if (!image) {
            return;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [image, onClose]);

    if (!image) {
        return null;
    }

    return createPortal(
        <div
            className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
            role="dialog"
            aria-modal="true"
            aria-label={image.title || 'Image preview'}
        >
            <button
                type="button"
                className="absolute inset-0 h-full w-full cursor-default"
                onClick={onClose}
                aria-label="Close image"
            />
            <button
                type="button"
                className="absolute right-4 top-4 z-20 icon-btn text-parchment"
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
