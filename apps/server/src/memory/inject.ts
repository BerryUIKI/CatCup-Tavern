// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/memory/index.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import { type MacroContext, type MemorySettings, type StoredSummary, substituteMacros } from '@catcup/shared';

import type { SummaryInjection } from '../prompt/assemble.js';

/**
 * Format a stored summary for the prompt.
 *
 * SillyTavern stores the summary raw and wraps it in the injection template
 * when it is about to be sent. `position: -1` keeps the summary out of the
 * prompt while leaving it available to the `{{summary}}` macro.
 */
export function buildMemoryInjection(
    settings: MemorySettings,
    summary: StoredSummary | null,
    context: MacroContext,
): SummaryInjection | null {
    if (!summary || settings.position === -1) {
        return null;
    }

    const template = settings.template.trim() || 'Summary: {{summary}}';
    const content = substituteMacros(template, { ...context, summary: summary.value }).trim();
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
