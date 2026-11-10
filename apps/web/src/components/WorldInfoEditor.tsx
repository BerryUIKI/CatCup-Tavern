import {
    formatKeywords,
    PROMPT_ROLE,
    splitKeywordsAndRegexes,
    WORLD_INFO_LOGIC,
    WORLD_INFO_POSITION,
    type WorldInfoEntryPatch,
    type WorldInfoEntryView,
} from '@catcup/shared';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Plus, Save, Search, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import {
    useCreateWorldEntry,
    useDeleteWorldEntry,
    useDuplicateWorldEntry,
    useReorderWorldEntries,
    useUpdateWorldEntry,
    useWorld,
} from '../hooks/data';
import { cn } from '../lib/cn';
import { useAppStore } from '../store/app';
import { Spinner } from './Spinner';

const POSITION_LABELS: Record<number, string> = {
    [WORLD_INFO_POSITION.BEFORE_CHAR]: 'Before character',
    [WORLD_INFO_POSITION.AFTER_CHAR]: 'After character',
    [WORLD_INFO_POSITION.AN_TOP]: "Author's note top",
    [WORLD_INFO_POSITION.AN_BOTTOM]: "Author's note bottom",
    [WORLD_INFO_POSITION.AT_DEPTH]: 'At chat depth',
    [WORLD_INFO_POSITION.EM_TOP]: 'Example messages top',
    [WORLD_INFO_POSITION.EM_BOTTOM]: 'Example messages bottom',
    [WORLD_INFO_POSITION.OUTLET]: 'Outlet',
};

const LOGIC_LABELS: Record<number, string> = {
    [WORLD_INFO_LOGIC.AND_ANY]: 'AND ANY — all keys are optional',
    [WORLD_INFO_LOGIC.NOT_ALL]: 'NOT ALL — activate unless all keys match',
    [WORLD_INFO_LOGIC.NOT_ANY]: 'NOT ANY — activate unless one key matches',
    [WORLD_INFO_LOGIC.AND_ALL]: 'AND ALL — every key must match',
};

/** Everything the editor form exposes, with keyword lists kept as text. */
interface EntryDraft {
    comment: string;
    content: string;
    key: string;
    keysecondary: string;
    constant: boolean;
    disable: boolean;
    probability: number;
    useProbability: boolean;
    selectiveLogic: number;
    order: number;
    position: number;
    depth: number;
    role: number | null;
    scanDepth: number | null;
    caseSensitive: boolean | null;
    matchWholeWords: boolean | null;
    useGroupScoring: boolean | null;
    group: string;
    groupWeight: number;
    groupOverride: boolean;
    sticky: number;
    cooldown: number;
    delay: number;
    delayUntilRecursion: number;
    excludeRecursion: boolean;
    preventRecursion: boolean;
    ignoreBudget: boolean;
    outletName: string;
    matchPersonaDescription: boolean;
    matchCharacterDescription: boolean;
    matchCharacterPersonality: boolean;
    matchCharacterDepthPrompt: boolean;
    matchScenario: boolean;
    matchCreatorNotes: boolean;
    triggers: string;
}

function toDraft(entry: WorldInfoEntryView): EntryDraft {
    return {
        comment: entry.comment,
        content: entry.content,
        key: formatKeywords(entry.key),
        keysecondary: formatKeywords(entry.keysecondary),
        constant: entry.constant,
        disable: entry.disable,
        probability: entry.probability,
        useProbability: entry.useProbability,
        selectiveLogic: entry.selectiveLogic,
        order: entry.order,
        position: entry.position,
        depth: entry.depth,
        role: entry.role,
        scanDepth: entry.scanDepth,
        caseSensitive: entry.caseSensitive,
        matchWholeWords: entry.matchWholeWords,
        useGroupScoring: entry.useGroupScoring,
        group: entry.group,
        groupWeight: entry.groupWeight,
        groupOverride: entry.groupOverride,
        sticky: entry.sticky,
        cooldown: entry.cooldown,
        delay: entry.delay,
        delayUntilRecursion: entry.delayUntilRecursion === true ? 1 : Number(entry.delayUntilRecursion) || 0,
        excludeRecursion: entry.excludeRecursion,
        preventRecursion: entry.preventRecursion,
        ignoreBudget: entry.ignoreBudget,
        outletName: entry.outletName,
        matchPersonaDescription: entry.matchPersonaDescription,
        matchCharacterDescription: entry.matchCharacterDescription,
        matchCharacterPersonality: entry.matchCharacterPersonality,
        matchCharacterDepthPrompt: entry.matchCharacterDepthPrompt,
        matchScenario: entry.matchScenario,
        matchCreatorNotes: entry.matchCreatorNotes,
        triggers: formatKeywords(entry.triggers),
    };
}

function toPatch(draft: EntryDraft): WorldInfoEntryPatch {
    return {
        comment: draft.comment,
        content: draft.content,
        key: splitKeywordsAndRegexes(draft.key),
        keysecondary: splitKeywordsAndRegexes(draft.keysecondary),
        constant: draft.constant,
        disable: draft.disable,
        probability: draft.probability,
        useProbability: draft.useProbability,
        selectiveLogic: draft.selectiveLogic,
        order: draft.order,
        position: draft.position,
        depth: draft.depth,
        // SillyTavern nulls the role for every position except at-depth.
        role: draft.position === WORLD_INFO_POSITION.AT_DEPTH ? (draft.role ?? PROMPT_ROLE.SYSTEM) : null,
        scanDepth: draft.scanDepth,
        caseSensitive: draft.caseSensitive,
        matchWholeWords: draft.matchWholeWords,
        useGroupScoring: draft.useGroupScoring,
        group: draft.group,
        groupWeight: draft.groupWeight,
        groupOverride: draft.groupOverride,
        sticky: draft.sticky,
        cooldown: draft.cooldown,
        delay: draft.delay,
        delayUntilRecursion: draft.delayUntilRecursion,
        excludeRecursion: draft.excludeRecursion,
        preventRecursion: draft.preventRecursion,
        ignoreBudget: draft.ignoreBudget,
        outletName: draft.outletName,
        matchPersonaDescription: draft.matchPersonaDescription,
        matchCharacterDescription: draft.matchCharacterDescription,
        matchCharacterPersonality: draft.matchCharacterPersonality,
        matchCharacterDepthPrompt: draft.matchCharacterDepthPrompt,
        matchScenario: draft.matchScenario,
        matchCreatorNotes: draft.matchCreatorNotes,
        triggers: splitKeywordsAndRegexes(draft.triggers),
    };
}

function entryTitle(entry: WorldInfoEntryView): string {
    if (entry.comment.trim()) {
        return entry.comment.trim();
    }
    if (entry.key.length > 0) {
        return entry.key.join(', ');
    }
    return `Entry ${entry.uid}`;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div>
            <span className="label-text">{label}</span>
            {children}
            {hint ? <p className="mt-1 text-[11px] leading-relaxed text-muted/70">{hint}</p> : null}
        </div>
    );
}

type Section = 'content' | 'matching' | 'placement' | 'effects';

const SECTIONS: { id: Section; label: string }[] = [
    { id: 'content', label: 'Content' },
    { id: 'matching', label: 'Matching' },
    { id: 'placement', label: 'Placement' },
    { id: 'effects', label: 'Effects' },
];

/**
 * Edit the entries of one world info book.
 *
 * Saved per entry rather than per keystroke: SillyTavern writes on every field
 * change, but a network round trip behind every edit would make the form feel
 * unpredictable on a slow host. The list marks unsaved work, and switching away
 * from a dirty entry asks first.
 */
export function WorldInfoEditor({ bookId, onClose }: { bookId: string; onClose: () => void }) {
    const worldQuery = useWorld(bookId);
    const createEntry = useCreateWorldEntry(bookId);
    const duplicateEntry = useDuplicateWorldEntry(bookId);
    const updateEntry = useUpdateWorldEntry(bookId);
    const deleteEntry = useDeleteWorldEntry(bookId);
    const reorderEntries = useReorderWorldEntries(bookId);
    const pushToast = useAppStore((state) => state.pushToast);

    const entries = useMemo(() => worldQuery.data?.world.entries ?? [], [worldQuery.data]);

    const [selectedUid, setSelectedUid] = useState<number | null>(null);
    const [draft, setDraft] = useState<EntryDraft | null>(null);
    const [search, setSearch] = useState('');
    const [section, setSection] = useState<Section>('content');
    const dirtyRef = useRef(false);

    const selected = useMemo(() => entries.find((entry) => entry.uid === selectedUid) ?? null, [entries, selectedUid]);

    // Select the first entry once the book loads.
    useEffect(() => {
        if (selectedUid === null && entries.length > 0) {
            setSelectedUid(entries[0]?.uid ?? null);
        }
    }, [entries, selectedUid]);

    // Refresh the form whenever the selection or the stored book changes.
    // Every mutation returns the whole book, so this is what makes a save show
    // up in the form. Anything that triggers a refresh while the draft is dirty
    // asks first, so a refresh never loses typing silently.
    useEffect(() => {
        const entry = entries.find((candidate) => candidate.uid === selectedUid) ?? null;
        setDraft(entry ? toDraft(entry) : null);
        dirtyRef.current = false;
    }, [entries, selectedUid]);

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase();
        if (!term) {
            return entries;
        }
        return entries.filter((entry) =>
            [entry.comment, entry.content, entry.key.join(' '), entry.keysecondary.join(' ')]
                .join('\n')
                .toLowerCase()
                .includes(term),
        );
    }, [entries, search]);

    const update = <K extends keyof EntryDraft>(field: K, value: EntryDraft[K]) => {
        dirtyRef.current = true;
        setDraft((current) => (current ? { ...current, [field]: value } : current));
    };

    /** Every action that refreshes the book must not silently drop a draft. */
    const confirmDiscard = () => !dirtyRef.current || window.confirm('Discard the unsaved changes to this entry?');

    const select = (uid: number) => {
        if (uid === selectedUid) {
            return;
        }
        if (!confirmDiscard()) {
            return;
        }
        setSelectedUid(uid);
    };

    const save = async () => {
        if (!selected || !draft) {
            return;
        }
        try {
            await updateEntry.mutateAsync({ uid: selected.uid, patch: toPatch(draft) });
            dirtyRef.current = false;
            pushToast('Entry saved.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not save the entry.', 'error');
        }
    };

    const addEntry = async () => {
        if (!confirmDiscard()) {
            return;
        }
        try {
            const result = await createEntry.mutateAsync();
            dirtyRef.current = false;
            setSelectedUid(result.uid ?? null);
            setSection('content');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not create the entry.', 'error');
        }
    };

    const copyEntry = async (entry: WorldInfoEntryView) => {
        if (!confirmDiscard()) {
            return;
        }
        try {
            const result = await duplicateEntry.mutateAsync(entry.uid);
            dirtyRef.current = false;
            setSelectedUid(result.uid ?? null);
            pushToast('Entry duplicated.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not duplicate the entry.', 'error');
        }
    };

    const removeEntry = async (entry: WorldInfoEntryView) => {
        if (entry.uid !== selectedUid && !confirmDiscard()) {
            return;
        }
        if (!window.confirm(`Delete the entry "${entryTitle(entry)}"? This cannot be undone.`)) {
            return;
        }
        try {
            await deleteEntry.mutateAsync(entry.uid);
            dirtyRef.current = false;
            if (entry.uid === selectedUid) {
                setSelectedUid(null);
            }
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not delete the entry.', 'error');
        }
    };

    const move = async (index: number, delta: number) => {
        const target = index + delta;
        if (target < 0 || target >= entries.length || !confirmDiscard()) {
            return;
        }
        const uids = entries.map((entry) => entry.uid);
        const current = uids[index];
        const other = uids[target];
        if (current === undefined || other === undefined) {
            return;
        }
        uids[index] = other;
        uids[target] = current;
        try {
            await reorderEntries.mutateAsync(uids);
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not reorder the entries.', 'error');
        }
    };

    if (worldQuery.isLoading) {
        return (
            <div className="flex justify-center p-12">
                <Spinner size={20} className="text-muted" />
            </div>
        );
    }

    if (worldQuery.isError) {
        return (
            <div className="space-y-3 p-5">
                <p className="text-sm text-wine">Could not load the book.</p>
                <button type="button" className="btn-ghost" onClick={onClose}>
                    <ArrowLeft size={15} />
                    Back to the book list
                </button>
            </div>
        );
    }

    return (
        <div className="p-5">
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <button type="button" className="btn-ghost" onClick={onClose}>
                    <ArrowLeft size={15} />
                    Books
                </button>
                <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-parchment">{bookId}</h3>
                <span className="text-xs text-muted">
                    {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
                </span>
                <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void addEntry()}
                    disabled={createEntry.isPending}
                >
                    {createEntry.isPending ? <Spinner size={15} /> : <Plus size={15} />}
                    New entry
                </button>
            </div>

            <div className="grid gap-4 md:grid-cols-[240px_1fr]">
                <aside className="min-w-0 space-y-2">
                    <div className="relative">
                        <Search size={13} className="pointer-events-none absolute left-2.5 top-2.5 text-muted" />
                        <input
                            className="input-shell pl-7 text-xs"
                            placeholder="Search entries"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                        />
                    </div>

                    <ul className="max-h-[58vh] space-y-1 overflow-y-auto pr-1">
                        {filtered.map((entry) => {
                            const index = entries.indexOf(entry);
                            return (
                                <li
                                    key={entry.uid}
                                    className={cn(
                                        'rounded-lg border px-2 py-1.5 transition',
                                        entry.uid === selectedUid
                                            ? 'border-amber/40 bg-surface-2'
                                            : 'border-transparent hover:bg-surface/70',
                                    )}
                                >
                                    <div className="flex items-start gap-1.5">
                                        <button
                                            type="button"
                                            className="min-w-0 flex-1 text-left"
                                            onClick={() => select(entry.uid)}
                                        >
                                            <span
                                                className={cn(
                                                    'block truncate text-xs',
                                                    entry.disable ? 'text-muted line-through' : 'text-parchment',
                                                )}
                                            >
                                                {entryTitle(entry)}
                                            </span>
                                            <span className="block truncate text-[10px] text-muted">
                                                {entry.constant ? 'constant · ' : ''}
                                                {POSITION_LABELS[entry.position] ?? `position ${entry.position}`}
                                                {' · order '}
                                                {entry.order}
                                            </span>
                                        </button>
                                        <div className="flex shrink-0 flex-col gap-0.5">
                                            <button
                                                type="button"
                                                className="icon-btn size-4"
                                                onClick={() => void move(index, -1)}
                                                disabled={index <= 0 || reorderEntries.isPending}
                                                aria-label={`Move ${entryTitle(entry)} up`}
                                            >
                                                <ArrowUp size={10} />
                                            </button>
                                            <button
                                                type="button"
                                                className="icon-btn size-4"
                                                onClick={() => void move(index, 1)}
                                                disabled={index >= entries.length - 1 || reorderEntries.isPending}
                                                aria-label={`Move ${entryTitle(entry)} down`}
                                            >
                                                <ArrowDown size={10} />
                                            </button>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    {filtered.length === 0 ? (
                        <p className="px-1 text-xs text-muted">
                            {entries.length === 0 ? 'This book has no entries yet.' : 'No entry matches the search.'}
                        </p>
                    ) : null}
                </aside>

                <section className="min-w-0">
                    {!selected || !draft ? (
                        <div className="rounded-xl border border-line-soft bg-surface/40 p-6 text-center text-sm text-muted">
                            Select an entry to edit it, or create a new one.
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div className="flex flex-wrap items-center gap-1 border-b border-line-soft">
                                {SECTIONS.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => setSection(item.id)}
                                        className={cn(
                                            'rounded-t-lg border-b-2 px-2.5 py-1.5 text-xs transition',
                                            section === item.id
                                                ? 'border-amber text-parchment'
                                                : 'border-transparent text-muted hover:text-parchment-dim',
                                        )}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                                <span className="ml-auto pr-1 text-[10px] text-muted">uid {selected.uid}</span>
                            </div>

                            {section === 'content' ? (
                                <div className="space-y-3">
                                    <Field label="Title" hint="Shown in the entry list. Falls back to the keywords.">
                                        <input
                                            className="input-shell"
                                            value={draft.comment}
                                            onChange={(event) => update('comment', event.target.value)}
                                        />
                                    </Field>
                                    <Field
                                        label="Keywords"
                                        hint="Comma separated. A /pattern/flags keyword is a regular expression, and commas inside one are part of it."
                                    >
                                        <input
                                            className="input-shell font-mono text-xs"
                                            value={draft.key}
                                            onChange={(event) => update('key', event.target.value)}
                                        />
                                    </Field>
                                    <Field
                                        label="Secondary keywords"
                                        hint="Applied with the logic below once a primary keyword matches."
                                    >
                                        <input
                                            className="input-shell font-mono text-xs"
                                            value={draft.keysecondary}
                                            onChange={(event) => update('keysecondary', event.target.value)}
                                        />
                                    </Field>
                                    <Field label="Content">
                                        <textarea
                                            className="input-shell min-h-[160px] resize-y font-mono text-xs leading-relaxed"
                                            value={draft.content}
                                            onChange={(event) => update('content', event.target.value)}
                                        />
                                    </Field>
                                    <div className="flex flex-wrap items-center gap-4 pt-1">
                                        <label className="flex items-center gap-2 text-xs text-parchment-dim">
                                            <input
                                                type="checkbox"
                                                className="accent-amber"
                                                checked={draft.constant}
                                                onChange={(event) => update('constant', event.target.checked)}
                                            />
                                            Always active
                                        </label>
                                        <label className="flex items-center gap-2 text-xs text-parchment-dim">
                                            <input
                                                type="checkbox"
                                                className="accent-amber"
                                                checked={draft.disable}
                                                onChange={(event) => update('disable', event.target.checked)}
                                            />
                                            Disabled
                                        </label>
                                    </div>
                                </div>
                            ) : null}

                            {section === 'matching' ? (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Secondary key logic">
                                        <select
                                            className="input-shell text-xs"
                                            value={draft.selectiveLogic}
                                            onChange={(event) => update('selectiveLogic', Number(event.target.value))}
                                        >
                                            {Object.entries(LOGIC_LABELS).map(([value, label]) => (
                                                <option key={value} value={value}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                    <Field
                                        label="Scan depth"
                                        hint="Empty uses the global setting. A number overrides it for this entry."
                                    >
                                        <NullableNumber
                                            value={draft.scanDepth}
                                            min={0}
                                            onChange={(value) => update('scanDepth', value)}
                                        />
                                    </Field>
                                    <TriState
                                        label="Case sensitive"
                                        value={draft.caseSensitive}
                                        onChange={(value) => update('caseSensitive', value)}
                                    />
                                    <TriState
                                        label="Match whole words"
                                        value={draft.matchWholeWords}
                                        onChange={(value) => update('matchWholeWords', value)}
                                    />
                                    <TriState
                                        label="Use group scoring"
                                        value={draft.useGroupScoring}
                                        onChange={(value) => update('useGroupScoring', value)}
                                    />
                                    <Field
                                        label="Inclusion group"
                                        hint="Comma separated. Only one entry in a group fires."
                                    >
                                        <input
                                            className="input-shell text-xs"
                                            value={draft.group}
                                            onChange={(event) => update('group', event.target.value)}
                                        />
                                    </Field>
                                    <Field label="Group weight">
                                        <input
                                            type="number"
                                            min={1}
                                            className="input-shell text-xs"
                                            value={draft.groupWeight}
                                            onChange={(event) => update('groupWeight', Number(event.target.value))}
                                        />
                                    </Field>
                                    <label className="flex items-end gap-2 pb-1 text-xs text-parchment-dim">
                                        <input
                                            type="checkbox"
                                            className="accent-amber"
                                            checked={draft.groupOverride}
                                            onChange={(event) => update('groupOverride', event.target.checked)}
                                        />
                                        Always win the group
                                    </label>
                                    <div className="sm:col-span-2">
                                        <span className="label-text">Match against</span>
                                        <div className="grid gap-1.5 pt-1 sm:grid-cols-2">
                                            <MatchToggle
                                                label="Persona description"
                                                checked={draft.matchPersonaDescription}
                                                onChange={(value) => update('matchPersonaDescription', value)}
                                            />
                                            <MatchToggle
                                                label="Character description"
                                                checked={draft.matchCharacterDescription}
                                                onChange={(value) => update('matchCharacterDescription', value)}
                                            />
                                            <MatchToggle
                                                label="Character personality"
                                                checked={draft.matchCharacterPersonality}
                                                onChange={(value) => update('matchCharacterPersonality', value)}
                                            />
                                            <MatchToggle
                                                label="Character depth prompt"
                                                checked={draft.matchCharacterDepthPrompt}
                                                onChange={(value) => update('matchCharacterDepthPrompt', value)}
                                            />
                                            <MatchToggle
                                                label="Scenario"
                                                checked={draft.matchScenario}
                                                onChange={(value) => update('matchScenario', value)}
                                            />
                                            <MatchToggle
                                                label="Creator notes"
                                                checked={draft.matchCreatorNotes}
                                                onChange={(value) => update('matchCreatorNotes', value)}
                                            />
                                        </div>
                                    </div>
                                    <Field
                                        label="Generation triggers"
                                        hint="Empty means every generation type. Values: normal, continue, impersonate, swipe, regenerate, quiet."
                                    >
                                        <input
                                            className="input-shell font-mono text-xs"
                                            value={draft.triggers}
                                            onChange={(event) => update('triggers', event.target.value)}
                                        />
                                    </Field>
                                </div>
                            ) : null}

                            {section === 'placement' ? (
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <Field label="Position">
                                        <select
                                            className="input-shell text-xs"
                                            value={draft.position}
                                            onChange={(event) => update('position', Number(event.target.value))}
                                        >
                                            {Object.entries(POSITION_LABELS).map(([value, label]) => (
                                                <option key={value} value={value}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                    <Field
                                        label="Insertion order"
                                        hint="Higher values are inserted closer to the prompt."
                                    >
                                        <input
                                            type="number"
                                            className="input-shell text-xs"
                                            value={draft.order}
                                            onChange={(event) => update('order', Number(event.target.value))}
                                        />
                                    </Field>
                                    {draft.position === WORLD_INFO_POSITION.AT_DEPTH ? (
                                        <>
                                            <Field label="Depth" hint="Messages from the end of the chat.">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    className="input-shell text-xs"
                                                    value={draft.depth}
                                                    onChange={(event) => update('depth', Number(event.target.value))}
                                                />
                                            </Field>
                                            <Field label="Role">
                                                <select
                                                    className="input-shell text-xs"
                                                    value={draft.role ?? PROMPT_ROLE.SYSTEM}
                                                    onChange={(event) => update('role', Number(event.target.value))}
                                                >
                                                    <option value={PROMPT_ROLE.SYSTEM}>System</option>
                                                    <option value={PROMPT_ROLE.USER}>User</option>
                                                    <option value={PROMPT_ROLE.ASSISTANT}>Assistant</option>
                                                </select>
                                            </Field>
                                        </>
                                    ) : null}
                                    {draft.position === WORLD_INFO_POSITION.OUTLET ? (
                                        <Field label="Outlet name">
                                            <input
                                                className="input-shell text-xs"
                                                value={draft.outletName}
                                                onChange={(event) => update('outletName', event.target.value)}
                                            />
                                        </Field>
                                    ) : null}
                                    <Field label="Probability" hint="Chance to activate once the keys match.">
                                        <input
                                            type="number"
                                            min={0}
                                            max={100}
                                            className="input-shell text-xs"
                                            value={draft.probability}
                                            onChange={(event) => update('probability', Number(event.target.value))}
                                        />
                                    </Field>
                                    <label className="flex items-end gap-2 pb-1 text-xs text-parchment-dim">
                                        <input
                                            type="checkbox"
                                            className="accent-amber"
                                            checked={draft.useProbability}
                                            onChange={(event) => update('useProbability', event.target.checked)}
                                        />
                                        Use probability
                                    </label>
                                </div>
                            ) : null}

                            {section === 'effects' ? (
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <Field label="Sticky" hint="Stays active for this many messages.">
                                        <input
                                            type="number"
                                            min={0}
                                            className="input-shell text-xs"
                                            value={draft.sticky}
                                            onChange={(event) => update('sticky', Number(event.target.value))}
                                        />
                                    </Field>
                                    <Field label="Cooldown" hint="Cannot activate again for this many messages.">
                                        <input
                                            type="number"
                                            min={0}
                                            className="input-shell text-xs"
                                            value={draft.cooldown}
                                            onChange={(event) => update('cooldown', Number(event.target.value))}
                                        />
                                    </Field>
                                    <Field
                                        label="Delay"
                                        hint="Cannot activate until the chat is this many messages long."
                                    >
                                        <input
                                            type="number"
                                            min={0}
                                            className="input-shell text-xs"
                                            value={draft.delay}
                                            onChange={(event) => update('delay', Number(event.target.value))}
                                        />
                                    </Field>
                                    <Field
                                        label="Delay until recursion"
                                        hint="0 disables it. A level delays the entry until that recursion pass."
                                    >
                                        <input
                                            type="number"
                                            min={0}
                                            className="input-shell text-xs"
                                            value={draft.delayUntilRecursion}
                                            onChange={(event) =>
                                                update('delayUntilRecursion', Number(event.target.value))
                                            }
                                        />
                                    </Field>
                                    <label className="flex items-end gap-2 pb-1 text-xs text-parchment-dim">
                                        <input
                                            type="checkbox"
                                            className="accent-amber"
                                            checked={draft.excludeRecursion}
                                            onChange={(event) => update('excludeRecursion', event.target.checked)}
                                        />
                                        Exclude from recursion
                                    </label>
                                    <label className="flex items-end gap-2 pb-1 text-xs text-parchment-dim">
                                        <input
                                            type="checkbox"
                                            className="accent-amber"
                                            checked={draft.preventRecursion}
                                            onChange={(event) => update('preventRecursion', event.target.checked)}
                                        />
                                        Prevent further recursion
                                    </label>
                                    <label className="flex items-end gap-2 pb-1 text-xs text-parchment-dim">
                                        <input
                                            type="checkbox"
                                            className="accent-amber"
                                            checked={draft.ignoreBudget}
                                            onChange={(event) => update('ignoreBudget', event.target.checked)}
                                        />
                                        Ignore token budget
                                    </label>
                                </div>
                            ) : null}

                            <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
                                <button
                                    type="button"
                                    className="btn-primary"
                                    onClick={() => void save()}
                                    disabled={updateEntry.isPending}
                                >
                                    {updateEntry.isPending ? <Spinner size={15} /> : <Save size={15} />}
                                    Save entry
                                </button>
                                <button
                                    type="button"
                                    className="btn-ghost"
                                    onClick={() => void copyEntry(selected)}
                                    disabled={duplicateEntry.isPending}
                                >
                                    {duplicateEntry.isPending ? <Spinner size={15} /> : <Copy size={15} />}
                                    Duplicate
                                </button>
                                <button
                                    type="button"
                                    className="btn-ghost hover:text-wine"
                                    onClick={() => void removeEntry(selected)}
                                    disabled={deleteEntry.isPending}
                                >
                                    {deleteEntry.isPending ? <Spinner size={15} /> : <Trash2 size={15} />}
                                    Delete entry
                                </button>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}

function MatchToggle({
    label,
    checked,
    onChange,
}: {
    label: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}) {
    return (
        <label className="flex items-center gap-2 text-xs text-parchment-dim">
            <input
                type="checkbox"
                className="accent-amber"
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
            />
            {label}
        </label>
    );
}

function TriState({
    label,
    value,
    onChange,
}: {
    label: string;
    value: boolean | null;
    onChange: (value: boolean | null) => void;
}) {
    return (
        <Field label={label}>
            <select
                className="input-shell text-xs"
                value={value === null ? 'inherit' : value ? 'on' : 'off'}
                onChange={(event) => {
                    const next = event.target.value;
                    onChange(next === 'inherit' ? null : next === 'on');
                }}
            >
                <option value="inherit">Use global setting</option>
                <option value="on">On</option>
                <option value="off">Off</option>
            </select>
        </Field>
    );
}

function NullableNumber({
    value,
    min,
    onChange,
}: {
    value: number | null;
    min: number;
    onChange: (value: number | null) => void;
}) {
    return (
        <input
            type="number"
            min={min}
            className="input-shell text-xs"
            value={value ?? ''}
            placeholder="Global"
            onChange={(event) => {
                const raw = event.target.value.trim();
                onChange(raw === '' ? null : Number(raw));
            }}
        />
    );
}
