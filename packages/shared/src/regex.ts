// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/extensions/regex/engine.js
// Ported to TypeScript without DOM or global state. See docs/REUSE.md.

import { REGEX_PLACEMENT, type RegexScript, SUBSTITUTE_REGEX } from './schemas/regex.js';

/**
 * Build a `RegExp` from a slash-delimited string such as `/dragon|wyrm/i`.
 *
 * Returns `null` for anything that is not a well-formed delimited regex, so a
 * malformed script is skipped rather than throwing during a generation.
 */
export function parseRegexFromString(input: string): RegExp | null {
    const match = input.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null;
    }

    const [, pattern, flags] = match;
    // An unescaped delimiter inside the pattern is not a regex to any other
    // engine, and SillyTavern rejects it too.
    if (pattern?.match(/(^|[^\\])\//)) {
        return null;
    }

    try {
        return new RegExp((pattern ?? '').replace('\\/', '/'), flags);
    } catch {
        return null;
    }
}

/**
 * Escape a macro value so it can be pasted into a regex pattern.
 *
 * Used by `substituteRegex: ESCAPED`, which lets a macro such as `{{char}}`
 * match literally instead of acting as pattern syntax.
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
     * `substituteRegex: ESCAPED`, where SillyTavern escapes the macro *values*
     * rather than the whole pattern — escaping the pattern would also escape
     * its `/` delimiters and stop it being a regex at all.
     *
     * Defaults to identity, which is what the browser-side render path uses
     * when it has no character context.
     */
    substitute?: (text: string, escapeValues: boolean) => string;
}

const identity = (text: string) => text;

/**
 * Whether a script runs for this placement and context.
 *
 * The three-way condition is SillyTavern's: a script marked `markdownOnly` runs
 * only when rendering, one marked `promptOnly` only when prompting, and one
 * with neither runs only at the source — when a message is stored — because the
 * stored text is what the prompt and the view both read afterwards.
 */
export function shouldRunRegexScript(script: RegexScript, placement: number, options: RegexContext = {}): boolean {
    if (script.disabled) {
        return false;
    }

    const { isMarkdown, isPrompt, isEdit, depth } = options;

    const inScope =
        (script.markdownOnly && isMarkdown === true) ||
        (script.promptOnly && isPrompt === true) ||
        (!script.markdownOnly && !script.promptOnly && isMarkdown !== true && isPrompt !== true);

    if (!inScope) {
        return false;
    }

    if (isEdit === true && !script.runOnEdit) {
        return false;
    }

    if (typeof depth === 'number') {
        if (
            script.minDepth !== null &&
            Number.isFinite(script.minDepth) &&
            script.minDepth >= -1 &&
            depth < script.minDepth
        ) {
            return false;
        }
        if (
            script.maxDepth !== null &&
            Number.isFinite(script.maxDepth) &&
            script.maxDepth >= 0 &&
            depth > script.maxDepth
        ) {
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

/**
 * Run one script over a string.
 *
 * `{{match}}` and `$0` both mean the whole match. `$1`, `$2` and `$<name>`
 * pull capture groups through the trim filter before they are inserted; the
 * replacement text is macro-expanded last, as SillyTavern does.
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
        const withGroups = template.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_whole, number: string, groupName: string) => {
            let value: unknown;
            if (number) {
                value = args[Number(number)];
            } else if (groupName) {
                const groups = args[args.length - 1];
                value =
                    groups && typeof groups === 'object' ? (groups as Record<string, string>)[groupName] : undefined;
            }

            if (typeof value !== 'string' || !value) {
                return '';
            }

            return filterString(value, script.trimStrings, substitute);
        });

        return substitute(withGroups, false);
    });
}

/**
 * Apply every script that matches, in order.
 *
 * SillyTavern orders global scripts first, then preset, then character-scoped;
 * the caller passes the list already in that order and each script sees the
 * output of the previous one.
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

/** Convenience wrappers for the two placements that read a message. */
export function regexPlacementForMessage(isUser: boolean): number {
    return isUser ? REGEX_PLACEMENT.USER_INPUT : REGEX_PLACEMENT.AI_OUTPUT;
}
