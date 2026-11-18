import { describe, expect, it } from 'vitest';

import { mapWithConcurrency } from './concurrency.js';

describe('mapWithConcurrency', () => {
    it('keeps result order and never exceeds the limit', async () => {
        let running = 0;
        let peak = 0;

        const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (item) => {
            running += 1;
            peak = Math.max(peak, running);
            await new Promise((resolve) => setTimeout(resolve, 5));
            running -= 1;
            return item * 2;
        });

        expect(results).toEqual([2, 4, 6, 8, 10, 12]);
        expect(peak).toBeLessThanOrEqual(2);
    });

    it('handles an empty list without starting a worker', async () => {
        let calls = 0;
        const results = await mapWithConcurrency([], 4, async () => {
            calls += 1;
            return 0;
        });

        expect(results).toEqual([]);
        expect(calls).toBe(0);
    });
});
