import type { GeneratedImage } from '@catcup/shared';
import { Download, ImagePlus, Send, Sparkles, WandSparkles } from 'lucide-react';
import { useState } from 'react';

import { useSettings } from '../hooks/data';
import {
    type ImageChatTarget,
    imageScope,
    useAttachImage,
    useDraftImagePrompt,
    useGenerateImage,
} from '../hooks/useImages';
import { galleryImageUrl } from '../lib/api';
import { useAppStore } from '../store/app';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

interface ImageGenerationDialogProps {
    target: ImageChatTarget;
    /** When opened from a message's "Illustrate" action, draft up to it. */
    messageIndex?: number;
    onClose: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

/**
 * Generate one illustration, preview it, and optionally post it to the chat.
 *
 * Generation and attachment are separate server calls so a discarded preview
 * still stays in the gallery instead of creating a chat message nobody wants.
 */
export function ImageGenerationDialog({ target, messageIndex, onClose }: ImageGenerationDialogProps) {
    const settings = useSettings().data;
    const pushToast = useAppStore((state) => state.pushToast);
    const draftPrompt = useDraftImagePrompt();
    const generateImage = useGenerateImage();
    const attachImage = useAttachImage(target);

    const [prompt, setPrompt] = useState('');
    const [image, setImage] = useState<GeneratedImage | null>(null);

    const enabled = settings?.imageGeneration.enabled ?? false;
    const busy = draftPrompt.isPending || generateImage.isPending || attachImage.isPending;

    const scope = imageScope(target);

    const handleDraft = async () => {
        try {
            const text = await draftPrompt.mutateAsync({
                ...scope,
                chatId: target.chatId,
                ...(messageIndex === undefined ? {} : { messageIndex }),
            });
            setPrompt(text);
        } catch (error) {
            pushToast(errorMessage(error, 'Could not draft an image prompt.'), 'error');
        }
    };

    const handleGenerate = async () => {
        const trimmed = prompt.trim();
        if (!trimmed) {
            pushToast('Describe the image first, or draft a prompt from the chat.', 'info');
            return;
        }
        try {
            setImage(await generateImage.mutateAsync({ ...scope, prompt: trimmed }));
        } catch (error) {
            pushToast(errorMessage(error, 'Could not generate the image.'), 'error');
        }
    };

    const handleAttach = async () => {
        if (!image) {
            return;
        }
        try {
            await attachImage.mutateAsync({
                ...scope,
                chatId: target.chatId,
                file: image.file,
                prompt: prompt.trim() || image.prompt,
            });
            pushToast('The image was added to the chat.', 'success');
            onClose();
        } catch (error) {
            pushToast(errorMessage(error, 'Could not add the image to the chat.'), 'error');
        }
    };

    return (
        <Modal open onClose={onClose} title={`Illustrate ${target.name}`} widthClassName="max-w-2xl">
            <div className="space-y-5 p-5">
                {!enabled ? (
                    <p className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-parchment-dim">
                        Image generation is disabled. Enable it in Settings → Images first.
                    </p>
                ) : null}

                <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="label-text" htmlFor="image-prompt">
                            Prompt
                        </label>
                        <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-xs"
                            onClick={() => void handleDraft()}
                            disabled={!enabled || busy}
                            title="Ask the active chat model for a prompt from the recent messages"
                        >
                            {draftPrompt.isPending ? <Spinner size={13} /> : <Sparkles size={13} />}
                            Draft from chat
                        </button>
                    </div>
                    <textarea
                        id="image-prompt"
                        className="input-shell min-h-28 w-full resize-y"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="A knight in a candle-lit tavern, rain at the window…"
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        The configured prompt prefix is added automatically. Editing the prompt after a draft is
                        encouraged.
                    </p>
                </div>

                {image ? (
                    <div className="space-y-3 rounded-xl border border-line-soft bg-ink-soft/50 p-3">
                        <img
                            src={galleryImageUrl(image.url)}
                            alt={image.prompt}
                            className="mx-auto max-h-[45dvh] w-auto rounded-lg object-contain"
                        />
                        <p className="text-xs leading-relaxed text-muted">{image.prompt}</p>
                        <div className="flex flex-wrap justify-end gap-2">
                            <a
                                className="btn-ghost"
                                href={galleryImageUrl(image.url)}
                                download={image.file}
                                target="_blank"
                                rel="noreferrer"
                            >
                                <Download size={14} />
                                Download
                            </a>
                            <button
                                type="button"
                                className="btn-ghost"
                                onClick={() => void handleGenerate()}
                                disabled={busy}
                            >
                                {generateImage.isPending ? <Spinner size={14} /> : <WandSparkles size={14} />}
                                Regenerate
                            </button>
                            <button
                                type="button"
                                className="btn-primary"
                                onClick={() => void handleAttach()}
                                disabled={busy}
                            >
                                {attachImage.isPending ? <Spinner size={14} /> : <Send size={14} />}
                                Insert into chat
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="btn-primary w-full"
                        onClick={() => void handleGenerate()}
                        disabled={!enabled || busy}
                    >
                        {generateImage.isPending ? <Spinner size={15} /> : <ImagePlus size={15} />}
                        Generate image
                    </button>
                )}

                <p className="text-[11px] leading-relaxed text-muted/70">
                    Generated images stay in the gallery even when you close this window without inserting them.
                </p>
            </div>
        </Modal>
    );
}
