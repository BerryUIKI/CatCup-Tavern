// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/world-info.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import type { AuthorNotePrompt, ScanResult, WorldInfoPrompt, WorldInfoPromptOptions } from './types.js';

/**
 * Apply SillyTavern's `wi_format` to a joined before/after bucket.
 *
 * Only `{0}` is substituted, matching `stringFormat(format, value)`: any other
 * placeholder is left literal. An empty value stays empty and a blank format
 * leaves the value untouched.
 */
export function formatWorldInfo(value: string, format = '{0}'): string {
    if (!value) {
        return '';
    }
    if (!format.trim()) {
        return value;
    }
    return format.replace(/\{(\d+)\}/g, (match, index: string) => (index === '0' ? value : match));
}

/**
 * Compose the Author's Note body the way SillyTavern does.
 *
 * The template always inserts both newlines; the regex then removes exactly
 * one leading and one trailing newline. This is deliberately not `trim()`, so
 * an empty note between top and bottom entries leaves a blank line.
 */
export function composeAuthorNote(top: string[], note: string, bottom: string[]): string {
    return `${top.join('\n')}\n${note}\n${bottom.join('\n')}`.replace(/(^\n)|(\n$)/g, '');
}

/**
 * Turn a scan result into the text the prompt builder consumes.
 *
 * Nothing here trims entry content: SillyTavern only skips exactly empty
 * strings, and trimming would change both the rendered line and the recursion
 * buffer.
 */
export function buildWorldInfoPrompt(result: ScanResult, options: WorldInfoPromptOptions): WorldInfoPrompt {
    const before = result.positions.before.length > 0 ? result.positions.before.join('\n') : '';
    const after = result.positions.after.length > 0 ? result.positions.after.join('\n') : '';

    let authorNote: AuthorNotePrompt | null = null;
    if (options.shouldAddAuthorNote) {
        authorNote = {
            value: composeAuthorNote(
                result.positions.authorNoteTop,
                options.originalAuthorNote,
                result.positions.authorNoteBottom,
            ),
            ...options.note,
        };
    }

    return {
        worldInfoBefore: before,
        worldInfoAfter: after,
        worldInfoString: before + after,
        worldInfoExamples: result.positions.examples,
        worldInfoDepth: result.positions.atDepth,
        anBefore: result.positions.authorNoteTop,
        anAfter: result.positions.authorNoteBottom,
        outletEntries: result.positions.outlets,
        authorNote,
        buckets: result.positions,
    };
}

/** Join the entries of each depth bucket, as ST does at injection time. */
export function depthPromptText(result: ScanResult): Array<{ depth: number; role: number; content: string }> {
    return result.positions.atDepth.map((bucket) => ({
        depth: bucket.depth,
        role: bucket.role,
        content: bucket.entries.join('\n'),
    }));
}

/** Join each outlet's entries, as the `{{outlet::name}}` macro reads them. */
export function outletText(result: ScanResult): Record<string, string> {
    return Object.fromEntries(
        Object.entries(result.positions.outlets).map(([name, entries]) => [name, entries.join('\n')]),
    );
}
