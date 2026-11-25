import { describe, expect, it } from 'vitest';

import { extractJson } from './reply.js';

describe('extractJson', () => {
    it('reads a bare object', () => {
        expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    });

    it('reads a fenced object', () => {
        expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    });

    it('reads an object with prose around it', () => {
        expect(extractJson('Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
    });

    it('returns null when there is no object', () => {
        expect(extractJson('I could not find anything.')).toBeNull();
        expect(extractJson('')).toBeNull();
    });
});
