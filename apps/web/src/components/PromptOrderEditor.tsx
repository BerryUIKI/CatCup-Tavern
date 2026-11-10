import { GLOBAL_PROMPT_ORDER_ID, type PromptEntry, type PromptOrder, type PromptOrderEntry } from '@catcup/shared';
import { ArrowDown, ArrowUp, Save } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { usePreset, useUpdatePreset } from '../hooks/data';
import { useAppStore } from '../store/app';
import { Spinner } from './Spinner';

interface Draft {
    prompts: PromptEntry[];
    order: PromptOrderEntry[];
}

/**
 * Edit a preset's prompt order and injection positions.
 *
 * Order is changed with explicit up/down buttons rather than drag and drop:
 * they work with a keyboard and a screen reader, and they cannot drop an entry
 * into a slot the user did not intend.
 */
export function PromptOrderEditor({ presetId }: { presetId: string }) {
    const presetQuery = usePreset(presetId);
    const updatePreset = useUpdatePreset(presetId);
    const pushToast = useAppStore((state) => state.pushToast);

    const [draft, setDraft] = useState<Draft | null>(null);
    const loadedRef = useRef(false);

    useEffect(() => {
        if (loadedRef.current) {
            return;
        }
        const body = presetQuery.data?.preset.preset;
        if (!body) {
            return;
        }
        loadedRef.current = true;

        const prompts = Array.isArray(body.prompts) ? (body.prompts as PromptEntry[]) : [];
        const orders = Array.isArray(body.prompt_order) ? (body.prompt_order as PromptOrder[]) : [];
        const list =
            orders.find((candidate) => String(candidate.character_id) === String(GLOBAL_PROMPT_ORDER_ID)) ?? orders[0];

        setDraft({ prompts, order: list?.order ?? [] });
    }, [presetQuery.data]);

    if (presetQuery.isLoading || !draft) {
        return (
            <div className="flex justify-center py-10">
                <Spinner size={20} className="text-muted" />
            </div>
        );
    }

    if (draft.order.length === 0) {
        return <p className="text-sm text-muted">This preset has no prompt order. Export it and edit the JSON.</p>;
    }

    const definitionOf = (identifier: string) => draft.prompts.find((prompt) => prompt.identifier === identifier);

    const move = (index: number, delta: number) => {
        setDraft((current) => {
            if (!current) {
                return current;
            }
            const target = index + delta;
            const a = current.order[index];
            const b = current.order[target];
            if (!a || !b) {
                return current;
            }
            const order = [...current.order];
            order[index] = b;
            order[target] = a;
            return { ...current, order };
        });
    };

    const toggle = (index: number) => {
        setDraft((current) => {
            if (!current) {
                return current;
            }
            const order = current.order.map((entry, position) =>
                position === index ? { ...entry, enabled: entry.enabled !== true } : entry,
            );
            return { ...current, order };
        });
    };

    const patchPrompt = (identifier: string, patch: Partial<PromptEntry>) => {
        setDraft((current) =>
            current
                ? {
                      ...current,
                      prompts: current.prompts.map((prompt) =>
                          prompt.identifier === identifier ? { ...prompt, ...patch } : prompt,
                      ),
                  }
                : current,
        );
    };

    const save = async () => {
        try {
            await updatePreset.mutateAsync({
                prompts: draft.prompts,
                prompt_order: [{ character_id: GLOBAL_PROMPT_ORDER_ID, order: draft.order }],
            });
            pushToast('Prompt order saved.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not save the prompt order.', 'error');
        }
    };

    return (
        <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted">
                Move entries with the arrows, turn them off with the checkbox, and switch a prompt between the ordered
                list and an in-chat injection.
            </p>

            <ol className="space-y-2">
                {draft.order.map((entry, index) => {
                    const prompt = definitionOf(entry.identifier);
                    const absolute = prompt?.injection_position === 1;

                    return (
                        <li key={entry.identifier} className="rounded-xl border border-line bg-surface/50 px-3 py-2">
                            <div className="flex items-center gap-2">
                                <div className="flex flex-col gap-0.5">
                                    <button
                                        type="button"
                                        className="icon-btn size-5"
                                        onClick={() => move(index, -1)}
                                        disabled={index === 0}
                                        aria-label={`Move ${entry.identifier} up`}
                                    >
                                        <ArrowUp size={11} />
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-btn size-5"
                                        onClick={() => move(index, 1)}
                                        disabled={index === draft.order.length - 1}
                                        aria-label={`Move ${entry.identifier} down`}
                                    >
                                        <ArrowDown size={11} />
                                    </button>
                                </div>

                                <input
                                    type="checkbox"
                                    className="accent-amber"
                                    checked={entry.enabled === true}
                                    onChange={() => toggle(index)}
                                    aria-label={`Enable ${entry.identifier}`}
                                />

                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm text-parchment">
                                        {prompt?.name || entry.identifier}
                                    </p>
                                    <p className="truncate text-[11px] text-muted">
                                        {entry.identifier}
                                        {prompt?.marker ? ' · marker' : ''}
                                    </p>
                                </div>

                                <select
                                    className="rounded-lg border border-line bg-ink px-2 py-1 text-xs text-parchment-dim"
                                    value={absolute ? '1' : '0'}
                                    disabled={!prompt}
                                    onChange={(event) =>
                                        patchPrompt(entry.identifier, {
                                            injection_position: Number(event.target.value),
                                        })
                                    }
                                    aria-label={`Injection position for ${entry.identifier}`}
                                >
                                    <option value="0">Relative</option>
                                    <option value="1">At depth</option>
                                </select>
                            </div>

                            {absolute && prompt ? (
                                <div className="mt-2 flex flex-wrap items-center gap-3 pl-8 text-xs text-muted">
                                    <label className="flex items-center gap-1">
                                        Depth
                                        <input
                                            type="number"
                                            min={0}
                                            max={10000}
                                            className="w-16 rounded border border-line bg-ink px-1.5 py-0.5 text-parchment-dim"
                                            value={prompt.injection_depth ?? 4}
                                            onChange={(event) =>
                                                patchPrompt(entry.identifier, {
                                                    injection_depth: Number(event.target.value),
                                                })
                                            }
                                        />
                                    </label>
                                    <label className="flex items-center gap-1">
                                        Order
                                        <input
                                            type="number"
                                            min={0}
                                            max={10000}
                                            className="w-16 rounded border border-line bg-ink px-1.5 py-0.5 text-parchment-dim"
                                            value={prompt.injection_order ?? 100}
                                            onChange={(event) =>
                                                patchPrompt(entry.identifier, {
                                                    injection_order: Number(event.target.value),
                                                })
                                            }
                                        />
                                    </label>
                                    <label className="flex items-center gap-1">
                                        Role
                                        <select
                                            className="rounded border border-line bg-ink px-1.5 py-0.5 text-parchment-dim"
                                            value={prompt.role ?? 'system'}
                                            onChange={(event) =>
                                                patchPrompt(entry.identifier, {
                                                    role: event.target.value as PromptEntry['role'],
                                                })
                                            }
                                        >
                                            <option value="system">System</option>
                                            <option value="user">User</option>
                                            <option value="assistant">Assistant</option>
                                        </select>
                                    </label>
                                </div>
                            ) : null}
                        </li>
                    );
                })}
            </ol>

            <button type="button" className="btn-primary" onClick={() => void save()} disabled={updatePreset.isPending}>
                {updatePreset.isPending ? <Spinner size={15} /> : <Save size={15} />}
                Save prompt order
            </button>
        </div>
    );
}
