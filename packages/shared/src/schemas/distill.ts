import { z } from 'zod';

import type { ItemScope } from './shared.js';

/**
 * Distilling a book into a world info book and character cards (RFC 0002).
 *
 * A book is uploaded once and kept in the profile that owns it, so a run can be
 * repeated with a better model without a second upload. The record of a run
 * lives beside it; nothing reaches `worlds/` or `characters/` until the review
 * sheet is accepted.
 *
 * The draft a run produces is plain data with no storage identity: a character
 * draft has no id and an entry draft has no uid, because neither exists until
 * something is accepted.
 */

export const BOOK_FORMATS = ['txt', 'md', 'epub'] as const;
export const bookFormatSchema = z.enum(BOOK_FORMATS);
export type BookFormat = (typeof BOOK_FORMATS)[number];

/** One section, as the book list shows it: a title and a size, never the text. */
export interface BookSection {
    index: number;
    title: string;
    /** Characters of body text, so the review sheet can show weight without loading it. */
    chars: number;
}

export interface DistilledBook {
    /** Folder name under `books/`. */
    id: string;
    /** Display name, from the file name without its extension. */
    name: string;
    fileName: string;
    format: BookFormat;
    bytes: number;
    addedAt: number;
    sections: BookSection[];
}

export type DistillMode = 'sections' | 'model';

export type DistillStage = 'analyze' | 'outline';

/** One unit of work the progress list shows. */
export interface DistillChunk {
    index: number;
    stage: DistillStage;
    /** The section title, or `<title> 1/3` when one section spans several chunks. */
    label: string;
    state: 'pending' | 'running' | 'done' | 'incomplete';
    /** Why it is incomplete, for the row and the review sheet. */
    message?: string;
}

/**
 * A world info entry as a draft.
 *
 * The fields are the subset the review sheet edits; the rest of SillyTavern's
 * entry template is filled in at accept time, so a stored entry is a complete
 * ST entry rather than a half-written one.
 */
export interface DistillEntryDraft {
    key: string[];
    keysecondary: string[];
    comment: string;
    content: string;
    constant: boolean;
    position: number;
    /** Section title this entry came from; the review sheet groups on it. */
    chapter: string;
    /** How many times the entity was seen, which decided whether it got an outline pass. */
    mentions: number;
    confidence: 'high' | 'low';
    /** A short quote from the source, shown beside the row. */
    evidence: string;
    accepted: boolean;
}

export interface DistillCharacterDraft {
    name: string;
    aliases: string[];
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    tags: string[];
    mentions: number;
    confidence: 'high' | 'low';
    evidence: string;
    accepted: boolean;
}

export interface DistillDraft {
    entries: DistillEntryDraft[];
    characters: DistillCharacterDraft[];
}

export type DistillRunStatus = 'running' | 'done' | 'stopped' | 'failed';

/** What accepting a run wrote, so the sheet can say where things went. */
export interface DistillAccepted {
    worldId: string;
    scope: ItemScope;
    characterIds: string[];
}

export interface DistillRun {
    id: string;
    bookId: string;
    bookName: string;
    mode: DistillMode;
    /** The model the run used; `''` for a sections-only run. */
    model: string;
    status: DistillRunStatus;
    startedAt: number;
    finishedAt: number | null;
    chunks: DistillChunk[];
    /** Why the run stopped or failed, and what it skipped. */
    message?: string;
    /** `null` while running. */
    draft: DistillDraft | null;
    accepted?: DistillAccepted;
}

export type DistillEvent =
    | { type: 'start'; runId: string; model: string; chunks: DistillChunk[] }
    | { type: 'chunk'; chunk: DistillChunk; found: { entries: number; characters: number } }
    | { type: 'progress'; done: number; total: number }
    | { type: 'done'; run: DistillRun }
    | { type: 'error'; message: string };

/** What a run of this book would cost, shown before it starts. */
export interface DistillBookEstimate {
    chunks: number;
    promptTokens: number;
}

// --- request schemas -------------------------------------------------------

export const distillRunRequestSchema = z.object({
    bookId: z.string().trim().min(1).max(200),
    mode: z.enum(['sections', 'model']).default('sections'),
    /** A model the active provider serves; the resolved default when absent. */
    model: z.string().trim().max(200).optional(),
});

const entryDraftSchema = z.object({
    key: z.array(z.string()).default([]),
    keysecondary: z.array(z.string()).default([]),
    comment: z.string().default(''),
    content: z.string().default(''),
    constant: z.boolean().default(false),
    position: z.number().int().min(0).max(7).default(0),
    chapter: z.string().default(''),
    mentions: z.number().int().min(0).default(0),
    confidence: z.enum(['high', 'low']).default('low'),
    evidence: z.string().default(''),
    accepted: z.boolean().default(true),
});

const characterDraftSchema = z.object({
    name: z.string().trim().min(1).max(200),
    aliases: z.array(z.string()).default([]),
    description: z.string().default(''),
    personality: z.string().default(''),
    scenario: z.string().default(''),
    first_mes: z.string().default(''),
    mes_example: z.string().default(''),
    tags: z.array(z.string()).default([]),
    mentions: z.number().int().min(0).default(0),
    confidence: z.enum(['high', 'low']).default('low'),
    evidence: z.string().default(''),
    accepted: z.boolean().default(true),
});

/**
 * The edited draft handed back on accept.
 *
 * The client owns the inline edits, so the accepted content is whatever it
 * sends; the server only fills in the parts the editor does not show.
 */
export const distillAcceptSchema = z.object({
    entries: z.array(entryDraftSchema).default([]),
    characters: z.array(characterDraftSchema).default([]),
    world: z.object({
        id: z.string().trim().min(1).max(200),
        scope: z.enum(['profile', 'shared']).default('profile'),
    }),
    characterScope: z.enum(['profile', 'shared']).default('profile'),
    /** Point each new card at the book through `extensions.world`. */
    linkWorld: z.boolean().default(true),
});

export type DistillAcceptInput = z.infer<typeof distillAcceptSchema>;

/** The analysis reply one chunk must produce; validated before it is trusted. */
export const distillAnalysisSchema = z.object({
    characters: z
        .array(
            z.object({
                name: z.string().trim().min(1),
                aliases: z.array(z.string()).default([]),
                description: z.string().default(''),
                personality: z.string().default(''),
                evidence: z.string().default(''),
            }),
        )
        .default([]),
    places: z
        .array(
            z.object({
                name: z.string().trim().min(1),
                aliases: z.array(z.string()).default([]),
                description: z.string().default(''),
                evidence: z.string().default(''),
            }),
        )
        .default([]),
    facts: z
        .array(
            z.object({
                subject: z.string().trim().min(1),
                content: z.string().default(''),
                keys: z.array(z.string()).default([]),
            }),
        )
        .default([]),
});

export type DistillAnalysis = z.infer<typeof distillAnalysisSchema>;
