import type { ScanEntry, ScanInput, ScanMessage, TimedWorldInfo } from '@catcup/compat-st';
import { composeAuthorNote, formatWorldInfo, parseDecorators, scanWorldInfo } from '@catcup/compat-st';
import { PROMPT_ROLE, WI_ANCHOR_POSITION, WORLD_INFO_LOGIC, WORLD_INFO_POSITION } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

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
        characterFilter: undefined,
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

function newTimedState(): TimedWorldInfo {
    return { sticky: {}, cooldown: {} };
}

function scan(entries: ScanEntry[], messages: ScanMessage[], extra: Partial<ScanInput> = {}) {
    return scanWorldInfo({ entries, chat: messages, maxContext: 4096, ...extra });
}

function reasons(result: ReturnType<typeof scanWorldInfo>): string[] {
    return result.trace.map((line) => line.reason);
}

describe('world info scanner — matching', () => {
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

    it('scans injected text without counting it as a chat message', () => {
        const matched = makeEntry({ key: ['brass key'], content: 'Key lore' });
        const delayed = makeEntry({ key: ['brass key'], content: 'Delayed lore', delay: 3 });

        const result = scan([matched, delayed], chat('one', 'two'), {
            injections: ['The brass key is safe.'],
        });

        expect(result.positions.before).toContain('Key lore');
        // The delayed entry needs three chat messages; the injection must not
        // advance the timed-effect clock.
        expect(result.positions.before).not.toContain('Delayed lore');
    });

    it('honours an entry-level scan depth override', () => {
        const entry = makeEntry({ key: ['dragon'], content: 'Lore', scanDepth: 5 });
        const result = scan([entry], chat('one', 'two', 'three', 'The dragon roars.'));

        expect(result.activated).toHaveLength(1);
    });

    it('applies the four secondary key logics', () => {
        const withLogic = (selectiveLogic: number) =>
            makeEntry({ key: ['dragon'], keysecondary: ['fire', 'ice'], selectiveLogic, content: 'Lore' });

        expect(scan([withLogic(WORLD_INFO_LOGIC.AND_ANY)], chat('dragon fire')).activated).toHaveLength(1);

        const andAllPartial = scan([withLogic(WORLD_INFO_LOGIC.AND_ALL)], chat('dragon fire'));
        expect(andAllPartial.activated).toHaveLength(0);
        expect(andAllPartial.trace[0]?.reason).toBe('secondary-key-miss');

        expect(scan([withLogic(WORLD_INFO_LOGIC.AND_ALL)], chat('dragon fire ice')).activated).toHaveLength(1);
        expect(scan([withLogic(WORLD_INFO_LOGIC.NOT_ANY)], chat('dragon')).activated).toHaveLength(1);
        expect(scan([withLogic(WORLD_INFO_LOGIC.NOT_ANY)], chat('dragon fire')).activated).toHaveLength(0);
        expect(scan([withLogic(WORLD_INFO_LOGIC.NOT_ALL)], chat('dragon fire')).activated).toHaveLength(1);
        expect(scan([withLogic(WORLD_INFO_LOGIC.NOT_ALL)], chat('dragon fire ice')).activated).toHaveLength(0);
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

        expect(scan([entry], [], { random: () => 0.2 }).activated).toHaveLength(1);

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

    it('records skips for disabled, keyless and trigger-filtered entries', () => {
        const entries = [
            makeEntry({ disable: true, content: 'off' }),
            makeEntry({ content: 'no keys' }),
            makeEntry({ constant: true, triggers: ['continue'], content: 'only on continue' }),
        ];

        expect(reasons(scan(entries, []))).toEqual(['disabled', 'no-keys', 'trigger-filter']);
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

    it('matches opt-in global scan data', () => {
        const entry = makeEntry({ key: ['war'], matchScenario: true, content: 'Lore' });

        expect(scan([entry], [], { globalScanData: { scenario: 'The war is over.' } }).activated).toHaveLength(1);
    });

    it('expands macros in keys and content', () => {
        const entry = makeEntry({ key: ['{{char}}'], content: 'Hello, {{char}}.' });
        const substitute = (text: string) => text.replaceAll('{{char}}', 'Seraphina');

        const result = scan([entry], chat('Seraphina speaks.'), { substitute });

        expect(result.activated).toHaveLength(1);
        expect(result.positions.before).toEqual(['Hello, Seraphina.']);
    });

    it('filters by character name and tags', () => {
        const named = makeEntry({
            constant: true,
            content: 'Lore',
            characterFilter: { names: ['Seraphina'], tags: [], isExclude: false },
        });

        expect(scan([named], [], { activeCharacter: { id: 'Seraphina' } }).activated).toHaveLength(1);

        const other = scan([named], [], { activeCharacter: { id: 'Someone' } });
        expect(other.activated).toHaveLength(0);
        expect(other.trace[0]?.reason).toBe('character-filter-name');

        const tagged = makeEntry({
            constant: true,
            content: 'Lore',
            characterFilter: { names: [], tags: ['t1'], isExclude: true },
        });

        expect(scan([tagged], [], { activeCharacter: { id: 'Seraphina', tagIds: ['t1'] } }).activated).toHaveLength(0);
        expect(scan([tagged], [], { activeCharacter: { id: 'Seraphina', tagIds: [] } }).activated).toHaveLength(1);
    });
});

describe('world info scanner — positions', () => {
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
                role: PROMPT_ROLE.USER,
            }),
        ];

        const result = scan(entries, []);

        expect(result.positions.before).toEqual(['before']);
        expect(result.positions.after).toEqual(['after']);
        expect(result.positions.authorNoteTop).toEqual(['note']);
        expect(result.positions.authorNoteBottom).toEqual(['bottom']);
        expect(result.positions.atDepth).toEqual([{ depth: 2, role: PROMPT_ROLE.USER, entries: ['deep'] }]);
    });

    it('collects example entries in ascending order across both anchors', () => {
        const entries = [
            makeEntry({ constant: true, content: 'top', order: 200, position: WORLD_INFO_POSITION.EM_TOP }),
            makeEntry({ constant: true, content: 'bottom', order: 100, position: WORLD_INFO_POSITION.EM_BOTTOM }),
        ];

        expect(scan(entries, []).positions.examples).toEqual([
            { position: WI_ANCHOR_POSITION.AFTER, content: 'bottom' },
            { position: WI_ANCHOR_POSITION.BEFORE, content: 'top' },
        ]);
    });

    it('keeps outlets in descending order and drops unnamed ones', () => {
        const entries = [
            makeEntry({
                constant: true,
                content: 'low',
                order: 50,
                position: WORLD_INFO_POSITION.OUTLET,
                outletName: 'x',
            }),
            makeEntry({
                constant: true,
                content: 'high',
                order: 100,
                position: WORLD_INFO_POSITION.OUTLET,
                outletName: 'x',
            }),
            makeEntry({ constant: true, content: 'ignored', position: WORLD_INFO_POSITION.OUTLET }),
        ];

        expect(scan(entries, []).positions.outlets).toEqual({ x: ['high', 'low'] });
    });

    it('keeps whitespace-only content and drops only empty strings', () => {
        const entries = [
            makeEntry({ constant: true, content: '   ', order: 200 }),
            makeEntry({ constant: true, content: '', order: 100 }),
        ];

        expect(scan(entries, []).positions.before).toEqual(['   ']);
    });

    it('drops entries in unknown positions', () => {
        const entry = makeEntry({ constant: true, content: 'lost', position: 99 });

        expect(scan([entry], []).positions.before).toEqual([]);
    });
});

describe('world info scanner — recursion', () => {
    it('feeds activated content into later passes', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200 }),
            makeEntry({ uid: 1, key: ['A'], content: 'B', order: 100 }),
        ];

        const result = scan(entries, [], { settings: { recursive: true } });

        expect(result.activated.map((entry) => entry.content)).toEqual(['A', 'B']);
        expect(result.trace.find((line) => line.uid === 1)?.loop).toBe(2);
        expect(result.loops).toBe(3);
    });

    it('does not recurse without the recursive setting', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200 }),
            makeEntry({ uid: 1, key: ['A'], content: 'B', order: 100 }),
        ];

        const result = scan(entries, []);

        expect(result.activated).toHaveLength(1);
        expect(result.loops).toBe(1);
    });

    it('stops a chain at preventRecursion', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200 }),
            makeEntry({ uid: 1, key: ['A'], content: 'B', preventRecursion: true }),
            makeEntry({ uid: 2, key: ['B'], content: 'C' }),
        ];

        const result = scan(entries, [], { settings: { recursive: true } });

        expect(result.activated.map((entry) => entry.content)).toEqual(['A', 'B']);
        expect(result.loops).toBe(2);
    });

    it('suppresses excludeRecursion entries during recursion passes', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200 }),
            makeEntry({ uid: 1, key: ['A'], content: 'B', excludeRecursion: true }),
        ];

        const result = scan(entries, [], { settings: { recursive: true } });

        expect(result.activated).toHaveLength(1);
        expect(result.trace.find((line) => line.uid === 1)?.reason).toBe('exclude-recursion');
    });

    it('only activates delayUntilRecursion entries during a recursion pass', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200 }),
            makeEntry({ uid: 1, key: ['A'], content: 'B', delayUntilRecursion: true }),
        ];

        const result = scan(entries, [], { settings: { recursive: true } });

        expect(result.activated.map((entry) => entry.content)).toEqual(['A', 'B']);
        expect(result.trace.find((line) => line.uid === 1)?.loop).toBe(2);
    });

    it('never activates a delayed entry when recursion is off', () => {
        // The only way into a RECURSION pass is recursion itself, so a lone
        // delay level produces no pass at all.
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200 }),
            makeEntry({ uid: 1, key: ['A'], content: 'B', delayUntilRecursion: true }),
        ];

        const result = scan(entries, []);

        expect(result.activated).toHaveLength(1);
        expect(result.loops).toBe(1);
    });

    it('honours the maximum recursion step count', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200 }),
            makeEntry({ uid: 1, key: ['A'], content: 'B', order: 100 }),
        ];

        const result = scan(entries, [], { settings: { recursive: true, maxRecursionSteps: 1 } });

        expect(result.activated).toHaveLength(1);
        expect(result.loops).toBe(1);
    });

    it('widens the scan depth until the minimum activation count is met', () => {
        const entry = makeEntry({ key: ['needle'], content: 'Lore' });

        const result = scan([entry], chat('a', 'b', 'c', 'd', 'needle'), {
            settings: { depth: 2, minActivations: 1 },
        });

        expect(result.activated).toHaveLength(1);
        // Passes run at depth 2, 3, 4 and 5.
        expect(result.loops).toBe(4);
    });
});

describe('world info scanner — inclusion groups', () => {
    it('lets a group override win on the highest order', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200, group: 'g', groupOverride: true }),
            makeEntry({ uid: 1, constant: true, content: 'B', order: 100, group: 'g' }),
        ];

        const result = scan(entries, []);

        expect(result.activated.map((entry) => entry.content)).toEqual(['A']);
        expect(result.trace.find((line) => line.uid === 1)?.reason).toBe('group-loser');
    });

    it('picks one winner by weighted roll', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200, group: 'g' }),
            makeEntry({ uid: 1, constant: true, content: 'B', order: 100, group: 'g' }),
        ];

        const result = scan(entries, [], { random: () => 0 });

        expect(result.activated.map((entry) => entry.content)).toEqual(['A']);
    });

    it('drops scored losers while unscored members set the bar', () => {
        const entries = [
            makeEntry({
                uid: 0,
                key: ['dragon'],
                content: 'A',
                order: 200,
                group: 'g',
                useGroupScoring: true,
            }),
            makeEntry({
                uid: 1,
                key: ['dragon', 'wyrm'],
                content: 'B',
                order: 100,
                group: 'g',
                useGroupScoring: false,
            }),
        ];

        const result = scan(entries, chat('dragon wyrm'));

        expect(result.activated.map((entry) => entry.content)).toEqual(['B']);
    });

    it('leaves ungrouped entries alone', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 200 }),
            makeEntry({ uid: 1, constant: true, content: 'B', order: 100 }),
        ];

        expect(scan(entries, []).activated).toHaveLength(2);
    });

    it('lets any group veto a multi-group entry', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', order: 300, group: 'g1', groupOverride: true }),
            makeEntry({ uid: 1, constant: true, content: 'B', order: 200, group: 'g1,g2' }),
            makeEntry({ uid: 2, constant: true, content: 'C', order: 100, group: 'g2', groupOverride: true }),
        ];

        const result = scan(entries, []);

        // g2's override removes B, so g1 has only A left.
        expect(result.activated.map((entry) => entry.content)).toEqual(['A', 'C']);
    });
});

describe('world info scanner — timed effects', () => {
    it('keeps a sticky entry active without a key match', () => {
        const state = newTimedState();
        const entry = makeEntry({ uid: 0, key: ['dragon'], content: 'Lore', sticky: 2 });

        const first = scan([entry], chat('dragon'), { timed: { state } });
        expect(first.activated).toHaveLength(1);
        expect(state.sticky[entry.id]).toEqual({ hash: entry.hash, start: 1, end: 3, protected: false });

        const second = scan([entry], chat('nothing', 'here'), { timed: { state } });
        expect(second.activated).toHaveLength(1);
        expect(second.trace[0]?.reason).toBe('sticky');

        const third = scan([entry], chat('a', 'b', 'c'), { timed: { state } });
        expect(third.activated).toHaveLength(0);
        expect(state.sticky[entry.id]).toBeUndefined();
    });

    it('suppresses an entry on cooldown', () => {
        const state = newTimedState();
        const entry = makeEntry({ uid: 0, key: ['dragon'], content: 'Lore', cooldown: 2 });

        scan([entry], chat('dragon'), { timed: { state } });

        const blocked = scan([entry], chat('dragon', 'again'), { timed: { state } });
        expect(blocked.activated).toHaveLength(0);
        expect(blocked.trace[0]?.reason).toBe('timed-cooldown');
    });

    it('suppresses a delayed entry until the chat is long enough', () => {
        const entry = makeEntry({ uid: 0, key: ['dragon'], content: 'Lore', delay: 3 });

        const early = scan([entry], chat('dragon', 'one'));
        expect(early.activated).toHaveLength(0);
        expect(early.trace[0]?.reason).toBe('timed-delay');

        expect(scan([entry], chat('dragon', 'one', 'two')).activated).toHaveLength(1);
    });

    it('turns an expiring sticky into a protected cooldown', () => {
        const state = newTimedState();
        const entry = makeEntry({ uid: 0, key: ['dragon'], content: 'Lore', sticky: 1, cooldown: 2 });

        scan([entry], chat('dragon'), { timed: { state } });

        const expired = scan([entry], chat('dragon', 'again'), { timed: { state } });

        expect(expired.activated).toHaveLength(0);
        expect(expired.trace[0]?.reason).toBe('timed-cooldown');
        expect(state.cooldown[entry.id]).toEqual({ hash: entry.hash, start: 2, end: 4, protected: true });
    });

    it('ignores sticky and cooldown during a dry run but still applies delay', () => {
        const state = newTimedState();
        const entry = makeEntry({ uid: 0, key: ['dragon'], content: 'Lore', sticky: 2, cooldown: 2 });

        const first = scan([entry], chat('dragon'), { timed: { state, dryRun: true } });
        expect(first.activated).toHaveLength(1);
        expect(state.sticky).toEqual({});

        const second = scan([entry], chat('nothing', 'here'), { timed: { state, dryRun: true } });
        expect(second.activated).toHaveLength(0);
    });
});

describe('world info scanner — edges the rewrite must not move', () => {
    /**
     * Behaviour that produces no error and no failed assertion when it changes:
     * an entry is silently absent, or a trace reason names the wrong thing. Each
     * of these was written down by running the scanner as it is, before the
     * module was rewritten, so they describe what it does rather than what it
     * was supposed to do.
     */

    it('lets a sticky winner survive beside its group and skip the roll', () => {
        const state = newTimedState();
        const sticky = makeEntry({ uid: 0, key: ['dragon'], content: 'S', group: 'g', sticky: 3 });
        const rival = makeEntry({ uid: 1, constant: true, content: 'R', group: 'g' });

        // Both scans seed the roll: the *first* one is where the group is
        // decided, so leaving it unseeded makes this test pass or fail at
        // random — which it did, until this was noticed.
        scan([sticky, rival], chat('dragon'), { timed: { state }, random: () => 0 });

        // The chat must *grow* for the record to survive: a shorter one is read
        // as a rewind and drops the record (that rule has its own test in the
        // timed-effects suite). Two messages leaves the window open.
        const second = scan([sticky, rival], chat('nothing', 'else'), { timed: { state }, random: () => 0 });

        expect(second.activated.map((entry) => entry.content)).toEqual(['S']);
        expect(second.trace.find((line) => line.uid === 1)?.reason).toBe('group-loser');
    });

    it('leaves a lone group member alone once the sticky winner is cooling down', () => {
        const state = newTimedState();
        // Sticky 1, cooldown 5. The rival loses to the sticky member while the
        // window is open; when it closes, the sticky member is skipped as
        // cooling down and the rival is the only candidate left.
        const entry = makeEntry({ uid: 0, key: ['dragon'], content: 'S', group: 'g', sticky: 1, cooldown: 5 });
        const rival = makeEntry({ uid: 1, constant: true, content: 'R', group: 'g' });

        // A fixed roll, because the first scan decides the group by weighted
        // draw and an unseeded one makes this test pass or fail at random.
        scan([entry, rival], chat('dragon'), { timed: { state }, random: () => 0 });
        const second = scan([entry, rival], chat('a', 'b', 'c'), { timed: { state }, random: () => 0 });

        // A group of one is not a decision: the cooldown removed the sticky
        // member's candidacy before grouping, so R is not "a survivor" — it is
        // the whole group, and it activates.
        expect(second.activated.map((candidate) => candidate.content)).toEqual(['R']);
        // The cooling-down entry is reported as such, because that gate runs
        // before the key match is even attempted.
        expect(second.trace.find((line) => line.uid === 0)?.reason).toBe('timed-cooldown');
    });

    it('compares the whole group string, so a multi-group entry locks nothing', () => {
        const entries = [
            // Active, but its `group` is the CSV `g,g2` — not the name `g`.
            makeEntry({ uid: 0, constant: true, content: 'A', group: 'g,g2', order: 300 }),
            makeEntry({ uid: 1, constant: true, content: 'B', group: 'g', order: 200, groupOverride: true }),
        ];

        const result = scan(entries, []);

        // A wins `g` as an ordinary member, then B's override removes it, so
        // only B is left — A's group string matched no group by name.
        expect(result.activated.map((entry) => entry.content)).toEqual(['B']);
        expect(result.trace.find((line) => line.uid === 0)?.reason).toBe('group-loser');
    });

    it('picks a winner even when every weight is zero', () => {
        const entries = [
            makeEntry({ uid: 0, constant: true, content: 'A', group: 'g', groupWeight: 0 }),
            makeEntry({ uid: 1, constant: true, content: 'B', group: 'g', groupWeight: 0 }),
        ];

        // Total weight 0 makes the roll 0, and `0 <= 0` picks the first member
        // — so a degenerate weight removes the others rather than failing open.
        // Written down because "zero weight means no preference" would be the
        // intuitive reading, and it is not what happens.
        const result = scan(entries, [], { random: () => 0.5 });

        expect(result.activated.map((entry) => entry.content)).toEqual(['A']);
        expect(result.trace.find((line) => line.uid === 1)?.reason).toBe('group-loser');
    });

    it('does not treat an empty key as a match', () => {
        // The matcher itself would say `''` is a substring of anything, but the
        // scanner rejects a falsy key before asking — which is what keeps an
        // entry whose keys were all emptied from becoming permanently active.
        const entry = makeEntry({ key: [''], content: 'Lore' });

        expect(scan([entry], chat('anything at all')).activated).toHaveLength(0);
    });

    it('does not scan across a message boundary', () => {
        const entry = makeEntry({ key: ['dragon fire'], content: 'Lore' });
        const result = scan([entry], chat('dragon', 'fire'));

        // The joiner is a control character, so a two-word key cannot span two
        // messages even when they are adjacent in the buffer.
        expect(result.activated).toHaveLength(0);
    });

    it('reports an alias hit with the alias in the trace, not the authored key', () => {
        const entry = makeEntry({ key: ['princess'], autoKeys: ['王女'], content: 'Lore' });
        const result = scan([entry], chat('王女 enters.'));

        expect(result.activated).toHaveLength(1);
        expect(result.trace[0]?.detail).toContain('王女');
    });

    it('counts an ignoreBudget entry against nothing', () => {
        const entries = [
            makeEntry({ uid: 0, key: ['dragon'], content: 'A'.repeat(400), ignoreBudget: true }),
            makeEntry({ uid: 1, key: ['dragon'], content: 'B'.repeat(4000) }),
        ];

        // A tiny context forces the budget to bite; the ignored entry still gets
        // in, and the other is dropped for exceeding what is left.
        const result = scan(entries, chat('dragon'), { maxContext: 200 });

        expect(result.activated.map((entry) => entry.content[0])).toEqual(['A']);
    });
});

describe('world info prompt helpers', () => {
    it('composes the author note with exactly one newline trimmed', () => {
        expect(composeAuthorNote([], '', [])).toBe('');
        expect(composeAuthorNote([], 'N', [])).toBe('N');
        expect(composeAuthorNote(['A'], 'N', ['B'])).toBe('A\nN\nB');
        expect(composeAuthorNote(['A'], '', ['B'])).toBe('A\n\nB');
    });

    it('applies wi_format only to the first placeholder', () => {
        expect(formatWorldInfo('x', '<{0}>')).toBe('<x>');
        expect(formatWorldInfo('', '<{0}>')).toBe('');
        expect(formatWorldInfo('x', '   ')).toBe('x');
        expect(formatWorldInfo('x', '{0}{1}')).toBe('x{1}');
    });
});
