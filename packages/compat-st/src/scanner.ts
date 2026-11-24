// Written for CatCup. The world info scan: which entries fire on this turn, in
// what order they consume the budget, and where each one lands in the prompt.

import { PROMPT_ROLE, WI_ANCHOR_POSITION, WORLD_INFO_LOGIC, WORLD_INFO_POSITION } from '@catcup/shared';
import { type KeyMatchOptions, matchesKey } from './matching.js';
import { estimateTokens } from './prompt-tokenizer.js';
import { createTimedEffects, ensureTimedWorldInfo, type TimedEffects } from './timedEffects.js';
import {
    type ActivationReason,
    type GlobalScanData,
    SCAN_STATE,
    type ScanEntry,
    type ScanInput,
    type ScanMessage,
    type ScanPositions,
    type ScanResult,
    type ScanState,
    type ScanTrace,
    type SkipReason,
    type WorldInfoSettings,
} from './worldinfo-types.js';

/**
 * The world info scanner.
 *
 * One scan answers three questions about a turn: which entries are relevant,
 * which of those fit the budget, and where in the prompt each one goes. The
 * pipeline runs in passes:
 *
 * 1. Timed effects are evaluated against the chat's length. This happens first
 *    because sticky and cooldown decide *candidacy* — an entry on cooldown must
 *    not be considered at all.
 * 2. The keyword pass walks entries by descending `order` and stops at the
 *    first gate that rejects each one. Everything an entry is subject to —
 *    disabled, wrong trigger, wrong character, cooling down, no key match, a
 *    secondary-key rule — is decided here.
 * 3. Lexical matching, when enabled, may *add* candidates that the keyword pass
 *    missed. It never removes one: a similarity hit is a suggestion, and an
 *    authored key is an instruction.
 * 4. Inclusion groups keep one winner per group.
 * 5. Probability is rolled, then the token budget is spent in order.
 * 6. The pass decides whether another one follows — for recursion, for
 *    `minActivations` depth seeking, or for a deeper `delayUntilRecursion`
 *    level — and repeats.
 * 7. Whatever activated is bucketed by `position` for the prompt builder.
 *
 * The ordering inside each pass is load-bearing in several places, and each is
 * called out where it happens rather than summarised here.
 */

/**
 * Settings a scan uses when the caller supplies none.
 *
 * `depth: 2` means the two newest messages; `budgetPercent: 25` means a quarter
 * of the context window. Both are the values a book written elsewhere expects,
 * so changing them here would change what an imported book does.
 */
export const DEFAULT_WORLD_INFO_SETTINGS: WorldInfoSettings = {
    depth: 2,
    budgetPercent: 25,
    budgetCap: 0,
    caseSensitive: false,
    matchWholeWords: false,
    useGroupScoring: false,
    recursive: false,
    minActivations: 0,
    minActivationsDepthMax: 0,
    maxRecursionSteps: 0,
    lexicalMatch: false,
    lexicalThreshold: 0.35,
    lexicalLimit: 10,
};

/** Upper bound on `scanDepth` and on how much chat is buffered at all. */
export const MAX_SCAN_DEPTH = 1000;

/** Depth an `atDepth` entry uses when it names none. */
export const DEFAULT_DEPTH = 4;

/** Weight an inclusion-group entry gets when it names none. */
export const DEFAULT_WEIGHT = 100;

/**
 * The separator between scanned messages.
 *
 * A control character rather than a newline, so a key can never match across a
 * message boundary: `dragon` at the end of one message and `fire` at the start
 * of the next must not satisfy a two-word key.
 */
const MATCHER = '\u0001';
const JOINER = `\n${MATCHER}`;

/**
 * How many tokens a scan may spend, from a context size and the settings.
 *
 * A percentage with an optional absolute ceiling, and never zero: a book whose
 * budget rounds to nothing would silently contribute nothing at all, which
 * reads as "no entries matched" rather than "the budget is misconfigured".
 */
function computeBudget(maxContext: number, settings: WorldInfoSettings): number {
    const raw = Math.round((settings.budgetPercent * maxContext) / 100) || 1;
    return settings.budgetCap > 0 && raw > settings.budgetCap ? settings.budgetCap : raw;
}

/** Append optional scanned text for an `entry.matchX` flag. */
function optIn(enabled: boolean, value: string | undefined): string {
    return enabled && value ? JOINER + value : '';
}

interface ScanBuffer {
    /** Current default scan depth: the configured depth plus the skew. */
    depth(): number;
    /** Widen the window by one message, for `minActivations` depth seeking. */
    advanceScan(): void;
    /** Add one pass worth of activated text to the recursion buffer. */
    addRecurse(text: string): void;
    hasRecurse(): boolean;
    /** Text an entry is matched against for the given pass kind. */
    text(entry: ScanEntry, state: ScanState): string;
    /** Text an inclusion-group score is computed against. */
    window(state: ScanState): string;
}
/**
 * The haystack a scan matches against.
 *
 * Built once per scan from the newest `MAX_SCAN_DEPTH` messages, then sliced
 * per entry, because the alternative — walking the message list once per entry
 * per pass — is the scan's whole cost on a large book.
 *
 * Three things are appended beyond the chat, and each is opt-in per entry so an
 * entry that does not ask for them cannot match on them:
 *
 * - the persona and card fields, which is how an entry keyed on a persona's
 *   name fires;
 * - the caller's injected text, which is scanned but does not advance the
 *   chat-length clock — the clock is what timed effects count;
 * - the recursion buffer, which is excluded from a `minActivations` pass on
 *   purpose: depth seeking must not be satisfied by text recursion produced,
 *   or it would stop as soon as it found itself.
 */
function createScanBuffer(
    chat: readonly ScanMessage[],
    global: GlobalScanData,
    baseDepth: number,
    injections: readonly string[] = [],
): ScanBuffer {
    const messages: string[] = [];
    const limit = Math.min(chat.length, MAX_SCAN_DEPTH);
    for (let index = 0; index < limit; index += 1) {
        messages[index] = (chat[index]?.text ?? '').trim();
    }

    const recurseBuffer: string[] = [];
    let skew = 0;

    return {
        depth() {
            return baseDepth + skew;
        },

        advanceScan() {
            skew += 1;
        },

        addRecurse(text) {
            recurseBuffer.push(text);
        },

        hasRecurse() {
            return recurseBuffer.length > 0;
        },

        text(entry, state) {
            const requested = entry.scanDepth ?? baseDepth + skew;
            if (requested <= 0) {
                return '';
            }

            const depth = Math.min(requested, MAX_SCAN_DEPTH);
            let result = MATCHER + messages.slice(0, depth).join(JOINER);

            result += optIn(entry.matchPersonaDescription, global.personaDescription);
            result += optIn(entry.matchCharacterDescription, global.characterDescription);
            result += optIn(entry.matchCharacterPersonality, global.characterPersonality);
            result += optIn(entry.matchCharacterDepthPrompt, global.characterDepthPrompt);
            result += optIn(entry.matchScenario, global.scenario);
            result += optIn(entry.matchCreatorNotes, global.creatorNotes);

            if (injections.length > 0) {
                result += JOINER + injections.join(JOINER);
            }

            if (recurseBuffer.length > 0 && state !== SCAN_STATE.MIN_ACTIVATIONS) {
                result += JOINER + recurseBuffer.join(JOINER);
            }

            return result;
        },

        window(state) {
            const depth = Math.min(Math.max(baseDepth + skew, 0), MAX_SCAN_DEPTH);
            let result = MATCHER + messages.slice(0, depth).join(JOINER);

            if (recurseBuffer.length > 0 && state !== SCAN_STATE.MIN_ACTIVATIONS) {
                result += JOINER + recurseBuffer.join(JOINER);
            }

            return result;
        },
    };
}

/*
 * The lexical pass uses `window()` rather than `text()`, and two consequences
 * follow. Both are true of the behaviour this app ships, and both are written
 * down rather than fixed, because a single index query needs one shared haystack
 * and walking it per entry would cost a pass over the book per candidate.
 *
 * - **`entry.scanDepth` is not honoured.** A lexical hit for an entry that asked
 *   to scan fifty messages is decided on the default window, so it can be
 *   surfaced on less text than its author configured — or miss text the keyword
 *   pass would have matched.
 * - **The `match*` opt-ins and the injected summary text are not included.** A
 *   keyword hit can fire on the scenario or the persona description; a lexical
 *   one cannot.
 *
 * The first means a lexical hit is never *more* permissive than a keyword hit
 * for the same entry; the second means it is sometimes less. Neither widens a
 * door the author closed, which is why it is recorded rather than treated as a
 * bug to fix in this pass.
 */

/** Roll an entry's activation chance. `>= 100` short-circuits, so most entries never call `random`. */
function passesProbability(entry: ScanEntry, random: () => number): boolean {
    if (!entry.useProbability || entry.probability >= 100) {
        return true;
    }
    return random() * 100 <= entry.probability;
}

interface SecondaryResult {
    ok: boolean;
    /** The key that satisfied the rule, when there is one worth reporting. */
    key?: string;
}

/**
 * Apply `selectiveLogic` to an entry's secondary keys.
 *
 * Four modes, and each has its own short circuit because the modes are not
 * variations of one rule:
 *
 * - **AND_ANY** — one hit is enough, so it returns at the first.
 * - **NOT_ALL** — one *miss* is enough, so it returns at the first too.
 * - **NOT_ANY** — needs every key to miss, so it can only answer at the end.
 * - **AND_ALL** — needs every key to hit, so it can only answer at the end.
 *
 * An empty secondary list under NOT_ANY succeeds and under AND_ALL does not:
 * `allMatch` starts at `keys.length > 0`, so "all of nothing" is false while
 * "none of nothing" is true. That asymmetry is the format's, not a bug here.
 */
function matchSecondaryKeys(
    entry: ScanEntry,
    haystack: string,
    options: KeyMatchOptions,
    substitute: (text: string) => string,
): SecondaryResult {
    const logic = entry.selectiveLogic ?? WORLD_INFO_LOGIC.AND_ANY;
    const keys = entry.keysecondary.map((key) => substitute(key).trim());

    let anyMatch = false;
    let allMatch = keys.length > 0;
    let firstMatch: string | undefined;

    for (const key of keys) {
        const matched = matchesKey(haystack, key, options);

        if (matched) {
            anyMatch = true;
            firstMatch ??= key;
        } else {
            allMatch = false;
        }

        if (logic === WORLD_INFO_LOGIC.AND_ANY && matched) {
            return { ok: true, key };
        }
        if (logic === WORLD_INFO_LOGIC.NOT_ALL && !matched) {
            return { ok: true, key };
        }
    }

    if (logic === WORLD_INFO_LOGIC.NOT_ANY && !anyMatch) {
        return { ok: true };
    }
    if (logic === WORLD_INFO_LOGIC.AND_ALL && allMatch) {
        return { ok: true, key: firstMatch };
    }

    return { ok: false };
}

/**
 * How relevant an entry is, for ranking the members of an inclusion group.
 *
 * The count of matching keys. Keys are matched **raw** — no macro expansion and
 * no trimming — which means an entry can score differently from the way it
 * activated. That is deliberate and worth knowing: scoring ranks candidates
 * against each other, and expanding macros here would make the ranking depend
 * on which pass happened to run.
 */
function scoreEntry(entry: ScanEntry, haystack: string, settings: WorldInfoSettings): number {
    if (entry.key.length === 0) {
        return 0;
    }

    const options: KeyMatchOptions = {
        caseSensitive: entry.caseSensitive ?? settings.caseSensitive,
        matchWholeWords: entry.matchWholeWords ?? settings.matchWholeWords,
    };

    let primary = 0;
    for (const key of entry.key) {
        if (matchesKey(haystack, key, options)) {
            primary += 1;
        }
    }

    let secondary = 0;
    for (const key of entry.keysecondary) {
        if (matchesKey(haystack, key, options)) {
            secondary += 1;
        }
    }

    if (entry.keysecondary.length > 0) {
        if (entry.selectiveLogic === WORLD_INFO_LOGIC.AND_ANY) {
            return primary + secondary;
        }
        if (entry.selectiveLogic === WORLD_INFO_LOGIC.AND_ALL) {
            return secondary === entry.keysecondary.length ? primary + secondary : primary;
        }
    }

    return primary;
}

interface GroupFilterContext {
    candidates: ScanEntry[];
    allActivated: ReadonlyMap<string, ScanEntry>;
    settings: WorldInfoSettings;
    timed: TimedEffects;
    random: () => number;
    scoreFor: (entry: ScanEntry) => number;
    onRemove: (entry: ScanEntry, reason: SkipReason, detail?: string) => void;
}

/**
 * Keep one winner per inclusion group.
 *
 * Two entries in the same group are alternatives — "which of these two ways of
 * describing the tavern" — so at most one may reach the prompt. Three passes,
 * in an order that decides the outcome:
 *
 * 1. **Timed effects.** A sticky member wins the group outright and takes the
 *    other members with it, because a sticky entry is one the story is
 *    currently relying on. Members already cooling down or waiting out a delay
 *    leave, which can empty a group entirely.
 * 2. **Scoring.** Every member's score sets the bar, but only members that opt
 *    in are compared against it. `useGroupScoring: false` is immunity; `null`
 *    follows the global setting. A sticky group skips this pass, having already
 *    decided.
 * 3. **The decision**, for groups that still hold more than one member:
 *    - an entry already activated whose `group` string equals this group's name
 *      locks the group, and nobody else gets in;
 *    - otherwise the highest-`order` `groupOverride` member wins;
 *    - otherwise a weighted roll picks one.
 *
 * The group map is a plain object rather than a `Map`, and that matters: object
 * keys that look like integers are enumerated first, so a group named `"5"` is
 * decided before one named `"alpha"`. That order is what a book written
 * elsewhere expects, and a `Map` would silently change it.
 */
function filterByInclusionGroups(context: GroupFilterContext): void {
    const { candidates, allActivated, settings, timed, random, scoreFor, onRemove } = context;

    const grouped: Record<string, ScanEntry[]> = {};
    let groupCount = 0;

    for (const entry of candidates) {
        if (!entry.group) {
            continue;
        }
        for (const name of entry.group.split(/,\s*/)) {
            if (!name) {
                continue;
            }
            if (!grouped[name]) {
                grouped[name] = [];
                groupCount += 1;
            }
            grouped[name].push(entry);
        }
    }

    if (groupCount === 0) {
        return;
    }

    const removeEntry = (entry: ScanEntry): void => {
        const index = candidates.indexOf(entry);
        if (index >= 0) {
            candidates.splice(index, 1);
        }
    };

    const removeAllBut = (group: ScanEntry[], winner: ScanEntry | null, name: string): void => {
        for (const entry of group) {
            if (entry === winner) {
                continue;
            }
            removeEntry(entry);
            onRemove(entry, 'group-loser', name);
        }
    };

    // Pass 1: timed effects decide first, and a sticky winner settles the group
    // before anything else is consulted.
    const hasSticky = new Map<string, boolean>();
    for (const [name, group] of Object.entries(grouped)) {
        hasSticky.set(name, false);

        const stickyEntries = group.filter((entry) => timed.isActive('sticky', entry));
        if (stickyEntries.length > 0) {
            for (const entry of group) {
                if (stickyEntries.includes(entry)) {
                    continue;
                }
                removeEntry(entry);
                onRemove(entry, 'group-loser', name);
            }
            hasSticky.set(name, true);
        }

        // A sticky member that is also cooling down is removed right here, even
        // though it just won: the sticky window closing is what put it on
        // cooldown, and an entry that is cooling down cannot speak.
        for (const entry of group.filter((candidate) => timed.isActive('cooldown', candidate))) {
            removeEntry(entry);
            onRemove(entry, 'group-loser', name);
        }

        for (const entry of group.filter((candidate) => timed.isActive('delay', candidate))) {
            removeEntry(entry);
            onRemove(entry, 'group-loser', name);
        }
    }

    // Pass 2: scoring, from whichever members opted in.
    for (const [name, group] of Object.entries(grouped)) {
        if (!settings.useGroupScoring && !group.some((entry) => entry.useGroupScoring)) {
            continue;
        }
        if (hasSticky.get(name)) {
            continue;
        }

        const scores = group.map((entry) => scoreFor(entry));
        const maxScore = Math.max(...scores);

        for (let index = 0; index < group.length; index += 1) {
            const entry = group[index];
            if (!entry) {
                continue;
            }

            const scored = entry.useGroupScoring ?? settings.useGroupScoring;
            if (!scored) {
                continue;
            }

            if ((scores[index] ?? 0) < maxScore) {
                removeEntry(entry);
                onRemove(entry, 'group-loser', name);
                group.splice(index, 1);
                scores.splice(index, 1);
                index -= 1;
            }
        }
    }

    // Pass 3: one winner, or none.
    for (const [name, group] of Object.entries(grouped)) {
        if (hasSticky.get(name)) {
            continue;
        }

        // An entry already activated whose `group` is exactly this name locks
        // the group. A member of several groups carries the whole CSV in its
        // `group` field, so it never equals one name and never locks anything —
        // multi-group membership vetoes itself, which is what lets another
        // group remove it without freezing this one.
        if ([...allActivated.values()].some((entry) => entry.group === name)) {
            removeAllBut(group, null, name);
            continue;
        }

        if (group.length <= 1) {
            continue;
        }

        const overrides = group.filter((entry) => entry.groupOverride).sort((a, b) => b.order - a.order);
        const override = overrides[0];
        if (override) {
            removeAllBut(group, override, name);
            continue;
        }

        // The roll. `roll <= cumulative` picks the first member when the total
        // weight is zero, so degenerate weights do not fail open — they pick a
        // winner that had no weight. Recorded because the intuitive reading
        // ("zero weight means no preference") is not what happens.
        const totalWeight = group.reduce((sum, entry) => sum + (entry.groupWeight ?? DEFAULT_WEIGHT), 0);
        const roll = random() * totalWeight;
        let cumulative = 0;
        let winner: ScanEntry | null = null;

        for (const entry of group) {
            cumulative += entry.groupWeight ?? DEFAULT_WEIGHT;
            if (roll <= cumulative) {
                winner = entry;
                break;
            }
        }

        if (!winner) {
            continue;
        }

        removeAllBut(group, winner, name);
    }
}

interface TraceWriter {
    activate: (entry: ScanEntry, reason: ActivationReason, detail?: string) => void;
    skip: (entry: ScanEntry, reason: SkipReason, detail?: string, force?: boolean) => void;
}

interface TraceStore extends TraceWriter {
    /** Set the 1-based pass number subsequent records belong to. */
    setLoop: (loop: number) => void;
    entries: () => ScanTrace[];
}

/**
 * What the context inspector shows: one line per entry, naming the reason it
 * activated or did not.
 *
 * One record per entry, not one per decision. A later pass would re-skip an
 * entry an earlier pass explained, and a later skip would overwrite a real
 * activation — so the first activation is final, and a plain skip cannot
 * replace one unless it asks to (`force`), which is how a group decision
 * overrules an ordinary match.
 */
function createTraceStore(): TraceStore {
    const map = new Map<ScanEntry, ScanTrace>();
    let loop = 1;

    const make = (
        entry: ScanEntry,
        activated: boolean,
        reason: ActivationReason | SkipReason,
        detail?: string,
    ): ScanTrace => ({
        loop,
        world: entry.world,
        uid: entry.uid,
        comment: entry.comment,
        activated,
        reason,
        detail,
    });

    return {
        setLoop(next) {
            loop = next;
        },
        activate(entry, reason, detail) {
            if (map.get(entry)?.activated) {
                return;
            }
            map.set(entry, make(entry, true, reason, detail));
        },
        skip(entry, reason, detail, force = false) {
            if (map.get(entry)?.activated && !force) {
                return;
            }
            map.set(entry, make(entry, false, reason, detail));
        },
        entries: () => [...map.values()],
    };
}

/**
 * Run a world info scan.
 *
 * Pure with respect to its inputs apart from `input.timed.state`, which it
 * writes when the caller supplies a live state — that is how a sticky window
 * carries between turns. Everything else returns rather than mutates, so the
 * context inspector can run the same scan as a dry run and see what a
 * generation would have done.
 */
export function scanWorldInfo(input: ScanInput): ScanResult {
    const settings: WorldInfoSettings = { ...DEFAULT_WORLD_INFO_SETTINGS, ...input.settings };
    const countTokens = input.countTokens ?? estimateTokens;
    const random = input.random ?? Math.random;
    const substitute = input.substitute ?? ((text: string) => text);
    const transformContent = input.transformContent ?? ((_entry: ScanEntry, content: string) => content);
    const globalScanData = input.globalScanData ?? {};
    const trigger = globalScanData.trigger ?? 'normal';

    // `order` descending decides who consumes the budget first, so this sort is
    // not cosmetic: a lower-order entry can be dropped for budget while a
    // higher-order one that arrived later in the file gets in.
    const sorted = [...input.entries].sort((a, b) => b.order - a.order);
    const sourceIndex = new Map<ScanEntry, number>();
    for (let index = 0; index < sorted.length; index += 1) {
        const entry = sorted[index];
        if (entry) {
            sourceIndex.set(entry, index);
        }
    }

    const budgetLimit = computeBudget(input.maxContext, settings);
    const buffer = createScanBuffer(input.chat, globalScanData, settings.depth, input.injections);

    const timed = createTimedEffects({
        chatLength: input.chat.length,
        entries: sorted,
        state: input.timed?.state ?? ensureTimedWorldInfo({}),
        // Without an injected state there is nothing to persist, so behave like
        // a dry run. A supplied state is live unless the caller says otherwise.
        dryRun: input.timed ? (input.timed.dryRun ?? false) : true,
    });
    timed.check();

    if (sorted.length === 0) {
        return {
            positions: emptyPositions(),
            activated: [],
            trace: [],
            budget: { limit: budgetLimit, used: 0, overflowed: false },
            loops: 0,
            timedEffects: timed.active,
            lexicalAdded: 0,
        };
    }

    // `delayUntilRecursion` levels are visited in ascending order, one per
    // recursion pass. An entry asking for level 2 waits until the pass that
    // follows level 1, not until any recursion at all.
    const delayLevels = [
        ...new Set(
            sorted
                .filter((entry) => entry.delayUntilRecursion)
                .map((entry) => (entry.delayUntilRecursion === true ? 1 : Number(entry.delayUntilRecursion))),
        ),
    ].sort((a, b) => a - b);
    let currentDelayLevel = delayLevels.shift() ?? 0;

    const allActivated = new Map<string, ScanEntry>();
    const failedProbability = new Set<string>();
    const resolvedContent = new Map<string, string>();
    const trace = createTraceStore();

    let scanState: ScanState = SCAN_STATE.INITIAL;
    let overflowed = false;
    let loops = 0;
    let allActivatedText = '';
    let budgetUsed = 0;
    let lexicalAdded = 0;

    while (scanState) {
        if (settings.maxRecursionSteps && settings.maxRecursionSteps <= loops) {
            break;
        }
        loops += 1;
        trace.setLoop(loops);

        const activatedNow: ScanEntry[] = [];

        for (const entry of sorted) {
            // Already decided this scan, one way or the other.
            if (failedProbability.has(entry.id) || allActivated.has(entry.id)) {
                continue;
            }

            if (entry.disable) {
                trace.skip(entry, 'disabled');
                continue;
            }

            if (entry.triggers.length > 0 && !entry.triggers.includes(trigger)) {
                trace.skip(entry, 'trigger-filter', trigger);
                continue;
            }

            const filter = entry.characterFilter;
            if (filter && filter.names.length > 0) {
                const included = input.activeCharacter !== undefined && filter.names.includes(input.activeCharacter.id);
                if (filter.isExclude ? included : !included) {
                    trace.skip(entry, 'character-filter-name', input.activeCharacter?.id);
                    continue;
                }
            }
            // The tag check is skipped entirely with no active character, since
            // there are no tags to compare against — not "no tags means match".
            if (filter && filter.tags.length > 0 && input.activeCharacter !== undefined) {
                const assigned = input.activeCharacter.tagIds ?? [];
                const intersects = assigned.some((tag) => filter.tags.includes(tag));
                if (filter.isExclude ? intersects : !intersects) {
                    trace.skip(entry, 'character-filter-tag', assigned.join(','));
                    continue;
                }
            }

            const isSticky = timed.isActive('sticky', entry);
            const isCooldown = timed.isActive('cooldown', entry);
            const isDelay = timed.isActive('delay', entry);

            if (isDelay) {
                trace.skip(entry, 'timed-delay', `${entry.delay}`);
                continue;
            }
            // Sticky beats cooldown: an entry can be on both buffers at once
            // when its cooldown outlives its sticky window, and while the
            // sticky is still open the entry speaks.
            if (isCooldown && !isSticky) {
                trace.skip(entry, 'timed-cooldown');
                continue;
            }

            // `delayUntilRecursion` means "only during a recurrence pass at or
            // past this level" — never during the first pass, and never during
            // a minimum-activations pass.
            if (scanState !== SCAN_STATE.RECURSION && entry.delayUntilRecursion && !isSticky) {
                trace.skip(entry, 'delay-until-recursion');
                continue;
            }
            if (
                scanState === SCAN_STATE.RECURSION &&
                entry.delayUntilRecursion &&
                Number(entry.delayUntilRecursion) > currentDelayLevel &&
                !isSticky
            ) {
                trace.skip(entry, 'delay-until-recursion', `${currentDelayLevel}`);
                continue;
            }
            if (scanState === SCAN_STATE.RECURSION && settings.recursive && entry.excludeRecursion && !isSticky) {
                trace.skip(entry, 'exclude-recursion');
                continue;
            }

            // The activation decorator is checked before the suppression one,
            // so an entry carrying both activates. Written down because the
            // ordering is invisible and the opposite choice would look equally
            // reasonable.
            if (entry.decorators.includes('@@activate')) {
                trace.activate(entry, 'decorator-activate');
                activatedNow.push(entry);
                continue;
            }

            if (entry.decorators.includes('@@dont_activate')) {
                trace.skip(entry, 'decorator-dont-activate');
                continue;
            }

            if (entry.constant) {
                trace.activate(entry, 'constant');
                activatedNow.push(entry);
                continue;
            }

            // A sticky entry activates without any key match: the window is
            // still open from the turn that opened it.
            if (isSticky) {
                trace.activate(entry, 'sticky');
                activatedNow.push(entry);
                continue;
            }

            if (entry.key.length === 0 && entry.autoKeys.length === 0) {
                trace.skip(entry, 'no-keys');
                continue;
            }

            const haystack = buffer.text(entry, scanState);
            const matchOptions: KeyMatchOptions = {
                caseSensitive: entry.caseSensitive ?? settings.caseSensitive,
                matchWholeWords: entry.matchWholeWords ?? settings.matchWholeWords,
            };

            // An alias is an additional primary key, not a second mechanism: it
            // uses the same matcher, the same per-entry options and feeds the
            // same gates below. Only the trace detail distinguishes it, so a hit
            // that came from an alias is visible in the inspector.
            const authored = entry.key
                .map((key) => substitute(key))
                .find((key) => Boolean(key) && matchesKey(haystack, key.trim(), matchOptions));
            const aliased = authored
                ? undefined
                : entry.autoKeys
                      .map((alias) => substitute(alias))
                      .find((alias) => Boolean(alias) && matchesKey(haystack, alias.trim(), matchOptions));
            const primaryKey = authored ?? aliased;
            const fromAlias = Boolean(aliased);

            if (!primaryKey) {
                trace.skip(entry, 'primary-key-miss');
                continue;
            }

            const hasSecondary = entry.selective && entry.keysecondary.length > 0;
            if (!hasSecondary) {
                trace.activate(entry, 'primary-key', fromAlias ? `alias: ${primaryKey.trim()}` : primaryKey.trim());
                activatedNow.push(entry);
                continue;
            }

            const secondary = matchSecondaryKeys(entry, haystack, matchOptions, substitute);
            if (!secondary.ok) {
                trace.skip(entry, 'secondary-key-miss', primaryKey.trim());
                continue;
            }

            trace.activate(
                entry,
                'secondary-key',
                secondary.key ? `${primaryKey.trim()} / ${secondary.key}` : primaryKey.trim(),
            );
            activatedNow.push(entry);
        }

        // Lexical matching, when enabled, may add entries whose keys missed but
        // whose text is about the same thing.
        //
        // It runs after the keyword loop and before groups, so a lexical
        // candidate faces exactly the same downstream gates as a keyword one.
        // It only ever adds: a similarity score is a suggestion, and an authored
        // key is an instruction.
        if (settings.lexicalMatch && scanState === SCAN_STATE.INITIAL) {
            const query = buffer.window(scanState);

            const carried = activatedNow;
            // The index builder is the caller's: it caches per book and depends
            // on the app's own retrieval module, and a package that imported its
            // own consumer would not be a boundary. Absent means no lexical pass
            // was configured, which is why this breaks rather than throws.
            if (!input.lexicalIndex) {
                break;
            }
            const { index } = input.lexicalIndex(sorted);
            const byId = new Map<string, ScanEntry>();
            for (const candidate of sorted) {
                byId.set(candidate.id, candidate);
            }

            // The threshold is relative to this scan's best hit. A relevance
            // score has no absolute meaning — it moves with corpus size, term
            // rarity and document length — so a fixed cutoff would behave
            // differently on every book. A fraction of the best hit means "good
            // for this book, for this query", which is comparable.
            const hits = index.query(query, settings.lexicalLimit);
            const best = hits[0]?.score ?? 0;
            const floor = best * settings.lexicalThreshold;

            for (const hit of hits) {
                if (hit.score < floor) {
                    break;
                }

                const entry = byId.get(hit.id);
                if (!entry) {
                    continue;
                }
                if (allActivated.has(entry.id) || failedProbability.has(entry.id)) {
                    continue;
                }
                if (carried.includes(entry)) {
                    continue;
                }
                if (entry.disable || entry.constant || entry.decorators.includes('@@dont_activate')) {
                    continue;
                }

                // Every gate the keyword path honours is honoured here too: an
                // entry the author excluded stays excluded no matter which pass
                // noticed it.
                if (entry.triggers.length > 0 && !entry.triggers.includes(trigger)) {
                    continue;
                }

                const filter = entry.characterFilter;
                if (filter && filter.names.length > 0) {
                    const included =
                        input.activeCharacter !== undefined && filter.names.includes(input.activeCharacter.id);
                    if (filter.isExclude ? included : !included) {
                        continue;
                    }
                }
                if (filter && filter.tags.length > 0 && input.activeCharacter !== undefined) {
                    const assigned = input.activeCharacter.tagIds ?? [];
                    const intersects = assigned.some((tag) => filter.tags.includes(tag));
                    if (filter.isExclude ? intersects : !intersects) {
                        continue;
                    }
                }

                if (timed.isActive('delay', entry)) {
                    continue;
                }
                if (timed.isActive('cooldown', entry) && !timed.isActive('sticky', entry)) {
                    continue;
                }

                trace.activate(entry, 'lexical', `${hit.score.toFixed(2)}`);
                carried.push(entry);
                lexicalAdded += 1;
            }
        }

        // Sticky entries float to the front; everything else keeps the
        // `order`-descending source order. This drives both budget consumption
        // and the order of contents inside one recursion-buffer element.
        const newEntries = [...activatedNow].sort((a, b) => {
            const stickyA = timed.isActive('sticky', a) ? 1 : 0;
            const stickyB = timed.isActive('sticky', b) ? 1 : 0;
            return stickyB - stickyA || (sourceIndex.get(a) ?? -1) - (sourceIndex.get(b) ?? -1);
        });

        const scoreCache = new Map<ScanEntry, number>();
        const scoreFor = (entry: ScanEntry): number => {
            const cached = scoreCache.get(entry);
            if (cached !== undefined) {
                return cached;
            }
            const score = scoreEntry(entry, buffer.text(entry, scanState), settings);
            scoreCache.set(entry, score);
            return score;
        };

        filterByInclusionGroups({
            candidates: newEntries,
            allActivated,
            settings,
            timed,
            random,
            scoreFor,
            onRemove: (entry, reason, detail) => trace.skip(entry, reason, detail, true),
        });

        // Budget. Counted in order, and an entry that does not fit stops the
        // pass — a lower-priority entry may not jump a higher-priority one just
        // because it happens to be shorter.
        let remainingIgnoreBudget = newEntries.filter((entry) => entry.ignoreBudget).length;
        let newContent = '';
        const passBaseline = countTokens(allActivatedText);

        for (const entry of newEntries) {
            if (entry.ignoreBudget) {
                remainingIgnoreBudget -= 1;
            }

            // Once the budget is exhausted only `ignoreBudget` entries may still
            // activate, and the loop stops after the last of them.
            if (overflowed && !entry.ignoreBudget) {
                if (remainingIgnoreBudget > 0) {
                    trace.skip(entry, 'budget-exceeded', `${budgetUsed}/${budgetLimit}`, true);
                    continue;
                }
                break;
            }

            const isSticky = timed.isActive('sticky', entry);
            if (!isSticky && !passesProbability(entry, random)) {
                failedProbability.add(entry.id);
                trace.skip(entry, 'probability-failed', `${entry.probability}%`, true);
                continue;
            }

            const content = resolvedContent.get(entry.id) ?? substitute(entry.content);
            resolvedContent.set(entry.id, content);
            newContent += `${content}\n`;

            if (!entry.ignoreBudget && passBaseline + countTokens(newContent) >= budgetLimit) {
                overflowed = true;
                trace.skip(entry, 'budget-exceeded', `${budgetLimit}`, true);
                continue;
            }

            allActivated.set(entry.id, entry);
        }

        budgetUsed = passBaseline + countTokens(newContent);

        // A probability failure is permanent for the scan: re-rolling it on the
        // next pass would turn "10%" into "at least 10%" across passes.
        const successful = newEntries.filter((entry) => !failedProbability.has(entry.id));
        const successfulForRecursion = successful.filter((entry) => !entry.preventRecursion);

        let nextState: ScanState = SCAN_STATE.NONE;

        if (settings.recursive && !overflowed && successfulForRecursion.length > 0) {
            nextState = SCAN_STATE.RECURSION;
        }

        // Depth seeking. A `minActivations` pass is always followed by a
        // recursion pass once a recursion buffer exists, so the two states
        // alternate rather than one replacing the other.
        if (settings.recursive && !overflowed && scanState === SCAN_STATE.MIN_ACTIVATIONS && buffer.hasRecurse()) {
            nextState = SCAN_STATE.RECURSION;
        }

        const minNotSatisfied = settings.minActivations > 0 && allActivated.size < settings.minActivations;
        if (nextState === SCAN_STATE.NONE && !overflowed && minNotSatisfied) {
            const overMax =
                (settings.minActivationsDepthMax > 0 && buffer.depth() > settings.minActivationsDepthMax) ||
                buffer.depth() > input.chat.length;

            if (!overMax) {
                nextState = SCAN_STATE.MIN_ACTIVATIONS;
                buffer.advanceScan();
            }
        }

        // A deeper delay level is the one transition that survives a budget
        // overflow: an entry that asked to wait for a later level still gets
        // its chance, even if the budget is already spent.
        if (nextState === SCAN_STATE.NONE && delayLevels.length > 0) {
            nextState = SCAN_STATE.RECURSION;
            currentDelayLevel = delayLevels.shift() ?? currentDelayLevel;
        }

        scanState = nextState;
        if (scanState) {
            const text = successfulForRecursion
                .map((entry) => resolvedContent.get(entry.id) ?? entry.content)
                .join('\n');
            if (text) {
                buffer.addRecurse(text);
                allActivatedText = `${text}\n${allActivatedText}`;
            }
        }
    }

    // Persist the timed records for what activated. Done once, after the loop,
    // so an entry that only activated on the last pass still records its
    // window — and so a dry run writes nothing.
    timed.set([...allActivated.values()]);

    const positions = emptyPositions();

    // Highest `order` first, unshifted per bucket, so each bucket ends up
    // ascending — the order the prompt reads top to bottom.
    for (const entry of [...allActivated.values()].sort((a, b) => b.order - a.order)) {
        const depth = entry.position === WORLD_INFO_POSITION.AT_DEPTH ? (entry.depth ?? DEFAULT_DEPTH) : null;
        const raw = resolvedContent.get(entry.id) ?? entry.content;
        const content = transformContent(entry, raw, depth);

        // Only an exactly empty string is skipped. Whitespace is content: a
        // script that reduced an entry to a newline still meant to insert it.
        if (!content) {
            continue;
        }

        switch (entry.position) {
            case WORLD_INFO_POSITION.BEFORE_CHAR:
                positions.before.unshift(content);
                break;
            case WORLD_INFO_POSITION.AFTER_CHAR:
                positions.after.unshift(content);
                break;
            case WORLD_INFO_POSITION.EM_TOP:
                positions.examples.unshift({ position: WI_ANCHOR_POSITION.BEFORE, content });
                break;
            case WORLD_INFO_POSITION.EM_BOTTOM:
                positions.examples.unshift({ position: WI_ANCHOR_POSITION.AFTER, content });
                break;
            case WORLD_INFO_POSITION.AN_TOP:
                positions.authorNoteTop.unshift(content);
                break;
            case WORLD_INFO_POSITION.AN_BOTTOM:
                positions.authorNoteBottom.unshift(content);
                break;
            case WORLD_INFO_POSITION.AT_DEPTH: {
                // Entries sharing a depth and a role share one bucket, so the
                // prompt gets one injection there rather than several.
                const bucketDepth = entry.depth ?? DEFAULT_DEPTH;
                const role = entry.role ?? PROMPT_ROLE.SYSTEM;
                const bucket = positions.atDepth.find(
                    (candidate) => candidate.depth === bucketDepth && candidate.role === role,
                );
                if (bucket) {
                    bucket.entries.unshift(content);
                } else {
                    positions.atDepth.push({ depth: bucketDepth, role, entries: [content] });
                }
                break;
            }
            case WORLD_INFO_POSITION.OUTLET: {
                // An outlet entry with no name goes nowhere: the position only
                // means something if a prompt slot claims it.
                if (!entry.outletName) {
                    break;
                }
                const existing = positions.outlets[entry.outletName];
                if (existing) {
                    existing.push(content);
                } else {
                    positions.outlets[entry.outletName] = [content];
                }
                break;
            }
            default:
                break;
        }
    }

    return {
        positions,
        activated: [...allActivated.values()],
        trace: trace.entries(),
        budget: { limit: budgetLimit, used: budgetUsed, overflowed },
        loops,
        timedEffects: timed.active,
        lexicalAdded,
    };
}

function emptyPositions(): ScanPositions {
    return {
        before: [],
        after: [],
        authorNoteTop: [],
        authorNoteBottom: [],
        atDepth: [],
        examples: [],
        outlets: {},
    };
}
