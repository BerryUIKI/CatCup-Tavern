// Written for CatCup. The key-matching rules are CatCup's own reading of the
// world info format: see docs/DATA-FORMATS.md and docs/ST-COMPATIBILITY.md,
// and the tests in apps/server/src/worldinfo/scanner.test.ts for the behaviour
// this has to keep.

import { parseRegexFromString } from '@catcup/shared';

export { parseRegexFromString };

/**
 * Decorator lines the format defines.
 *
 * A decorator sits on its own line at the very top of an entry's content and
 * says whether the entry should fire. Anything else beginning with `@@` is not
 * part of the vocabulary and is left in the content.
 */
const DECORATORS = new Set(['@@activate', '@@dont_activate']);

/** How far a decorator line may be indented before it stops being a decorator. */
const ESCAPED_PREFIX = '@@@';

/**
 * Split leading decorator lines from an entry's content.
 *
 * The rules, in order:
 *
 * - Content that does not start with `@@` has no decorators at all.
 * - A run of `@@` lines at the top is the decorator region; the first line that
 *   does not start with `@@` ends it, and everything from that line on is the
 *   content.
 * - `@@@activate` is the *escaped* form: it means "this is text that looks like
 *   a decorator, not one". It contributes no decorator, and it only stays in
 *   the content when nothing after it ends the run — in that case the original
 *   string is returned untouched, because there was no region to strip.
 * - An unrecognised `@@something` line ends the decorator region rather than
 *   being consumed, so a card that opens with `@@author` keeps its text.
 */
export function parseDecorators(content: string): { decorators: string[]; content: string } {
    if (!content.startsWith('@@')) {
        return { decorators: [], content };
    }

    const lines = content.split('\n');
    const decorators: string[] = [];
    let body = content;
    /** Set once an escaped or unknown line has been seen, so the next one is not skipped. */
    let sawNonDecorator = false;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';

        if (!line.startsWith('@@')) {
            body = lines.slice(index).join('\n');
            break;
        }

        if (line.startsWith(ESCAPED_PREFIX) && !sawNonDecorator) {
            // Escaped on its own: not a decorator, and not yet a reason to stop.
            continue;
        }

        const candidate = line.startsWith(ESCAPED_PREFIX) ? line.slice(1) : line;
        if (DECORATORS.has(candidate)) {
            decorators.push(candidate);
            sawNonDecorator = false;
            continue;
        }

        sawNonDecorator = true;
    }

    return { decorators, content: body };
}

/** Escape a string so it can be embedded in a regular expression. */
export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface KeyMatchOptions {
    caseSensitive: boolean;
    matchWholeWords: boolean;
}

/** A boundary is any non-word character; a key must not be glued to a letter. */
function wholeWordPattern(key: string): RegExp {
    return new RegExp(`(?:^|\\W)${escapeRegex(key)}(?:$|\\W)`);
}

/**
 * Test one world info key against the scan buffer.
 *
 * A key written as `/pattern/flags` is a regular expression and ignores the
 * case and whole-word options — the pattern carries its own flags, and a
 * regex key that was silently lowercased would not match what its author
 * wrote.
 *
 * A plain key is a substring, which means an empty key matches everything.
 * That is deliberate: an entry whose keys were all blank after trimming still
 * fires, and treating it as "matches nothing" would make it inert without
 * saying so.
 *
 * With whole-word matching on, a single word gets boundary checks on both
 * sides, while a multi-word key is compared as a substring. A phrase is
 * already bounded by its own spaces, so wrapping it in `\W` would only add
 * failure modes at the ends.
 */
export function matchesKey(haystack: string, needle: string, options: KeyMatchOptions): boolean {
    const pattern = parseRegexFromString(needle);
    if (pattern) {
        return pattern.test(haystack);
    }

    const hay = options.caseSensitive ? haystack : haystack.toLowerCase();
    const key = options.caseSensitive ? needle : needle.toLowerCase();

    if (!options.matchWholeWords || /\s/.test(key)) {
        return hay.includes(key);
    }

    return wholeWordPattern(key).test(hay);
}
