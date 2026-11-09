// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/world-info.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import type { ScanEntry, TimedEffectRecord, TimedEffectsView, TimedEffectType, TimedWorldInfo } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

/**
 * Normalize `chat_metadata.timedWorldInfo` in place, mirroring SillyTavern's
 * `ensureChatMetadata`. Missing or malformed containers and records are
 * replaced, and the caller keeps the same object identity.
 */
export function ensureTimedWorldInfo(container: Record<string, unknown>): TimedWorldInfo {
    let timed = container.timedWorldInfo;
    if (!isRecord(timed)) {
        timed = {};
        container.timedWorldInfo = timed;
    }

    const state = timed as Record<string, unknown>;
    for (const type of ['sticky', 'cooldown'] as const) {
        let records = state[type];
        if (!isRecord(records)) {
            records = {};
            state[type] = records;
        }

        const recordMap = records as Record<string, unknown>;
        for (const [key, record] of Object.entries(recordMap)) {
            if (!isValidRecord(record)) {
                delete recordMap[key];
            }
        }
    }

    return timed as TimedWorldInfo;
}

export interface TimedEffectsContext {
    /** Length of SillyTavern's `chatForWI`: non-system messages only. */
    chatLength: number;
    /** Every candidate entry, not only the activated ones. */
    entries: readonly ScanEntry[];
    state: TimedWorldInfo;
    /** Mirrors ST's dry run: sticky and cooldown are neither read nor written. */
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
    /** Manual override, equivalent to ST's `/wi-set-timed-effect`. */
    setOne(type: TimedEffectType, entry: ScanEntry, active: boolean): void;
    /** Clear the in-memory buffers; persisted records are untouched. */
    cleanup(): void;
    readonly active: TimedEffectsView;
}

/**
 * Timed world info effects: `sticky` keeps an entry active for N messages
 * after it triggers, `cooldown` blocks it for N messages, and `delay` blocks
 * it until the chat has N messages. ST stores only sticky and cooldown; delay
 * is recomputed from the entry on every scan.
 */
export function createTimedEffects(context: TimedEffectsContext): TimedEffects {
    const { chatLength, entries, state, dryRun } = context;
    const buffers = {
        sticky: [] as ScanEntry[],
        cooldown: [] as ScanEntry[],
        delay: [] as ScanEntry[],
    };
    const expiredSticky: ScanEntry[] = [];

    function findEntry(record: TimedEffectRecord): ScanEntry | undefined {
        return entries.find((entry) => String(entry.hash) === String(record.hash));
    }

    /**
     * Spawn the protected cooldown that follows an expiring sticky effect.
     * It is pushed into the cooldown buffer immediately so the cooldown pass,
     * which runs after this one, suppresses the entry in the same scan.
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

    function checkType(type: 'sticky' | 'cooldown'): void {
        const records = state[type];
        for (const [key, record] of Object.entries(records)) {
            const entry = findEntry(record);

            // The chat was rewound to (or before) the message the effect
            // started on: regenerate/swipe dropped it. Protected records
            // survive so a sticky-to-cooldown hand-off is not lost.
            if (chatLength <= Number(record.start) && !record.protected) {
                delete records[key];
                continue;
            }

            // The book or entry is gone. Keep the record until its natural
            // end so re-activating the book resumes the effect.
            if (!entry) {
                if (chatLength >= Number(record.end)) {
                    delete records[key];
                }
                continue;
            }

            // The effect was removed in the editor.
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

    function checkDelay(): void {
        for (const entry of entries) {
            if (entry.delay && chatLength < entry.delay) {
                buffers.delay.push(entry);
            }
        }
    }

    function setType(type: 'sticky' | 'cooldown', entry: ScanEntry): void {
        if (!entry[type]) {
            return;
        }

        // An existing record is never refreshed or extended: ST only creates
        // when the key is absent, so the window starts at the first activation.
        if (!state[type][entry.id]) {
            state[type][entry.id] = {
                hash: entry.hash,
                start: chatLength,
                end: chatLength + Number(entry[type]),
                protected: false,
            };
        }
    }

    function isActive(type: TimedEffectType, entry: ScanEntry): boolean {
        return buffers[type].some((candidate) => candidate.hash === entry.hash);
    }

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
            // A dry run ignores sticky and cooldown entirely; only delay,
            // which is stateless, still applies.
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
            // ST throws for `delay` because its metadata has no such bucket.
            // This port treats it as a no-op rather than reproducing a crash.
            if (type === 'delay') {
                return;
            }
            if (dryRun) {
                return;
            }

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
            buffers.sticky.length = 0;
            buffers.cooldown.length = 0;
            buffers.delay.length = 0;
        },

        get active(): TimedEffectsView {
            return {
                sticky: buffers.sticky,
                cooldown: buffers.cooldown,
                delay: buffers.delay,
                expiredSticky,
            };
        },
    };
}
