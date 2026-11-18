import { MAX_ALIASES_PER_ENTRY } from '@catcup/shared';
import { Plus, RefreshCw, X } from 'lucide-react';
import { type KeyboardEvent, useId, useState } from 'react';

/**
 * The extra names one entry answers to.
 *
 * Aliases are stored in a sidecar beside the book, not in the entry, so they
 * save on their own rather than with the entry's Save button. That is deliberate:
 * an alias write must never touch the book file, because an entry's identity
 * hash covers its whole raw record and a changed hash detaches the entry's timed
 * effects from every chat that already has a record.
 *
 * Because an alias is matched as a *primary* key, it is not merely additive: it
 * also satisfies `selective` gates and enters inclusion groups, probability and
 * the token budget. The hint says so, because a bad alias can suppress an entry
 * as well as reveal one.
 */
export function AliasChips({
    aliases,
    stale,
    busy,
    onChange,
    onRefresh,
}: {
    aliases: readonly string[];
    /** True when a model produced these against content that has since changed. */
    stale: boolean;
    busy: boolean;
    onChange: (next: string[]) => void;
    /** Ask the model again for this entry. Only offered when the set is stale. */
    onRefresh?: (() => void) | undefined;
}) {
    const [draft, setDraft] = useState('');
    const inputId = useId();
    const hintId = `${inputId}-hint`;
    const full = aliases.length >= MAX_ALIASES_PER_ENTRY;

    const add = (): void => {
        const alias = draft.trim();
        setDraft('');
        if (!alias || full) {
            return;
        }
        // Case-insensitive, because a key differing only by case would fire in
        // exactly the same places.
        if (aliases.some((existing) => existing.toLowerCase() === alias.toLowerCase())) {
            return;
        }
        onChange([...aliases, alias]);
    };

    const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
        if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault();
            add();
        }
        if (event.key === 'Backspace' && !draft && aliases.length > 0) {
            onChange(aliases.slice(0, -1));
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between gap-3">
                <label className="label-text mb-0" htmlFor={inputId}>
                    Also matches
                </label>
                {stale ? (
                    <span className="flex items-center gap-1.5">
                        <span className="rounded border border-amber/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber">
                            Stale
                        </span>
                        {onRefresh ? (
                            <button
                                type="button"
                                className="btn-ghost px-1.5 py-0.5 text-[11px]"
                                disabled={busy}
                                onClick={onRefresh}
                                title="Ask the model again, now that this entry has changed"
                            >
                                <RefreshCw size={11} />
                                Refresh
                            </button>
                        ) : null}
                    </span>
                ) : null}
            </div>

            {aliases.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                    {aliases.map((alias) => (
                        <li
                            key={alias}
                            className="flex items-center gap-1 rounded border border-line bg-surface/60 py-0.5 pr-1 pl-2 text-xs text-parchment"
                        >
                            <span className="font-mono">{alias}</span>
                            <button
                                type="button"
                                className="icon-btn size-5 hover:text-wine"
                                title={`Remove "${alias}"`}
                                aria-label={`Remove the alias ${alias}`}
                                disabled={busy}
                                onClick={() => onChange(aliases.filter((item) => item !== alias))}
                            >
                                <X size={11} />
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}

            <div className="mt-2 flex items-center gap-2">
                <input
                    id={inputId}
                    className="input-shell font-mono text-xs"
                    value={draft}
                    placeholder={full ? 'No room for another alias' : 'Add a name or title this entry answers to'}
                    disabled={busy || full}
                    aria-describedby={hintId}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={onKeyDown}
                />
                <button
                    type="button"
                    className="btn-ghost shrink-0"
                    onClick={add}
                    disabled={busy || full || !draft.trim()}
                >
                    <Plus size={14} />
                    Add
                </button>
            </div>

            <p id={hintId} className="mt-1 text-[11px] leading-relaxed text-muted">
                Extra names this entry fires on, kept beside the book rather than inside it. An alias counts as a
                keyword, so it also satisfies the secondary-key logic and shares the token budget — a bad one can hide
                the entry as well as reveal it.
                {stale
                    ? ' The entry changed since these were generated, so some of them may no longer fit. Refresh asks the model again; editing any name below replaces the whole list, and a hand-edited list is never stale.'
                    : ''}
            </p>
        </div>
    );
}
