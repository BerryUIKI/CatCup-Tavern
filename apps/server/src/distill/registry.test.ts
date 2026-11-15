import type { DistillRun } from '@catcup/shared';
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

describe('the distill registry', () => {
    it('counts only the runs still in flight', () => {
        createRun(run('a'));
        expect(runningCount()).toBe(1);

        releaseRun('a');
        expect(runningCount()).toBe(0);
        expect(findRun('a')).toBeNull();
    });

    it('replays the current chunk list to a late subscriber', () => {
        const state = createRun(run('b'));
        state.run.chunks.push({ index: 0, stage: 'analyze', label: 'Chapter 1', state: 'done' });

        const seen: string[] = [];
        subscribe('b', (event) => seen.push(event.type));

        // An attach mid-run must draw the rows that already finished, not an
        // empty list, so the replay happens on subscribe.
        expect(seen).toEqual(['start']);
        releaseRun('b');
    });

    it('delivers events to every listener until one unsubscribes', () => {
        const state = createRun(run('c'));
        const first: string[] = [];
        const second: string[] = [];

        const off = subscribe('c', (event) => first.push(event.type));
        subscribe('c', (event) => second.push(event.type));
        emit(state, { type: 'progress', done: 1, total: 2 });
        off();
        emit(state, { type: 'progress', done: 2, total: 2 });

        // Both saw the replay and the first progress; only one saw the second.
        expect(first).toEqual(['start', 'progress']);
        expect(second).toEqual(['start', 'progress', 'progress']);
        releaseRun('c');
    });

    it('stops a running run and reports when there is none', () => {
        const state = createRun(run('d'));
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
});
