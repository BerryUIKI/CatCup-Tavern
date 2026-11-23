// Written for CatCup. The regex-script engine: which scripts run for a given
// placement and context, and how one script rewrites a string.
//
// The script *fields* are the stored format (`docs/DATA-FORMATS.md`, "Regex
// scripts") and do not change here. What follows is CatCup's own implementation
// of the rules, with the reasoning recorded where it is not self-evident.

import { REGEX_PLACEMENT, type RegexScript, SUBSTITUTE_REGEX } from './schemas/regex.js';

/**
 * Split a `/pattern/flags` string into its source and flags.
 *
 * Returns `null` for anything that is not exactly one delimited pattern, or
 * whose body does not compile. Every caller treats `null` as "not a regex":
 * a world info key becomes literal text, and a script is skipped. That is why
 * this function never throws — a malformed script must not break a generation.
 *
 * The grammar, in order:
 *
 * - The whole string must be delimited. `^\/([\w\W]+?)\/([gimsuy]*)$` means a
 *   leading `/`, at least one character of body (`//` is not a pattern), a
 *   trailing `/`, then only the flags JavaScript knows. Anything either side
 *   of that is not a regex.
 * - An unescaped `/` inside the body is rejected. The test is a one-character
 *   lookback for a backslash, so a body containing `\\/` (an escaped backslash
 *   followed by a slash) parses even though the slash is not really escaped.
 *   That is left as-is on purpose: the lookback is what makes `/a\/b/` work,
 *   and tightening it would reject patterns people write.
 * - Exactly one `\/` is unescaped to `/` before compiling, the first only. The
 *   remaining ones are legal inside a `RegExp` source, so a global replace is
 *   unnecessary and would change the meaning of a doubled escape.
 *
 * A fresh `RegExp` is returned on every call and nothing is cached. That is
 * load-bearing: a shared `/g` regex would carry `lastIndex` between calls.
 */
export function parseRegexParts(input: string): { source: string; flags: string } | null {
    const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null;
    }

    const [, body, flags] = match;
    const source = body ?? '';

    // An unescaped delimiter inside the body is not a regex to any engine.
    if (/(^|[^\\])\//.test(source)) {
        return null;
    }

    try {
        new RegExp(source.replace('\\/', '/'), flags);
    } catch {
        return null;
    }

    return { source, flags: flags ?? '' };
}

/**
 * Build a `RegExp` from a slash-delimited string such as `/dragon|wyrm/i`.
 *
 * Returns `null` when `parseRegexParts` rejects the string, so a malformed
 * script is skipped rather than throwing during a generation.
 */
export function parseRegexFromString(input: string): RegExp | null {
    const parts = parseRegexParts(input);
    if (!parts) {
        return null;
    }
    return new RegExp(parts.source.replace('\\/', '/'), parts.flags);
}

/**
 * Escape a macro value so it can be pasted into a regex pattern.
 *
 * Used by `substituteRegex: ESCAPED`, which lets a macro such as `{{char}}`
 * match literally instead of acting as pattern syntax.
 *
 * The character set is deliberate and should not be "tidied":
 *
 * - The five whitespace controls and NUL become their two-character escapes,
 *   which is what a pattern needs to match them.
 * - Every regex metacharacter is backslash-escaped, including `/` — that is
 *   what lets a value containing a slash go inside a slash-delimited pattern
 *   without terminating it early.
 * - `-` is *not* escaped. Outside a character class it needs no escape, and
 *   `\-` throws under the `u` flag, so escaping it for symmetry would break
 *   every `/u` script whose macro value contains a hyphen.
 */
export function sanitizeRegexMacro(value: string): string {
    return value.replaceAll(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, (char) => {
        switch (char) {
            case '\n':
                return '\\n';
            case '\r':
                return '\\r';
            case '\t':
                return '\\t';
            case '\v':
                return '\\v';
            case '\f':
                return '\\f';
            case '\0':
                return '\\0';
            default:
                return `\\${char}`;
        }
    });
}

export interface RegexContext {
    /** The text is being rendered in the chat view. */
    isMarkdown?: boolean;
    /** The text is being placed in a prompt. */
    isPrompt?: boolean;
    /** The text is a message being edited. */
    isEdit?: boolean;
    /** Distance from the end of the conversation, where 0 is the newest message. */
    depth?: number;
    /**
     * Macro expansion applied to `findRegex`, `replaceString` and trim strings.
     *
     * `escape` is true only while preparing the find pattern for
     * `substituteRegex: ESCAPED`. It escapes the macro *values* rather than the
     * finished pattern, because escaping the pattern would also escape its `/`
     * delimiters and it would stop being a regex at all.
     *
     * Defaults to identity, which is what the browser render path uses when it
     * has no character context to expand.
     */
    substitute?: (text: string, escapeValues: boolean) => string;
}

const identity = (text: string) => text;

/**
 * Whether a script runs for this placement and context.
 *
 * Three gates, in this order — the order matters only for cost, since every
 * gate is side-effect free:
 *
 * 1. **Disabled** scripts never run.
 * 2. **Scope.** A `markdownOnly` script runs only while rendering; a
 *    `promptOnly` script only while building a prompt; a script with neither
 *    runs only at the source — when a message is stored — because the stored
 *    text is what both the prompt and the view read afterwards. The comparisons
 *    are `=== true` on purpose: a truthy non-boolean must not activate a
 *    markdown-only script, and must not suppress a plain one either.
 * 3. **Editing.** A script marked `runOnEdit: false` is skipped while editing.
 *
 * The depth window is checked next, and only when both the caller supplied a
 * depth and the bound is usable:
 *
 * - `minDepth` applies when it is not null, finite, and `>= -1`. The `-1`
 *   floor is how the format says "no minimum"; a value below it is nonsense and
 *   is ignored rather than clamping everything off.
 * - `maxDepth` applies when it is not null, finite, and `>= 0`.
 *
 * The placement check comes last: a script runs only where it is listed.
 */
export function shouldRunRegexScript(script: RegexScript, placement: number, options: RegexContext = {}): boolean {
    if (script.disabled) {
        return false;
    }

    const { isMarkdown, isPrompt, isEdit, depth } = options;

    const rendersOnly = script.markdownOnly === true;
    const promptsOnly = script.promptOnly === true;
    const atSource = !rendersOnly && !promptsOnly;

    const inScope =
        (rendersOnly && isMarkdown === true) ||
        (promptsOnly && isPrompt === true) ||
        (atSource && isMarkdown !== true && isPrompt !== true);

    if (!inScope) {
        return false;
    }

    if (isEdit === true && !script.runOnEdit) {
        return false;
    }

    if (typeof depth === 'number') {
        const { minDepth, maxDepth } = script;
        if (minDepth !== null && Number.isFinite(minDepth) && minDepth >= -1 && depth < minDepth) {
            return false;
        }
        if (maxDepth !== null && Number.isFinite(maxDepth) && maxDepth >= 0 && depth > maxDepth) {
            return false;
        }
    }

    return script.placement.includes(placement);
}

/** Remove every configured trim string from a match. */
function filterString(
    raw: string,
    trimStrings: readonly string[],
    substitute: (text: string, escapeValues: boolean) => string,
): string {
    let result = raw;
    for (const trimString of trimStrings) {
        const needle = substitute(trimString, false);
        if (needle) {
            result = result.replaceAll(needle, '');
        }
    }
    return result;
}

/** `$1`, `$12` or `$<name>` — the only `$` forms this engine expands. */
const CAPTURE_REFERENCE = /\$(\d+)|\$<([^>]+)>/g;

/**
 * Run one script over a string.
 *
 * Returns the input unchanged — by reference, not a copy — when the script is
 * disabled, has no pattern, or the text is empty. Callers rely on that: the
 * editor preview shows a disabled script's text verbatim.
 *
 * The replacement is expanded in this order, which is what makes `{{match}}`
 * and `$1` compose:
 *
 * 1. `{{match}}` becomes `$0`, so it means the whole match like `$0` does.
 * 2. `$1`, `$2` and `$<name>` are replaced by their capture group, each passed
 *    through the trim filter. A group that did not participate, or a name the
 *    pattern does not define, yields an empty string.
 * 3. The result is macro-expanded once, last.
 *
 * Expansion is single-pass: a `$1` that arrives inside a capture value is never
 * expanded again. Any other `$` form — `$&`, `$$`, a lone `$` — is left
 * literal, because the replacer above only recognises the two shapes in
 * `CAPTURE_REFERENCE` and never lets the engine expand them.
 *
 * The find pattern is macro-expanded *before* it is parsed, so a `substitute`
 * with side effects runs even when the resulting pattern turns out to be
 * unparseable. That is harmless — the text is returned unchanged — but it means
 * substitution cannot be made lazy without changing when a caller's function
 * is called.
 */
export function runRegexScript(script: RegexScript, raw: string, options: RegexContext = {}): string {
    if (script.disabled || !script.findRegex || !raw) {
        return raw;
    }

    const substitute = options.substitute ?? ((text: string) => identity(text));

    const pattern =
        script.substituteRegex === SUBSTITUTE_REGEX.RAW
            ? substitute(script.findRegex, false)
            : script.substituteRegex === SUBSTITUTE_REGEX.ESCAPED
              ? substitute(script.findRegex, true)
              : script.findRegex;

    const regex = parseRegexFromString(pattern);
    if (!regex) {
        return raw;
    }

    const template = script.replaceString.replace(/{{match}}/gi, '$0');

    return raw.replace(regex, (...args: unknown[]) => {
        const replaced = template.replaceAll(CAPTURE_REFERENCE, (_whole, number: string, groupName: string) => {
            let value: unknown;
            if (number) {
                value = args[Number(number)];
            } else if (groupName) {
                // Named groups are the last argument of the replacer.
                const groups = args[args.length - 1];
                value =
                    groups && typeof groups === 'object' ? (groups as Record<string, string>)[groupName] : undefined;
            }

            if (typeof value !== 'string' || !value) {
                return '';
            }

            return filterString(value, script.trimStrings, substitute);
        });

        return substitute(replaced, false);
    });
}

/**
 * Apply every script that matches, in order.
 *
 * Each passing script sees the output of the previous one, and the same options
 * object is handed to the gate and to the run, so the depth that admitted a
 * script is the depth it ran at.
 *
 * A non-string or empty input is returned by reference, so `null`,
 * `undefined` and `''` pass through rather than throwing.
 */
export function applyRegexScripts(
    scripts: readonly RegexScript[],
    raw: string,
    placement: number,
    options: RegexContext = {},
): string {
    if (typeof raw !== 'string' || raw === '') {
        return raw;
    }

    let result = raw;
    for (const script of scripts) {
        if (shouldRunRegexScript(script, placement, options)) {
            result = runRegexScript(script, result, options);
        }
    }
    return result;
}

/** The placement a message's own text sits at, by whether its author is the user. */
export function regexPlacementForMessage(isUser: boolean): number {
    return isUser ? REGEX_PLACEMENT.USER_INPUT : REGEX_PLACEMENT.AI_OUTPUT;
}
