import type { ItemScope } from '@catcup/shared';
import { Globe } from 'lucide-react';

import { cn } from '../lib/cn';

/**
 * The one word that says an item is not this profile's alone.
 *
 * A word plus an icon, never colour alone: the meaning survives a monochrome
 * screen and a colour-blind reader, and the eye learns it once. See
 * `docs/DESIGN.md`.
 */
export function SharedBadge({ className }: { className?: string }) {
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border border-sage/40 bg-sage/10 px-2 py-0.5 text-[10px] text-sage',
                className,
            )}
            title="Reusable in every profile"
        >
            <Globe size={10} />
            Shared
        </span>
    );
}

/**
 * The quiet line under a row whose shared original is behind it.
 *
 * A profile item and a shared item can share an id; the profile's wins, and
 * saying so is cheaper than a person wondering where the shared one went.
 */
export function ShadowedNote({ className }: { className?: string }) {
    return (
        <span className={cn('text-[10px] text-muted', className)} title="A shared item with the same name is hidden by this one">
            hides a shared one
        </span>
    );
}

/** Show the badge for a shared row and the note for a shadowing one. */
export function ScopeMarks({ item }: { item: { scope: ItemScope; shadowed?: boolean } }) {
    if (item.scope === 'shared') {
        return <SharedBadge />;
    }
    return item.shadowed ? <ShadowedNote /> : null;
}
