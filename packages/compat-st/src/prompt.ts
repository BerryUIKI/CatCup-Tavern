// Written for CatCup. Shapes the scanned entries into the strings the prompt
// builder consumes; see docs/DATA-FORMATS.md for the `wi_format` placeholder and
// docs/API.md for the context inspector that reads the same buckets.

import type { AuthorNotePrompt, ScanResult, WorldInfoPrompt, WorldInfoPromptOptions } from './worldinfo-types.js';

/**
 * Wrap a joined world info bucket in the author's `wi_format` template.
 *
 * `{0}` is the only placeholder the template understands — any other index is
 * left exactly as written, because a format string that mentions `{1}` is a
 * mistake the user can see, and silently blanking it would hide that.
 *
 * An empty bucket stays empty rather than rendering the bare template, and a
 * blank template leaves the value alone. Both are what makes "no format" and
 * "no entries" behave the same way as not having the feature on.
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
 * Assemble the Author's Note body from the parts the scanner split it into.
 *
 * The top and bottom groups are joined with the note between them. Exactly one
 * newline is removed from each end afterwards — not `trim()`, which would eat
 * a blank line and change the shape of a note that has entries above and below
 * it. An empty note therefore leaves one blank line, which is the intended
 * rendering rather than an artefact.
 */
export function composeAuthorNote(top: string[], note: string, bottom: string[]): string {
    return `${top.join('\n')}\n${note}\n${bottom.join('\n')}`.replace(/(^\n)|(\n$)/g, '');
}

/**
 * Turn a scan result into the text the prompt builder consumes.
 *
 * Entry content is passed through untouched. The scanner already decided what
 * is empty, and trimming here would change both the rendered line and the text
 * the recursion pass sees on the next step — two things that have to agree.
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
        // The two buckets are concatenated for the single-string consumers; the
        // separate copies above are what the builder places at its two markers.
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

/** Join the entries of each depth bucket, at the depth they are injected into. */
export function depthPromptText(result: ScanResult): Array<{ depth: number; role: number; content: string }> {
    return result.positions.atDepth.map((bucket) => ({
        depth: bucket.depth,
        role: bucket.role,
        content: bucket.entries.join('\n'),
    }));
}

/** Join each outlet's entries, which is what `{{outlet::name}}` expands to. */
export function outletText(result: ScanResult): Record<string, string> {
    return Object.fromEntries(
        Object.entries(result.positions.outlets).map(([name, entries]) => [name, entries.join('\n')]),
    );
}
