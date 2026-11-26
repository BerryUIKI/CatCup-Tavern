import {
    DEFAULT_DIRECTOR_CONFIG,
    type DirectorCastMember,
    type DirectorConfig,
    type DirectorConfigPatch,
    type DirectorSpeakerMode,
    MAX_CHOICES,
    MIN_CHOICES,
} from '@catcup/shared';
import { Check, Loader2, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { Modal } from './Modal';
import { Select } from './Select';

/**
 * The director's form.
 *
 * Two steps, because the two halves answer different questions. **Rules** is
 * what the scene should be like; **who you play** is what the model must not
 * write. Separating them matters because the cast line is the half that makes a
 * guided scene work, and it is the half a person is most likely to forget to
 * fill in — so it sits on its own tab where it cannot be scrolled past.
 *
 * The form is explicit-save with a leave guard, per `docs/DESIGN.md`: a config
 * change alters every following reply, and a half-typed rule that saved on every
 * keystroke would produce a scene that drifts while the person is still writing
 * the instruction.
 */

type Tab = 'rules' | 'cast';

const SPEAKER_MODES: { value: DirectorSpeakerMode; label: string; hint: string }[] = [
    {
        value: 'auto',
        label: 'Group decides',
        hint: 'Today’s activation strategy, unchanged. Played members are skipped.',
    },
    {
        value: 'rotate',
        label: 'Take turns',
        hint: 'List order, skipping anyone you play.',
    },
    {
        value: 'director',
        label: 'Director picks',
        hint: 'The model names the next speaker; an unknown name falls back to the group rule.',
    },
];

export interface DirectorPanelProps {
    open: boolean;
    onClose: () => void;
    /** Load the current config and the playable cast. */
    load: () => Promise<{ director: DirectorConfig; cast: DirectorCastMember[]; isGroup: boolean }>;
    save: (patch: DirectorConfigPatch) => Promise<{ director: DirectorConfig }>;
    /** The chat's own character, so a single chat can say why it cannot be played. */
    ownCharacterId: string;
}

export function DirectorPanel({ open, onClose, load, save, ownCharacterId }: DirectorPanelProps) {
    const [tab, setTab] = useState<Tab>('rules');
    const [form, setForm] = useState<DirectorConfig>(DEFAULT_DIRECTOR_CONFIG);
    const [cast, setCast] = useState<DirectorCastMember[]>([]);
    const [isGroup, setIsGroup] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const dirtyRef = useRef(false);

    // Reload whenever the panel opens: the chat may have changed underneath it,
    // and a stale director config is worse than a loading state.
    useEffect(() => {
        if (!open) {
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        dirtyRef.current = false;

        void load()
            .then((data) => {
                if (cancelled) {
                    return;
                }
                setForm(data.director);
                setCast(data.cast);
                setIsGroup(data.isGroup);
                setTab('rules');
            })
            .catch((reason: unknown) => {
                if (!cancelled) {
                    setError(reason instanceof Error ? reason.message : 'Could not load the director.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [open, load]);

    const set = <K extends keyof DirectorConfig>(field: K, value: DirectorConfig[K]): void => {
        dirtyRef.current = true;
        setForm((current) => ({ ...current, [field]: value }));
    };

    /** Ask before losing a half-written rule, the same guard the editor uses. */
    const close = (): void => {
        if (dirtyRef.current && !window.confirm('Discard the changes to this scene?')) {
            return;
        }
        onClose();
    };

    const submit = async (): Promise<void> => {
        setSaving(true);
        setError(null);
        try {
            const { director } = await save(form);
            setForm(director);
            dirtyRef.current = false;
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Could not save the director.');
        } finally {
            setSaving(false);
        }
    };

    const togglePlayed = (id: string): void => {
        const played = form.playedMembers.includes(id)
            ? form.playedMembers.filter((member) => member !== id)
            : [...form.playedMembers, id];
        set('playedMembers', played);
    };

    return (
        <Modal open={open} onClose={close} title="Director" widthClassName="max-w-2xl">
            <div className="space-y-4 p-5">
                <label className="flex items-start gap-2 text-sm text-parchment-dim">
                    <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 accent-amber"
                        checked={form.enabled}
                        onChange={(event) => set('enabled', event.target.checked)}
                    />
                    <span>
                        Run this chat as a scene
                        <span className="mt-0.5 block text-footnote leading-relaxed text-muted">
                            Off by default. A chat with the director off behaves exactly as it always did — the settings
                            below are kept but not used.
                        </span>
                    </span>
                </label>

                {loading ? (
                    <p className="flex items-center gap-2 text-xs text-muted">
                        <Loader2 className="size-3.5 animate-spin" />
                        Reading this chat…
                    </p>
                ) : null}

                {error ? <p className="text-xs text-danger">{error}</p> : null}

                <div className="flex items-center gap-1 border-b border-line-soft pb-2" role="tablist">
                    {(
                        [
                            ['rules', 'Rules'],
                            [
                                'cast',
                                `Who you play${form.playedMembers.length > 0 ? ` (${form.playedMembers.length})` : ''}`,
                            ],
                        ] as const
                    ).map(([value, label]) => (
                        <button
                            key={value}
                            type="button"
                            role="tab"
                            aria-selected={tab === value}
                            className={cn(
                                'rounded-lg px-3 py-1.5 text-sm transition',
                                tab === value ? 'bg-surface-2 text-parchment' : 'text-muted hover:text-parchment',
                            )}
                            onClick={() => setTab(value)}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {tab === 'rules' ? (
                    <div className="space-y-4">
                        <div>
                            <label className="label-text" htmlFor="director-rules">
                                Standing instructions
                            </label>
                            <textarea
                                id="director-rules"
                                className="input-shell min-h-32 resize-y text-sm leading-relaxed"
                                placeholder="Keep the pace slow. Never resolve a threat the player has not faced."
                                value={form.rules}
                                onChange={(event) => set('rules', event.target.value)}
                            />
                            <p className="field-hint">
                                Sent to the model with every reply in this chat, in its own system block. Leave it empty
                                and the cast block below is still sent — that is the part that stops the model writing
                                your character.
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <Select<DirectorSpeakerMode>
                                id="director-speaker"
                                label="Who speaks next"
                                value={form.speakerMode}
                                onChange={(value) => set('speakerMode', value)}
                                options={SPEAKER_MODES.map((mode) => ({ value: mode.value, label: mode.label }))}
                            />
                            <div>
                                <label className="label-text" htmlFor="director-choice-count">
                                    Options per reply
                                </label>
                                <input
                                    id="director-choice-count"
                                    type="number"
                                    min={MIN_CHOICES}
                                    max={MAX_CHOICES}
                                    className="input-shell"
                                    disabled={!form.choices}
                                    value={form.choiceCount}
                                    onChange={(event) =>
                                        set(
                                            'choiceCount',
                                            Math.min(
                                                MAX_CHOICES,
                                                Math.max(MIN_CHOICES, Number(event.target.value) || MIN_CHOICES),
                                            ),
                                        )
                                    }
                                />
                            </div>
                        </div>

                        <p className="text-footnote leading-relaxed text-muted">
                            {SPEAKER_MODES.find((mode) => mode.value === form.speakerMode)?.hint}
                        </p>

                        <label className="flex items-start gap-2 text-sm text-parchment-dim">
                            <input
                                type="checkbox"
                                className="mt-0.5 size-4 shrink-0 accent-amber"
                                checked={form.choices}
                                onChange={(event) => set('choices', event.target.checked)}
                            />
                            <span>
                                Offer options after each reply
                                <span className="mt-0.5 block text-footnote leading-relaxed text-muted">
                                    Two to four buttons under the reply. Clicking one sends it as your message; ignoring
                                    them leaves the composer fully usable. A reply with no options is a normal outcome,
                                    not a failure.
                                </span>
                            </span>
                        </label>
                    </div>
                ) : null}

                {tab === 'cast' ? (
                    <div className="space-y-3">
                        <p className="text-footnote leading-relaxed text-muted">
                            The characters you play. They stay in the prompt so the model knows who they are, and the
                            model is told never to write their dialogue or decisions.
                        </p>

                        {cast.length === 0 ? (
                            <p className="rounded-lg border border-line-soft bg-surface/50 px-3 py-4 text-center text-xs text-muted">
                                This chat has no characters to play.
                            </p>
                        ) : (
                            <ul className="space-y-1.5">
                                {cast.map((member) => {
                                    const played = form.playedMembers.includes(member.id);
                                    // A single chat cannot play its own card: the
                                    // prompt already says "you are {{char}}", so
                                    // forbidding it would contradict itself. The
                                    // backend refuses it too; disabling the row
                                    // here says why before the save fails.
                                    const refused = !isGroup && member.id === ownCharacterId;

                                    return (
                                        <li key={member.id}>
                                            <button
                                                type="button"
                                                disabled={refused}
                                                onClick={() => togglePlayed(member.id)}
                                                className={cn(
                                                    'flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition',
                                                    refused
                                                        ? 'cursor-not-allowed border-line-soft/50 text-muted'
                                                        : played
                                                          ? 'border-amber/50 bg-amber/10 text-parchment'
                                                          : 'border-line-soft text-parchment-dim hover:border-line',
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        'flex size-4 shrink-0 items-center justify-center rounded border',
                                                        played ? 'border-amber bg-amber text-ink' : 'border-line',
                                                    )}
                                                >
                                                    {played ? <Check size={11} /> : null}
                                                </span>
                                                <UserRound size={13} className="shrink-0 text-muted" />
                                                <span className="truncate">{member.name}</span>
                                                {refused ? (
                                                    <span className="ml-auto shrink-0 text-caption text-muted">
                                                        this chat’s own card
                                                    </span>
                                                ) : null}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {!isGroup && cast.some((member) => member.id === ownCharacterId) ? (
                            <p className="text-footnote leading-relaxed text-amber/90">
                                A single chat cannot play its own character: the prompt tells the model to be that
                                character, so also forbidding it would contradict itself. Put the cast in a group chat,
                                or keep this card as the narrator and play someone the world book describes.
                            </p>
                        ) : null}
                    </div>
                ) : null}

                <div className="flex items-center gap-2 pt-1">
                    <button
                        type="button"
                        className="btn-primary"
                        disabled={saving || loading}
                        onClick={() => void submit()}
                    >
                        {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                        Save
                    </button>
                    <button type="button" className="btn-ghost" onClick={close}>
                        Cancel
                    </button>
                </div>
            </div>
        </Modal>
    );
}
