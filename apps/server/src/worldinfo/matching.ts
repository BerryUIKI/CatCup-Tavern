// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/world-info.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

/** Decorators SillyTavern recognises at the top of an entry's content. */
const KNOWN_DECORATORS = ['@@activate', '@@dont_activate'] as const;

function isKnownDecorator(line: string): boolean {
    const candidate = line.startsWith('@@@') ? line.slice(1) : line;
    return KNOWN_DECORATORS.some((decorator) => candidate.startsWith(decorator));
}

/**
 * Split leading `@@decorator` lines from an entry's content.
 *
 * Mirrors SillyTavern's `parseDecorators`: a run of known decorator lines is
 * consumed, unknown lines end the run, and `@@@` escapes a decorator so it is
 * kept as content.
 */
export function parseDecorators(content: string): { decorators: string[]; content: string } {
    if (!content.startsWith('@@')) {
        return { decorators: [], content };
    }

    const lines = content.split('\n');
    const decorators: string[] = [];
    let remaining = content;
    let fallbacked = false;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (!line.startsWith('@@')) {
            remaining = lines.slice(index).join('\n');
            break;
        }

        if (line.startsWith('@@@') && !fallbacked) {
            continue;
        }

        if (isKnownDecorator(line)) {
            decorators.push(line.startsWith('@@@') ? line.slice(1) : line);
            fallbacked = false;
            continue;
        }

        fallbacked = true;
    }

    return { decorators, content: remaining };
}

/**
 * Build a `RegExp` from a slash-delimited string such as `/dragon|wyrm/i`.
 *
 * Returns `null` for anything that is not a well-formed delimited regex, so
 * plain keyword entries fall through to substring matching.
 */
export function parseRegexFromString(input: string): RegExp | null {
    const match = input.match(/^\/([\s\S]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null;
    }

    const [, pattern, flags] = match;
    if (pattern === undefined || flags === undefined) {
        return null;
    }

    // An unescaped delimiter means this is not a regex after all; every other
    // engine would reject it, so treat it as a plain key.
    if (/(^|[^\\])\//.test(pattern)) {
        return null;
    }

    try {
        return new RegExp(pattern.replace('\\/', '/'), flags);
    } catch {
        return null;
    }
}

/** Escape a string so it can be embedded in a regular expression. */
export function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface KeyMatchOptions {
    caseSensitive: boolean;
    matchWholeWords: boolean;
}

/**
 * Test one world info key against the scan buffer.
 *
 * A key written as `/regex/flags` is applied as a regular expression and
 * overrides the plain-text options, exactly as SillyTavern does.
 */
export function matchesKey(haystack: string, needle: string, options: KeyMatchOptions): boolean {
    const pattern = parseRegexFromString(needle);
    if (pattern) {
        return pattern.test(haystack);
    }

    const hay = options.caseSensitive ? haystack : haystack.toLowerCase();
    const key = options.caseSensitive ? needle : needle.toLowerCase();
    if (!key) {
        return false;
    }

    if (!options.matchWholeWords) {
        return hay.includes(key);
    }

    // Multi-word keys are matched as a plain substring; single words get
    // boundary checks that include punctuation and other non-word characters.
    if (/\s/.test(key)) {
        return hay.includes(key);
    }

    return new RegExp(`(?:^|\\W)(${escapeRegex(key)})(?:$|\\W)`).test(hay);
}
