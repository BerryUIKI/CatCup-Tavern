import {
    REGEX_PLACEMENT,
    type RegexScript,
    type RegexScriptPatch,
    runRegexScript,
    SUBSTITUTE_REGEX,
} from '@catcup/shared';
import { ArrowDown, ArrowUp, Download, Globe, Pencil, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { useState } from 'react';

import {
    useCreateRegexScript,
    useDeleteRegexScript,
    useImportRegexScripts,
    useRegexScripts,
    useReorderRegexScripts,
    useShareItem,
    useUpdateRegexScript,
} from '../hooks/data';
import { api } from '../lib/api';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/app';
import { SharedBadge } from './SharedBadge';
import { Spinner } from './Spinner';

const PLACEMENTS: { value: number; label: string }[] = [
    { value: REGEX_PLACEMENT.USER_INPUT, label: 'User input' },
    { value: REGEX_PLACEMENT.AI_OUTPUT, label: 'AI output' },
    { value: REGEX_PLACEMENT.SLASH_COMMAND, label: 'Slash commands' },
    { value: REGEX_PLACEMENT.WORLD_INFO, label: 'World info' },
    { value: REGEX_PLACEMENT.REASONING, label: 'Reasoning' },
];

interface Draft {
    scriptName: string;
    findRegex: string;
    replaceString: string;
    trimStrings: string;
    placement: number[];
    disabled: boolean;
    markdownOnly: boolean;
    promptOnly: boolean;
    runOnEdit: boolean;
    substituteRegex: number;
    minDepth: string;
    maxDepth: string;
}

const EMPTY_DRAFT: Draft = {
    scriptName: '',
    findRegex: '',
    replaceString: '',
    trimStrings: '',
    // SillyTavern's editor pre-checks "Alter Chat Display", "Run on edit" and
    // the user-input placement for a new script.
    placement: [REGEX_PLACEMENT.USER_INPUT],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: SUBSTITUTE_REGEX.NONE,
    minDepth: '',
    maxDepth: '',
};

function toDraft(script: RegexScript): Draft {
    return {
        scriptName: script.scriptName,
        findRegex: script.findRegex,
        replaceString: script.replaceString,
        trimStrings: script.trimStrings.join('\n'),
        placement: [...script.placement],
        disabled: script.disabled,
        markdownOnly: script.markdownOnly,
        promptOnly: script.promptOnly,
        runOnEdit: script.runOnEdit,
        substituteRegex: script.substituteRegex,
        minDepth: script.minDepth === null ? '' : String(script.minDepth),
        maxDepth: script.maxDepth === null ? '' : String(script.maxDepth),
    };
}

function toPatch(draft: Draft): RegexScriptPatch {
    const depth = (value: string): number | null => {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    };

    return {
        scriptName: draft.scriptName,
        findRegex: draft.findRegex,
        replaceString: draft.replaceString,
        trimStrings: draft.trimStrings
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        placement: draft.placement,
        disabled: draft.disabled,
        markdownOnly: draft.markdownOnly,
        promptOnly: draft.promptOnly,
        runOnEdit: draft.runOnEdit,
        substituteRegex: draft.substituteRegex,
        minDepth: depth(draft.minDepth),
        maxDepth: depth(draft.maxDepth),
    };
}

function toScript(draft: Draft): RegexScript {
    return {
        id: 'preview',
        ...toPatch(draft),
        trimStrings: toPatch(draft).trimStrings ?? [],
        placement: draft.placement,
    } as RegexScript;
}

function scopeLabel(script: RegexScript): string {
    if (script.markdownOnly) {
        return 'display only';
    }
    if (script.promptOnly) {
        return 'prompt only';
    }
    return 'stored text';
}

/**
 * Regex script manager.
 *
 * The list order is behaviour, not cosmetics: scripts run top to bottom and
 * each sees the previous one's output, so reordering is offered explicitly.
 */
export function RegexSettings() {
    const scriptsQuery = useRegexScripts();
    const createScript = useCreateRegexScript();
    const updateScript = useUpdateRegexScript();
    const deleteScript = useDeleteRegexScript();
    const reorderScripts = useReorderRegexScripts();
    const importScripts = useImportRegexScripts();
    const shareItem = useShareItem();
    const pushToast = useAppStore((state) => state.pushToast);

    const scripts = scriptsQuery.data?.scripts ?? [];
    const [editingId, setEditingId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    const [testInput, setTestInput] = useState('');

    const startCreate = () => {
        setCreating(true);
        setEditingId(null);
        setDraft(EMPTY_DRAFT);
        setTestInput('');
    };

    const startEdit = (script: RegexScript) => {
        setCreating(false);
        setEditingId(script.id);
        setDraft(toDraft(script));
        setTestInput('');
    };

    const cancel = () => {
        setCreating(false);
        setEditingId(null);
    };

    const save = async () => {
        const patch = toPatch(draft);
        if (patch.placement && patch.placement.length === 0) {
            pushToast('Pick at least one place this script should apply.', 'error');
            return;
        }
        try {
            if (editingId) {
                await updateScript.mutateAsync({ id: editingId, patch });
            } else {
                await createScript.mutateAsync({ patch });
            }
            pushToast('Regex script saved.', 'success');
            cancel();
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not save the script.', 'error');
        }
    };

    /** Move this rule between the profile's list and the shared one. */
    const share = async (script: RegexScript) => {
        const target = script.scope === 'shared' ? 'profile' : 'shared';
        try {
            await shareItem.mutateAsync({ kind: 'regex', id: script.id, action: 'move', scope: target });
            if (editingId === script.id) {
                cancel();
            }
            pushToast(
                target === 'shared'
                    ? `"${script.scriptName || 'Untitled'}" is now shared.`
                    : `"${script.scriptName || 'Untitled'}" belongs to this profile again.`,
                'success',
            );
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not change where this rule lives.', 'error');
        }
    };

    const remove = async (script: RegexScript) => {
        if (!window.confirm(`Delete the regex script "${script.scriptName || 'untitled'}"?`)) {
            return;
        }
        try {
            await deleteScript.mutateAsync(script.id);
            if (editingId === script.id) {
                cancel();
            }
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not delete the script.', 'error');
        }
    };

    const move = async (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= scripts.length) {
            return;
        }
        const ids = scripts.map((script) => script.id);
        const current = ids[index];
        const other = ids[target];
        if (current === undefined || other === undefined) {
            return;
        }
        ids[index] = other;
        ids[target] = current;
        try {
            await reorderScripts.mutateAsync({ ids });
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not reorder the scripts.', 'error');
        }
    };

    const toggleEnabled = async (script: RegexScript) => {
        try {
            await updateScript.mutateAsync({ id: script.id, patch: { disabled: !script.disabled } });
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not update the script.', 'error');
        }
    };

    const importFile = async (file: File) => {
        try {
            const data = JSON.parse(await file.text()) as unknown;
            const result = await importScripts.mutateAsync({ data, mode: 'append' });
            pushToast(
                `Imported ${result.scripts.length - scripts.length} script(s).` +
                    (result.errors.length > 0 ? ` ${result.errors.length} could not be read.` : ''),
                result.errors.length > 0 ? 'error' : 'success',
            );
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not import the scripts.', 'error');
        }
    };

    const preview = testInput && draft.findRegex ? runRegexScript(toScript(draft), testInput) : '';

    return (
        <div className="space-y-4 p-5">
            <p className="text-sm leading-relaxed text-muted">
                Scripts run top to bottom over the text they target. A script with neither “display only” nor “prompt
                only” rewrites the stored message, so the prompt and the chat view both see the result.
            </p>

            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-ghost" onClick={startCreate}>
                    <Plus size={15} />
                    New script
                </button>
                <label className={cn('btn-ghost cursor-pointer', importScripts.isPending && 'opacity-60')}>
                    {importScripts.isPending ? <Spinner size={15} /> : <Upload size={15} />}
                    Import JSON
                    <input
                        type="file"
                        accept=".json,application/json"
                        className="sr-only"
                        disabled={importScripts.isPending}
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = '';
                            if (file) {
                                void importFile(file);
                            }
                        }}
                    />
                </label>
                <a className="btn-ghost" href={api.regex.exportUrl()} download>
                    <Download size={15} />
                    Export
                </a>
                {scriptsQuery.isLoading ? <Spinner size={15} className="text-muted" /> : null}
            </div>

            {scripts.length === 0 ? (
                <p className="text-sm text-muted">
                    No scripts yet. Import a SillyTavern regex export or create one here.
                </p>
            ) : (
                <ul className="space-y-1.5">
                    {scripts.map((script, index) => (
                        <li
                            key={script.id}
                            className={cn(
                                'flex items-center gap-2 rounded-xl border px-3 py-2',
                                editingId === script.id ? 'border-amber/40 bg-surface-2' : 'border-line bg-surface/50',
                            )}
                        >
                            <div className="flex flex-col gap-0.5">
                                <button
                                    type="button"
                                    className="icon-btn size-4"
                                    onClick={() => void move(index, -1)}
                                    disabled={index === 0 || reorderScripts.isPending}
                                    aria-label={`Move ${script.scriptName} up`}
                                >
                                    <ArrowUp size={10} />
                                </button>
                                <button
                                    type="button"
                                    className="icon-btn size-4"
                                    onClick={() => void move(index, 1)}
                                    disabled={index === scripts.length - 1 || reorderScripts.isPending}
                                    aria-label={`Move ${script.scriptName} down`}
                                >
                                    <ArrowDown size={10} />
                                </button>
                            </div>

                            <input
                                type="checkbox"
                                className="accent-amber"
                                checked={!script.disabled}
                                onChange={() => void toggleEnabled(script)}
                                aria-label={`Enable ${script.scriptName}`}
                            />

                            <div className="min-w-0 flex-1">
                                <p className="flex items-center gap-1.5 truncate text-sm text-parchment">
                                    <span className="truncate">{script.scriptName || '(untitled)'}</span>
                                    {script.scope === 'shared' ? <SharedBadge /> : null}
                                </p>
                                <p className="truncate text-[11px] text-muted">
                                    {scopeLabel(script)} · {script.placement.length} place
                                    {script.placement.length === 1 ? '' : 's'} · {script.findRegex || 'no pattern'}
                                </p>
                            </div>

                            <button
                                type="button"
                                className="icon-btn size-7"
                                onClick={() => startEdit(script)}
                                aria-label={`Edit ${script.scriptName}`}
                            >
                                <Pencil size={14} />
                            </button>
                            <button
                                type="button"
                                className="icon-btn size-7"
                                onClick={() => void share(script)}
                                aria-label={
                                    script.scope === 'shared'
                                        ? `Take ${script.scriptName} into this profile`
                                        : `Make ${script.scriptName} reusable in every profile`
                                }
                                title={script.scope === 'shared' ? 'Take into this profile' : 'Reusable in every profile'}
                            >
                                <Globe size={14} />
                            </button>
                            <button
                                type="button"
                                className="icon-btn size-7 hover:text-wine"
                                onClick={() => void remove(script)}
                                aria-label={`Delete ${script.scriptName}`}
                            >
                                <Trash2 size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {creating || editingId ? (
                <div className="space-y-3 rounded-xl border border-amber/30 bg-surface-2/60 p-4">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium text-parchment">
                            {editingId ? 'Edit script' : 'New script'}
                        </h4>
                        <button type="button" className="icon-btn size-7" onClick={cancel} aria-label="Close editor">
                            <X size={14} />
                        </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <span className="label-text">Name</span>
                            <input
                                className="input-shell"
                                value={draft.scriptName}
                                onChange={(event) =>
                                    setDraft((current) => ({ ...current, scriptName: event.target.value }))
                                }
                            />
                        </div>
                        <div>
                            <span className="label-text">Macros in the pattern</span>
                            <select
                                className="input-shell text-xs"
                                value={draft.substituteRegex}
                                onChange={(event) =>
                                    setDraft((current) => ({
                                        ...current,
                                        substituteRegex: Number(event.target.value),
                                    }))
                                }
                            >
                                <option value={SUBSTITUTE_REGEX.NONE}>Leave them alone</option>
                                <option value={SUBSTITUTE_REGEX.RAW}>Substitute as pattern</option>
                                <option value={SUBSTITUTE_REGEX.ESCAPED}>Substitute and escape</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <span className="label-text">Find regex</span>
                        <input
                            className="input-shell font-mono text-xs"
                            placeholder="/pattern/flags"
                            value={draft.findRegex}
                            onChange={(event) => setDraft((current) => ({ ...current, findRegex: event.target.value }))}
                        />
                    </div>

                    <div>
                        <span className="label-text">Replace with</span>
                        <textarea
                            className="input-shell min-h-[64px] resize-y font-mono text-xs"
                            placeholder="Use $1, $<name> or {{match}} for the match"
                            value={draft.replaceString}
                            onChange={(event) =>
                                setDraft((current) => ({ ...current, replaceString: event.target.value }))
                            }
                        />
                    </div>

                    <div>
                        <span className="label-text">Trim from the match</span>
                        <textarea
                            className="input-shell min-h-[48px] resize-y font-mono text-xs"
                            placeholder="One string per line"
                            value={draft.trimStrings}
                            onChange={(event) =>
                                setDraft((current) => ({ ...current, trimStrings: event.target.value }))
                            }
                        />
                    </div>

                    <div>
                        <span className="label-text">Apply to</span>
                        <div className="grid gap-1.5 pt-1 sm:grid-cols-3">
                            {PLACEMENTS.map((placement) => (
                                <label
                                    key={placement.value}
                                    className="flex items-center gap-2 text-xs text-parchment-dim"
                                >
                                    <input
                                        type="checkbox"
                                        className="accent-amber"
                                        checked={draft.placement.includes(placement.value)}
                                        onChange={(event) =>
                                            setDraft((current) => ({
                                                ...current,
                                                placement: event.target.checked
                                                    ? [...current.placement, placement.value]
                                                    : current.placement.filter((value) => value !== placement.value),
                                            }))
                                        }
                                    />
                                    {placement.label}
                                </label>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-1.5 sm:grid-cols-2">
                        <label className="flex items-center gap-2 text-xs text-parchment-dim">
                            <input
                                type="checkbox"
                                className="accent-amber"
                                checked={draft.markdownOnly}
                                onChange={(event) =>
                                    setDraft((current) => ({ ...current, markdownOnly: event.target.checked }))
                                }
                            />
                            Display only (leave the prompt alone)
                        </label>
                        <label className="flex items-center gap-2 text-xs text-parchment-dim">
                            <input
                                type="checkbox"
                                className="accent-amber"
                                checked={draft.promptOnly}
                                onChange={(event) =>
                                    setDraft((current) => ({ ...current, promptOnly: event.target.checked }))
                                }
                            />
                            Prompt only (leave the stored text alone)
                        </label>
                        <label className="flex items-center gap-2 text-xs text-parchment-dim">
                            <input
                                type="checkbox"
                                className="accent-amber"
                                checked={draft.runOnEdit}
                                onChange={(event) =>
                                    setDraft((current) => ({ ...current, runOnEdit: event.target.checked }))
                                }
                            />
                            Run when a message is edited
                        </label>
                        <label className="flex items-center gap-2 text-xs text-parchment-dim">
                            <input
                                type="checkbox"
                                className="accent-amber"
                                checked={draft.disabled}
                                onChange={(event) =>
                                    setDraft((current) => ({ ...current, disabled: event.target.checked }))
                                }
                            />
                            Disabled
                        </label>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <span className="label-text">Newest message depth (min)</span>
                            <input
                                type="number"
                                className="input-shell text-xs"
                                placeholder="No limit"
                                value={draft.minDepth}
                                onChange={(event) =>
                                    setDraft((current) => ({ ...current, minDepth: event.target.value }))
                                }
                            />
                        </div>
                        <div>
                            <span className="label-text">Oldest message depth (max)</span>
                            <input
                                type="number"
                                className="input-shell text-xs"
                                placeholder="No limit"
                                value={draft.maxDepth}
                                onChange={(event) =>
                                    setDraft((current) => ({ ...current, maxDepth: event.target.value }))
                                }
                            />
                        </div>
                    </div>

                    <div>
                        <span className="label-text">Test</span>
                        <textarea
                            className="input-shell min-h-[56px] resize-y text-xs"
                            placeholder="Type text to run the script over"
                            value={testInput}
                            onChange={(event) => setTestInput(event.target.value)}
                        />
                        {testInput ? (
                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-line-soft bg-ink-soft/60 p-2 text-xs text-parchment-dim">
                                {preview || '(no change)'}
                            </pre>
                        ) : null}
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={() => void save()}
                            disabled={updateScript.isPending || createScript.isPending}
                        >
                            {updateScript.isPending || createScript.isPending ? (
                                <Spinner size={15} />
                            ) : (
                                <Save size={15} />
                            )}
                            Save script
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
