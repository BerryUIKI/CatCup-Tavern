import type { DistillCharacterDraft, DistillEntryDraft, ItemScope } from '@catcup/shared';
import { BookOpen, Check, ChevronDown, Merge, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '../lib/cn';

/**
 * The review sheet: what a run found, before any of it is written.
 *
 * Two rules shape it. **Nothing is kept that was not ticked**, so an untick is
 * a real exclusion rather than a hint. And **the text is editable here**, not
 * in a second screen — a distilled entry is a draft, and the moment to fix a
 * bad key is while the chapter it came from is on the same row.
 *
 * Rows group by chapter because that is the unit a person remembers a book in,
 * and the entry fields are the same three the world info editor shows, so the
 * shape learned here carries over.
 */

export interface ReviewState {
    entries: DistillEntryDraft[];
    characters: DistillCharacterDraft[];
}

type Tab = 'entries' | 'characters';

function ConfidenceMark({ confidence }: { confidence: 'high' | 'low' }) {
    return (
        <span
            className={cn(
                'shrink-0 rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.12em]',
                confidence === 'high' ? 'bg-sage/20 text-sage' : 'bg-surface-3 text-muted',
            )}
        >
            {confidence === 'high' ? 'High' : 'Low'}
        </span>
    );
}

function Row({
    checked,
    onToggle,
    header,
    meta,
    children,
}: {
    checked: boolean;
    onToggle: () => void;
    header: string;
    meta?: React.ReactNode;
    children: React.ReactNode;
}) {
    const [open, setOpen] = useState(false);

    return (
        <li className="rounded-xl border border-line-soft bg-surface/40">
            <div className="flex items-start gap-2 px-3 py-2">
                <input
                    checked={checked}
                    className="mt-1 size-4 shrink-0 accent-amber"
                    onChange={onToggle}
                    type="checkbox"
                />
                <button
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setOpen((value) => !value)}
                    type="button"
                >
                    <span className="flex items-center gap-2">
                        <span className="truncate text-sm text-parchment">{header}</span>
                        {meta}
                    </span>
                </button>
                <button
                    aria-expanded={open}
                    aria-label={open ? 'Hide details' : 'Show details'}
                    className="icon-btn size-7 shrink-0"
                    onClick={() => setOpen((value) => !value)}
                    type="button"
                >
                    <ChevronDown className={cn('size-4 transition', open && 'rotate-180')} />
                </button>
            </div>
            {open ? <div className="space-y-3 border-t border-line-soft px-3 py-3">{children}</div> : null}
        </li>
    );
}

function EntryFields({
    entry,
    onChange,
}: {
    entry: DistillEntryDraft;
    onChange: (patch: Partial<DistillEntryDraft>) => void;
}) {
    return (
        <>
            <div>
                <label className="label-text" htmlFor={`entry-comment-${entry.comment}-${entry.chapter}`}>
                    Comment
                </label>
                <input
                    className="input-shell py-2 text-sm"
                    id={`entry-comment-${entry.comment}-${entry.chapter}`}
                    onChange={(event) => onChange({ comment: event.target.value })}
                    value={entry.comment}
                />
            </div>
            <div>
                <label className="label-text" htmlFor={`entry-keys-${entry.comment}-${entry.chapter}`}>
                    Keys
                </label>
                <input
                    className="input-shell py-2 text-sm"
                    id={`entry-keys-${entry.comment}-${entry.chapter}`}
                    onChange={(event) =>
                        onChange({
                            key: event.target.value
                                .split(',')
                                .map((key) => key.trim())
                                .filter(Boolean),
                        })
                    }
                    placeholder="comma separated"
                    value={entry.key.join(', ')}
                />
                <p className="field-hint">What someone would type in play to bring this up.</p>
            </div>
            <div>
                <label className="label-text" htmlFor={`entry-content-${entry.comment}-${entry.chapter}`}>
                    Content
                </label>
                <textarea
                    className="input-shell min-h-40 py-2 font-mono text-xs leading-relaxed"
                    id={`entry-content-${entry.comment}-${entry.chapter}`}
                    onChange={(event) => onChange({ content: event.target.value })}
                    value={entry.content}
                />
            </div>
        </>
    );
}

function CharacterFields({
    character,
    onChange,
}: {
    character: DistillCharacterDraft;
    onChange: (patch: Partial<DistillCharacterDraft>) => void;
}) {
    const fields: Array<{ key: keyof DistillCharacterDraft; label: string; rows?: number }> = [
        { key: 'description', label: 'Description', rows: 5 },
        { key: 'personality', label: 'Personality', rows: 3 },
        { key: 'scenario', label: 'Scenario', rows: 3 },
        { key: 'first_mes', label: 'First message', rows: 4 },
        { key: 'mes_example', label: 'Example messages', rows: 3 },
    ];

    return (
        <>
            {fields.map((field) => (
                <div key={field.key}>
                    <label className="label-text" htmlFor={`character-${field.key}-${character.name}`}>
                        {field.label}
                    </label>
                    <textarea
                        className="input-shell py-2 text-sm leading-relaxed"
                        id={`character-${field.key}-${character.name}`}
                        onChange={(event) => onChange({ [field.key]: event.target.value })}
                        rows={field.rows}
                        value={String(character[field.key])}
                    />
                </div>
            ))}
        </>
    );
}

export function ReviewSheet({
    draft,
    onChange,
    worldName,
    onWorldNameChange,
    scope,
    onScopeChange,
}: {
    draft: ReviewState;
    onChange: (next: ReviewState) => void;
    worldName: string;
    onWorldNameChange: (value: string) => void;
    scope: ItemScope;
    onScopeChange: (value: ItemScope) => void;
}) {
    const [tab, setTab] = useState<Tab>('entries');
    const [selected, setSelected] = useState<Set<number>>(new Set());

    const kept = draft.entries.filter((entry) => entry.accepted).length;
    const keptCharacters = draft.characters.filter((character) => character.accepted).length;

    /** Entries grouped by chapter, in the book's order. */
    const groups = useMemo(() => {
        const byChapter = new Map<string, number[]>();
        draft.entries.forEach((entry, index) => {
            const chapter = entry.chapter || 'Unfiled';
            byChapter.set(chapter, [...(byChapter.get(chapter) ?? []), index]);
        });
        return [...byChapter.entries()];
    }, [draft.entries]);

    /**
     * Rows with a key that survives an edit.
     *
     * A name is the closest thing a draft has to an identity, and two characters
     * can share one, so a repeat gets its ordinal — but an index alone would
     * make every row below a deletion re-mount and lose the open state.
     */
    const entryRows = useMemo(() => {
        const seen = new Map<string, number>();
        return draft.entries.map((entry, index) => {
            const base = entry.comment || 'entry';
            const seenCount = seen.get(base) ?? 0;
            seen.set(base, seenCount + 1);
            return { entry, index, key: `${base}#${seenCount}` };
        });
    }, [draft.entries]);

    const characterRows = useMemo(() => {
        const seen = new Map<string, number>();
        return draft.characters.map((character, index) => {
            const seenCount = seen.get(character.name) ?? 0;
            seen.set(character.name, seenCount + 1);
            return { character, index, key: `${character.name}#${seenCount}` };
        });
    }, [draft.characters]);

    const patchEntry = (index: number, patch: Partial<DistillEntryDraft>) => {
        onChange({
            ...draft,
            entries: draft.entries.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
        });
    };

    const patchCharacter = (index: number, patch: Partial<DistillCharacterDraft>) => {
        onChange({
            ...draft,
            characters: draft.characters.map((character, at) =>
                at === index ? { ...character, ...patch } : character,
            ),
        });
    };

    const toggleSelected = (index: number) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(index)) {
                next.delete(index);
            } else {
                next.add(index);
            }
            return next;
        });
    };

    /**
     * Merge every selected row into the first of them.
     *
     * The cases this exists for are the ones clustering gets wrong: "Bram" and
     * "Bram Wyrd" arriving as two people, or one place described under two
     * names. Contents concatenate, keys union, and the highest mention count
     * survives so the merged row keeps the outline it earned.
     */
    const mergeSelected = () => {
        const indexes = [...selected].sort((a, b) => a - b);
        const [first, ...rest] = indexes;
        if (first === undefined || rest.length === 0) {
            return;
        }

        const target = draft.entries[first];
        if (!target) {
            return;
        }

        const absorbed = rest
            .map((index) => draft.entries[index])
            .filter((row): row is DistillEntryDraft => Boolean(row));
        const merged: DistillEntryDraft = {
            ...target,
            key: [...new Set([...target.key, ...absorbed.flatMap((row) => row.key)])].slice(0, 8),
            keysecondary: [...new Set([...target.keysecondary, ...absorbed.flatMap((row) => row.keysecondary)])],
            content: [target.content, ...absorbed.map((row) => row.content)].filter(Boolean).join('\n\n'),
            evidence: [target.evidence, ...absorbed.map((row) => row.evidence)].filter(Boolean).join('\n\n'),
            mentions: target.mentions + absorbed.reduce((sum, row) => sum + row.mentions, 0),
            confidence: absorbed.some((row) => row.confidence === 'high') ? 'high' : target.confidence,
        };

        const dropped = new Set(rest);
        onChange({
            ...draft,
            entries: draft.entries
                .map((row, index) => (index === first ? merged : row))
                .filter((_row, index) => !dropped.has(index)),
        });
        setSelected(new Set());
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-52 flex-1">
                    <label className="label-text" htmlFor="distill-world-name">
                        World info book name
                    </label>
                    <input
                        className="input-shell py-2 text-sm"
                        id="distill-world-name"
                        onChange={(event) => onWorldNameChange(event.target.value)}
                        value={worldName}
                    />
                </div>
                <div>
                    <label className="label-text" htmlFor="distill-scope">
                        Write to
                    </label>
                    <select
                        className="input-shell py-2 text-sm"
                        id="distill-scope"
                        onChange={(event) => onScopeChange(event.target.value as ItemScope)}
                        value={scope}
                    >
                        <option value="profile">This profile</option>
                        <option value="shared">Shared — every profile</option>
                    </select>
                </div>
            </div>

            <div className="flex items-center gap-1 border-b border-line-soft pb-2" role="tablist">
                {(
                    [
                        ['entries', `World info (${kept})`, BookOpen],
                        ['characters', `Characters (${keptCharacters})`, UserRound],
                    ] as const
                ).map(([value, label, Icon]) => (
                    <button
                        aria-selected={tab === value}
                        className={cn(
                            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition',
                            tab === value ? 'bg-surface-2 text-parchment' : 'text-muted hover:text-parchment',
                        )}
                        key={value}
                        onClick={() => setTab(value)}
                        role="tab"
                        type="button"
                    >
                        <Icon className="size-4" />
                        {label}
                    </button>
                ))}
            </div>

            {tab === 'entries' ? (
                <div className="space-y-4">
                    {draft.entries.length === 0 ? (
                        <p className="rounded-xl border border-line-soft bg-surface/40 px-4 py-6 text-center text-sm text-muted">
                            This run found no entries.
                        </p>
                    ) : (
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-muted">
                                {draft.entries.length} found, {kept} kept. Unticked rows are not written.
                            </p>
                            <button
                                className="btn-ghost py-1.5 text-xs"
                                disabled={selected.size < 2}
                                onClick={mergeSelected}
                                type="button"
                            >
                                <Merge className="size-3.5" />
                                Merge into first
                            </button>
                        </div>
                    )}

                    {groups.map(([chapter, indexes]) => (
                        <section key={chapter} className="space-y-2">
                            <h4 className="text-[11px] uppercase tracking-[0.14em] text-muted/80">{chapter}</h4>
                            <ul className="space-y-2">
                                {indexes.map((index) => {
                                    const entry = draft.entries[index];
                                    const row = entryRows[index];
                                    if (!entry || !row) {
                                        return null;
                                    }
                                    return (
                                        <Row
                                            checked={entry.accepted}
                                            header={entry.comment || '(untitled)'}
                                            key={row.key}
                                            meta={
                                                <>
                                                    <ConfidenceMark confidence={entry.confidence} />
                                                    {selected.has(index) ? (
                                                        <span className="text-[10px] text-amber">selected</span>
                                                    ) : null}
                                                </>
                                            }
                                            onToggle={() => patchEntry(index, { accepted: !entry.accepted })}
                                        >
                                            <label className="flex items-center gap-2 text-xs text-muted">
                                                <input
                                                    checked={selected.has(index)}
                                                    className="size-3.5 accent-amber"
                                                    onChange={() => toggleSelected(index)}
                                                    type="checkbox"
                                                />
                                                Include in a merge
                                            </label>
                                            {entry.evidence ? (
                                                <blockquote className="border-l-2 border-ember/60 pl-3 text-xs italic leading-relaxed text-parchment-dim">
                                                    {entry.evidence}
                                                </blockquote>
                                            ) : null}
                                            <EntryFields entry={entry} onChange={(patch) => patchEntry(index, patch)} />
                                        </Row>
                                    );
                                })}
                            </ul>
                        </section>
                    ))}
                </div>
            ) : (
                <div className="space-y-2">
                    {draft.characters.length === 0 ? (
                        <p className="rounded-xl border border-line-soft bg-surface/40 px-4 py-6 text-center text-sm text-muted">
                            This run drafted no characters.
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {characterRows.map(({ character, index, key }) => (
                                <Row
                                    checked={character.accepted}
                                    header={character.name}
                                    key={key}
                                    meta={
                                        <>
                                            <ConfidenceMark confidence={character.confidence} />
                                            {character.aliases.length > 0 ? (
                                                <span className="truncate text-[11px] text-muted">
                                                    also {character.aliases.join(', ')}
                                                </span>
                                            ) : null}
                                        </>
                                    }
                                    onToggle={() => patchCharacter(index, { accepted: !character.accepted })}
                                >
                                    {character.evidence ? (
                                        <blockquote className="border-l-2 border-ember/60 pl-3 text-xs italic leading-relaxed text-parchment-dim">
                                            {character.evidence}
                                        </blockquote>
                                    ) : null}
                                    <CharacterFields
                                        character={character}
                                        onChange={(patch) => patchCharacter(index, patch)}
                                    />
                                </Row>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            <p className="flex items-center gap-2 text-xs text-muted">
                <Check className="size-3.5 text-sage" />
                Nothing is written until you accept.
            </p>
        </div>
    );
}
