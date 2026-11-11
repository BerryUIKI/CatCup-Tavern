import type { CharacterPatch } from '@catcup/shared';
import { Download, Save } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useCharacter, useUpdateCharacter } from '../hooks/data';
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
    alternate_greetings: string;
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
        alternate_greetings: card.alternate_greetings.join('\n'),
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

/** Split a one-per-line list, dropping blank lines. */
function splitLines(value: string): string[] {
    return value
        .split('\n')
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
    const pushToast = useAppStore((state) => state.pushToast);
    const [draft, setDraft] = useState<Draft | null>(null);

    const character = characterQuery.data ?? null;

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
            alternate_greetings: splitLines(draft.alternate_greetings),
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
                    <Field
                        label="Alternate greetings"
                        hint="One per line. Shown when starting a chat."
                        rows={4}
                        value={draft.alternate_greetings}
                        onChange={(value) => update('alternate_greetings', value)}
                    />
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
