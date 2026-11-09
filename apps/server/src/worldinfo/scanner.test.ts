import { WORLD_INFO_LOGIC, WORLD_INFO_POSITION } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

import { parseDecorators } from './matching.js';
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
        key: [],
        keysecondary: [],
        comment: '',
        content: '',
        constant: false,
        selective: true,
        selectiveLogic: WORLD_INFO_LOGIC.AND_ANY,
        order: 100,
        position: WORLD_INFO_POSITION.BEFORE_CHAR,
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
        ignoreBudget: false,
        outletName: '',
        triggers: [],
        automationId: '',
        ...overrides,
    };
}

/** Chat messages are given newest-first, matching SillyTavern's buffer. */
function chat(...messages: string[]): ScanMessage[] {
    return messages.map((text) => ({ text }));
}

function scan(entries: ScanEntry[], messages: ScanMessage[], extra: Partial<ScanInput> = {}) {
    return scanWorldInfo({ entries, chat: messages, maxContext: 4096, ...extra });
}

describe('world info scanner', () => {
    it('activates constant entries without keys', () => {
        const result = scan([makeEntry({ constant: true, content: 'Always here' })], []);

        expect(result.positions.before).toEqual(['Always here']);
        expect(result.activated).toHaveLength(1);
        expect(result.trace[0]?.reason).toBe('constant');
    });

    it('matches a primary key inside the scan depth only', () => {
        const entry = makeEntry({ key: ['dragon'], content: 'Lore' });

        expect(scan([entry], chat('The dragon roars.')).activated).toHaveLength(1);

        // Depth 2 scans the two newest messages; the dragon is the fourth.
        const missed = scan([entry], chat('one', 'two', 'three', 'The dragon roars.'));
        expect(missed.activated).toHaveLength(0);
        expect(missed.trace[0]?.reason).toBe('primary-key-miss');
    });

    it('honours an entry-level scan depth override', () => {
        const entry = makeEntry({ key: ['dragon'], content: 'Lore', scanDepth: 5 });
        const result = scan([entry], chat('one', 'two', 'three', 'The dragon roars.'));

        expect(result.activated).toHaveLength(1);
    });

    it('applies the four secondary key logics', () => {
        const withLogic = (selectiveLogic: number) =>
            makeEntry({ key: ['dragon'], keysecondary: ['fire', 'ice'], selectiveLogic, content: 'Lore' });

        const andAny = scan([withLogic(WORLD_INFO_LOGIC.AND_ANY)], chat('dragon fire'));
        expect(andAny.activated).toHaveLength(1);

        const andAllPartial = scan([withLogic(WORLD_INFO_LOGIC.AND_ALL)], chat('dragon fire'));
        expect(andAllPartial.activated).toHaveLength(0);
        expect(andAllPartial.trace[0]?.reason).toBe('secondary-key-miss');

        const andAllFull = scan([withLogic(WORLD_INFO_LOGIC.AND_ALL)], chat('dragon fire ice'));
        expect(andAllFull.activated).toHaveLength(1);

        const notAnyClean = scan([withLogic(WORLD_INFO_LOGIC.NOT_ANY)], chat('dragon'));
        expect(notAnyClean.activated).toHaveLength(1);

        const notAnyDirty = scan([withLogic(WORLD_INFO_LOGIC.NOT_ANY)], chat('dragon fire'));
        expect(notAnyDirty.activated).toHaveLength(0);

        const notAllPartial = scan([withLogic(WORLD_INFO_LOGIC.NOT_ALL)], chat('dragon fire'));
        expect(notAllPartial.activated).toHaveLength(1);

        const notAllFull = scan([withLogic(WORLD_INFO_LOGIC.NOT_ALL)], chat('dragon fire ice'));
        expect(notAllFull.activated).toHaveLength(0);
    });

    it('ignores secondary keys when the entry is not selective', () => {
        const entry = makeEntry({
            key: ['dragon'],
            keysecondary: ['fire'],
            selective: false,
            content: 'Lore',
        });

        expect(scan([entry], chat('dragon')).activated).toHaveLength(1);
    });

    it('applies global and per-entry case sensitivity', () => {
        const entry = makeEntry({ key: ['Dragon'], content: 'Lore' });

        expect(scan([entry], chat('a dragon')).activated).toHaveLength(1);

        const sensitive = scan([entry], chat('a dragon'), { settings: { caseSensitive: true } });
        expect(sensitive.activated).toHaveLength(0);

        const entryOverride = makeEntry({ key: ['Dragon'], caseSensitive: true, content: 'Lore' });
        expect(scan([entryOverride], chat('a Dragon')).activated).toHaveLength(1);
    });

    it('supports whole-word matching with punctuation boundaries', () => {
        const entry = makeEntry({ key: ['dragon'], content: 'Lore' });

        expect(scan([entry], chat('dragons are here')).activated).toHaveLength(1);

        const whole = { settings: { matchWholeWords: true } };
        expect(scan([entry], chat('dragons are here'), whole).activated).toHaveLength(0);
        expect(scan([entry], chat('the dragon, at last'), whole).activated).toHaveLength(1);
    });

    it('treats slash-delimited keys as regular expressions', () => {
        const entry = makeEntry({ key: ['/drag(on|ons)/i'], content: 'Lore' });

        expect(scan([entry], chat('Dragons sleep')).activated).toHaveLength(1);
    });

    it('rolls probability and reports failures', () => {
        const entry = makeEntry({ constant: true, probability: 50, content: 'Lore' });

        const pass = scan([entry], [], { random: () => 0.2 });
        expect(pass.activated).toHaveLength(1);

        const fail = scan([entry], [], { random: () => 0.8 });
        expect(fail.activated).toHaveLength(0);
        expect(fail.trace[0]?.reason).toBe('probability-failed');

        const disabled = scan([makeEntry({ constant: true, probability: 0, useProbability: false })], [], {
            random: () => 0.99,
        });
        expect(disabled.activated).toHaveLength(1);
    });

    it('stops at the token budget', () => {
        const entries = [
            makeEntry({ constant: true, content: 'aaaaaaaaaa', order: 100 }),
            makeEntry({ constant: true, content: 'bbbbbbbbbb', order: 90 }),
            makeEntry({ constant: true, content: 'cccccccccc', order: 80 }),
        ];

        const result = scanWorldInfo({
            entries,
            chat: [],
            maxContext: 100,
            settings: { budgetPercent: 15 },
            countTokens: (text) => text.length,
        });

        expect(result.budget.limit).toBe(15);
        expect(result.activated).toHaveLength(1);
        expect(result.budget.overflowed).toBe(true);
    });

    it('lets ignoreBudget entries through an exhausted budget', () => {
        const entries = [
            makeEntry({ constant: true, content: 'aaaaaaaaaa', order: 100 }),
            makeEntry({ constant: true, content: 'bbbbbbbbbb', order: 90, ignoreBudget: true }),
        ];

        const result = scanWorldInfo({
            entries,
            chat: [],
            maxContext: 100,
            settings: { budgetPercent: 15 },
            countTokens: (text) => text.length,
        });

        expect(result.activated.map((entry) => entry.content)).toEqual(['aaaaaaaaaa', 'bbbbbbbbbb']);
    });

    it('orders each position bucket by ascending order value', () => {
        const entries = [
            makeEntry({ constant: true, content: 'high', order: 200 }),
            makeEntry({ constant: true, content: 'low', order: 50 }),
        ];

        expect(scan(entries, []).positions.before).toEqual(['low', 'high']);
    });

    it('places entries in their configured positions', () => {
        const entries = [
            makeEntry({ constant: true, content: 'before' }),
            makeEntry({ constant: true, content: 'after', position: WORLD_INFO_POSITION.AFTER_CHAR }),
            makeEntry({ constant: true, content: 'note', position: WORLD_INFO_POSITION.AN_TOP }),
            makeEntry({ constant: true, content: 'bottom', position: WORLD_INFO_POSITION.AN_BOTTOM }),
            makeEntry({
                constant: true,
                content: 'deep',
                position: WORLD_INFO_POSITION.AT_DEPTH,
                depth: 2,
                role: 1,
            }),
        ];

        const result = scan(entries, []);

        expect(result.positions.before).toEqual(['before']);
        expect(result.positions.after).toEqual(['after']);
        expect(result.positions.authorNoteTop).toEqual(['note']);
        expect(result.positions.authorNoteBottom).toEqual(['bottom']);
        expect(result.positions.atDepth).toEqual([{ depth: 2, role: 1, entries: ['deep'] }]);
    });

    it('records skips for disabled and keyless entries', () => {
        const entries = [makeEntry({ disable: true, content: 'off' }), makeEntry({ content: 'no keys' })];

        const result = scan(entries, []);

        expect(result.activated).toHaveLength(0);
        expect(result.trace.map((line) => line.reason)).toEqual(['disabled', 'no-keys']);
    });

    it('honours the activation and suppression decorators', () => {
        const activated = parseDecorators('@@activate\nAlways');
        const suppressed = parseDecorators('@@dont_activate\nNever');

        const result = scan(
            [makeEntry({ ...activated }), makeEntry({ ...suppressed, key: ['anything'] })],
            chat('anything'),
        );

        expect(result.activated.map((entry) => entry.content)).toEqual(['Always']);
        expect(result.trace[1]?.reason).toBe('decorator-dont-activate');
    });

    it('filters entries by generation trigger', () => {
        const entry = makeEntry({ constant: true, triggers: ['continue'], content: 'Lore' });

        expect(scan([entry], []).activated).toHaveLength(0);
        expect(scan([entry], [], { globalScanData: { trigger: 'continue' } }).activated).toHaveLength(1);
    });

    it('matches opt-in global scan data', () => {
        const entry = makeEntry({ key: ['war'], matchScenario: true, content: 'Lore' });

        const result = scan([entry], [], {
            globalScanData: { scenario: 'The war is over.' },
        });

        expect(result.activated).toHaveLength(1);
    });

    it('expands macros in keys and content', () => {
        const entry = makeEntry({ key: ['{{char}}'], content: 'Hello, {{char}}.' });
        const substitute = (text: string) => text.replaceAll('{{char}}', 'Seraphina');

        const result = scan([entry], chat('Seraphina speaks.'), { substitute });

        expect(result.activated).toHaveLength(1);
        expect(result.positions.before).toEqual(['Hello, Seraphina.']);
    });
});
