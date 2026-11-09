import type { WorldInfoEntry } from '@catcup/shared';

/** Why an entry was activated during a scan. */
export type ActivationReason = 'constant' | 'decorator-activate' | 'primary-key' | 'secondary-key';

/** Why an entry was considered and rejected during a scan. */
export type SkipReason =
    | 'disabled'
    | 'no-keys'
    | 'trigger-filter'
    | 'decorator-dont-activate'
    | 'primary-key-miss'
    | 'secondary-key-miss'
    | 'probability-failed'
    | 'budget-exceeded';

/**
 * A world info entry annotated with the book it came from.
 *
 * Intersected rather than `Omit`-ed: the passthrough schema adds an index
 * signature, and `Omit` would collapse every known field to `unknown`.
 */
export type ScanEntry = WorldInfoEntry & {
    /** UID within the source book. Assigned from the record key when missing. */
    uid: number;
    /** Source book id (file name without `.json`). */
    world: string;
    /** Stable identifier across books: `<world>.<uid>`. */
    id: string;
    /** Decorator lines parsed from the start of the raw content. */
    decorators: string[];
};

/** One line of the scan trace, consumed by the context inspector. */
export interface ScanTrace {
    loop: number;
    world: string;
    uid: number;
    comment: string;
    activated: boolean;
    reason: ActivationReason | SkipReason;
    /** Matched key, or a short explanation for skips. */
    detail?: string;
}

/**
 * Chat-independent text that an entry can opt into scanning through its
 * `match*` flags. SillyTavern calls this `globalScanData`.
 */
export interface GlobalScanData {
    trigger?: string;
    personaDescription?: string;
    characterDescription?: string;
    characterPersonality?: string;
    characterDepthPrompt?: string;
    scenario?: string;
    creatorNotes?: string;
}

/** A chat message prepared for scanning. */
export interface ScanMessage {
    text: string;
}

/** Global world info settings, named after their SillyTavern counterparts. */
export interface WorldInfoSettings {
    /** Number of recent chat messages scanned by default. */
    depth: number;
    /** Budget as a percentage of `maxContext`. */
    budgetPercent: number;
    /** Absolute budget cap in tokens; `0` disables the cap. */
    budgetCap: number;
    caseSensitive: boolean;
    matchWholeWords: boolean;
}

export interface ScanInput {
    entries: ScanEntry[];
    /** Chat messages, newest first. */
    chat: ScanMessage[];
    /** Context size in tokens; the percentage budget is derived from it. */
    maxContext: number;
    settings?: Partial<WorldInfoSettings>;
    globalScanData?: GlobalScanData;
    /** Token counter. Defaults to the shared estimator. */
    countTokens?: (text: string) => number;
    /** RNG in `[0, 1)`. Injectable so probability checks are testable. */
    random?: () => number;
    /** Macro expansion applied to keys and content. Defaults to identity. */
    substitute?: (text: string) => string;
}

export interface DepthBucket {
    depth: number;
    /** `0` system, `1` user, `2` assistant. */
    role: number;
    entries: string[];
}

/** Position buckets, ordered the way the prompt builder consumes them. */
export interface ScanPositions {
    before: string[];
    after: string[];
    authorNoteTop: string[];
    authorNoteBottom: string[];
    atDepth: DepthBucket[];
}

export interface ScanResult {
    positions: ScanPositions;
    activated: ScanEntry[];
    trace: ScanTrace[];
    budget: { limit: number; used: number; overflowed: boolean };
    /** Number of scan passes. Recursion adds more in a later milestone slice. */
    loops: number;
}
