import { Check, ChevronDown } from 'lucide-react';
import {
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
    useEffect,
    useId,
    useRef,
    useState,
} from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn';
import { isTopFocusLayer, pushFocusLayer } from '../lib/focus';

export interface SelectOption<T extends string> {
    value: T;
    label: string;
    /** A second line under the label: what the option means, in one sentence. */
    description?: ReactNode;
    /** Rendered after the option when it is selected; defaults to a check. */
    icon?: ReactNode;
}

interface SelectProps<T extends string> {
    value: T;
    options: SelectOption<T>[];
    onChange: (value: T) => void;
    /** Visible label; rendered above the trigger by the caller when it needs one. */
    label: string;
    /** Hides the visible label while keeping it as the control's accessible name. */
    hideLabel?: boolean;
    /** Extra explanation shown under the label, always visible. */
    description?: string;
    disabled?: boolean;
    id?: string;
    className?: string;
    /**
     * `md` matches `.input-shell`, for a form field. `sm` is the compact row used
     * in the library footer, where a full-size control would dominate the rail.
     * `xs` is the header chip that sits beside a title.
     */
    size?: 'md' | 'sm' | 'xs';
    /** An icon drawn at the start of the trigger, as the library's sort control has. */
    leadingIcon?: ReactNode;
    /**
     * A spinner shown in place of the chevron, for a list that is still loading.
     * The control stays disabled, so nothing opens while it is empty.
     */
    trailingSlot?: ReactNode;
    /** Shown when `options` is empty, so the trigger never reads blank. */
    emptyLabel?: string;
}

/**
 * A listbox in CatCup's own styling.
 *
 * A native `<select>` cannot be styled past its closed state: the option list
 * is drawn by the operating system, so on Windows it arrives as a white system
 * popup in the middle of the tavern's dark panel. This component is the
 * replacement — a button that opens a `role="listbox"` popover in `ink`/`surface`
 * with the same borders, radius and focus ring as the rest of the app.
 *
 * The popover is portalled to the body and positioned against the trigger, so
 * the scroll container of a settings panel cannot clip it.
 *
 * Keyboard follows the pattern the menus already use: Enter, Space and ArrowDown
 * open on the current row; Arrow keys, Home and End move; type-ahead jumps to
 * the first option whose label starts with the letter; Escape closes and
 * returns focus to the trigger; Tab closes and leaves. The open list is
 * registered as a focus layer, so Escape closes it and not the dialog under it.
 */
export function Select<T extends string>({
    value,
    options,
    onChange,
    label,
    hideLabel = false,
    description,
    disabled = false,
    id,
    className,
    size = 'md',
    leadingIcon,
    trailingSlot,
    emptyLabel,
}: SelectProps<T>) {
    const generatedId = useId();
    const controlId = id ?? `${generatedId}-select`;
    const listId = `${controlId}-list`;
    const labelId = `${controlId}-label`;
    const descriptionId = `${controlId}-description`;

    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const rowsRef = useRef<Array<HTMLButtonElement | null>>([]);

    const selectedIndex = Math.max(
        0,
        options.findIndex((option) => option.value === value),
    );
    const selected = options[selectedIndex] ?? null;

    const close = (restoreFocus = true) => {
        setOpen(false);
        if (restoreFocus) {
            triggerRef.current?.focus({ preventScroll: true });
        }
    };
    const closeRef = useRef(close);
    closeRef.current = close;

    const measure = () => {
        const trigger = triggerRef.current;
        if (!trigger) {
            return;
        }
        const rect = trigger.getBoundingClientRect();
        const listHeight = Math.min(options.length * 56 + 12, 320);
        // `innerHeight` is 0 when the tab is not being painted (hidden, or in an
        // occluded pane), and every clamp below would then drag the list into
        // the corner. Fall back to the trigger's own frame, which still exists.
        const viewportHeight = window.innerHeight || rect.bottom + listHeight + 16;
        const viewportWidth = window.innerWidth || rect.right + 16;
        const spaceBelow = viewportHeight - rect.bottom;
        // Flip above the trigger when there is more room there, and clamp so a
        // list near the bottom of a short window stays reachable.
        const top =
            spaceBelow < listHeight + 8 && rect.top > listHeight + 8
                ? rect.top - listHeight - 6
                : Math.min(rect.bottom + 6, viewportHeight - listHeight - 8);
        // Never wider than the trigger, but never pushed off the right edge.
        const width = Math.min(rect.width, Math.max(200, viewportWidth - rect.left - 8));
        setPosition({ top: Math.max(8, top), left: Math.max(8, rect.left), width });
    };

    const openList = (focusCurrent: boolean) => {
        if (disabled) {
            return;
        }
        // A trigger hidden by a responsive class (`hidden md:block`) has no box;
        // opening would put the portal in the top-left corner with nothing to
        // anchor it to. Nothing can click it, so this only guards a stray event.
        const trigger = triggerRef.current;
        if (!trigger || trigger.getClientRects().length === 0) {
            return;
        }
        setActiveIndex(selectedIndex);
        measure();
        setOpen(true);
        if (focusCurrent) {
            window.requestAnimationFrame(() => rowsRef.current[selectedIndex]?.focus({ preventScroll: true }));
        }
    };

    // The effect is keyed on `open` alone: the measurement helper reads the DOM when
    // it runs, and re-running the listeners on every keystroke would tear them down and
    // rebuild them for nothing.
    // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on open, not on the helper identity
    useEffect(() => {
        if (!open) {
            return;
        }
        const list = listRef.current;
        const releaseLayer = list ? pushFocusLayer(list) : () => {};

        const onPointerDown = (event: MouseEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }
            if (listRef.current?.contains(target) || triggerRef.current?.contains(target)) {
                return;
            }
            closeRef.current(false);
        };

        /**
         * Close when focus moves to a different Select.
         *
         * A click outside already closes this list, but a click on another
         * Select's trigger is "outside" by that rule only on `mousedown`, and the
         * sibling's own open could then leave two lists on screen. Watching focus
         * catches the keyboard path too: Tab or a click into another Select moves
         * focus, and this one gives way.
         */
        const onFocusIn = (event: FocusEvent) => {
            const target = event.target;
            const root = target instanceof Element ? target.closest('[data-select-root]') : null;
            if (!root || root === rootRef.current) {
                return;
            }
            closeRef.current(false);
        };
        const onKeyDown = (event: globalThis.KeyboardEvent) => {
            if (event.key !== 'Escape' || !list || !isTopFocusLayer(list)) {
                return;
            }
            // Stop here: the Settings dialog underneath must not also close.
            event.preventDefault();
            event.stopPropagation();
            closeRef.current();
        };
        const onViewportChange = () => measure();

        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('focusin', onFocusIn);
        document.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, true);
        return () => {
            releaseLayer();
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('focusin', onFocusIn);
            document.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('resize', onViewportChange);
            window.removeEventListener('scroll', onViewportChange, true);
        };
        // `open` is the only thing that starts or stops the listeners; the
        // measurement helpers close over the values they need.
    }, [open]);

    // Keep the highlighted row in view while arrow keys move it.
    useEffect(() => {
        if (!open) {
            return;
        }
        rowsRef.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }, [open, activeIndex]);

    const commit = (index: number) => {
        const option = options[index];
        if (!option) {
            return;
        }
        onChange(option.value);
        close();
    };

    const typeAhead = (letter: string) => {
        const lower = letter.toLowerCase();
        const start = activeIndex + 1;
        for (let offset = 0; offset < options.length; offset += 1) {
            const index = (start + offset) % options.length;
            const option = options[index];
            if (option?.label.toLowerCase().startsWith(lower)) {
                setActiveIndex(index);
                rowsRef.current[index]?.focus({ preventScroll: true });
                return;
            }
        }
    };

    const onTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openList(true);
            return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openList(true);
        }
    };

    const onListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const last = options.length - 1;
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActiveIndex((current) => {
                const next = Math.min(current + 1, last);
                rowsRef.current[next]?.focus({ preventScroll: true });
                return next;
            });
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((current) => {
                const next = Math.max(current - 1, 0);
                rowsRef.current[next]?.focus({ preventScroll: true });
                return next;
            });
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            setActiveIndex(0);
            rowsRef.current[0]?.focus({ preventScroll: true });
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            setActiveIndex(last);
            rowsRef.current[last]?.focus({ preventScroll: true });
            return;
        }
        if (event.key === 'Tab') {
            // Tab leaves the control rather than cycling inside it.
            close(false);
            return;
        }
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
            typeAhead(event.key);
        }
    };

    return (
        <div ref={rootRef} data-select-root className={cn('relative', className)}>
            {hideLabel ? null : (
                <span id={labelId} className="label-text">
                    {label}
                </span>
            )}
            <button
                ref={triggerRef}
                id={controlId}
                type="button"
                role="combobox"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-labelledby={hideLabel ? undefined : labelId}
                aria-label={hideLabel ? label : undefined}
                aria-describedby={description ? descriptionId : undefined}
                disabled={disabled}
                onClick={() => (open ? close() : openList(false))}
                onKeyDown={onTriggerKeyDown}
                className={cn(
                    'flex w-full items-center gap-2 text-left',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    size === 'md'
                        ? 'input-shell min-h-11'
                        : size === 'sm'
                          ? 'rounded-lg border border-line/70 bg-ink px-2 py-1.5 text-xs text-parchment-dim transition hover:border-amber/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink'
                          : 'rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs text-parchment-dim transition hover:border-amber/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-ink',
                    open && (size === 'md' ? 'border-amber/60 ring-2 ring-amber/15' : 'border-amber/50 text-parchment'),
                )}
            >
                <span className="min-w-0 flex-1 truncate">
                    {leadingIcon ? (
                        <span className="mr-1.5 inline-flex align-[-2px] text-muted" aria-hidden="true">
                            {leadingIcon}
                        </span>
                    ) : null}
                    {selected?.label ?? emptyLabel ?? 'Choose…'}
                </span>
                {trailingSlot ?? (
                    <ChevronDown
                        size={15}
                        className={cn('shrink-0 text-muted transition', size !== 'md' && 'size-3.5', open && 'rotate-180')}
                        aria-hidden="true"
                    />
                )}
            </button>
            {description ? (
                <p id={descriptionId} className="field-hint">
                    {description}
                </p>
            ) : null}

            {open && position
                ? createPortal(
                      <div
                          ref={listRef}
                          id={listId}
                          role="listbox"
                          aria-label={label}
                          onKeyDown={onListKeyDown}
                          style={{ top: position.top, left: position.left, minWidth: position.width }}
                          className="animate-fade-up fixed z-[60] max-h-80 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-2xl shadow-black/45"
                      >
                          {options.map((option, index) => {
                              const isSelected = index === selectedIndex;
                              return (
                                  <button
                                      key={option.value}
                                      ref={(element) => {
                                          rowsRef.current[index] = element;
                                      }}
                                      type="button"
                                      role="option"
                                      aria-selected={isSelected}
                                      tabIndex={-1}
                                      onClick={() => commit(index)}
                                      className={cn(
                                          'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition',
                                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                                          isSelected
                                              ? 'bg-surface-2 text-parchment'
                                              : 'text-parchment-dim hover:bg-surface-2 hover:text-parchment',
                                      )}
                                  >
                                      <span className="min-w-0 flex-1">
                                          <span className="block truncate">{option.label}</span>
                                          {option.description ? (
                                              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                                                  {option.description}
                                              </span>
                                          ) : null}
                                      </span>
                                      {isSelected ? (
                                          <span className="mt-0.5 shrink-0 text-amber">
                                              {option.icon ?? <Check size={14} aria-hidden="true" />}
                                          </span>
                                      ) : null}
                                  </button>
                              );
                          })}
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}
