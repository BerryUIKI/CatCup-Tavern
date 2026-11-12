// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/world-info.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.
//
// Deliberate divergence: SillyTavern's `removeEntry` is
// `newEntries.splice(newEntries.indexOf(entry), 1)`. When the entry is already
// absent (multi-group membership, or a second group pass), `indexOf` returns
// -1 and the last unrelated candidate is silently dropped. This port guards
// the index instead of reproducing that data loss.

import { PROMPT_ROLE, WI_ANCHOR_POSITION, WORLD_INFO_LOGIC, WORLD_INFO_POSITION } from '@catcup/shared';

import { estimateTokens } from '../prompt/tokenizer.js';
import { type KeyMatchOptions, matchesKey } from './matching.js';
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
} from './types.js';

/** SillyTavern's defaults, used when a caller does not override them. */
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
};

/** Upper bound SillyTavern applies to `scanDepth` and the chat buffer. */
export const MAX_SCAN_DEPTH = 1000;

/** Depth used by an `atDepth` entry that does not set one. */
export const DEFAULT_DEPTH = 4;

/** Default weight for an inclusion-group entry. */
export const DEFAULT_WEIGHT = 100;

/**
 * Separator injected between scanned messages. It is a control character so a
 * key can never match across a message boundary.
 */
const MATCHER = '\u0001';
const JOINER = `\n${MATCHER}`;

function computeBudget(maxContext: number, settings: WorldInfoSettings): number {
    const raw = Math.round((settings.budgetPercent * maxContext) / 100) || 1;
    return settings.budgetCap > 0 && raw > settings.budgetCap ? settings.budgetCap : raw;
}

function optIn(enabled: boolean, value: string | undefined): string {
    return enabled && value ? JOINER + value : '';
}

interface ScanBuffer {
    /** Current default scan depth: the configured depth plus the skew. */
    depth(): number;
    /** Advance the minimum-activations depth window by one message. */
    advanceScan(): void;
    /** Add one pass worth of activated text to the recursion buffer. */
    addRecurse(text: string): void;
    hasRecurse(): boolean;
    /** Text an entry is matched against for the given pass kind. */
    text(entry: ScanEntry, state: ScanState): string;
}

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

            // Extra scanned text does not shift the chat depth clock.
            if (injections.length > 0) {
                result += JOINER + injections.join(JOINER);
            }

            // Minimum-activation passes deliberately exclude the recursion
            // buffer so that depth seeking cannot be satisfied by recursion.
            if (recurseBuffer.length > 0 && state !== SCAN_STATE.MIN_ACTIVATIONS) {
                result += JOINER + recurseBuffer.join(JOINER);
            }

            return result;
        },
    };
}

function passesProbability(entry: ScanEntry, random: () => number): boolean {
    if (!entry.useProbability || entry.probability >= 100) {
        return true;
    }
    return random() * 100 <= entry.probability;
}

interface SecondaryResult {
    ok: boolean;
    /** Key that satisfied the logic, when there is one to report. */
    key?: string;
}

/**
 * Apply `selectiveLogic` to the secondary keys.
 *
 * The four modes map to SillyTavern's `AND_ANY`, `NOT_ALL`, `NOT_ANY` and
 * `AND_ALL`, including their short-circuit order.
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
 * SillyTavern's `getScore`: the number of matching keys, used to rank entries
 * inside an inclusion group. Keys are matched raw - no macro expansion and no
 * trimming - which is why an entry can score differently from how it activated.
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
 * Inclusion groups: keep one winner per group, with sticky entries winning
 * unconditionally and `groupOverride` beating the weighted roll.
 */
function filterByInclusionGroups(context: GroupFilterContext): void {
    const { candidates, allActivated, settings, timed, random, scoreFor, onRemove } = context;

    // A plain object, not a Map: SillyTavern's key order puts integer-like
    // group names first, and that order decides which group vetoes first.
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

    // Pass 1: timed effects. Sticky winners survive together and skip the
    // group decision entirely; a sticky entry that also has an active cooldown
    // is removed right after, which can empty the group.
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

        for (const entry of group.filter((candidate) => timed.isActive('cooldown', candidate))) {
            removeEntry(entry);
            onRemove(entry, 'group-loser', name);
        }

        for (const entry of group.filter((candidate) => timed.isActive('delay', candidate))) {
            removeEntry(entry);
            onRemove(entry, 'group-loser', name);
        }
    }

    // Pass 2: scoring. Every member's score sets the bar, but only entries
    // that opt in are compared - `false` is immunity, `null` follows the
    // global setting.
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

    // Pass 3: the decision.
    for (const [name, group] of Object.entries(grouped)) {
        if (hasSticky.get(name)) {
            continue;
        }

        // An entry already activated with the exact same `group` string locks
        // the group for this scan. Multi-group entries never lock any group
        // because the comparison is against the whole CSV string.
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

        // Fail open when weights are degenerate (zero, negative or NaN):
        // nobody is removed and every member proceeds.
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
            // The first successful activation is authoritative: a later pass
            // would only re-skip it through the already-activated gate.
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
 * Implements SillyTavern's full pipeline: timed effects, the recursion /
 * minimum-activation scan-state machine, inclusion groups, probability, the
 * token budget, and the position buckets consumed by the prompt builder.
 */
export function scanWorldInfo(input: ScanInput): ScanResult {
    const settings: WorldInfoSettings = { ...DEFAULT_WORLD_INFO_SETTINGS, ...input.settings };
    const countTokens = input.countTokens ?? estimateTokens;
    const random = input.random ?? Math.random;
    const substitute = input.substitute ?? ((text: string) => text);
    const transformContent = input.transformContent ?? ((_entry: ScanEntry, content: string) => content);
    const globalScanData = input.globalScanData ?? {};
    const trigger = globalScanData.trigger ?? 'normal';

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
        // Without an injected state there is nothing to persist, so behave
        // like a dry run. A supplied state is live unless the caller says
        // otherwise.
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
        };
    }

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

    while (scanState) {
        if (settings.maxRecursionSteps && settings.maxRecursionSteps <= loops) {
            break;
        }
        loops += 1;
        trace.setLoop(loops);

        const activatedNow: ScanEntry[] = [];

        for (const entry of sorted) {
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
            // ST skips the tag check entirely when it has no tag map, which
            // here means "no active character".
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
            if (isCooldown && !isSticky) {
                trace.skip(entry, 'timed-cooldown');
                continue;
            }

            // `delayUntilRecursion` is not "delay until later": it means only
            // during a RECURSION pass, and never during MIN_ACTIVATIONS.
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

            // SillyTavern checks the activation decorator before the
            // suppression one, so an entry carrying both is activated.
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

            // A sticky entry activates without any key match.
            if (isSticky) {
                trace.activate(entry, 'sticky');
                activatedNow.push(entry);
                continue;
            }

            if (entry.key.length === 0) {
                trace.skip(entry, 'no-keys');
                continue;
            }

            const haystack = buffer.text(entry, scanState);
            const matchOptions: KeyMatchOptions = {
                caseSensitive: entry.caseSensitive ?? settings.caseSensitive,
                matchWholeWords: entry.matchWholeWords ?? settings.matchWholeWords,
            };

            const primaryKey = entry.key
                .map((key) => substitute(key))
                .find((key) => Boolean(key) && matchesKey(haystack, key.trim(), matchOptions));

            if (!primaryKey) {
                trace.skip(entry, 'primary-key-miss');
                continue;
            }

            const hasSecondary = entry.selective && entry.keysecondary.length > 0;
            if (!hasSecondary) {
                trace.activate(entry, 'primary-key', primaryKey.trim());
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

        // Sticky entries float to the front; everything else keeps the
        // `order`-descending source order, which drives budget consumption and
        // the order of contents inside one recursion-buffer element.
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

        let remainingIgnoreBudget = newEntries.filter((entry) => entry.ignoreBudget).length;
        let newContent = '';
        const passBaseline = countTokens(allActivatedText);

        for (const entry of newEntries) {
            if (entry.ignoreBudget) {
                remainingIgnoreBudget -= 1;
            }

            // Once the budget is exhausted only `ignoreBudget` entries may
            // still activate. SillyTavern breaks out after the last of them.
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

        const successful = newEntries.filter((entry) => !failedProbability.has(entry.id));
        const successfulForRecursion = successful.filter((entry) => !entry.preventRecursion);

        let nextState: ScanState = SCAN_STATE.NONE;

        if (settings.recursive && !overflowed && successfulForRecursion.length > 0) {
            nextState = SCAN_STATE.RECURSION;
        }

        // A minimum-activations pass is always followed by a recursion pass
        // once a recursion buffer exists, so the two states alternate.
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

        // Delay-level advancement is the only transition that survives a
        // budget overflow.
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

    timed.set([...allActivated.values()]);

    const positions = emptyPositions();

    // Highest `order` first, unshifted, so each bucket ends up ascending.
    for (const entry of [...allActivated.values()].sort((a, b) => b.order - a.order)) {
        const depth = entry.position === WORLD_INFO_POSITION.AT_DEPTH ? (entry.depth ?? DEFAULT_DEPTH) : null;
        const raw = resolvedContent.get(entry.id) ?? entry.content;
        const content = transformContent(entry, raw, depth);

        // Only an exactly empty string is skipped; whitespace is content.
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
