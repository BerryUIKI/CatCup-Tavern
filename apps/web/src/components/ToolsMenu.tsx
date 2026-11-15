import { MoreHorizontal } from 'lucide-react';
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { cn } from '../lib/cn';

export interface ToolsMenuItem {
    /** Stable key; also the DOM id so the menu can find its rows. */
    id: string;
    label: string;
    icon: typeof MoreHorizontal;
    onSelect: () => void;
    disabled?: boolean;
    /** Explains a disabled row in a tooltip and a hint line. */
    hint?: string;
    /** Draws the row in wine and closes the menu before it runs. */
    danger?: boolean;
    /** Draws a divider above the row, grouping destructive tools at the end. */
    separate?: boolean;
}

interface ToolsMenuProps {
    items: ToolsMenuItem[];
    /** Accessible name for the trigger and the menu; defaults to "Tools". */
    label?: string;
}

/**
 * The one low-frequency entry point in a chat header.
 *
 * Everything the header used to spell out as an icon (switch greeting, rename,
 * delete, memory, inspector, images) lives here, so the header keeps only
 * identity, chat switching, provider state and this trigger — the layout
 * DESIGN.md asks for in stage B.
 *
 * Keyboard: Enter/Space/ArrowDown open the menu and focus the first row, the
 * arrow keys and Home/End move between rows, Escape closes and returns focus
 * to the trigger, Tab leaves and closes. Clicking elsewhere dismisses it.
 */
export function ToolsMenu({ items, label = 'Tools' }: ToolsMenuProps) {
    const menuId = useId();
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const rowsRef = useRef<Array<HTMLButtonElement | null>>([]);

    const rows = () => rowsRef.current.filter((row): row is HTMLButtonElement => row !== null && !row.disabled);

    const close = (restoreFocus = true) => {
        setOpen(false);
        if (restoreFocus) {
            triggerRef.current?.focus({ preventScroll: true });
        }
    };
    const closeRef = useRef(close);
    closeRef.current = close;

    const openMenu = (focusFirst: boolean) => {
        setOpen(true);
        if (!focusFirst) {
            return;
        }
        // The rows do not exist until the next paint.
        window.requestAnimationFrame(() => rows()[0]?.focus({ preventScroll: true }));
    };

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
            closeRef.current(false);
        };

        const onDocumentKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape') {
                return;
            }
            // Escape closes the menu and nothing else: a Modal underneath must
            // not also close when the reader dismisses a menu inside it.
            event.preventDefault();
            event.stopPropagation();
            closeRef.current();
        };

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onDocumentKeyDown, true);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onDocumentKeyDown, true);
        };
    }, [open]);

    // A menu that is open while its rows all become disabled (a reply starts
    // streaming, say) would trap focus on nothing; close it instead.
    useEffect(() => {
        if (open && items.every((item) => item.disabled)) {
            closeRef.current(false);
        }
    }, [open, items]);

    const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMenu(true);
        }
    };

    const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const focusable = rows();
        if (focusable.length === 0) {
            return;
        }
        const index = focusable.indexOf(document.activeElement as HTMLButtonElement);

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusable[(index + 1 + focusable.length) % focusable.length]?.focus({ preventScroll: true });
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusable[(index - 1 + focusable.length) % focusable.length]?.focus({ preventScroll: true });
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            focusable[0]?.focus({ preventScroll: true });
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            focusable[focusable.length - 1]?.focus({ preventScroll: true });
            return;
        }
        if (event.key === 'Tab') {
            // Tab is a way out of a menu that does not own the page.
            close(false);
        }
    };

    const run = (item: ToolsMenuItem) => {
        if (item.disabled) {
            return;
        }
        close();
        item.onSelect();
    };

    const activeHint = items.find((item) => item.disabled && item.hint)?.hint;

    return (
        <div className="relative">
            <button
                ref={triggerRef}
                type="button"
                className={cn('icon-btn', open && 'bg-surface-2 text-parchment')}
                onClick={() => (open ? close() : openMenu(false))}
                onKeyDown={onTriggerKeyDown}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                aria-label={label}
                title={label}
            >
                <MoreHorizontal size={18} />
            </button>

            {open ? (
                <div
                    ref={menuRef}
                    id={menuId}
                    role="menu"
                    aria-label={label}
                    onKeyDown={onMenuKeyDown}
                    className="animate-fade-up absolute right-0 top-full z-40 mt-1.5 w-60 overflow-hidden rounded-xl border border-line bg-surface p-1.5 shadow-2xl shadow-black/45"
                >
                    {items.map((item, index) => {
                        const Icon = item.icon;
                        const previous = index > 0 ? items[index - 1] : undefined;
                        return (
                            <div key={item.id}>
                                {item.separate && previous ? <hr className="my-1 h-px border-0 bg-line-soft" /> : null}
                                <button
                                    ref={(element) => {
                                        rowsRef.current[index] = element;
                                    }}
                                    type="button"
                                    role="menuitem"
                                    id={`${menuId}-${item.id}`}
                                    className={cn(
                                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                                        item.disabled
                                            ? 'cursor-not-allowed text-muted opacity-40'
                                            : item.danger
                                              ? 'text-parchment-dim hover:bg-wine/15 hover:text-wine'
                                              : 'text-parchment-dim hover:bg-surface-2 hover:text-parchment',
                                    )}
                                    onClick={() => run(item)}
                                    disabled={item.disabled}
                                    title={item.disabled ? item.hint : undefined}
                                >
                                    <Icon size={16} className="shrink-0" />
                                    <span className="truncate">{item.label}</span>
                                </button>
                            </div>
                        );
                    })}
                    {activeHint ? (
                        <p className="mt-1 border-t border-line-soft px-2.5 pb-1 pt-2 text-[11px] leading-relaxed text-muted">
                            {activeHint}
                        </p>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
