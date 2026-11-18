import { beforeEach, describe, expect, it } from 'vitest';

import { clearIndexCache } from './lexicalIndex.js';
import { scanWorldInfo } from './scanner.js';
import type { ScanEntry, ScanInput, ScanMessage } from './types.js';

let nextUid = 0;

function makeEntry(overrides: Partial<ScanEntry> = {}): ScanEntry {
    const uid = overrides.uid ?? nextUid++;
    return {
        uid,
        world: 'test',
        id: `test.${uid}`,
        decorators: [],
        autoKeys: [],
        hash: uid * 7919 + 13,
        key: [],
        keysecondary: [],
        comment: '',
        content: '',
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
        ...overrides,
    } as ScanEntry;
}

function chat(...messages: string[]): ScanMessage[] {
    return messages.map((text) => ({ text }));
}

function scan(entries: ScanEntry[], messages: ScanMessage[], extra: Partial<ScanInput> = {}) {
    return scanWorldInfo({
        entries,
        chat: messages,
        maxContext: 8192,
        settings: { depth: 10, lexicalMatch: true, ...(extra.settings ?? {}) },
        ...extra,
    });
}

beforeEach(() => {
    clearIndexCache();
});

describe('lexical pass', () => {
    it('is off unless enabled', () => {
        const entry = makeEntry({ key: ['dragon'], content: 'Scaled beasts of the northern peaks.' });
        const result = scan([entry], chat('A wyrm circled the high crags.'), {
            settings: { depth: 10, lexicalMatch: false },
        });

        expect(result.activated).toHaveLength(0);
        expect(result.lexicalAdded).toBe(0);
    });

    it('surfaces an entry whose key missed but whose content is on topic', () => {
        const entry = makeEntry({
            key: ['dragon'],
            comment: 'Dragons',
            content: 'Scaled beasts that roost on the northern peaks and hoard old coins.',
        });

        const result = scan([entry], chat('A wyrm circled the high crags above the peaks.'));

        expect(result.activated.map((e) => e.id)).toContain(entry.id);
        expect(result.lexicalAdded).toBe(1);
        expect(result.trace.find((line) => line.world === 'test' && line.activated)?.reason).toBe('lexical');
    });

    it('never activates an entry the author disabled', () => {
        const entry = makeEntry({
            key: ['dragon'],
            disabled: undefined,
            disable: true,
            content: 'Scaled beasts that roost on the northern peaks.',
        });

        const result = scan([entry], chat('A wyrm circled the northern peaks.'));

        expect(result.activated).toHaveLength(0);
    });

    it('acts on the current entry after an edit the index fingerprint ignores', () => {
        // The fingerprint covers `id`, `comment`, `content` and `key`, because
        // those are what BM25 scores. Everything else — `disable`, `position`,
        // `order` — can change without invalidating the cached index. The pass
        // must still read the entry as it is now, not as it was at build time.
        const content = 'Scaled beasts that roost on the northern peaks.';
        const before = makeEntry({ uid: 0, key: ['dragon'], content, comment: 'Beasts', disable: false });

        const first = scan([before], chat('A wyrm circled the northern peaks.'));
        expect(first.lexicalAdded).toBe(1);

        // Same id, same key, same comment, same content — only fields the
        // fingerprint excludes have changed.
        const after = makeEntry({
            uid: 0,
            key: ['dragon'],
            content,
            comment: 'Beasts',
            disable: true,
            position: 4,
            order: 1,
        });

        const second = scan([after], chat('A wyrm circled the northern peaks.'));

        expect(second.activated).toHaveLength(0);
        expect(second.lexicalAdded).toBe(0);
        expect(second.positions.before).toHaveLength(0);
    });

    it('uses the current position and order of an entry the index still holds', () => {
        const content = 'Scaled beasts that roost on the northern peaks.';
        const before = makeEntry({ uid: 0, key: ['dragon'], content, comment: 'Beasts', position: 0, order: 100 });

        scan([before], chat('A wyrm circled the northern peaks.'));

        // Moved to an at-depth injection and demoted in order, with nothing the
        // fingerprint reads changed.
        const after = makeEntry({
            uid: 0,
            key: ['dragon'],
            content,
            comment: 'Beasts',
            position: 4,
            order: 1,
            depth: 3,
        });

        const result = scan([after], chat('A wyrm circled the northern peaks.'));
        const activated = result.activated[0];

        expect(activated?.position).toBe(4);
        expect(activated?.order).toBe(1);
        expect(result.positions.before).toHaveLength(0);
        expect(result.positions.atDepth).toHaveLength(1);
    });

    it('honours @@dont_activate', () => {
        const entry = makeEntry({
            key: ['dragon'],
            decorators: ['@@dont_activate'],
            content: 'Scaled beasts that roost on the northern peaks.',
        });

        const result = scan([entry], chat('A wyrm circled the northern peaks.'));

        expect(result.activated).toHaveLength(0);
    });

    it('never activates a constant entry twice', () => {
        const entry = makeEntry({ constant: true, content: 'Always here.' });

        const result = scan([entry], chat('Anything at all.'));

        expect(result.activated).toHaveLength(1);
        expect(result.lexicalAdded).toBe(0);
    });

    it('honours a character filter', () => {
        const entry = makeEntry({
            key: ['dragon'],
            content: 'Scaled beasts that roost on the northern peaks.',
            characterFilter: { names: ['someone-else'], tags: [], isExclude: false },
        });

        const result = scan([entry], chat('A wyrm circled the northern peaks.'), {
            activeCharacter: { id: 'mira' },
        });

        expect(result.activated).toHaveLength(0);
    });

    it('honours a trigger filter', () => {
        const entry = makeEntry({
            key: ['dragon'],
            content: 'Scaled beasts that roost on the northern peaks.',
            triggers: ['impersonate'],
        });

        const result = scan([entry], chat('A wyrm circled the northern peaks.'), {
            globalScanData: { trigger: 'normal' },
        });

        expect(result.activated).toHaveLength(0);
    });

    it('respects the limit', () => {
        const entries = Array.from({ length: 8 }, (_, i) =>
            makeEntry({
                key: [`unrelated${i}`],
                comment: `Peak lore ${i}`,
                content: `The northern peaks hold old secrets, volume ${i}.`,
            }),
        );

        const result = scan(entries, chat('Something about the northern peaks and their secrets.'), {
            settings: { depth: 10, lexicalMatch: true, lexicalLimit: 3 },
        });

        expect(result.lexicalAdded).toBeLessThanOrEqual(3);
    });

    it('adds candidates without removing a keyword activation', () => {
        const keyword = makeEntry({ key: ['wyrm'], content: 'A wyrm entry.' });
        const lexical = makeEntry({
            key: ['dragon'],
            content: 'Scaled beasts that roost on the northern peaks.',
        });

        const result = scan([keyword, lexical], chat('The wyrm circled the northern peaks.'));

        const ids = result.activated.map((e) => e.id);
        expect(ids).toContain(keyword.id);
        expect(ids).toContain(lexical.id);
        expect(result.lexicalAdded).toBe(1);
    });

    it('does not duplicate an entry the keyword pass already activated', () => {
        const entry = makeEntry({ key: ['wyrm'], content: 'Scaled beasts that roost on the northern peaks.' });

        const result = scan([entry], chat('The wyrm circled the northern peaks.'));

        expect(result.activated).toHaveLength(1);
        expect(result.lexicalAdded).toBe(0);
    });

    it('contributes nothing when no entry is on topic', () => {
        const entry = makeEntry({ key: ['dragon'], content: 'Scaled beasts of the high crags.' });

        const result = scan([entry], chat('She poured tea and watched the rain.'));

        expect(result.lexicalAdded).toBe(0);
    });

    it('matches Chinese synonyms by shared characters when the key misses', () => {
        const entry = makeEntry({
            key: ['龙族'],
            comment: '龙与山峰',
            content: '有鳞的巨兽盘踞在北方的山峰上，守着古老的财宝。',
        });

        const result = scan([entry], chat('巨兽在山峰上盘旋。'));

        expect(result.activated.map((e) => e.id)).toContain(entry.id);
    });

    it('reports zero when the book is empty', () => {
        const result = scan([], chat('Anything.'));

        expect(result.lexicalAdded).toBe(0);
    });

    it('runs only on the initial pass, not on recursion', () => {
        const entry = makeEntry({ key: ['wyrm'], content: 'Scaled beasts that roost on the northern peaks.' });

        const result = scan([entry], chat('The wyrm circled the northern peaks.'), {
            settings: { depth: 10, lexicalMatch: true, recursive: true },
        });

        // The entry activated once. A recursion pass must not re-add it.
        const forEntry = result.trace.filter((line) => line.comment === '' && line.activated);
        expect(forEntry.length).toBeLessThanOrEqual(1);
        expect(result.activated).toHaveLength(1);
    });
});
