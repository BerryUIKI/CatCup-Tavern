import type { GeneratedImage } from '@catcup/shared';
import { Copy, ImagePlus, UserRound, WandSparkles } from 'lucide-react';
import { useState } from 'react';

import { useSettings } from '../hooks/data';
import { useDraftPortraitPrompt, useGenerateImage, useSetPortrait } from '../hooks/useImages';
import { galleryImageUrl } from '../lib/api';
import { useAppStore } from '../store/app';
import { ConfirmDialog } from './ConfirmDialog';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

interface PortraitDialogProps {
    characterId: string;
    characterName: string;
    onClose: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

/**
 * Give a character a picture, starting from the card rather than from a chat.
 *
 * This is deliberately separate from `ImageGenerationDialog`: that one illustrates
 * a moment in a conversation, while a portrait is a property of the character and
 * must work for a card that has never been spoken to — a distilled cast member is
 * exactly that.
 *
 * With no image backend the dialog still does its most useful half. Drafting is a
 * chat-model call, so the prompt appears and can be copied into any image tool;
 * only the generate and use buttons need a backend.
 */
export function PortraitDialog({ characterId, characterName, onClose }: PortraitDialogProps) {
    const settings = useSettings().data;
    const pushToast = useAppStore((state) => state.pushToast);
    const draftPortrait = useDraftPortraitPrompt();
    const generateImage = useGenerateImage();
    const setPortrait = useSetPortrait();

    const [prompt, setPrompt] = useState('');
    const [image, setImage] = useState<GeneratedImage | null>(null);
    const [confirm, setConfirm] = useState(false);

    const enabled = settings?.imageGeneration.enabled ?? false;
    const busy = draftPortrait.isPending || generateImage.isPending || setPortrait.isPending;

    const handleDraft = async () => {
        try {
            setPrompt(await draftPortrait.mutateAsync(characterId));
        } catch (error) {
            pushToast(errorMessage(error, 'Could not draft a portrait prompt.'), 'error');
        }
    };

    const handleGenerate = async () => {
        const trimmed = prompt.trim();
        if (!trimmed) {
            pushToast('Draft or describe the portrait first.', 'info');
            return;
        }
        try {
            setImage(await generateImage.mutateAsync({ characterId, prompt: trimmed }));
        } catch (error) {
            pushToast(errorMessage(error, 'Could not generate the image.'), 'error');
        }
    };

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(prompt.trim());
            pushToast('Prompt copied.', 'success');
        } catch {
            pushToast('Could not copy. Select the text and copy it yourself.', 'error');
        }
    };

    const handleApply = async () => {
        if (!image) {
            return;
        }
        try {
            await setPortrait.mutateAsync({ characterId, file: image.file });
            pushToast(`${characterName} has a new portrait.`, 'success');
            setConfirm(false);
            onClose();
        } catch (error) {
            pushToast(errorMessage(error, 'Could not set the portrait.'), 'error');
        }
    };

    return (
        <Modal open onClose={onClose} title={`Portrait of ${characterName}`} widthClassName="max-w-2xl">
            <div className="space-y-4 p-5">
                {!enabled ? (
                    <p className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-sm text-parchment-dim">
                        No image backend is set up. The prompt below still works — copy it into your own image tool, or
                        enable one in Settings → Images.
                    </p>
                ) : null}

                <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="label-text">Prompt</span>
                        <div className="flex items-center gap-1">
                            <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-xs"
                                onClick={() => void handleDraft()}
                                disabled={busy}
                                title="Describe this character's appearance from their card"
                            >
                                {draftPortrait.isPending ? <Spinner size={13} /> : <WandSparkles size={13} />}
                                Draft from card
                            </button>
                            <button
                                type="button"
                                className="btn-ghost px-2 py-1 text-xs"
                                onClick={() => void handleCopy()}
                                disabled={!prompt.trim()}
                                title="Copy the prompt to use in another image tool"
                            >
                                <Copy size={13} />
                                Copy
                            </button>
                        </div>
                    </div>
                    <textarea
                        className="input-shell min-h-28 w-full resize-y"
                        value={prompt}
                        onChange={(event) => setPrompt(event.target.value)}
                        placeholder="Appearance, build, face, hair, clothing, expression…"
                    />
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        Built from the card's description and personality, not from a chat — so it works before the
                        character has said anything.
                    </p>
                </div>

                {image ? (
                    <div className="space-y-3 rounded-xl border border-line-soft bg-ink-soft/50 p-3">
                        <img
                            src={galleryImageUrl(image.url)}
                            alt={image.prompt}
                            className="mx-auto max-h-[45dvh] w-auto rounded-lg object-contain"
                        />
                        <div className="flex flex-wrap justify-end gap-2">
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
                                onClick={() => setConfirm(true)}
                                disabled={busy}
                            >
                                <UserRound size={14} />
                                Use as portrait
                            </button>
                        </div>
                    </div>
                ) : (
                    <button
                        type="button"
                        className="btn-primary w-full"
                        onClick={() => void handleGenerate()}
                        disabled={!enabled || busy || !prompt.trim()}
                    >
                        {generateImage.isPending ? <Spinner size={15} /> : <ImagePlus size={15} />}
                        Generate portrait
                    </button>
                )}
            </div>

            <ConfirmDialog
                open={confirm}
                title={`Make this ${characterName}'s portrait?`}
                description={
                    <span>
                        It appears in the library and in every chat.
                        <strong className="mt-1 block text-parchment">The previous picture is not kept.</strong>A
                        card&apos;s picture and its data are one file, so this rewrites the card — the text fields are
                        untouched.
                    </span>
                }
                confirmLabel="Use as portrait"
                tone="danger"
                busy={setPortrait.isPending}
                onConfirm={() => void handleApply()}
                onCancel={() => setConfirm(false)}
            />
        </Modal>
    );
}
