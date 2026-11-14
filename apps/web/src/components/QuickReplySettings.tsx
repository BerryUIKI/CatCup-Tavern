import {
    type QuickReplyItem,
    type QuickReplySetLink,
    type QuickReplySetView,
    quickReplyItemSchema,
} from '@catcup/shared';
import { ArrowDown, ArrowUp, Download, Globe, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
    useCreateQuickReplySet,
    useDeleteQuickReplySet,
    useImportQuickReplySet,
    useQuickReplies,
    useSaveQuickReplySet,
    useSettings,
    useShareItem,
    useUpdateSettings,
} from '../hooks/data';
import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { SharedBadge } from './SharedBadge';
import { Spinner } from './Spinner';

/** Copy so edits never mutate the React Query cache. */
function cloneSet(set: QuickReplySetView): QuickReplySetView {
    return { ...set, qrList: set.qrList.map((item) => ({ ...item })) };
}

/** Stable identity while the set list is loading. */
const EMPTY_SETS: QuickReplySetView[] = [];

/** Keep one link per set; the bar renders a set once even if ST saved it twice. */
function uniqueLinks(links: QuickReplySetLink[]): QuickReplySetLink[] {
    const seen = new Set<string>();
    return links.filter((link) => {
        if (seen.has(link.set)) {
            return false;
        }
        seen.add(link.set);
        return true;
    });
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}

/**
 * Quick Replies settings: the bar toggle, which sets it shows, and a
 * master/detail editor for the sets themselves.
 *
 * A set is saved as a whole, like SillyTavern's debounced set save, so a
 * half-edited reply never reaches the file. Fields the editor does not expose
 * (icons, auto-execution flags, context-menu links) are carried through the
 * save untouched.
 */
export function QuickReplySettings() {
    const settings = useSettings().data;
    const updateSettings = useUpdateSettings();
    const setsQuery = useQuickReplies();
    const createSet = useCreateQuickReplySet();
    const saveSet = useSaveQuickReplySet();
    const deleteSet = useDeleteQuickReplySet();
    const shareItem = useShareItem();
    const importSet = useImportQuickReplySet();
    const pushToast = useAppStore((state) => state.pushToast);

    const sets = setsQuery.data?.sets ?? EMPTY_SETS;
    const [enabled, setEnabled] = useState(settings?.quickReplies.enabled ?? false);
    const [links, setLinks] = useState<QuickReplySetLink[]>(uniqueLinks(settings?.quickReplies.setList ?? []));
    const editedLinks = useRef(false);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [draft, setDraft] = useState<QuickReplySetView | null>(null);
    const [dirty, setDirty] = useState(false);
    const [newName, setNewName] = useState('');
    const [addSetName, setAddSetName] = useState('');
    const selectedOnce = useRef(false);
    const selectedIdRef = useRef<string | null>(null);
    const editVersion = useRef(0);
    const creatingRef = useRef(false);
    const importingRef = useRef(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const chooseSet = useCallback((id: string | null) => {
        selectedIdRef.current = id;
        setSelectedId(id);
    }, []);

    const confirmDiscard = () => !dirty || window.confirm('Discard the unsaved changes to this quick reply set?');

    // Adopt settings saved elsewhere while this form is untouched.
    useEffect(() => {
        if (!settings?.quickReplies || editedLinks.current) {
            return;
        }
        setEnabled(settings.quickReplies.enabled);
        setLinks(uniqueLinks(settings.quickReplies.setList));
    }, [settings?.quickReplies]);

    // Open the first set once, when the library first loads. Everything after
    // that (create, import, delete, rename) selects explicitly, so a refetch
    // never replaces a draft the user is editing.
    useEffect(() => {
        if (selectedOnce.current || sets.length === 0) {
            return;
        }
        const first = sets[0];
        if (!first) {
            return;
        }
        selectedOnce.current = true;
        chooseSet(first.id);
        setDraft(cloneSet(first));
    }, [sets, chooseSet]);

    const available = sets.filter((set) => !links.some((link) => link.set === set.name));

    const selectSet = (id: string) => {
        if (id === selectedId) {
            return;
        }
        if (!confirmDiscard()) {
            return;
        }
        const next = sets.find((set) => set.id === id) ?? null;
        selectedOnce.current = true;
        setDirty(false);
        chooseSet(next?.id ?? null);
        setDraft(next ? cloneSet(next) : null);
    };

    const patchDraft = (patch: Partial<QuickReplySetView>) => {
        editVersion.current += 1;
        setDirty(true);
        setDraft((current) => (current ? { ...current, ...patch } : current));
    };

    const patchItem = (index: number, patch: Partial<QuickReplyItem>) => {
        if (!draft) {
            return;
        }
        patchDraft({
            qrList: draft.qrList.map((item, cursor) => (cursor === index ? { ...item, ...patch } : item)),
        });
    };

    const addItem = () => {
        if (!draft) {
            return;
        }
        const highest = draft.qrList.reduce((max, item) => Math.max(max, item.id), draft.idIndex);
        const id = highest + 1;
        const item = quickReplyItemSchema.parse({ id, label: 'New reply' });
        patchDraft({ qrList: [...draft.qrList, item], idIndex: id });
    };

    const removeItem = (index: number) => {
        if (!draft) {
            return;
        }
        patchDraft({ qrList: draft.qrList.filter((_item, cursor) => cursor !== index) });
    };

    const moveItem = (index: number, delta: number) => {
        if (!draft) {
            return;
        }
        const target = index + delta;
        if (target < 0 || target >= draft.qrList.length) {
            return;
        }
        const next = [...draft.qrList];
        const [moved] = next.splice(index, 1);
        if (!moved) {
            return;
        }
        next.splice(target, 0, moved);
        patchDraft({ qrList: next });
    };

    const handleCreate = async () => {
        if (creatingRef.current || createSet.isPending) {
            return;
        }
        const name = newName.trim();
        if (!name || !confirmDiscard()) {
            return;
        }
        creatingRef.current = true;
        try {
            const { set } = await createSet.mutateAsync({ name });
            setNewName('');
            selectedOnce.current = true;
            setDirty(false);
            chooseSet(set.id);
            setDraft(cloneSet(set));
            pushToast(`Created "${set.name}".`, 'success');
        } catch (error) {
            pushToast(errorMessage(error, 'Could not create the quick reply set.'), 'error');
        } finally {
            creatingRef.current = false;
        }
    };

    const handleSave = async () => {
        if (!draft) {
            return;
        }
        if (!draft.name.trim()) {
            pushToast('The set needs a name.', 'error');
            return;
        }
        const { id, ...body } = draft;
        const version = editVersion.current;
        const savedId = draft.id;
        try {
            const { set, renamedFrom } = await saveSet.mutateAsync({ id, set: body });
            // The server rewrites the account set list on a rename; keep this
            // tab's copy of it in step. The response names the old set name.
            if (renamedFrom) {
                setLinks((current) =>
                    current.map((link) => (link.set === renamedFrom ? { ...link, set: set.name } : link)),
                );
            }
            const stillOnSet = selectedIdRef.current === savedId;
            if (stillOnSet) {
                chooseSet(set.id);
            }
            if (stillOnSet && editVersion.current === version) {
                setDirty(false);
                setDraft(cloneSet(set));
            } else if (stillOnSet) {
                // Edits landed while the save was in flight: keep them, but
                // point the draft at the file's current id after a rename.
                setDraft((current) => (current && current.id === savedId ? { ...current, id: set.id } : current));
            }
            pushToast('Quick reply set saved.', 'success');
        } catch (error) {
            pushToast(errorMessage(error, 'Could not save the quick reply set.'), 'error');
        }
    };

    /** Move this set between the profile and the shared scope. */
    const handleShare = async () => {
        const stored = sets.find((set) => set.id === selectedId);
        if (!stored) {
            return;
        }
        const target = stored.scope === 'shared' ? 'profile' : 'shared';
        try {
            await shareItem.mutateAsync({ kind: 'quickreplies', id: stored.id, action: 'move', scope: target });
            pushToast(
                target === 'shared'
                    ? `"${stored.name}" is now shared.`
                    : `"${stored.name}" belongs to this profile again.`,
                'success',
            );
        } catch (error) {
            pushToast(errorMessage(error, 'Could not change where this set lives.'), 'error');
        }
    };

    const handleDelete = async () => {
        if (!draft) {
            return;
        }
        if (!window.confirm(`Delete the quick reply set "${draft.name}"?`)) {
            return;
        }
        // The links use the stored name; the draft may hold an unsaved rename.
        const storedName = sets.find((set) => set.id === draft.id)?.name ?? draft.name;
        try {
            await deleteSet.mutateAsync(draft.id);
            setLinks((current) => current.filter((link) => link.set !== storedName));
            const remaining = sets.filter((set) => set.id !== draft.id);
            const next = remaining[0] ?? null;
            setDirty(false);
            chooseSet(next?.id ?? null);
            setDraft(next ? cloneSet(next) : null);
            pushToast('Quick reply set deleted.', 'success');
        } catch (error) {
            pushToast(errorMessage(error, 'Could not delete the quick reply set.'), 'error');
        }
    };

    const handleImport = async (file: File) => {
        if (importingRef.current || importSet.isPending || !confirmDiscard()) {
            return;
        }
        importingRef.current = true;
        try {
            const data = JSON.parse(await file.text()) as unknown;
            const { set } = await importSet.mutateAsync({ data });
            selectedOnce.current = true;
            setDirty(false);
            chooseSet(set.id);
            setDraft(cloneSet(set));
            pushToast(`Imported "${set.name}".`, 'success');
        } catch (error) {
            pushToast(errorMessage(error, 'Could not import the quick reply set.'), 'error');
        } finally {
            importingRef.current = false;
        }
    };

    const addLink = () => {
        if (!addSetName || links.some((link) => link.set === addSetName)) {
            return;
        }
        editedLinks.current = true;
        setLinks((current) => [...current, { set: addSetName, isVisible: true }]);
        setAddSetName('');
    };

    const moveLink = (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= links.length) {
            return;
        }
        editedLinks.current = true;
        setLinks((current) => {
            const next = [...current];
            const [moved] = next.splice(index, 1);
            if (!moved) {
                return current;
            }
            next.splice(target, 0, moved);
            return next;
        });
    };

    const handleSaveDisplay = () => {
        updateSettings.mutate(
            { quickReplies: { enabled, setList: links } },
            {
                onSuccess: () => {
                    editedLinks.current = false;
                    pushToast('Quick reply display settings saved.', 'success');
                },
                onError: (error) =>
                    pushToast(errorMessage(error, 'Could not save the quick reply display settings.'), 'error'),
            },
        );
    };

    return (
        <div className="space-y-6 p-5">
            <section className="rounded-xl border border-line-soft bg-surface/40 p-4">
                <h3 className="font-display text-base text-parchment">Quick reply bar</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                    Buttons appear above the message box in every chat. A set can be shown or hidden without deleting
                    it, and the order here is the order of the groups in the bar.
                </p>

                <label className="mt-3 flex items-center gap-2 text-sm text-parchment-dim">
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(event) => {
                            editedLinks.current = true;
                            setEnabled(event.target.checked);
                        }}
                        className="size-4 accent-amber"
                    />
                    Show quick reply buttons
                </label>

                <div className="mt-3 space-y-1.5">
                    {links.length === 0 ? (
                        <p className="text-xs text-muted">No sets are shown yet. Add one below.</p>
                    ) : null}
                    {links.map((link, index) => (
                        <div
                            key={link.set}
                            className="flex items-center gap-2 rounded-lg border border-line-soft bg-ink/40 px-2.5 py-1.5"
                        >
                            <span className="min-w-0 flex-1 truncate text-sm text-parchment-dim">{link.set}</span>
                            <label className="flex items-center gap-1.5 text-[11px] text-muted">
                                <input
                                    type="checkbox"
                                    checked={link.isVisible}
                                    onChange={(event) => {
                                        editedLinks.current = true;
                                        setLinks((current) =>
                                            current.map((entry, cursor) =>
                                                cursor === index
                                                    ? { ...entry, isVisible: event.target.checked }
                                                    : entry,
                                            ),
                                        );
                                    }}
                                    className="size-3.5 accent-amber"
                                />
                                Visible
                            </label>
                            <button
                                type="button"
                                className="icon-btn size-6"
                                onClick={() => moveLink(index, -1)}
                                disabled={index === 0}
                                title="Move up"
                                aria-label="Move set up"
                            >
                                <ArrowUp size={12} />
                            </button>
                            <button
                                type="button"
                                className="icon-btn size-6"
                                onClick={() => moveLink(index, 1)}
                                disabled={index === links.length - 1}
                                title="Move down"
                                aria-label="Move set down"
                            >
                                <ArrowDown size={12} />
                            </button>
                            <button
                                type="button"
                                className="icon-btn size-6 hover:text-wine"
                                onClick={() => {
                                    editedLinks.current = true;
                                    setLinks((current) => current.filter((_entry, cursor) => cursor !== index));
                                }}
                                title="Remove from the bar"
                                aria-label="Remove set from the bar"
                            >
                                <X size={12} />
                            </button>
                        </div>
                    ))}
                </div>

                <div className="mt-2 flex items-center gap-2">
                    <select
                        className="input-shell h-9 flex-1 py-1 text-xs"
                        value={addSetName}
                        onChange={(event) => setAddSetName(event.target.value)}
                        aria-label="Set to add to the bar"
                    >
                        <option value="">Add a set…</option>
                        {available.map((set) => (
                            <option key={set.id} value={set.name}>
                                {set.name}
                            </option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="btn-ghost h-9 px-3 text-xs"
                        onClick={addLink}
                        disabled={!addSetName}
                    >
                        <Plus size={13} />
                        Add
                    </button>
                </div>

                <div className="mt-3 flex justify-end">
                    <button
                        type="button"
                        className="btn-primary"
                        onClick={handleSaveDisplay}
                        disabled={updateSettings.isPending}
                    >
                        {updateSettings.isPending ? <Spinner size={15} /> : <Save size={15} />}
                        Save display settings
                    </button>
                </div>
            </section>

            <section>
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-display text-base text-parchment">Quick reply sets</h3>
                    <div className="flex flex-wrap items-center gap-2">
                        <input
                            className="input-shell h-9 w-44 py-1 text-xs"
                            placeholder="New set name"
                            value={newName}
                            maxLength={120}
                            onChange={(event) => setNewName(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    void handleCreate();
                                }
                            }}
                        />
                        <button
                            type="button"
                            className="btn-ghost h-9 px-3 text-xs"
                            onClick={() => void handleCreate()}
                            disabled={!newName.trim() || createSet.isPending}
                        >
                            {createSet.isPending ? <Spinner size={13} /> : <Plus size={13} />}
                            Create
                        </button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".json,application/json"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) {
                                    void handleImport(file);
                                }
                                event.target.value = '';
                            }}
                        />
                        <button
                            type="button"
                            className="btn-ghost h-9 px-3 text-xs"
                            onClick={() => fileRef.current?.click()}
                            disabled={importSet.isPending}
                        >
                            {importSet.isPending ? <Spinner size={13} /> : <Upload size={13} />}
                            Import
                        </button>
                    </div>
                </div>

                <div className="mt-3 grid gap-4 md:grid-cols-[220px_1fr]">
                    <div className="space-y-1 self-start rounded-xl border border-line-soft bg-surface/30 p-1.5">
                        {sets.length === 0 ? <p className="p-2 text-xs text-muted">No sets yet.</p> : null}
                        {sets.map((set) => (
                            <button
                                key={set.id}
                                type="button"
                                onClick={() => selectSet(set.id)}
                                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                                    set.id === selectedId
                                        ? 'bg-amber/10 text-parchment'
                                        : 'text-parchment-dim hover:bg-surface-2/60'
                                }`}
                            >
                                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                    <span className="truncate">{set.name}</span>
                                    {set.scope === 'shared' ? <SharedBadge /> : null}
                                </span>
                                <span className="shrink-0 text-[11px] text-muted">{set.qrList.length}</span>
                            </button>
                        ))}
                    </div>

                    {draft ? (
                        <div className="space-y-4 rounded-xl border border-line-soft bg-surface/30 p-4">
                            <div className="flex flex-wrap items-end gap-2">
                                <div className="min-w-0 flex-1">
                                    <label className="label-text" htmlFor="quick-reply-set-name">
                                        Set name
                                    </label>
                                    <input
                                        id="quick-reply-set-name"
                                        className="input-shell"
                                        value={draft.name}
                                        maxLength={120}
                                        onChange={(event) => patchDraft({ name: event.target.value })}
                                    />
                                    <p className="mt-1 text-[11px] text-muted">
                                        Renaming moves the set's file, as SillyTavern names the file after the set.
                                    </p>
                                </div>
                                <a
                                    className="btn-ghost h-9 px-3 text-xs"
                                    href={api.quickReplies.exportUrl(draft.id)}
                                    download
                                >
                                    <Download size={13} />
                                    Export
                                </a>
                                <button
                                    type="button"
                                    className="btn-ghost h-9 px-3 text-xs"
                                    onClick={() => void handleShare()}
                                    disabled={shareItem.isPending}
                                >
                                    <Globe size={13} />
                                    {sets.find((set) => set.id === selectedId)?.scope === 'shared'
                                        ? 'Take into this profile'
                                        : 'Reusable in every profile'}
                                </button>
                                <button
                                    type="button"
                                    className="btn-ghost h-9 px-3 text-xs hover:text-wine"
                                    onClick={() => void handleDelete()}
                                    disabled={deleteSet.isPending}
                                >
                                    {deleteSet.isPending ? <Spinner size={13} /> : <Trash2 size={13} />}
                                    Delete
                                </button>
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <div>
                                    <label className="label-text" htmlFor="quick-reply-set-color">
                                        Button color
                                    </label>
                                    <input
                                        id="quick-reply-set-color"
                                        className="input-shell"
                                        value={draft.color}
                                        maxLength={100}
                                        placeholder="transparent"
                                        onChange={(event) => patchDraft({ color: event.target.value })}
                                    />
                                    <p className="mt-1 text-[11px] text-muted">
                                        Any CSS color, or <code>transparent</code> for none.
                                    </p>
                                </div>
                                <div className="space-y-1.5 self-end text-sm text-parchment-dim">
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={draft.onlyBorderColor}
                                            onChange={(event) => patchDraft({ onlyBorderColor: event.target.checked })}
                                            className="size-4 accent-amber"
                                        />
                                        Color the border only
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={draft.disableSend}
                                            onChange={(event) => patchDraft({ disableSend: event.target.checked })}
                                            className="size-4 accent-amber"
                                        />
                                        Paste into the message box instead of running
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={draft.injectInput}
                                            onChange={(event) => patchDraft({ injectInput: event.target.checked })}
                                            className="size-4 accent-amber"
                                        />
                                        Append to the typed message instead of replacing it
                                    </label>
                                    <label className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={draft.placeBeforeInput}
                                            disabled={!draft.injectInput}
                                            onChange={(event) => patchDraft({ placeBeforeInput: event.target.checked })}
                                            className="size-4 accent-amber disabled:opacity-50"
                                        />
                                        Put the reply before the typed text
                                    </label>
                                </div>
                            </div>

                            <div className="border-t border-line-soft pt-3">
                                <div className="flex items-center justify-between gap-2">
                                    <div>
                                        <h4 className="text-sm font-medium text-parchment">Buttons</h4>
                                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
                                            Plain text goes into the message box. Start with <code>/send</code>,{' '}
                                            <code>/sys</code> (<code>/nar</code>), <code>/echo</code>,{' '}
                                            <code>/trigger</code>, <code>/continue</code>, <code>/regenerate</code> or{' '}
                                            <code>/run</code> to run commands; separate commands with <code>|</code>.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn-ghost h-8 shrink-0 px-2.5 text-xs"
                                        onClick={addItem}
                                    >
                                        <Plus size={13} />
                                        Add
                                    </button>
                                </div>

                                <div className="mt-3 space-y-2">
                                    {draft.qrList.length === 0 ? (
                                        <p className="text-xs text-muted">This set has no buttons yet.</p>
                                    ) : null}
                                    {draft.qrList.map((item, index) => (
                                        <div
                                            key={item.id}
                                            className="rounded-lg border border-line-soft bg-ink/30 p-2.5"
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="w-7 shrink-0 text-[10px] tabular-nums text-muted">
                                                    #{item.id}
                                                </span>
                                                <input
                                                    className="input-shell h-8 flex-1 py-1 text-xs"
                                                    value={item.label}
                                                    maxLength={200}
                                                    placeholder="Label shown on the button"
                                                    onChange={(event) =>
                                                        patchItem(index, { label: event.target.value })
                                                    }
                                                />
                                                <label className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
                                                    <input
                                                        type="checkbox"
                                                        checked={item.isHidden}
                                                        onChange={(event) =>
                                                            patchItem(index, { isHidden: event.target.checked })
                                                        }
                                                        className="size-3.5 accent-amber"
                                                    />
                                                    Hidden
                                                </label>
                                                <button
                                                    type="button"
                                                    className="icon-btn size-6"
                                                    onClick={() => moveItem(index, -1)}
                                                    disabled={index === 0}
                                                    title="Move up"
                                                    aria-label="Move quick reply up"
                                                >
                                                    <ArrowUp size={12} />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="icon-btn size-6"
                                                    onClick={() => moveItem(index, 1)}
                                                    disabled={index === draft.qrList.length - 1}
                                                    title="Move down"
                                                    aria-label="Move quick reply down"
                                                >
                                                    <ArrowDown size={12} />
                                                </button>
                                                <button
                                                    type="button"
                                                    className="icon-btn size-6 hover:text-wine"
                                                    onClick={() => removeItem(index)}
                                                    title="Remove"
                                                    aria-label="Remove quick reply"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                            <input
                                                className="input-shell mt-1.5 h-8 py-1 text-xs"
                                                value={item.title}
                                                maxLength={500}
                                                placeholder="Tooltip (optional)"
                                                onChange={(event) => patchItem(index, { title: event.target.value })}
                                            />
                                            <textarea
                                                className="input-shell mt-1.5 min-h-16 resize-y py-1.5 font-mono text-xs leading-relaxed"
                                                value={item.message}
                                                maxLength={20000}
                                                placeholder="Message, or /command | /command"
                                                onChange={(event) => patchItem(index, { message: event.target.value })}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-2">
                                <p className="text-[11px] text-muted">{dirty ? 'Unsaved changes.' : 'Saved.'}</p>
                                <button
                                    type="button"
                                    className="btn-primary"
                                    onClick={() => void handleSave()}
                                    disabled={saveSet.isPending}
                                >
                                    {saveSet.isPending ? <Spinner size={15} /> : <Save size={15} />}
                                    Save set
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="rounded-xl border border-dashed border-line-soft p-6 text-sm text-muted">
                            Create a set or import one to start adding buttons.
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
