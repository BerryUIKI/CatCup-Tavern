import { describe, expect, it } from 'vitest';

import { extractImportedScripts } from './regex.js';

describe('regex import shapes', () => {
    it('reads an array of scripts', () => {
        expect(extractImportedScripts([{ id: 'a' }, { id: 'b' }])).toHaveLength(2);
    });

    it('reads a { scripts } wrapper', () => {
        expect(extractImportedScripts({ scripts: [{ id: 'a' }] })).toHaveLength(1);
    });

    it('reads an extension-settings backup', () => {
        expect(extractImportedScripts({ regex: [{ id: 'a' }] })).toHaveLength(1);
    });

    it('reads a single exported script', () => {
        expect(extractImportedScripts({ scriptName: 'Strip OOC', findRegex: '/x/' })).toHaveLength(1);
    });

    it('returns nothing for a payload it does not recognise', () => {
        expect(extractImportedScripts(null)).toEqual([]);
        expect(extractImportedScripts('nope')).toEqual([]);
        expect(extractImportedScripts({ unrelated: true })).toEqual([]);
    });
});
