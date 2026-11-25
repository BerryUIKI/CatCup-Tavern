// Written for CatCup. Timed world info effects: `sticky` holds an entry active
// for N messages after it fires, `cooldown` blocks it for N messages, and
// `delay` blocks it until the chat reaches N messages.
//
// Only sticky and cooldown are stored, in `chat_metadata.timedWorldInfo`, keyed
// by entry id and matched by entry hash — that record shape is part of the chat
// file format (docs/DATA-FORMATS.md, "Timed effects") and other clients read it.
// Delay is stateless: it is recomputed from the entry on every scan.

import type {
    ScanEntry,
    TimedEffectRecord,
    TimedEffectsView,
    TimedEffectType,
    TimedWorldInfo,
} from './worldinfo-types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored record is usable when every field has the type the format says. */
function isValidRecord(value: unknown): value is TimedEffectRecord {
    if (!isRecord(value)) {
        return false;
    }
    return (
        typeof value.hash === 'number' &&
        typeof value.start === 'number' &&
        typeof value.end === 'number' &&
        typeof value.protected === 'boolean'
    );
}

/** The two effect kinds that are stored. `delay` never is. */
const STORED_TYPES = ['sticky', 'cooldown'] as const;
type StoredType = (typeof STORED_TYPES)[number];

/**
 * Make sure `container.timedWorldInfo` has the shape the scanner expects, in
 * place.
 *
 * Three properties matter to callers and each is easy to lose:
 *
 * - **Identity is preserved.** A valid nested container is mutated, never
 *   replaced, because the caller keeps its own reference to it. Only a
 *   missing or wrong-typed one is replaced.
 * - **Unknown keys survive.** Anything else on `timedWorldInfo`, or on the
 *   sticky/cooldown maps, is left where it is. A newer client may have written
 *   something this one does not know about, and dropping it would silently
 *   edit the chat file.
 * - **Unusable records are deleted, not repaired.** A record with a string
 *   hash or a missing `protected` is treated as absent. Guessing a default
 *   would invent an effect the user never set.
 */
export function ensureTimedWorldInfo(container: Record<string, unknown>): TimedWorldInfo {
    let timed = container.timedWorldInfo;
    if (!isRecord(timed)) {
        timed = {};
        container.timedWorldInfo = timed;
    }

    const state = timed as Record<string, unknown>;
    for (const type of STORED_TYPES) {
        let records = state[type];
        if (!isRecord(records)) {
            records = {};
            state[type] = records;
        }

        const recordMap = records as Record<string, unknown>;
        // A snapshot of the key/value pairs, so deleting from the live map
        // during the loop is safe.
        for (const [key, record] of Object.entries(recordMap)) {
            if (!isValidRecord(record)) {
                delete recordMap[key];
            }
        }
    }

    return timed as TimedWorldInfo;
}

export interface TimedEffectsContext {
    /** The timed-effect clock: non-system messages only. */
    chatLength: number;
    /** Every candidate entry, not only the activated ones. */
    entries: readonly ScanEntry[];
    state: TimedWorldInfo;
    /** Sticky and cooldown are neither read nor written; delay still applies. */
    dryRun: boolean;
}

export interface TimedEffects {
    /** Populate the per-scan active buffers. Call once, before scanning. */
    check(): void;
    /** Persist sticky and cooldown records for the entries that activated. */
    set(activated: readonly ScanEntry[]): void;
    isActive(type: TimedEffectType, entry: ScanEntry): boolean;
    /** Remaining messages before the effect expires, or `undefined` when inactive. */
    remaining(type: TimedEffectType, entry: ScanEntry): number | undefined;
    /** Manual override, equivalent to the `set timed effect` slash command. */
    setOne(type: TimedEffectType, entry: ScanEntry, active: boolean): void;
    /** Clear the in-memory buffers; persisted records are untouched. */
    cleanup(): void;
    readonly active: TimedEffectsView;
}

/**
 * Build the timed-effect state machine for one scan.
 *
 * The context is read once, at construction. Buffers belong to the instance,
 * so a second instance starts empty — which is what makes the context
 * inspector's dry run independent of a live generation.
 *
 * `check()` runs sticky before cooldown, and that order is load-bearing: an
 * expiring sticky spawns a protected cooldown record *and* pushes the entry
 * onto the cooldown buffer immediately, so the cooldown pass that follows
 * already sees it and the entry cannot re-fire in the same scan.
 */
export function createTimedEffects(context: TimedEffectsContext): TimedEffects {
    const { chatLength, entries, state, dryRun } = context;
    const buffers: Record<TimedEffectType, ScanEntry[]> = {
        sticky: [],
        cooldown: [],
        delay: [],
    };
    const expiredSticky: ScanEntry[] = [];

    /**
     * Find the entry a record belongs to, by hash.
     *
     * Hash rather than id: the record has to survive the entry being renamed or
     * moved in the book, and the hash is the entry's content identity. Both
     * sides are stringified, so a record whose hash was written as a string
     * still matches.
     */
    function findEntry(record: TimedEffectRecord): ScanEntry | undefined {
        return entries.find((entry) => String(entry.hash) === String(record.hash));
    }

    /**
     * Report an expiring sticky, and start the cooldown that follows it.
     *
     * The entry is reported as expired unconditionally — a caller wants to know
     * the sticky ended even when there is nothing to follow it. The cooldown
     * record is written only when the entry asks for one, and it is marked
     * `protected` so a rewind cannot delete it before the hand-off completes.
     */
    function onStickyEnded(entry: ScanEntry): void {
        expiredSticky.push(entry);
        if (!entry.cooldown) {
            return;
        }

        state.cooldown[entry.id] = {
            hash: entry.hash,
            start: chatLength,
            end: chatLength + Number(entry.cooldown),
            protected: true,
        };
        buffers.cooldown.push(entry);
    }

    /**
     * Rebuild one buffer from its stored records, deleting what no longer
     * applies.
     *
     * Four rules, and the order between them is part of the behaviour:
     *
     * 1. **Rewound chat.** The chat is back at or before the message the effect
     *    started on (a regenerate or swipe removed it). `<=` is deliberate: a
     *    record created at length N is dropped on a re-scan at the same N,
     *    which is what makes regenerating re-evaluate the effect. A protected
     *    record survives, because it belongs to a hand-off already in flight.
     * 2. **Book or entry gone.** Nothing to evaluate. The record is kept until
     *    its natural end, so re-enabling the book resumes the effect where it
     *    left off rather than restarting it.
     * 3. **Effect removed in the editor.** The entry exists but no longer sets
     *    this effect, so the record goes immediately — before the end check, so
     *    even a protected one is dropped.
     * 4. **Expired.** Past `end`, the record goes; an expiring sticky also
     *    hands off to its cooldown.
     *
     * Everything else survives and is pushed onto the buffer. The same entry can
     * appear on both buffers at once when its own cooldown outlives its sticky.
     */
    function checkType(type: StoredType): void {
        const records = state[type];
        for (const [key, record] of Object.entries(records)) {
            const entry = findEntry(record);

            if (chatLength <= Number(record.start) && !record.protected) {
                delete records[key];
                continue;
            }

            if (!entry) {
                if (chatLength >= Number(record.end)) {
                    delete records[key];
                }
                continue;
            }

            if (!entry[type]) {
                delete records[key];
                continue;
            }

            if (chatLength >= Number(record.end)) {
                delete records[key];
                if (type === 'sticky') {
                    onStickyEnded(entry);
                }
                continue;
            }

            buffers[type].push(entry);
        }
    }

    /**
     * Rebuild the delay buffer.
     *
     * Delay is not stored and not affected by `dryRun`: whether an entry is
     * still waiting depends only on its own setting and the clock.
     */
    function checkDelay(): void {
        for (const entry of entries) {
            if (entry.delay && chatLength < entry.delay) {
                buffers.delay.push(entry);
            }
        }
    }

    /**
     * Record an activation, unless one is already stored.
     *
     * A record is never refreshed or extended: the window starts at the entry's
     * *first* activation, so a cooldown that re-fires later does not push its
     * own end further out. The absent-key test is what enforces that, which is
     * also why a record left over from an edited entry blocks a new one — the
     * key is present even though the hash no longer matches.
     */
    function setType(type: StoredType, entry: ScanEntry): void {
        if (!entry[type]) {
            return;
        }

        if (!state[type][entry.id]) {
            state[type][entry.id] = {
                hash: entry.hash,
                start: chatLength,
                end: chatLength + Number(entry[type]),
                protected: false,
            };
        }
    }

    /**
     * Is this entry active in the current scan?
     *
     * A strict `===` on the buffer's hashes, unlike `findEntry`'s string
     * comparison: this is an in-memory question asked of entries the scanner
     * already holds, not a lookup in a file that might hold a string.
     */
    function isActive(type: TimedEffectType, entry: ScanEntry): boolean {
        return buffers[type].some((candidate) => candidate.hash === entry.hash);
    }

    /**
     * How many more messages the effect lasts.
     *
     * Delay answers from the entry alone, so it reports a value during a dry
     * run too. The stored kinds answer from the record, and only when that
     * record belongs to this entry (strict hash compare, so a stale record left
     * by an edited entry reports nothing) and has not yet expired.
     */
    function remaining(type: TimedEffectType, entry: ScanEntry): number | undefined {
        if (type === 'delay') {
            if (!entry.delay || chatLength >= entry.delay) {
                return undefined;
            }
            return entry.delay - chatLength;
        }

        const record = state[type][entry.id];
        if (!record || record.hash !== entry.hash || chatLength >= record.end) {
            return undefined;
        }
        return record.end - chatLength;
    }

    return {
        check() {
            if (!dryRun) {
                checkType('sticky');
                checkType('cooldown');
            }
            checkDelay();
        },

        set(activated) {
            if (dryRun) {
                return;
            }
            for (const entry of activated) {
                setType('sticky', entry);
                setType('cooldown', entry);
            }
        },

        isActive,
        remaining,

        setOne(type, entry, active) {
            // There is no delay bucket to write to, so the honest answer is to
            // do nothing rather than throw.
            if (type === 'delay' || dryRun) {
                return;
            }

            // Deleted first and unconditionally, so `active: false` clears a
            // record whose hash no longer matches as well as one that does.
            delete state[type][entry.id];
            if (active) {
                state[type][entry.id] = {
                    hash: entry.hash,
                    start: chatLength,
                    end: chatLength + Number(entry[type]),
                    protected: false,
                };
            }
        },

        cleanup() {
            // In place, so a view captured earlier sees the cleared arrays.
            buffers.sticky.length = 0;
            buffers.cooldown.length = 0;
            buffers.delay.length = 0;
        },

        get active(): TimedEffectsView {
            // A new view object over the same four arrays: a caller that holds
            // one keeps seeing updates, which is what the context inspector
            // relies on.
            return {
                sticky: buffers.sticky,
                cooldown: buffers.cooldown,
                delay: buffers.delay,
                expiredSticky,
            };
        },
    };
}
