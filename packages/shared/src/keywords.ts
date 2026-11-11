// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/world-info.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

/** Does `input` parse as a `/pattern/flags` regular expression? */
export function isValidRegex(input: string): boolean {
    const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return false;
    }

    const pattern = match[1] as string;
    // An unescaped delimiter inside the pattern would not be a regex to any
    // other engine, so SillyTavern rejects it too.
    if (/(^|[^\\])\//.test(pattern)) {
        return false;
    }

    try {
        new RegExp(pattern.replace('\\/', '/'), match[2]);
        return true;
    } catch {
        return false;
    }
}

/**
 * Split a comma-separated keyword field into individual keys.
 *
 * Ported from SillyTavern's `splitKeywordsAndRegexes`. A `/pattern/flags` key
 * is a regular expression, and commas inside one belong to the pattern rather
 * than separating keys, so `/dragon|wyrm, wyrmling/i` stays one key. A
 * slash-delimited token that does not parse as a regex is split on its commas
 * like ordinary text.
 *
 * SillyTavern's loop restarts one character late after every split, so a key
 * that begins immediately after a comma with a slash is misread; this port
 * resumes at the start of the remaining text instead.
 */
export function splitKeywordsAndRegexes(input: string): string[] {
    const keywords: string[] = [];
    const push = (value: string) => {
        const trimmed = value.trim();
        if (trimmed) {
            keywords.push(trimmed);
        }
    };

    let current = input;
    let insideRegex = false;
    let regexClosed = false;

    for (let index = 0; index < current.length; index += 1) {
        const char = current[index];

        if (char === '/' && (index === 0 || current[index - 1] !== '\\')) {
            if (!insideRegex) {
                insideRegex = true;
            } else if (!regexClosed) {
                regexClosed = true;
            }
        }

        if (char !== ',') {
            continue;
        }

        const token = current.slice(0, index).trim();

        // A comma inside an unterminated `/.../` is part of the pattern.
        if (insideRegex && !regexClosed) {
            continue;
        }

        if (token) {
            if (token.startsWith('/') && !isValidRegex(token)) {
                for (const part of token.split(',')) {
                    push(part);
                }
            } else {
                push(token);
            }
        }

        current = current.slice(index + 1);
        insideRegex = false;
        regexClosed = false;
        index = -1;
    }

    push(current);
    return keywords;
}

/** Render a key list the way SillyTavern's editor displays it. */
export function formatKeywords(keys: readonly string[]): string {
    return keys.join(', ');
}
