import type { ScopeFilter } from '@catcup/shared';

import { cn } from '../lib/cn';

const OPTIONS: { value: ScopeFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'profile', label: 'This profile' },
    { value: 'shared', label: 'Shared' },
];

/**
 * The scope filter that joins the library's existing filter row.
 *
 * Visible-but-labelled is the design: a shared item shows up by default rather
 * than appearing only once a box is ticked, because a person who marks a preset
 * reusable and then sees nothing would read that as a broken feature. Hiding
 * them is this control, one click away.
 *
 * The choice is remembered per profile — the storage key carries the profile
 * id — because a person who hides shared items in one campaign is not
 * necessarily of that mind in the next.
 *
 * A real radio group rather than `role="radio"` on buttons: arrow keys move
 * between the options for free, which is what a person expects of a group of
 * mutually exclusive choices.
 */
export function ScopeFilterRow({
    value,
    onChange,
    counts,
}: {
    value: ScopeFilter;
    onChange: (value: ScopeFilter) => void;
    counts?: { profile?: number; shared?: number };
}) {
    return (
        <fieldset className="flex items-center gap-1">
            <legend className="sr-only">Which items to show</legend>
            {OPTIONS.map((option) => {
                const count = option.value === 'all' ? undefined : counts?.[option.value];
                return (
                    <label
                        className={cn(
                            'cursor-pointer rounded-full border px-2 py-0.5 text-[10px] transition',
                            value === option.value
                                ? 'border-amber/50 bg-amber/15 text-amber'
                                : 'border-line/70 text-muted hover:text-parchment',
                        )}
                        key={option.value}
                    >
                        <input
                            checked={value === option.value}
                            className="sr-only"
                            name="library-scope"
                            onChange={() => onChange(option.value)}
                            type="radio"
                            value={option.value}
                        />
                        {option.label}
                        {count ? ` (${count})` : ''}
                    </label>
                );
            })}
        </fieldset>
    );
}

/** Whether an item passes the filter. */
export function matchesScopeFilter(item: { scope: string }, filter: ScopeFilter): boolean {
    return filter === 'all' || item.scope === filter;
}
