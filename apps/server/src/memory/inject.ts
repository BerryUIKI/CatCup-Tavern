// Written for CatCup. Which stored summaries reach a prompt, and how they are
// formatted once chosen.

import { type MacroContext, type MemorySettings, type StoredSummary, substituteMacros } from '@catcup/shared';

import type { SummaryInjection } from '../prompt/assemble.js';

/**
 * Format one stored summary for display or for the world info scan.
 *
 * Independent of whether the summary is injected, because both other uses
 * exist: `{{summary}}` expands to it, and a summary can be scanned for world
 * info even while its injection position is "none".
 *
 * A blank or whitespace-only template falls back to a labelled default rather
 * than dropping the label — an unlabelled paragraph in the prompt reads as
 * narration. A summary that formats to nothing returns `null`, so the caller
 * omits the block instead of emitting an empty one.
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
 * Every generation path — single, group and the context inspector — makes the
 * same choice, so it is made here once.
 *
 * With append-only off this is the latest summary alone, which is the classic
 * behaviour and costs nothing to a chat that never turned the setting on.
 *
 * The budget is a cap on absurdity, not a tight allowance: it only bounds a
 * chat that has accumulated dozens of summaries. A low cap would quietly defeat
 * the feature — the point is that the beginning survives — so it is set well
 * above what a normal chat reaches. A caller with a precise allowance calls
 * `selectSummaries` directly.
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

    // Roughly six 200-word summaries; see the note on `summariesForTurn`.
    return selectSummaries(summaries, cost, APPEND_ONLY_BUDGET);
}

/** Rough token ceiling for the append-only summary block; see `summariesForTurn`. */
export const APPEND_ONLY_BUDGET = 1200;

/**
 * Build the injection block for a prompt.
 *
 * The stored summary is kept raw and wrapped in the template here, on the way
 * into a prompt. `position: -1` keeps it out of the prompt while still leaving
 * it available to `{{summary}}` and to the world info scan — those read the
 * stored value, not this block.
 *
 * Accepts one summary or several. The order they arrive in does not matter:
 * they are sorted newest first, because the most recent settled state is what a
 * turn acts on and the earliest follows as background.
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
