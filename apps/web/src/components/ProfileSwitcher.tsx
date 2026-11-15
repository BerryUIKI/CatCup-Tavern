import type { ProfileSummary } from '@catcup/shared';
import { Check, ChevronDown, Layers } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { Spinner } from './Spinner';

interface ProfileSwitcherProps {
    profiles: ProfileSummary[];
    activeProfileId: string | null;
    /** The active provider, shown beneath the profile as the second line. */
    providerLine: string;
    providerReady: boolean;
    switching: boolean;
    onSwitch: (id: string) => void;
    onManage: () => void;
}

/**
 * The profile switcher in the library footer.
 *
 * A profile is the bigger switch — it replaces the cast, the lorebooks and the
 * way prompts are built — so it sits above the provider, which is the lighter
 * and more frequent choice beneath it.
 */
export function ProfileSwitcher({
    profiles,
    activeProfileId,
    providerLine,
    providerReady,
    switching,
    onSwitch,
    onManage,
}: ProfileSwitcherProps) {
    const [open, setOpen] = useState(false);
    const menuId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const active = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0] ?? null;
    const live = profiles.filter((profile) => !profile.archived);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onPointerDown = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) {
                return;
            }
            setOpen(false);
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus({ preventScroll: true });
            }
        };
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown, true);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown, true);
        };
    }, [open]);

    return (
        <div className="relative mb-2">
            <button
                ref={triggerRef}
                type="button"
                className="w-full rounded-lg border border-line/70 bg-surface/60 px-3 py-2 text-left transition hover:border-amber/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
                onClick={() => setOpen((current) => !current)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                title="Switch profile"
            >
                <span className="flex items-center gap-1.5">
                    <Layers size={12} className="shrink-0 text-muted" aria-hidden="true" />
                    <span className="text-[10px] uppercase tracking-[0.14em] text-muted">Profile</span>
                    {switching ? <Spinner size={10} className="ml-auto text-muted" /> : null}
                    <ChevronDown
                        size={12}
                        className={cn('ml-auto shrink-0 text-muted transition', open && 'rotate-180')}
                        aria-hidden="true"
                    />
                </span>
                <span className="mt-0.5 block truncate text-xs text-parchment">{active?.name ?? 'No profile'}</span>
                <span className="mt-1 flex items-center gap-1.5">
                    <span
                        className={cn('size-1.5 shrink-0 rounded-full', providerReady ? 'bg-sage' : 'bg-amber/70')}
                        aria-hidden="true"
                    />
                    <span className="truncate text-[11px] text-muted">{providerLine}</span>
                </span>
            </button>

            {open ? (
                <div
                    ref={menuRef}
                    id={menuId}
                    role="menu"
                    aria-label="Profiles"
                    className="absolute bottom-full left-0 z-40 mb-1.5 w-full min-w-[220px] overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-2xl shadow-black/45"
                >
                    {live.map((profile) => {
                        const isActive = profile.id === activeProfileId;
                        return (
                            <button
                                key={profile.id}
                                type="button"
                                role="menuitem"
                                className={cn(
                                    'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition',
                                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                                    isActive
                                        ? 'bg-surface-2 text-parchment'
                                        : 'text-parchment-dim hover:bg-surface-2 hover:text-parchment',
                                )}
                                onClick={() => {
                                    setOpen(false);
                                    if (!isActive) {
                                        onSwitch(profile.id);
                                    }
                                }}
                                aria-current={isActive ? 'true' : undefined}
                            >
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{profile.name}</span>
                                    <span className="block truncate text-[11px] text-muted">
                                        {profile.counts.characters} characters · {profile.counts.chats} chats ·{' '}
                                        {profile.counts.books} books
                                    </span>
                                </span>
                                {isActive ? <Check size={14} className="mt-0.5 shrink-0 text-amber" /> : null}
                            </button>
                        );
                    })}
                    <hr className="my-1 h-px border-0 bg-line-soft" />
                    <button
                        type="button"
                        role="menuitem"
                        className="w-full rounded-lg px-2.5 py-2 text-left text-sm text-parchment-dim transition hover:bg-surface-2 hover:text-parchment focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                        onClick={() => {
                            setOpen(false);
                            onManage();
                        }}
                    >
                        Manage profiles…
                    </button>
                </div>
            ) : null}
        </div>
    );
}
