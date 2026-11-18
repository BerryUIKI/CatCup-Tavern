import { z } from 'zod';

import { MAX_ALIAS_LENGTH, MAX_ALIASES_PER_ENTRY } from './worldinfo.js';

/**
 * Generating a book's aliases with a model.
 *
 * One request per entry, because an entry is the unit a person reviews: the
 * model sees one entry's keys, comment and content and proposes the names that
 * entry should also answer to. Batching several entries into one request would
 * save requests and lose the ability to accept one row and reject the next.
 *
 * A run is resumable, which is why the record carries per-entry state rather
 * than one draft blob. `alias-runs/<id>.json` is read back by a resume, and a
 * row that finished keeps its proposal so a resumed run does not pay for it
 * again — the gap book distillation has, where a run record is history only.
 */

export type AliasRunStatus = 'running' | 'done' | 'stopped' | 'failed';

/** One entry's share of a run: one request, one reviewable row. */
export interface AliasRunItem {
    /** The book's uid for this entry; the row's identity across a resume. */
    uid: number;
    /** The comment, or the first key, or `Entry <uid>` — what the row shows. */
    label: string;
    state: 'pending' | 'running' | 'done' | 'skipped' | 'incomplete';
    /** Why a row was skipped or could not be read. */
    message?: string;
    /** The aliases the entry already carried when the run was planned. */
    existing: string[];
    /**
     * The names the model added, with the entry's own keys and its existing
     * aliases filtered out. The review sheet starts each row at
     * `existing + proposed`, so nothing hand-entered is silently dropped.
     */
    proposed?: string[];
    /**
     * Hash of the entry's content this row was generated against.
     *
     * Written as `generatedFrom` on apply, and compared on resume: an entry
     * edited while a run was stopped is planned again rather than keeping a
     * proposal that describes text which no longer exists.
     */
    contentHash?: string;
}

export interface AliasRun {
    id: string;
    worldId: string;
    model: string;
    status: AliasRunStatus;
    startedAt: number;
    finishedAt: number | null;
    items: AliasRunItem[];
    /** Why the run stopped or failed, and how many rows it could not read. */
    message?: string;
    /** What an apply wrote, so the sheet can say where things went. */
    applied?: { updated: number; kept: number };
}

export type AliasEvent =
    | { type: 'start'; runId: string; model: string; items: AliasRunItem[] }
    | { type: 'item'; item: AliasRunItem }
    | { type: 'progress'; done: number; total: number }
    | { type: 'done'; run: AliasRun }
    | { type: 'error'; message: string };

/**
 * What generating aliases for a book would cost, before it starts.
 *
 * `requests` is the number a person is about to spend, not an estimate of one:
 * it is the count of entries a run would ask about.
 */
export interface AliasEstimate {
    /** Entries that would be requested. */
    requests: number;
    /** How many of those already carry aliases. */
    withAliases: number;
    /** Entries that will be skipped because they have no content. */
    empty: number;
    /** Prompt tokens across every request, counted with the run's own model. */
    promptTokens: number;
    /** The model those numbers were counted with. */
    model: string;
}

// --- request schemas -------------------------------------------------------

export const aliasRunRequestSchema = z.object({
    /** Restrict the run to these uids; absent means every entry in the book. */
    uids: z.array(z.number().int().min(0)).max(100_000).optional(),
    /** Re-generate entries that already carry aliases. */
    includeExisting: z.boolean().default(true),
    /** A model the active provider serves; the resolved default when absent. */
    model: z.string().trim().max(200).optional(),
});

export type AliasRunRequest = z.infer<typeof aliasRunRequestSchema>;

/**
 * The edited rows handed back on apply.
 *
 * The client owns the chips, so what arrives is exactly what is stored. A row
 * an entry is not listed for keeps whatever aliases it already had — an
 * apply can add and replace, never clear by omission.
 */
export const aliasApplySchema = z.object({
    entries: z
        .array(
            z.object({
                uid: z.number().int().min(0),
                aliases: z.array(z.string().max(MAX_ALIAS_LENGTH)).max(MAX_ALIASES_PER_ENTRY),
            }),
        )
        .max(100_000)
        .default([]),
});

export type AliasApplyInput = z.infer<typeof aliasApplySchema>;

/** The reply one entry's request must produce, validated before it is trusted. */
export const aliasReplySchema = z.object({
    aliases: z.array(z.string()).default([]),
});

export type AliasReply = z.infer<typeof aliasReplySchema>;
