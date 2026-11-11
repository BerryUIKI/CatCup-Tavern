import type { CharacterPatch } from '@catcup/shared';
import { BookOpen, Download, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useCharacter, useDeleteCharacter, useImportCharacterBook, useUpdateCharacter } from '../hooks/data';
import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { CharacterAvatar } from './CharacterAvatar';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

interface Draft {
    name: string;
    creator: string;
    character_version: string;
    tags: string;
    creator_notes: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    alternate_greetings: string[];
    system_prompt: string;
    post_history_instructions: string;
}

function toDraft(card: {
    name: string;
    creator: string;
    character_version: string;
    tags: string[];
    creator_notes: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    alternate_greetings: string[];
    system_prompt: string;
    post_history_instructions: string;
}): Draft {
    return {
        name: card.name,
        creator: card.creator,
        character_version: card.character_version,
        tags: card.tags.join(', '),
        creator_notes: card.creator_notes,
        description: card.description,
        personality: card.personality,
        scenario: card.scenario,
        first_mes: card.first_mes,
        mes_example: card.mes_example,
        alternate_greetings: [...card.alternate_greetings],
        system_prompt: card.system_prompt,
        post_history_instructions: card.post_history_instructions,
    };
}

/** Split a comma list, dropping blanks. */
function splitList(value: string): string[] {
    return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function Field({
    label,
    hint,
    value,
    onChange,
    rows,
    placeholder,
}: {
    label: string;
    hint?: string;
    value: string;
    onChange: (value: string) => void;
    rows?: number;
    placeholder?: string;
}) {
    return (
        <div>
            <span className="label-text">{label}</span>
            {rows ? (
                <textarea
                    className="input-shell resize-y leading-relaxed"
                    rows={rows}
                    value={value}
                    placeholder={placeholder}
                    onChange={(event) => onChange(event.target.value)}
                />
            ) : (
                <input
                    className="input-shell"
                    value={value}
                    placeholder={placeholder}
                    onChange={(event) => onChange(event.target.value)}
                />
            )}
            {hint ? <p className="mt-1 text-[11px] leading-relaxed text-muted/70">{hint}</p> : null}
        </div>
    );
}

/**
 * Edit a character card in place.
 *
 * The file keeps its name — that id is what chats, avatars and world info
 * already reference — so renaming a character changes only the card's `name`.
 */
export function CharacterEditor({ characterId, onClose }: { characterId: string | null; onClose: () => void }) {
    const characterQuery = useCharacter(characterId);
    const updateCharacter = useUpdateCharacter();
    const deleteCharacterMutation = useDeleteCharacter();
    const importBook = useImportCharacterBook(characterId);
    const pushToast = useAppStore((state) => state.pushToast);
    const [draft, setDraft] = useState<Draft | null>(null);

    const character = characterQuery.data ?? null;
    const linkedWorld =
        character && typeof character.card.extensions.world === 'string' ? character.card.extensions.world : '';

    useEffect(() => {
        if (character) {
            setDraft(toDraft(character.card));
        } else {
            setDraft(null);
        }
    }, [character]);

    const update = (field: keyof Draft, value: string) => {
        setDraft((current) => (current ? { ...current, [field]: value } : current));
    };

    const save = async () => {
        if (!character || !draft) {
            return;
        }
        const patch: CharacterPatch = {
            name: draft.name.trim() || character.card.name,
            creator: draft.creator,
            character_version: draft.character_version,
            tags: splitList(draft.tags),
            creator_notes: draft.creator_notes,
            description: draft.description,
            personality: draft.personality,
            scenario: draft.scenario,
            first_mes: draft.first_mes,
            mes_example: draft.mes_example,
            alternate_greetings: draft.alternate_greetings.filter((greeting) => greeting.trim().length > 0),
            system_prompt: draft.system_prompt,
            post_history_instructions: draft.post_history_instructions,
        };

        try {
            await updateCharacter.mutateAsync({ id: character.id, patch });
            pushToast('Character saved.', 'success');
            onClose();
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not save the character.', 'error');
        }
    };

    const remove = async () => {
        if (!character) {
            return;
        }
        if (
            !window.confirm(
                `Delete "${character.name}"? The card file is removed; chats stay on disk but no longer appear in the library.`,
            )
        ) {
            return;
        }
        try {
            await deleteCharacterMutation.mutateAsync(character.id);
            pushToast('Character deleted.', 'success');
            onClose();
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not delete the character.', 'error');
        }
    };

    const importLorebook = async () => {
        if (!character) {
            return;
        }
        try {
            const result = await importBook.mutateAsync();
            pushToast(
                result.created
                    ? `Imported "${result.world.id}" and linked it to this card.`
                    : `This card is already linked to "${result.world.id}".`,
                'success',
            );
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not import the lorebook.', 'error');
        }
    };

    return (
        <Modal open={characterId !== null} onClose={onClose} title="Edit character" widthClassName="max-w-3xl">
            {characterQuery.isLoading || !character || !draft ? (
                <div className="flex justify-center p-12">
                    <Spinner size={20} className="text-muted" />
                </div>
            ) : (
                <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
                    <div className="flex items-center gap-3">
                        <CharacterAvatar name={character.card.name} src={character.avatarUrl} size={48} />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-parchment">{character.fileName}</p>
                            <p className="text-[11px] text-muted">
                                {character.spec.toUpperCase()} · {character.format.toUpperCase()}
                            </p>
                        </div>
                        <a className="btn-ghost" href={api.characters.exportUrl(character.id, 'json')} download>
                            <Download size={15} />
                            JSON
                        </a>
                        {character.format === 'png' ? (
                            <a className="btn-ghost" href={api.characters.exportUrl(character.id, 'png')} download>
                                <Download size={15} />
                                PNG
                            </a>
                        ) : (
                            <span className="btn-ghost cursor-not-allowed opacity-50" title="This card has no image">
                                <Download size={15} />
                                PNG
                            </span>
                        )}
                        {character.hasCharacterBook ? (
                            <button
                                type="button"
                                className="btn-ghost"
                                onClick={() => void importLorebook()}
                                disabled={importBook.isPending || Boolean(linkedWorld)}
                                title={
                                    linkedWorld
                                        ? `Linked to the "${linkedWorld}" lorebook`
                                        : "Import the card's embedded lorebook"
                                }
                            >
                                {importBook.isPending ? <Spinner size={15} /> : <BookOpen size={15} />}
                                {linkedWorld ? 'Lore linked' : 'Import lore'}
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className="btn-ghost hover:text-wine"
                            onClick={() => void remove()}
                            disabled={deleteCharacterMutation.isPending}
                        >
                            {deleteCharacterMutation.isPending ? <Spinner size={15} /> : <Trash2 size={15} />}
                            Delete
                        </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Name" value={draft.name} onChange={(value) => update('name', value)} />
                        <Field label="Creator" value={draft.creator} onChange={(value) => update('creator', value)} />
                        <Field
                            label="Version"
                            value={draft.character_version}
                            onChange={(value) => update('character_version', value)}
                        />
                    </div>

                    <Field
                        label="Tags"
                        hint="Comma separated."
                        value={draft.tags}
                        onChange={(value) => update('tags', value)}
                    />

                    <Field
                        label="Description"
                        rows={5}
                        value={draft.description}
                        onChange={(value) => update('description', value)}
                    />
                    <Field
                        label="Personality"
                        rows={3}
                        value={draft.personality}
                        onChange={(value) => update('personality', value)}
                    />
                    <Field
                        label="Scenario"
                        rows={3}
                        value={draft.scenario}
                        onChange={(value) => update('scenario', value)}
                    />
                    <Field
                        label="First message"
                        rows={5}
                        value={draft.first_mes}
                        onChange={(value) => update('first_mes', value)}
                    />
                    <div>
                        <span className="label-text">Alternate greetings</span>
                        <p className="mb-1 text-[11px] leading-relaxed text-muted/70">
                            Each one is offered when starting a chat. They are separate entries, so a greeting that
                            spans paragraphs stays one greeting.
                        </p>
                        <div className="space-y-2">
                            {draft.alternate_greetings.map((greeting, index) => (
                                // biome-ignore lint/suspicious/noArrayIndexKey: greetings have no stable id
                                <div key={index} className="flex items-start gap-2">
                                    <textarea
                                        className="input-shell min-h-[80px] resize-y leading-relaxed"
                                        value={greeting}
                                        onChange={(event) => {
                                            const next = [...draft.alternate_greetings];
                                            next[index] = event.target.value;
                                            setDraft((current) =>
                                                current ? { ...current, alternate_greetings: next } : current,
                                            );
                                        }}
                                    />
                                    <button
                                        type="button"
                                        className="icon-btn mt-1 size-7 shrink-0 hover:text-wine"
                                        onClick={() =>
                                            setDraft((current) =>
                                                current
                                                    ? {
                                                          ...current,
                                                          alternate_greetings: current.alternate_greetings.filter(
                                                              (_, position) => position !== index,
                                                          ),
                                                      }
                                                    : current,
                                            )
                                        }
                                        aria-label={`Remove greeting ${index + 1}`}
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button
                            type="button"
                            className="btn-ghost mt-2"
                            onClick={() =>
                                setDraft((current) =>
                                    current
                                        ? {
                                              ...current,
                                              alternate_greetings: [...current.alternate_greetings, ''],
                                          }
                                        : current,
                                )
                            }
                        >
                            <Plus size={15} />
                            Add greeting
                        </button>
                    </div>
                    <Field
                        label="Example messages"
                        rows={5}
                        value={draft.mes_example}
                        onChange={(value) => update('mes_example', value)}
                    />
                    <Field
                        label="System prompt"
                        hint="Overrides the preset's main prompt when set."
                        rows={3}
                        value={draft.system_prompt}
                        onChange={(value) => update('system_prompt', value)}
                    />
                    <Field
                        label="Post-history instructions"
                        rows={3}
                        value={draft.post_history_instructions}
                        onChange={(value) => update('post_history_instructions', value)}
                    />
                    <Field
                        label="Creator notes"
                        rows={3}
                        value={draft.creator_notes}
                        onChange={(value) => update('creator_notes', value)}
                    />

                    <div className="flex items-center gap-2 border-t border-line-soft pt-3">
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={() => void save()}
                            disabled={updateCharacter.isPending}
                        >
                            {updateCharacter.isPending ? <Spinner size={15} /> : <Save size={15} />}
                            Save character
                        </button>
                        <button type="button" className="btn-ghost" onClick={onClose}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}
        </Modal>
    );
}
