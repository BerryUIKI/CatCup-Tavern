import type { ReactNode } from 'react';
import { create } from 'zustand';

/**
 * A confirmation that is asked for in code and answered by the app's own dialog.
 *
 * `window.confirm` blocks the thread, draws the operating system's dialog and
 * ignores every design token the app has: on Windows it arrives as a white
 * system box in the middle of a dark panel, and no skin will ever reach it.
 * `docs/DESIGN.md` has said destructive actions use `ConfirmDialog` since stage
 * B; fourteen call sites still reached for the browser's.
 *
 * The shape below is the one a caller wants — ask, then continue — so the call
 * site reads `if (!(await confirm({...}))) return;` rather than growing a piece
 * of state per dialog. The rendering end is `ConfirmHost`, mounted once.
 */
export interface ConfirmRequest {
    title: string;
    description?: ReactNode;
    confirmLabel: string;
    cancelLabel?: string;
    /** Renders the wine treatment and the warning icon. Use for anything removed. */
    tone?: 'default' | 'danger';
    /** Which action is focused on open. Defaults to Cancel, the safe one. */
    initialFocus?: 'confirm' | 'cancel';
}

interface PendingConfirm extends ConfirmRequest {
    id: number;
    resolve: (confirmed: boolean) => void;
}

interface ConfirmState {
    pending: PendingConfirm[];
    ask: (request: ConfirmRequest) => Promise<boolean>;
    settle: (id: number, confirmed: boolean) => void;
}

let nextId = 1;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
    pending: [],

    ask: (request) =>
        new Promise<boolean>((resolve) => {
            set((state) => ({
                pending: [...state.pending, { ...request, id: nextId++, resolve }],
            }));
        }),

    settle: (id, confirmed) => {
        const entry = get().pending.find((item) => item.id === id);
        // A dialog that an unmount already dropped has no one left to answer;
        // resolving it anyway is what keeps a caller from waiting forever.
        entry?.resolve(confirmed);
        set((state) => ({ pending: state.pending.filter((item) => item.id !== id) }));
    },
}));

/**
 * Ask the person to confirm something, and resolve when they answer.
 *
 * Queued rather than stacked: two confirmations opened in the same tick appear
 * one after the other, so an accidental double click cannot produce a dialog
 * drawn underneath the one the person is reading.
 */
export function confirm(request: ConfirmRequest): Promise<boolean> {
    return useConfirmStore.getState().ask(request);
}
