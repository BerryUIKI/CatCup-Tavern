import { describe, expect, it } from 'vitest';

import { ensureTimedWorldInfo } from './timedEffects.js';

describe('timed world info metadata', () => {
    it('creates the containers SillyTavern expects', () => {
        const metadata: Record<string, unknown> = {};

        const state = ensureTimedWorldInfo(metadata);

        expect(state.sticky).toEqual({});
        expect(state.cooldown).toEqual({});
        expect(metadata.timedWorldInfo).toBe(state);
    });

    it('keeps valid records and drops malformed ones', () => {
        const metadata: Record<string, unknown> = {
            timedWorldInfo: {
                sticky: {
                    'book.1': { hash: 42, start: 3, end: 6, protected: false },
                    'book.2': 'not a record',
                },
                cooldown: null,
            },
        };

        const state = ensureTimedWorldInfo(metadata);

        expect(state.sticky).toEqual({ 'book.1': { hash: 42, start: 3, end: 6, protected: false } });
        expect(state.cooldown).toEqual({});
    });

    it('replaces a non-object container', () => {
        const metadata: Record<string, unknown> = { timedWorldInfo: 'corrupt' };

        expect(ensureTimedWorldInfo(metadata).sticky).toEqual({});
    });
});
