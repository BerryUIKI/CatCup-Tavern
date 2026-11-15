import type { TitleBarGeometry } from '@catcup/shared';
import { Minus, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '../lib/cn';

/**
 * The desktop shell's title bar, drawn by the page.
 *
 * The shell removes the native frame on Windows, so the window has nothing to
 * drag or close with until this draws it. It is an overlay rather than a strip:
 * the buttons sit in the top-right corner and everything else is transparent,
 * so the library rail and the chat header keep their own backgrounds all the way
 * to the window edge. Those two add the bar's height to their top padding (see
 * `MainApp`), and the brand stays in the rail rather than appearing a second
 * time up here.
 *
 * Why the page does this rather than the shell: WebView2 covers the window's
 * client area and takes every mouse message itself, so a hit test over the bar
 * never reaches the top-level window procedure. Dragging therefore goes through
 * the Tauri window API, which is what `data-tauri-drag-region` on the strip
 * does. See `apps/desktop/src-tauri/src/chrome.rs` for the measurement that
 * settled it, and `docs/DESKTOP.md` for what it costs (Snap Layouts).
 */
const GLYPHS = {
    minimize: Minus,
    maximize: Square,
    close: X,
} as const;

const LABELS = {
    minimize: 'Minimize',
    maximize: 'Maximize',
    close: 'Close',
} as const;

/**
 * The parts of the Tauri window API this needs.
 *
 * Looked up on `window.__TAURI_INTERNALS__` rather than imported: the page is
 * served by the sidecar over loopback, not bundled into the shell, so
 * `@tauri-apps/api` would be a dependency of the web app for a value that only
 * exists in one of its two shapes.
 */
interface TauriWindowApi {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
}

function tauriWindow(): TauriWindowApi | null {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriWindowApi }).__TAURI_INTERNALS__;
    return internals && typeof internals.invoke === 'function' ? internals : null;
}

interface TitleBarProps {
    geometry: TitleBarGeometry;
}

export function TitleBar({ geometry }: TitleBarProps) {
    const [maximized, setMaximized] = useState(false);

    // The glyph and the accessible name follow the window, which can change from
    // the keyboard, the taskbar or a second monitor without the page asking.
    useEffect(() => {
        const api = tauriWindow();
        if (!api) {
            return;
        }
        let cancelled = false;
        const read = () => {
            void api
                .invoke('plugin:window|is_maximized')
                .then((value) => {
                    if (!cancelled && typeof value === 'boolean') {
                        setMaximized(value);
                    }
                })
                .catch(() => {
                    // A refusal here only costs a stale glyph; the button still
                    // works, so it is not worth reporting.
                });
        };
        read();
        window.addEventListener('resize', read);
        return () => {
            cancelled = true;
            window.removeEventListener('resize', read);
        };
    }, []);

    const run = (command: string) => {
        void tauriWindow()
            ?.invoke(command)
            .then(() => {
                if (command !== 'plugin:window|start_dragging') {
                    return tauriWindow()?.invoke('plugin:window|is_maximized');
                }
                return undefined;
            })
            .then((value) => {
                if (typeof value === 'boolean') {
                    setMaximized(value);
                }
            })
            .catch(() => {
                // The shell refuses a command it was not granted. Nothing the
                // page can do about that, and the window itself is unchanged.
            });
    };

    return (
        <div
            // Below the dialog layer (`z-50` in `Modal`): a dialog that opens
            // over the bar must cover it, or its own close button ends up under
            // a window control.
            className="fixed inset-x-0 top-0 z-40 flex select-none"
            style={{ height: geometry.height }}
        >
            {/* The strip runs the full width of the window, over the library
                rail on its left, so dragging anywhere along the top moves the
                window. It stops where the buttons start, so a press on one of
                those never begins a window drag. */}
            <div
                className="h-full flex-1"
                data-tauri-drag-region
                aria-hidden="true"
                onDoubleClick={() => run('plugin:window|toggle_maximize')}
            />

            <div className="flex shrink-0 items-stretch" style={{ height: geometry.height }}>
                {geometry.buttonOrder.map((name) => {
                    const Glyph = GLYPHS[name];
                    const label = name === 'maximize' && maximized ? 'Restore' : LABELS[name];
                    return (
                        <button
                            key={name}
                            type="button"
                            aria-label={label}
                            title={label}
                            style={{ width: geometry.buttonWidth, height: geometry.height }}
                            className={cn(
                                'flex items-center justify-center text-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber/70 focus-visible:ring-inset',
                                name === 'close'
                                    ? 'hover:bg-[#c42b1c] hover:text-white'
                                    : 'hover:bg-surface-2 hover:text-parchment',
                            )}
                            onClick={() =>
                                run(
                                    name === 'minimize'
                                        ? 'plugin:window|minimize'
                                        : name === 'maximize'
                                          ? 'plugin:window|toggle_maximize'
                                          : 'plugin:window|close',
                                )
                            }
                        >
                            <Glyph size={name === 'close' ? 16 : 14} strokeWidth={1.5} />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
