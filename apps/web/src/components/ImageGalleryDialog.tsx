import type { GeneratedImage } from '@catcup/shared';
import { Download, Send, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { type ImageChatTarget, imageScope, useAttachImage, useDeleteImage, useImageGallery } from '../hooks/useImages';
import { galleryImageUrl } from '../lib/api';
import { useAppStore } from '../store/app';
import { ImageLightbox, type LightboxImage } from './ImageLightbox';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

interface ImageGalleryDialogProps {
    open: boolean;
    onClose: () => void;
    target: ImageChatTarget;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

/** The character's or group's gallery, with insert and delete actions. */
export function ImageGalleryDialog({ open, onClose, target }: ImageGalleryDialogProps) {
    const gallery = useImageGallery(open ? target : null);
    const attachImage = useAttachImage(target);
    const deleteImage = useDeleteImage(target);
    const pushToast = useAppStore((state) => state.pushToast);
    const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
    const [pendingFile, setPendingFile] = useState<string | null>(null);

    const scope = imageScope(target);

    const handleAttach = async (image: GeneratedImage) => {
        setPendingFile(image.file);
        try {
            await attachImage.mutateAsync({
                ...scope,
                chatId: target.chatId,
                file: image.file,
                prompt: image.prompt || 'Generated image',
            });
            pushToast('The image was added to the chat.', 'success');
            onClose();
        } catch (error) {
            pushToast(errorMessage(error, 'Could not add the image to the chat.'), 'error');
        } finally {
            setPendingFile(null);
        }
    };

    const handleDelete = async (image: GeneratedImage) => {
        if (!window.confirm('Delete this image? Messages that already show it will keep a broken reference.')) {
            return;
        }
        try {
            await deleteImage.mutateAsync(image);
            pushToast('Image deleted.', 'success');
        } catch (error) {
            pushToast(errorMessage(error, 'Could not delete the image.'), 'error');
        }
    };

    const images = gallery.data ?? [];

    return (
        <Modal open={open} onClose={onClose} title={`${target.name} gallery`} widthClassName="max-w-3xl">
            <div className="space-y-4 p-5">
                {gallery.isLoading ? (
                    <div className="flex justify-center py-10">
                        <Spinner size={20} className="text-muted" />
                    </div>
                ) : gallery.isError ? (
                    <p className="text-sm text-wine">
                        {errorMessage(gallery.error, 'The gallery could not be loaded.')}
                    </p>
                ) : images.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted">
                        No images yet. Generate one from the chat header or a message.
                    </p>
                ) : (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        {images.map((image) => (
                            <figure
                                key={image.file}
                                className="overflow-hidden rounded-xl border border-line-soft bg-ink-soft/40"
                            >
                                <button
                                    type="button"
                                    className="block w-full"
                                    onClick={() => setLightbox({ url: image.url, title: image.prompt })}
                                    aria-label={image.prompt || 'Open image'}
                                >
                                    <img
                                        src={galleryImageUrl(image.url)}
                                        alt={image.prompt || 'Generated image'}
                                        className="aspect-square w-full object-cover"
                                        loading="lazy"
                                    />
                                </button>
                                <figcaption className="space-y-2 p-2">
                                    <p className="line-clamp-2 min-h-8 text-[11px] leading-snug text-muted">
                                        {image.prompt || 'No prompt recorded'}
                                    </p>
                                    <div className="flex items-center justify-end gap-1">
                                        <a
                                            className="icon-btn size-7"
                                            href={galleryImageUrl(image.url)}
                                            download={image.file}
                                            target="_blank"
                                            rel="noreferrer"
                                            title="Download"
                                            aria-label="Download image"
                                        >
                                            <Download size={13} />
                                        </a>
                                        <button
                                            type="button"
                                            className="icon-btn size-7"
                                            onClick={() => void handleAttach(image)}
                                            disabled={attachImage.isPending}
                                            title="Insert into chat"
                                            aria-label="Insert into chat"
                                        >
                                            {pendingFile === image.file ? <Spinner size={13} /> : <Send size={13} />}
                                        </button>
                                        <button
                                            type="button"
                                            className="icon-btn size-7 hover:text-wine"
                                            onClick={() => void handleDelete(image)}
                                            disabled={deleteImage.isPending}
                                            title="Delete"
                                            aria-label="Delete image"
                                        >
                                            <Trash2 size={13} />
                                        </button>
                                    </div>
                                </figcaption>
                            </figure>
                        ))}
                    </div>
                )}
            </div>

            <ImageLightbox image={lightbox} onClose={() => setLightbox(null)} />
        </Modal>
    );
}
