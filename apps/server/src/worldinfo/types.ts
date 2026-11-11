import type { WorldInfoEntry } from '@catcup/shared';

/** Why an entry was activated during a scan. */
export type ActivationReason = 'constant' | 'decorator-activate' | 'primary-key' | 'secondary-key' | 'sticky';

/** Why an entry was considered and rejected during a scan. */
export type SkipReason =
    | 'disabled'
    | 'no-keys'
    | 'trigger-filter'
    | 'character-filter-name'
    | 'character-filter-tag'
    | 'timed-delay'
    | 'timed-cooldown'
    | 'delay-until-recursion'
    | 'exclude-recursion'
    | 'decorator-dont-activate'
    | 'primary-key-miss'
    | 'secondary-key-miss'
    | 'group-already-activated'
    | 'group-loser'
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
    /**
     * SillyTavern-compatible content hash, computed over the raw entry with
     * decorators stripped. Timed-effect records are matched by this value.
     */
    hash: number;
};

/** One line of the scan trace, consumed by the context inspector. */
export interface ScanTrace {
    /** Scan pass the outcome was decided in; 1-based. */
    loop: number;
    world: string;
    uid: number;
    comment: string;
    activated: boolean;
    reason: ActivationReason | SkipReason;
    /** Matched key, group name, or a short explanation for skips. */
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

/** Character identity used by `characterFilter` entries. */
export interface ActiveCharacter {
    /** Character id: avatar file name without its extension. */
    id: string;
    /** Tag ids assigned to the character in the user's tag store. */
    tagIds?: readonly string[];
}

/** Global world info settings, named after their SillyTavern counterparts. */
export interface WorldInfoSettings {
    /** `world_info_depth`: recent chat messages scanned by default. */
    depth: number;
    /** `world_info_budget`: budget as a percentage of `maxContext`. */
    budgetPercent: number;
    /** `world_info_budget_cap`: absolute budget cap in tokens; `0` disables it. */
    budgetCap: number;
    /** `world_info_case_sensitive`. */
    caseSensitive: boolean;
    /** `world_info_match_whole_words`. */
    matchWholeWords: boolean;
    /** `world_info_use_group_scoring`. */
    useGroupScoring: boolean;
    /** `world_info_recursive`. */
    recursive: boolean;
    /** `world_info_min_activations`; `0` disables depth seeking. */
    minActivations: number;
    /** `world_info_min_activations_depth_max`; `0` disables the cap. */
    minActivationsDepthMax: number;
    /** `world_info_max_recursion_steps`; `0` is unlimited. */
    maxRecursionSteps: number;
}

/** SillyTavern's `scan_state` enum. */
export const SCAN_STATE = {
    NONE: 0,
    INITIAL: 1,
    RECURSION: 2,
    MIN_ACTIVATIONS: 3,
} as const;

export type ScanState = (typeof SCAN_STATE)[keyof typeof SCAN_STATE];

export type TimedEffectType = 'sticky' | 'cooldown' | 'delay';

/**
 * One persisted timed-effect record.
 *
 * `start` and `end` are absolute counts of non-system chat messages, not
 * message ids or timestamps. The effect applies while
 * `start < chatLength < end`.
 */
export interface TimedEffectRecord {
    hash: number;
    start: number;
    end: number;
    /** Set only on the cooldown spawned when a sticky effect expires. */
    protected: boolean;
}

/** Persisted as `chat_metadata.timedWorldInfo`. `delay` is stateless. */
export interface TimedWorldInfo {
    sticky: Record<string, TimedEffectRecord>;
    cooldown: Record<string, TimedEffectRecord>;
}

/** Timed effects active for the current scan. */
export interface TimedEffectsView {
    sticky: ScanEntry[];
    cooldown: ScanEntry[];
    delay: ScanEntry[];
    /** Sticky effects that expired at the start of this scan. */
    expiredSticky: ScanEntry[];
}

export interface ScanInput {
    entries: ScanEntry[];
    /**
     * Chat messages, newest first, with system messages removed.
     *
     * This is SillyTavern's `chatForWI`: its length is the timed-effect clock,
     * so pass the full conversation, never a context-trimmed slice.
     */
    chat: ScanMessage[];
    /** Context size in tokens; the percentage budget is derived from it. */
    maxContext: number;
    settings?: Partial<WorldInfoSettings>;
    globalScanData?: GlobalScanData;
    /** Persisted timed effects. Omit to run without any. */
    timed?: {
        state: TimedWorldInfo;
        /** Mirror of ST's dry run: sticky/cooldown are ignored and not written. */
        dryRun?: boolean;
    };
    /** Character identity for `characterFilter` entries. */
    activeCharacter?: ActiveCharacter;
    /** Token counter. Defaults to the shared estimator. */
    countTokens?: (text: string) => number;
    /** RNG in `[0, 1)`. Injectable so rolls are testable. */
    random?: () => number;
    /**
     * Macro expansion applied to keys and content. SillyTavern expands once,
     * when an entry passes its probability roll; this port calls the callback
     * at the same point so the recursion buffer sees the same text.
     */
    substitute?: (text: string) => string;
    /**
     * Per-entry content transform applied when building prompt buckets, after
     * the budget and before the empty check. Reserved for regex scripts (M2).
     */
    transformContent?: (entry: ScanEntry, content: string, depth: number | null) => string;
}

export interface DepthBucket {
    depth: number;
    /** `0` system, `1` user, `2` assistant. */
    role: number;
    entries: string[];
}

/** An example-message entry: `position` is `0` before or `1` after. */
export interface ExampleBucket {
    position: number;
    content: string;
}

/** Position buckets, ordered the way the prompt builder consumes them. */
export interface ScanPositions {
    before: string[];
    after: string[];
    authorNoteTop: string[];
    authorNoteBottom: string[];
    atDepth: DepthBucket[];
    examples: ExampleBucket[];
    /** Keyed by `outletName`; arrays are in descending `order`. */
    outlets: Record<string, string[]>;
}

export interface ScanResult {
    positions: ScanPositions;
    /** Activated entries, deduplicated by `<world>.<uid>`. */
    activated: ScanEntry[];
    trace: ScanTrace[];
    budget: { limit: number; used: number; overflowed: boolean };
    /** Number of scan passes performed. */
    loops: number;
    timedEffects: TimedEffectsView;
}

/** The Author's Note prompt SillyTavern rewrites after a scan. */
export interface AuthorNotePrompt {
    value: string;
    /** `0` in prompt, `1` in chat, `2` before prompt. */
    position: number;
    depth: number;
    /** `0` system, `1` user, `2` assistant. */
    role: number;
    scan: boolean;
}

export interface WorldInfoPromptOptions {
    /** `oai_settings.wi_format`, default `{0}`; wraps before/after once. */
    wiFormat?: string;
    /** ST's `shouldWIAddPrompt` for this turn. */
    shouldAddAuthorNote: boolean;
    /** The note text before world info is merged into it. */
    originalAuthorNote: string;
    note: { position: number; depth: number; role: number; scan: boolean };
}

/** DOM-free equivalent of SillyTavern's `WIPromptResult`. */
export interface WorldInfoPrompt {
    worldInfoBefore: string;
    worldInfoAfter: string;
    /** `worldInfoBefore + worldInfoAfter`, with no separator. */
    worldInfoString: string;
    worldInfoExamples: ExampleBucket[];
    /** One bucket per `(depth, role)`; join `entries` with `\n` to inject. */
    worldInfoDepth: DepthBucket[];
    anBefore: string[];
    anAfter: string[];
    outletEntries: Record<string, string[]>;
    /** Non-null only when the Author's Note is scheduled this turn. */
    authorNote: AuthorNotePrompt | null;
    /** Raw buckets, kept for the context inspector and tests. */
    buckets: ScanPositions;
}
