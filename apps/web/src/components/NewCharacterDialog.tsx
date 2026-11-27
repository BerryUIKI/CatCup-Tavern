import type { CharacterCreateRequest, ItemScope } from '@catcup/shared';
import { Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useCreateCharacter } from '../hooks/data';
import { useAppStore } from '../store/app';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

/**
 * New character: the two fields that make a card exist.
 *
 * Deliberately short. A card has thirteen fields and the editor shows all of
 * them — so asking for them twice would mean two forms drifting apart about what
 * a card is. This asks for what a card cannot exist without, creates it, and
 * hands it to the editor, which is where every other field is filled in.
 *
 * See issue #168. The name is the only required field, because it is the only
 * one the server needs to give the card a file name.
 */

interface NewCharacterDialogProps {
    open: boolean;
    onClose: () => void;
    /** Called with the new card's id once it exists, so the caller can open the editor. */
    onCreated: (id: string) => void;
}

export function NewCharacterDialog({ open, onClose, onCreated }: NewCharacterDialogProps) {
    const [name, setName] = useState('');
    const [firstMes, setFirstMes] = useState('');
    const [scope, setScope] = useState<ItemScope>('profile');
    const create = useCreateCharacter();
    const pushToast = useAppStore((state) => state.pushToast);
    const nameRef = useRef<HTMLInputElement>(null);

    // Focus the name box when the dialog appears. Everything else about the
    // draft's lifetime is handled by mounting a fresh dialog per opening, which
    // the caller does with a `key` — so there is nothing to reset here.
    useEffect(() => {
        if (open) {
            nameRef.current?.focus();
        }
    }, [open]);

    const trimmed = name.trim();
    const canSave = trimmed.length > 0 && !create.isPending;

    const handleCreate = async () => {
        if (!canSave) {
            return;
        }
        const body: CharacterCreateRequest = { name: trimmed };
        if (firstMes.trim()) {
            body.first_mes = firstMes.trim();
        }

        try {
            const result = await create.mutateAsync({ body, scope });
            pushToast(`Created "${result.character.name}".`, 'success');
            onCreated(result.character.id);
            onClose();
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not create the character.', 'error');
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="New character" widthClassName="max-w-lg">
            <div className="space-y-5 p-5">
                <div>
                    <label className="label-text" htmlFor="new-character-name">
                        Name
                    </label>
                    <input
                        ref={nameRef}
                        id="new-character-name"
                        className="input-shell"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                void handleCreate();
                            }
                        }}
                        placeholder="Who are they?"
                        maxLength={200}
                    />
                    <p className="mt-1 text-footnote leading-relaxed text-muted">
                        A name already in use gets a number beside it rather than replacing that character.
                    </p>
                </div>

                <div>
                    <label className="label-text" htmlFor="new-character-greeting">
                        First message <span className="font-normal text-muted">(optional)</span>
                    </label>
                    <textarea
                        id="new-character-greeting"
                        className="input-shell min-h-24 resize-y"
                        value={firstMes}
                        onChange={(event) => setFirstMes(event.target.value)}
                        placeholder="What they say when a chat begins. You can write this later."
                    />
                </div>

                <div>
                    <span className="label-text">Save to</span>
                    <div className="mt-1 flex gap-2">
                        {(
                            [
                                { value: 'profile', label: 'This profile', hint: 'Only this profile sees it.' },
                                { value: 'shared', label: 'Shared', hint: 'Every profile sees it.' },
                            ] as const
                        ).map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                onClick={() => setScope(option.value)}
                                aria-pressed={scope === option.value}
                                className={
                                    scope === option.value
                                        ? 'flex-1 rounded-xl border border-amber/50 bg-amber/10 px-3 py-2 text-left text-sm text-parchment'
                                        : 'flex-1 rounded-xl border border-line/60 px-3 py-2 text-left text-sm text-muted transition hover:border-line hover:text-parchment'
                                }
                            >
                                <span className="block">{option.label}</span>
                                <span className="mt-0.5 block text-footnote text-muted">{option.hint}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <p className="flex items-start gap-2 rounded-xl border border-line-soft bg-ink-soft/60 px-3 py-2 text-footnote leading-relaxed text-muted">
                    <Sparkles size={14} className="mt-0.5 shrink-0 text-amber" aria-hidden="true" />
                    The card opens in the editor as soon as it exists, with a placeholder portrait you can replace
                    later.
                </p>

                <div className="flex items-center justify-end gap-2 border-t border-line-soft pt-4">
                    <button type="button" className="btn-ghost" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void handleCreate()}
                        disabled={!canSave}
                    >
                        {create.isPending ? <Spinner size={15} /> : null}
                        Create character
                    </button>
                </div>
            </div>
        </Modal>
    );
}
