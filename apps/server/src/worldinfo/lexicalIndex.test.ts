import { beforeEach, describe, expect, it } from 'vitest';

import { clearIndexCache, getEntryIndex, indexFingerprint } from './lexicalIndex.js';
import type { ScanEntry } from './types.js';

function entry(over: Partial<ScanEntry> = {}): ScanEntry {
    return {
        uid: 0,
        world: 'book',
        id: 'book.0',
        decorators: [],
        autoKeys: [],
        hash: 1,
        key: ['dragon'],
        keysecondary: [],
        comment: 'Dragons',
        content: 'Scaled beasts of the northern peaks.',
        constant: false,
        selective: true,
        selectiveLogic: 0,
        order: 100,
        position: 0,
        disable: false,
        group: '',
        groupOverride: false,
        groupWeight: 100,
        sticky: 0,
        cooldown: 0,
        delay: 0,
        probability: 100,
        depth: 4,
        useProbability: true,
        role: null,
        vectorized: false,
        excludeRecursion: false,
        preventRecursion: false,
        delayUntilRecursion: false,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        characterFilter: undefined,
        ignoreBudget: false,
        outletName: '',
        triggers: [],
        automationId: '',
        ...over,
    } as ScanEntry;
}

beforeEach(() => {
    clearIndexCache();
});

describe('indexFingerprint', () => {
    it('changes when an alias is added', () => {
        const before = indexFingerprint([entry()]);
        const after = indexFingerprint([entry({ autoKeys: ['wyrm'] })]);
        // An alias is indexed as a key, so a stale index would score the old
        // key set. The fingerprint has to notice, or the edit does nothing until
        // a process restart.
        expect(after).not.toBe(before);
    });

    it('is stable across a rebuild of identical entries', () => {
        expect(indexFingerprint([entry()])).toBe(indexFingerprint([entry()]));
    });
});

describe('getEntryIndex', () => {
    it('indexes aliases alongside the authored keys', () => {
        const { index } = getEntryIndex([entry({ autoKeys: ['wyrm'] })]);
        expect(index.query('wyrm').length).toBe(1);
    });

    it('keeps the index usable when only unhashed fields change', () => {
        // Non-hashed fields must not invalidate the index: an entry reordered or
        // disabled scores identically, so rebuilding would be wasted work. The
        // scanner resolves hits against its own current entry list, which is
        // what stops a cached build from resurrecting an old `disable` flag.
        const first = entry({ disable: false, position: 0 });
        const before = getEntryIndex([first]).fingerprint;

        const current = entry({ disable: true, position: 4 });
        const after = getEntryIndex([current]);

        expect(after.fingerprint).toBe(before);
        expect(after.index.query('dragon')).toHaveLength(1);
    });
});
