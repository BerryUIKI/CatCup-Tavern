import type { DistillEvent, DistillRun } from '@catcup/shared';

/**
 * Work in flight, and the listeners watching it.
 *
 * A run is not a generation and must not behave like one: a generation is
 * aborted when its socket closes, because the person stopped reading. A run over
 * a 300-page book — or over every entry in a large lorebook — is minutes of
 * work, so closing the tab leaves it alone and only its own stop endpoint
 * cancels it. That is why this registry exists separately from
 * `activeGenerations` even though both hold an `AbortController`.
 *
 * Two engines use it: book distillation and alias generation. They are
 * different pipelines over different inputs, but a run is a run — it owns a
 * record, publishes progress to whoever is watching, and blocks a profile
 * switch. Keeping one registry is what makes `runningCount` the single answer
 * to "is anything still writing to this profile".
 *
 * The two type parameters carry each engine's own record and event shape, and
 * default to distillation's so existing call sites need no annotation.
 */

export interface RunState<R = DistillRun, E = DistillEvent> {
    run: R;
    controller: AbortController;
    listeners: Set<(event: E) => void>;
    /**
     * The event a late subscriber is sent first.
     *
     * An attach that arrives mid-run must draw the rows that already finished
     * rather than an empty list, and the opening event is the one that carries
     * them. Each engine supplies its own, because the record it has to render
     * differs.
     */
    replay: (state: RunState<R, E>) => E;
}

// The registry is heterogeneous by design: it holds runs of every kind and only
// ever hands one back under the type the caller asked for.
// biome-ignore lint/suspicious/noExplicitAny: one table for every run shape
const runs = new Map<string, RunState<any, any>>();

export function createRun<R, E>(run: R, id: string, replay: (state: RunState<R, E>) => E): RunState<R, E> {
    const state: RunState<R, E> = { run, controller: new AbortController(), listeners: new Set(), replay };
    runs.set(id, state);
    return state;
}

export function findRun<R = DistillRun, E = DistillEvent>(id: string): RunState<R, E> | null {
    return runs.get(id) ?? null;
}

/** Every run currently in flight, which is what blocks a profile switch. */
export function runningCount(): number {
    return runs.size;
}

/** Every run currently in flight, oldest first. */
export function runningIds(): string[] {
    return [...runs.keys()];
}

/**
 * Watch a run's events.
 *
 * The caller subscribes **before** the engine starts, so no event — not the
 * opening one, not a `done` from a run that fails on its first request — can be
 * emitted into an empty room. A late subscriber is replayed the run's opening
 * event as it stands, so an attach that arrives mid-run draws the rows that
 * already finished instead of an empty list.
 */
export function subscribe<R, E>(id: string, listener: (event: E) => void): () => void {
    const state = runs.get(id) as RunState<R, E> | undefined;
    if (!state) {
        return () => {};
    }
    listener(state.replay(state));
    state.listeners.add(listener);
    return () => {
        state.listeners.delete(listener);
    };
}

/** Publish one event to everyone watching. */
export function emit<R, E>(state: RunState<R, E>, event: E): void {
    for (const listener of state.listeners) {
        try {
            listener(event);
        } catch (error) {
            console.warn('[run] Listener failed:', error);
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
