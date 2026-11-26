import type { AliasRun, AliasRunItem } from '@catcup/shared';
import { Check, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';

import { cn } from '../lib/cn';

/**
 * The rows an alias run produced, before any of them is written.
 *
 * Two rules, the same two the distillation sheet follows. **Nothing is kept that
 * was not ticked**, so an untick is a real exclusion. And **the names are
 * editable here**, because a model that proposes "the Princess" for an entry
 * whose comment already says "The Princess" is making an ordinary mistake a
 * person fixes in a second.
 *
 * A row starts at the aliases the entry already had plus what the model added.
 * That is why unticking a name and unticking a row are different actions: one
 * keeps the entry's existing aliases and drops the proposal, the other leaves
 * the entry exactly as it is.
 */

export interface AliasReviewRow {
    uid: number;
    label: string;
    existing: string[];
    proposed: string[];
    /** Names the person removed from the proposal. */
    dropped: Set<string>;
    accepted: boolean;
    message?: string;
}

/** Build the editable rows from a finished run. */
export function rowsFromRun(run: AliasRun): AliasReviewRow[] {
    return run.items
        .filter((item) => item.state === 'done' || item.state === 'incomplete')
        .map((item: AliasRunItem) => ({
            uid: item.uid,
            label: item.label,
            existing: item.existing,
            proposed: item.proposed ?? [],
            dropped: new Set<string>(),
            accepted: (item.proposed?.length ?? 0) > 0,
            ...(item.message ? { message: item.message } : {}),
        }));
}

/** The names a row would write: what it already had, plus what it kept. */
export function keptOf(row: AliasReviewRow): string[] {
    return [...row.existing, ...row.proposed.filter((alias) => !row.dropped.has(alias))];
}

function Row({
    row,
    onToggle,
    onDrop,
}: {
    row: AliasReviewRow;
    onToggle: () => void;
    onDrop: (alias: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const kept = keptOf(row).length;

    return (
        <li className="rounded-xl border border-line-soft bg-surface/40">
            <div className="flex items-start gap-2 px-3 py-2">
                <input
                    checked={row.accepted}
                    className="mt-1 size-4 shrink-0 accent-amber"
                    onChange={onToggle}
                    type="checkbox"
                    aria-label={`Keep the new names for ${row.label}`}
                />
                <button
                    aria-expanded={open}
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setOpen((value) => !value)}
                    type="button"
                >
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm text-parchment">{row.label}</span>
                        {row.proposed.length > 0 ? (
                            <span className="rounded-full bg-sage/20 px-2 py-0.5 text-caption uppercase tracking-[0.12em] text-sage">
                                {row.proposed.length} new
                            </span>
                        ) : null}
                        {row.existing.length > 0 ? (
                            <span className="text-caption text-muted">{row.existing.length} existing</span>
                        ) : null}
                    </span>
                    {row.proposed.length > 0 ? (
                        <span className="mt-0.5 block truncate text-footnote text-muted">
                            {row.proposed.join(', ')}
                        </span>
                    ) : null}
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

            {open ? (
                <div className="space-y-2 border-t border-line-soft px-3 py-3">
                    {row.message ? <p className="text-footnote text-muted">{row.message}</p> : null}

                    {row.existing.length > 0 ? (
                        <div>
                            <p className="label-text mb-0">Already there</p>
                            <ul className="mt-1 flex flex-wrap gap-1.5">
                                {row.existing.map((alias) => (
                                    <li
                                        className="rounded border border-line bg-surface/60 px-2 py-0.5 font-mono text-footnote text-parchment-dim"
                                        key={alias}
                                    >
                                        {alias}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ) : null}

                    {row.proposed.length > 0 ? (
                        <div>
                            <p className="label-text mb-0">Proposed</p>
                            <ul className="mt-1 flex flex-wrap gap-1.5">
                                {row.proposed.map((alias) => {
                                    const gone = row.dropped.has(alias);
                                    return (
                                        <li key={alias}>
                                            <button
                                                aria-pressed={!gone}
                                                className={cn(
                                                    'rounded border px-2 py-0.5 font-mono text-footnote transition',
                                                    gone
                                                        ? 'border-line-soft text-muted line-through'
                                                        : 'border-amber/40 bg-amber/10 text-parchment',
                                                )}
                                                onClick={() => onDrop(alias)}
                                                title={gone ? `Keep "${alias}"` : `Drop "${alias}"`}
                                                type="button"
                                            >
                                                {alias}
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                            <p className="field-hint">
                                Click a name to drop it. Unticking the row keeps the old list only.
                            </p>
                        </div>
                    ) : null}

                    <p className="text-footnote text-muted">
                        {row.accepted && kept > row.existing.length
                            ? `This entry would answer to ${kept} names.`
                            : 'This entry would keep the names it already has.'}
                    </p>
                </div>
            ) : null}
        </li>
    );
}

export function AliasReview({
    run,
    rows,
    onChange,
}: {
    run: AliasRun;
    rows: AliasReviewRow[];
    onChange: (next: AliasReviewRow[]) => void;
}) {
    const [onlyKept, setOnlyKept] = useState(false);

    const shown = useMemo(() => (onlyKept ? rows.filter((row) => row.accepted) : rows), [rows, onlyKept]);
    const accepted = rows.filter((row) => row.accepted).length;
    const adding = rows.filter((row) => row.accepted && row.proposed.some((alias) => !row.dropped.has(alias))).length;

    const setAll = (value: boolean) => {
        onChange(rows.map((row) => ({ ...row, accepted: value && row.proposed.length > 0 })));
    };

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted">
                    {run.items.length} entries read · {rows.length} with an answer · {accepted} kept
                    {adding > 0 ? ` · ${adding} would gain names` : ''}
                </p>
                <div className="flex items-center gap-1">
                    <button className="btn-ghost py-1.5 text-xs" onClick={() => setAll(true)} type="button">
                        <Check className="size-3.5" />
                        Keep all
                    </button>
                    <button className="btn-ghost py-1.5 text-xs" onClick={() => setAll(false)} type="button">
                        Keep none
                    </button>
                    <label className="flex items-center gap-1.5 text-footnote text-muted">
                        <input
                            checked={onlyKept}
                            className="size-3.5 accent-amber"
                            onChange={(event) => setOnlyKept(event.target.checked)}
                            type="checkbox"
                        />
                        Kept only
                    </label>
                </div>
            </div>

            {rows.length === 0 ? (
                <p className="rounded-xl border border-line-soft bg-surface/40 px-4 py-6 text-center text-sm text-muted">
                    The run finished without a usable answer for any entry.
                </p>
            ) : null}

            <ul className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">
                {shown.map((row) => (
                    <Row
                        key={row.uid}
                        onDrop={(alias) => {
                            const dropped = new Set(row.dropped);
                            if (dropped.has(alias)) {
                                dropped.delete(alias);
                            } else {
                                dropped.add(alias);
                            }
                            onChange(rows.map((item) => (item.uid === row.uid ? { ...item, dropped } : item)));
                        }}
                        onToggle={() =>
                            onChange(
                                rows.map((item) =>
                                    item.uid === row.uid ? { ...item, accepted: !row.accepted } : item,
                                ),
                            )
                        }
                        row={row}
                    />
                ))}
            </ul>

            {run.items.some((item) => item.state === 'incomplete' || item.state === 'skipped') ? (
                <p className="text-footnote leading-relaxed text-muted">
                    {run.items.filter((item) => item.state === 'incomplete').length} entries could not be read and{' '}
                    {run.items.filter((item) => item.state === 'skipped').length} were skipped. Those rows are left
                    exactly as they are.
                </p>
            ) : null}
        </div>
    );
}
