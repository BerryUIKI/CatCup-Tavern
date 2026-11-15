import type { DistillEvent, DistillRun } from '@catcup/shared';

/**
 * Runs in flight, and the listeners watching them.
 *
 * A distill run is not a generation and must not behave like one: a generation
 * is aborted when its socket closes, because the person stopped reading. A run
 * over a 300-page book is minutes of work, so closing the tab leaves it alone
 * and only its own stop endpoint cancels it. That is why this registry exists
 * separately from `activeGenerations` even though both hold an
 * `AbortController`.
 */

export interface RunState {
    run: DistillRun;
    controller: AbortController;
    listeners: Set<(event: DistillEvent) => void>;
}

const runs = new Map<string, RunState>();

export function createRun(run: DistillRun): RunState {
    const state: RunState = { run, controller: new AbortController(), listeners: new Set() };
    runs.set(run.id, state);
    return state;
}

export function findRun(id: string): RunState | null {
    return runs.get(id) ?? null;
}

/** Every run currently in flight, which is what blocks a profile switch. */
export function runningCount(): number {
    return runs.size;
}

/**
 * Watch a run's events.
 *
 * The caller subscribes **before** the engine starts, so no event — not the
 * opening one, not a `done` from a run that fails on its first request — can be
 * emitted into an empty room. A late subscriber is replayed the chunk list as it
 * stands, so an attach that arrives mid-run draws the rows that already
 * finished instead of an empty list.
 */
export function subscribe(id: string, listener: (event: DistillEvent) => void): () => void {
    const state = runs.get(id);
    if (!state) {
        return () => {};
    }
    listener({ type: 'start', runId: state.run.id, model: state.run.model, chunks: state.run.chunks });
    state.listeners.add(listener);
    return () => {
        state.listeners.delete(listener);
    };
}

/** Publish one event to everyone watching. */
export function emit(state: RunState, event: DistillEvent): void {
    for (const listener of state.listeners) {
        try {
            listener(event);
        } catch (error) {
            console.warn('[distill] Listener failed:', error);
        }
    }
}

/** Stop a run, if it is still going. Returns false when it is not running. */
export function stopRun(id: string): boolean {
    const state = runs.get(id);
    if (!state) {
        return false;
    }
    state.controller.abort();
    return true;
}

/** Forget a finished run. The record on disk is what survives. */
export function releaseRun(id: string): void {
    runs.delete(id);
}
