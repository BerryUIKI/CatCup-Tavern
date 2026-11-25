// Written for CatCup. The `/pattern/flags` grammar this module needs lives in
// `regex.ts`; there is one implementation and this is a caller of it.

import { parseRegexParts } from './regex.js';

/**
 * Does `input` parse as a `/pattern/flags` regular expression?
 *
 * Delegates to the regex engine's own parser rather than carrying a second copy
 * of the grammar. The two have to agree: a key the splitter treats as a regex
 * and the engine then refuses to parse would silently become literal text, and
 * the only way to keep them agreeing is to have one implementation of it.
 */
export function isValidRegex(input: string): boolean {
    return parseRegexParts(input) !== null;
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

/** Render a key list the way the editor displays it. */
export function formatKeywords(keys: readonly string[]): string {
    return keys.join(', ');
}
