import type { DistillEvent, DistillRun } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { createRun, emit, findRun, releaseRun, runningCount, stopRun, subscribe } from './registry.js';

function run(id: string): DistillRun {
    return {
        id,
        bookId: 'novel',
        bookName: 'novel',
        mode: 'sections',
        model: '',
        status: 'running',
        startedAt: 0,
        finishedAt: null,
        chunks: [],
        draft: null,
    };
}

/** The opening event the distill engine replays to a late subscriber. */
function replay(state: { run: DistillRun }): Extract<DistillEvent, { type: 'start' }> {
    return { type: 'start', runId: state.run.id, model: state.run.model, chunks: state.run.chunks };
}

const make = (id: string) => createRun<DistillRun, DistillEvent>(run(id), id, replay);

describe('the run registry', () => {
    it('counts only the runs still in flight', () => {
        make('a');
        expect(runningCount()).toBe(1);

        releaseRun('a');
        expect(runningCount()).toBe(0);
        expect(findRun('a')).toBeNull();
    });

    it('replays the current chunk list to a late subscriber', () => {
        const state = make('b');
        state.run.chunks.push({ index: 0, stage: 'analyze', label: 'Chapter 1', state: 'done' });

        const seen: string[] = [];
        subscribe<DistillRun, DistillEvent>('b', (event) => seen.push(event.type));

        // An attach mid-run must draw the rows that already finished, not an
        // empty list, so the replay happens on subscribe.
        expect(seen).toEqual(['start']);
        releaseRun('b');
    });

    it('delivers events to every listener until one unsubscribes', () => {
        const state = make('c');
        const first: string[] = [];
        const second: string[] = [];

        const off = subscribe<DistillRun, DistillEvent>('c', (event) => first.push(event.type));
        subscribe<DistillRun, DistillEvent>('c', (event) => second.push(event.type));
        emit(state, { type: 'progress', done: 1, total: 2 });
        off();
        emit(state, { type: 'progress', done: 2, total: 2 });

        // Both saw the replay and the first progress; only one saw the second.
        expect(first).toEqual(['start', 'progress']);
        expect(second).toEqual(['start', 'progress', 'progress']);
        releaseRun('c');
    });

    it('stops a running run and reports when there is none', () => {
        const state = make('d');
        expect(stopRun('d')).toBe(true);
        expect(state.controller.signal.aborted).toBe(true);

        releaseRun('d');
        expect(stopRun('d')).toBe(false);
    });

    it('ignores a subscription to an unknown run', () => {
        const off = subscribe('nope', () => {
            throw new Error('should not be called');
        });
        expect(() => off()).not.toThrow();
    });

    it('holds runs of two engines under the one count a profile switch reads', () => {
        // Distillation and alias generation are different pipelines over
        // different inputs, but both write to the active profile, so both have
        // to block a switch. One registry is what makes that automatic.
        make('distill-run');
        const alias = createRun<{ id: string; status: string }, string>(
            { id: 'alias-run', status: 'running' },
            'alias-run',
            (state) => state.run.id,
        );

        expect(runningCount()).toBe(2);

        const seen: string[] = [];
        subscribe<string, string>('alias-run', (event) => seen.push(event));
        expect(seen).toEqual(['alias-run']);

        releaseRun(alias.run.id);
        releaseRun('distill-run');
        expect(runningCount()).toBe(0);
    });
});
