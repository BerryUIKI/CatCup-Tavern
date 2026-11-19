// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/memory/index.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import { type MacroContext, type MemorySettings, type StoredSummary, substituteMacros } from '@catcup/shared';

import type { SummaryInjection } from '../prompt/assemble.js';

/**
 * Format the stored summary for display or scanning, regardless of whether it
 * is injected. SillyTavern keeps the formatted memory available to the world
 * info scan even when its position is "None".
 */
export function formatMemoryText(
    settings: MemorySettings,
    summary: StoredSummary | null,
    context: MacroContext,
): string | null {
    if (!summary) {
        return null;
    }
    const template = settings.template.trim() || 'Summary: {{summary}}';
    const content = substituteMacros(template, { ...context, summary: summary.value }).trim();
    return content || null;
}

/**
 * Merge several summaries into one injection body.
 *
 * Newest first is the reading order that matters: a person skimming the prompt
 * wants the most recent state at the top and the oldest context underneath.
 * Each is wrapped in the configured template separately so the boundary between
 * two settled ranges stays visible — concatenating raw text would run chapter 1
 * into chapter 9 with nothing in between.
 */
export function formatSummaryList(
    settings: MemorySettings,
    summaries: readonly StoredSummary[],
    context: MacroContext,
): string | null {
    const parts = summaries
        .map((summary) => formatMemoryText(settings, summary, context))
        .filter((part): part is string => Boolean(part));

    return parts.length > 0 ? parts.join('\n\n') : null;
}

/**
 * Choose which summaries to send when they all fit, the newest, and the opening.
 *
 * This is the whole of the "two-sided" budget. The complaint that opened this
 * work was *a long conversation stops forgetting its own beginning*: with only
 * the newest summary injected, an old one that falls out of the prompt is gone
 * from the model's view entirely. Keeping the oldest as well as the newest
 * means the failure is a dropped middle rather than a dropped start, which is
 * strictly better for the stated problem and reversible by a setting.
 *
 * The newest wins a tie for the first slot: with one summary there is nothing
 * to balance, and with two the earliest counts as both.
 *
 * `budget` is a token allowance; entries are taken newest-first until it runs
 * out, and the earliest is added afterwards if it is not already present.
 * A summary larger than the remaining budget for the earliest is skipped rather
 * than displacing the newest one — this keeps the most recent state, which is
 * what a turn is most likely to need.
 */
export function selectSummaries(
    summaries: readonly StoredSummary[],
    cost: (summary: StoredSummary) => number,
    budget: number,
): StoredSummary[] {
    if (summaries.length === 0) {
        return [];
    }

    const chosen: StoredSummary[] = [];
    let remaining = budget;

    // Newest first, walking back through the settled ranges.
    for (let index = summaries.length - 1; index >= 0; index -= 1) {
        const summary = summaries[index];
        if (!summary) {
            continue;
        }
        const spend = cost(summary);
        if (spend > remaining) {
            // The newest always gets in even when it alone overruns: an empty
            // memory block would be worse than a slightly over-budget one, and
            // the caller has already reserved room for it.
            if (chosen.length === 0) {
                chosen.push(summary);
            }
            break;
        }
        remaining -= spend;
        chosen.push(summary);
    }

    const earliest = summaries[0];
    if (earliest && !chosen.includes(earliest)) {
        const spend = cost(earliest);
        // Only if it fits beside what has already been kept, and only if
        // keeping it does not evict the newest.
        if (spend <= remaining) {
            chosen.push(earliest);
        }
    }

    return chosen;
}

/**
 * Pick the summaries to inject, without the caller having to know the rule.
 *
 * Every generation path — single, group and the context inspector — has to make
 * the same choice, so it is made here once. With `appendOnly` off this returns
 * the latest summary alone, which is exactly what SillyTavern injects and what
 * this app injected before.
 *
 * The budget is generous by design rather than tight: it is expressed in tokens
 * and only bounds the pathological case of a chat carrying dozens of summaries.
 * A caller with a precise allowance can call `selectSummaries` directly.
 */
export function summariesForTurn(
    settings: MemorySettings,
    summaries: readonly StoredSummary[],
    cost: (summary: StoredSummary) => number,
): StoredSummary[] {
    if (summaries.length === 0) {
        return [];
    }
    if (!settings.appendOnly) {
        const latest = summaries[summaries.length - 1];
        return latest ? [latest] : [];
    }

    /**
     * 1,200 tokens is roughly six 200-word summaries. It is a cap on absurdity,
     * not a budget a normal chat reaches: the point of append-only mode is that
     * the beginning survives, and a cap low enough to drop it would defeat the
     * feature.
     */
    return selectSummaries(summaries, cost, APPEND_ONLY_BUDGET);
}

/** Rough token ceiling for the append-only summary block; see `summariesForTurn`. */
export const APPEND_ONLY_BUDGET = 1200;

/**
 * Format a stored summary for the prompt.
 *
 * SillyTavern stores the summary raw and wraps it in the injection template
 * when it is about to be sent. `position: -1` keeps the summary out of the
 * prompt while leaving it available to the `{{summary}}` macro and to the
 * world info scan.
 *
 * `summaries` is the list the two-sided budget selected, oldest or newest order
 * irrelevant — `formatSummaryList` sorts by recency. Passing just the latest
 * reproduces SillyTavern's single-summary behaviour exactly.
 */
export function buildMemoryInjection(
    settings: MemorySettings,
    summaries: StoredSummary | readonly StoredSummary[] | null,
    context: MacroContext,
): SummaryInjection | null {
    if (settings.position === -1) {
        return null;
    }

    const list = summaries === null ? [] : Array.isArray(summaries) ? summaries : [summaries as StoredSummary];
    if (list.length === 0) {
        return null;
    }

    // Newest first: the most recent settled state is what a turn acts on, and
    // the earliest follows it as background.
    const ordered = [...list].sort((a, b) => b.index - a.index);
    const content = formatSummaryList(settings, ordered, context);
    if (!content) {
        return null;
    }

    return {
        content,
        position: settings.position,
        role: settings.role,
        depth: settings.depth,
    };
}
