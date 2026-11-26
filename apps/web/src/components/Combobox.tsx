import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '../lib/cn';
import { pushFocusLayer } from '../lib/focus';

export interface ComboboxOption {
    /** The value written into the field when the row is chosen. */
    value: string;
    /** A friendlier name shown under the value; the value is always visible too. */
    label?: string;
}

interface ComboboxProps {
    value: string;
    onChange: (value: string) => void;
    /** Suggestions, already in the order they should appear. */
    options: ComboboxOption[];
    /** Called on Enter when no suggestion is highlighted: "use what I typed". */
    onEnter?: () => void;
    placeholder?: string;
    id?: string;
    maxLength?: number;
    disabled?: boolean;
    /** Shown at the foot of the open list when nothing matches the typed text. */
    emptyHint?: ReactNode;
    /** Class names for the input itself. */
    className?: string;
    /**
     * Focus the field when it mounts. The dialog that owns it focuses the field
     * rather than the dialog, because the field is the reason it opened.
     */
    autoFocus?: boolean;
}

/**
 * A text field with CatCup's own suggestion list.
 *
 * The model field used an `<input list>` with a `<datalist>`, whose dropdown is
 * drawn by the browser — a white, system-fonted card in the middle of a dark
 * panel, and unstyleable. This keeps the field free-text (an endpoint that does
 * not implement `/models` is perfectly usable) while giving the suggestions the
 * same shell, border and focus ring as every other floating layer.
 *
 * Typing filters the list; ArrowDown and ArrowUp move through it; Enter accepts
 * the highlighted row, or hands the typed text to `onEnter` when none is
 * highlighted; Escape closes the list without touching the typed value; Tab
 * leaves the list open only long enough to move on.
 */
export function Combobox({
    value,
    onChange,
    options,
    onEnter,
    placeholder,
    id,
    maxLength,
    disabled = false,
    emptyHint,
    className,
    autoFocus = false,
}: ComboboxProps) {
    const generatedId = useId();
    const inputId = id ?? `${generatedId}-combobox`;
    const listId = `${inputId}-list`;
    const hintId = `${inputId}-hint`;

    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(-1);
    // The list is shown on focus and during typing, hidden on Escape until the
    // next keystroke, so a reader can dismiss it without losing the field.
    const [dismissed, setDismissed] = useState(false);
    const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const rowsRef = useRef<Array<HTMLButtonElement | null>>([]);

    useEffect(() => {
        if (autoFocus) {
            inputRef.current?.focus({ preventScroll: true });
        }
    }, [autoFocus]);

    const trimmed = value.trim().toLowerCase();
    const matches = trimmed
        ? options.filter(
              (option) =>
                  option.value.toLowerCase().includes(trimmed) || (option.label ?? '').toLowerCase().includes(trimmed),
          )
        : options;

    const close = () => {
        setOpen(false);
        setActiveIndex(-1);
    };
    const closeRef = useRef(close);
    closeRef.current = close;

    const measure = () => {
        const input = inputRef.current;
        if (!input) {
            return;
        }
        const rect = input.getBoundingClientRect();
        const listHeight = Math.min(matches.length * 48 + 12, 260);
        // `innerHeight` is 0 when the tab is not being painted, which would
        // otherwise clamp the list into the top-left corner.
        const viewportHeight = window.innerHeight || rect.bottom + listHeight + 16;
        const viewportWidth = window.innerWidth || rect.right + 16;
        const spaceBelow = viewportHeight - rect.bottom;
        const top =
            spaceBelow < listHeight + 8 && rect.top > listHeight + 8
                ? rect.top - listHeight - 6
                : Math.min(rect.bottom + 6, viewportHeight - listHeight - 8);
        const width = Math.min(rect.width, Math.max(200, viewportWidth - rect.left - 8));
        setPosition({ top: Math.max(8, top), left: Math.max(8, rect.left), width });
    };

    const show = () => {
        if (disabled || dismissed) {
            return;
        }
        // A field hidden by a responsive class has no box to anchor the list to.
        if (!inputRef.current?.getClientRects().length) {
            return;
        }
        measure();
        setOpen(true);
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
        const onViewportChange = () => measure();
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('scroll', onViewportChange, true);
        return () => {
            releaseLayer();
            window.removeEventListener('resize', onViewportChange);
            window.removeEventListener('scroll', onViewportChange, true);
        };
        // Re-measure only matters while the list is open.
    }, [open]);

    useEffect(() => {
        if (open) {
            rowsRef.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
        }
    }, [open, activeIndex]);

    const accept = (option: ComboboxOption | undefined) => {
        if (!option) {
            return;
        }
        onChange(option.value);
        close();
        inputRef.current?.focus({ preventScroll: true });
    };

    const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) {
                show();
                setActiveIndex(0);
                return;
            }
            setActiveIndex((current) => Math.min(current + 1, matches.length - 1));
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) {
                show();
                setActiveIndex(Math.max(matches.length - 1, 0));
                return;
            }
            setActiveIndex((current) => Math.max(current - 1, -1));
            return;
        }
        if (event.key === 'Home' && open) {
            event.preventDefault();
            setActiveIndex(0);
            return;
        }
        if (event.key === 'End' && open) {
            event.preventDefault();
            setActiveIndex(Math.max(matches.length - 1, 0));
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            if (open && activeIndex >= 0) {
                accept(matches[activeIndex]);
                return;
            }
            close();
            onEnter?.();
            return;
        }
        if (event.key === 'Escape') {
            if (!open) {
                return;
            }
            // The list owns Escape while it is open; the dialog underneath must
            // not also close on the same press.
            event.preventDefault();
            event.stopPropagation();
            close();
            setDismissed(true);
            return;
        }
    };

    // A second Escape, with the list already closed, should leave the dialog
    // alone too: the reader is still in the field they were typing in. The
    // dialog's handler checks `defaultPrevented`, so marking the event is
    // enough.
    const onEscapeWhileClosed = (event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Escape' && !open) {
            event.stopPropagation();
        }
    };

    const listVisible = open && position !== null;
    const activeOption = activeIndex >= 0 ? matches[activeIndex] : undefined;

    return (
        <div className="relative">
            <input
                ref={inputRef}
                id={inputId}
                className={cn('input-shell', className)}
                value={value}
                maxLength={maxLength}
                spellCheck={false}
                placeholder={placeholder}
                disabled={disabled}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={
                    activeOption ? `${listId}-${activeOption.value.replace(/[^a-zA-Z0-9_-]/g, '_')}` : undefined
                }
                autoComplete="off"
                onChange={(event) => {
                    onChange(event.target.value);
                    setDismissed(false);
                    measure();
                    setOpen(true);
                    setActiveIndex(-1);
                }}
                onFocus={show}
                onBlur={(event) => {
                    // A click on a suggestion fires after blur; keep the list
                    // alive for that, and close it for anything else.
                    const next = event.relatedTarget;
                    if (next instanceof Node && listRef.current?.contains(next)) {
                        return;
                    }
                    close();
                }}
                onKeyDown={(event) => {
                    onEscapeWhileClosed(event);
                    onKeyDown(event);
                }}
            />

            {listVisible
                ? createPortal(
                      <div
                          ref={listRef}
                          id={listId}
                          role="listbox"
                          aria-label="Suggested model ids"
                          style={{ top: position.top, left: position.left, minWidth: position.width }}
                          className="animate-fade-up fixed z-[60] max-h-64 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-float"
                      >
                          {matches.length === 0 ? (
                              <p id={hintId} className="px-2.5 py-2 text-xs leading-relaxed text-muted">
                                  {emptyHint ?? 'No match. Press Enter or Add to use this id as typed.'}
                              </p>
                          ) : (
                              matches.map((option, index) => (
                                  <button
                                      key={option.value}
                                      ref={(element) => {
                                          rowsRef.current[index] = element;
                                      }}
                                      type="button"
                                      id={`${listId}-${option.value.replace(/[^a-zA-Z0-9_-]/g, '_')}`}
                                      role="option"
                                      aria-selected={index === activeIndex}
                                      tabIndex={-1}
                                      onMouseEnter={() => setActiveIndex(index)}
                                      // `onMouseDown` runs before the input's blur,
                                      // so the field never loses the value.
                                      onMouseDown={(event) => {
                                          event.preventDefault();
                                          accept(option);
                                      }}
                                      className={cn(
                                          'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition',
                                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                                          index === activeIndex
                                              ? 'bg-surface-2 text-parchment'
                                              : 'text-parchment-dim hover:bg-surface-2 hover:text-parchment',
                                      )}
                                  >
                                      <span className="min-w-0 flex-1">
                                          <span className="block truncate font-mono text-xs">{option.value}</span>
                                          {option.label && option.label !== option.value ? (
                                              <span className="mt-0.5 block truncate text-footnote text-muted">
                                                  {option.label}
                                              </span>
                                          ) : null}
                                      </span>
                                  </button>
                              ))
                          )}
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}
