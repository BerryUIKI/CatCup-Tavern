import { DEFAULT_PERSONA, type Persona } from '@catcup/shared';
import { Check, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { useSettings, useUpdateSettings } from '../hooks/data';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/app';
import { Spinner } from './Spinner';

/**
 * Manage the personas a user can speak as.
 *
 * One is the account default; a chat can pin a different one from its header.
 * Deleting the persona a chat pointed at is safe: the chat falls back to the
 * first persona rather than failing to open.
 */
export function PersonaSettings() {
    const settingsQuery = useSettings();
    const updateSettings = useUpdateSettings();
    const pushToast = useAppStore((state) => state.pushToast);

    const settings = settingsQuery.data;
    const personas = settings?.personas ?? [];
    const activePersonaId = settings?.activePersonaId ?? personas[0]?.id ?? null;

    const [draft, setDraft] = useState<Persona | null>(null);
    const [creating, setCreating] = useState(false);

    const startCreate = () => {
        setCreating(true);
        setDraft({ id: crypto.randomUUID(), ...DEFAULT_PERSONA });
    };

    const startEdit = (persona: Persona) => {
        setCreating(false);
        setDraft({ ...persona });
    };

    const cancel = () => {
        setCreating(false);
        setDraft(null);
    };

    const showError = (error: unknown) => {
        pushToast(error instanceof Error ? error.message : 'Could not save the persona.', 'error');
    };

    const save = async () => {
        if (!draft) {
            return;
        }
        const name = draft.name.trim();
        if (!name) {
            pushToast('A persona needs a name.', 'error');
            return;
        }

        const next = creating
            ? [...personas, { ...draft, name }]
            : personas.map((persona) => (persona.id === draft.id ? { ...draft, name } : persona));

        try {
            await updateSettings.mutateAsync({
                personas: next,
                activePersonaId: activePersonaId ?? draft.id,
            });
            pushToast('Persona saved.', 'success');
            cancel();
        } catch (error) {
            showError(error);
        }
    };

    const remove = async (persona: Persona) => {
        if (!window.confirm(`Delete the persona "${persona.name}"? Chats that used it fall back to the default.`)) {
            return;
        }
        try {
            await updateSettings.mutateAsync({ personas: personas.filter((item) => item.id !== persona.id) });
            if (draft?.id === persona.id) {
                cancel();
            }
        } catch (error) {
            showError(error);
        }
    };

    const makeDefault = async (persona: Persona) => {
        try {
            await updateSettings.mutateAsync({ activePersonaId: persona.id });
        } catch (error) {
            showError(error);
        }
    };

    return (
        <div className="space-y-4 p-5">
            <p className="text-sm leading-relaxed text-muted">
                Your persona is how the model refers to you. The default applies to new chats; any chat can pin a
                different one from its header.
            </p>

            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-ghost" onClick={startCreate}>
                    <Plus size={15} />
                    New persona
                </button>
                {settingsQuery.isLoading ? <Spinner size={15} className="text-muted" /> : null}
            </div>

            {personas.length === 0 ? (
                <p className="text-sm text-muted">
                    No personas yet. Create one to give yourself a name and a description.
                </p>
            ) : (
                <ul className="space-y-1.5">
                    {personas.map((persona) => {
                        const isDefault = persona.id === activePersonaId;
                        return (
                            <li
                                key={persona.id}
                                className={cn(
                                    'flex items-center gap-2 rounded-xl border px-3 py-2',
                                    draft?.id === persona.id
                                        ? 'border-amber/40 bg-surface-2'
                                        : 'border-line bg-surface/50',
                                )}
                            >
                                <div className="min-w-0 flex-1">
                                    <p className="flex items-center gap-1.5 truncate text-sm text-parchment">
                                        {persona.name}
                                        {isDefault ? (
                                            <span className="rounded bg-amber/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber">
                                                Default
                                            </span>
                                        ) : null}
                                    </p>
                                    <p className="truncate text-[11px] text-muted">
                                        {persona.description || 'No description'}
                                    </p>
                                </div>

                                {isDefault ? (
                                    <Check size={14} className="shrink-0 text-sage" />
                                ) : (
                                    <button
                                        type="button"
                                        className="icon-btn size-7"
                                        onClick={() => void makeDefault(persona)}
                                        disabled={updateSettings.isPending}
                                        title="Use as default"
                                        aria-label={`Make ${persona.name} the default`}
                                    >
                                        <Check size={14} />
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="icon-btn size-7"
                                    onClick={() => startEdit(persona)}
                                    aria-label={`Edit ${persona.name}`}
                                >
                                    <Pencil size={14} />
                                </button>
                                <button
                                    type="button"
                                    className="icon-btn size-7 hover:text-wine"
                                    onClick={() => void remove(persona)}
                                    disabled={updateSettings.isPending}
                                    aria-label={`Delete ${persona.name}`}
                                >
                                    <Trash2 size={14} />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {draft ? (
                <div className="space-y-3 rounded-xl border border-amber/30 bg-surface-2/60 p-4">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-parchment">
                            {creating ? 'New persona' : 'Edit persona'}
                        </h4>
                        <button type="button" className="icon-btn size-7" onClick={cancel} aria-label="Close editor">
                            <X size={14} />
                        </button>
                    </div>

                    <div>
                        <span className="label-text">Name</span>
                        <input
                            className="input-shell"
                            value={draft.name}
                            placeholder="You"
                            onChange={(event) =>
                                setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                            }
                        />
                    </div>

                    <div>
                        <span className="label-text">Description</span>
                        <textarea
                            className="input-shell min-h-[120px] resize-y leading-relaxed"
                            value={draft.description}
                            placeholder="Optional description of your persona…"
                            onChange={(event) =>
                                setDraft((current) =>
                                    current ? { ...current, description: event.target.value } : current,
                                )
                            }
                        />
                        <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                            Available to prompts as {'{{persona}}'}. Keep it short: it is sent with every turn.
                        </p>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={() => void save()}
                            disabled={updateSettings.isPending}
                        >
                            {updateSettings.isPending ? <Spinner size={15} /> : <Save size={15} />}
                            Save persona
                        </button>
                        <button type="button" className="btn-ghost" onClick={cancel}>
                            Cancel
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
