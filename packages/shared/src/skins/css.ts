/**
 * A skin's optional stylesheet, checked rather than sanitised.
 *
 * RFC 0007 §`css` says a pack may ship one CSS file and that the loader
 * **refuses** one it cannot verify instead of rewriting it. This is that
 * refusal.
 *
 * The rules exist for one property: **a skin cannot make a request**. A
 * `url("https://tracker/?pack=gr")` tells a third party that a person has this
 * pack, from an app that otherwise makes no request it did not initiate. The
 * CSP added in #192 backs that up at runtime; this is the half that runs before
 * anything is stored, so the person holding the file is told before it installs
 * rather than after.
 */

export interface CssProblem {
    /** 1-based line in the skin's own file, so the author can go to it. */
    line: number;
    message: string;
}

export interface CssCheckResult {
    /** What was wrong, in file order. Empty means the sheet is usable. */
    problems: CssProblem[];
    /**
     * The sheet wrapped in its own scope, ready to insert.
     *
     * `null` when there are problems, or when the sheet is blank.
     */
    scoped: string | null;
}

/** The largest stylesheet a skin may carry. */
export const MAX_SKIN_CSS_BYTES = 64 * 1024;

/**
 * Which URL forms a skin may use.
 *
 * Only `data:` and paths relative to the pack's own media. Anything absolute —
 * `https:`, `//host`, `/absolute`, `file:` — is refused, because those are the
 * forms that leave the machine or the pack. A relative path is rewritten to
 * `url("/api/skins/<id>/media/<path>")` before insertion, so it can only ever
 * resolve inside the skin's own folder.
 *
 * The allowed forms, spelled out:
 *
 * - `data:` — inline, no request.
 * - `images/x.png`, `./images/x.png` — relative to the skin's own folder.
 * - `x.png` — a bare file name, which resolves in the same folder.
 *
 * Everything else is refused. `//host/x` is the case a loose rule gets wrong:
 * it looks like a path and is a host.
 */
const ALLOWED_URL = /^(?:data:|(?:\.\.?\/)?[a-z0-9_-][a-z0-9_.-]*(?:\/[a-z0-9_-][a-z0-9_.-]*)*$)/i;

function lineAt(source: string, index: number): number {
    let line = 1;
    for (let position = 0; position < index && position < source.length; position += 1) {
        if (source[position] === '\n') {
            line += 1;
        }
    }
    return line;
}

/** Find every `url(...)` and check what it points at. */
function checkUrls(source: string, problems: CssProblem[]): void {
    for (const match of source.matchAll(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi)) {
        const target = (match[2] ?? '').trim();
        if (!target) {
            continue;
        }
        if (!ALLOWED_URL.test(target)) {
            problems.push({
                line: lineAt(source, match.index ?? 0),
                message: `url("${target}") would leave the skin's own files. A skin may use a data: URL or a path relative to its media folder.`,
            });
        }
    }
}

/** Cheap brace balance, so an unclosed rule is a line-numbered error. */
function checkBraces(source: string, problems: CssProblem[]): void {
    const stack: number[] = [];
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character === '{') {
            stack.push(index);
        } else if (character === '}') {
            if (stack.length === 0) {
                problems.push({ line: lineAt(source, index), message: 'A closing brace has no opening brace.' });
                return;
            }
            stack.pop();
        }
    }
    const unclosed = stack[0];
    if (unclosed !== undefined) {
        problems.push({ line: lineAt(source, unclosed), message: 'A rule is never closed.' });
    }
}

/** At-rules a skin may not use, and why. */
const FORBIDDEN_AT_RULES: { pattern: RegExp; message: string }[] = [
    {
        pattern: /@import\b/gi,
        message: '@import pulls in a file the skin does not carry. Put the rules in this file instead.',
    },
    {
        pattern: /@namespace\b/gi,
        message: '@namespace changes how every selector in the file is read.',
    },
    {
        pattern: /@font-face\b/gi,
        message: 'A @font-face is a way around the url() rule. Set the font in "tokens.font" as a path instead.',
    },
];

/**
 * Check a skin's stylesheet.
 *
 * Comments are stripped before the checks so a rule named in a comment is not
 * reported as a violation — an author explaining "no @import here" should not
 * be refused for it. The stripped source is what the checks see; the sheet that
 * goes into the document is the original, so an author's formatting survives.
 */
export function checkSkinCss(source: string): CssCheckResult {
    const problems: CssProblem[] = [];

    if (source.length > MAX_SKIN_CSS_BYTES) {
        return {
            problems: [
                {
                    line: 1,
                    message: `A skin stylesheet is capped at ${Math.round(MAX_SKIN_CSS_BYTES / 1024)} KB.`,
                },
            ],
            scoped: null,
        };
    }

    // Strip comments, keeping the newlines so line numbers still line up.
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '));

    for (const rule of FORBIDDEN_AT_RULES) {
        for (const match of withoutComments.matchAll(rule.pattern)) {
            problems.push({ line: lineAt(withoutComments, match.index ?? 0), message: rule.message });
        }
    }

    checkUrls(withoutComments, problems);
    checkBraces(withoutComments, problems);

    if (problems.length > 0) {
        problems.sort((left, right) => left.line - right.line);
        return { problems, scoped: null };
    }

    const trimmed = source.trim();
    if (!trimmed) {
        return { problems: [], scoped: null };
    }

    return { problems: [], scoped: scopedCss(trimmed) };
}

/**
 * Wrap a stylesheet in the skin's scope.
 *
 * The loader writes this rather than trusting the file to be scoped, so a
 * selector naming `html`, `:root` or `body` cannot reach outside the element
 * the app puts it on. A `@media` at the top level would not survive a naive
 * wrap — it would end up inside a selector list — so it is lifted out and
 * re-wrapped around the scope, which is what the author meant.
 *
 * `data-skin` is set by the app on whichever element the skin applies to; for an
 * `app`-scope skin that is `<html>`, which is why the scope selector is written
 * as `[data-skin]` rather than a class the app might rename.
 */
export function scopedCss(source: string, selector = '[data-skin]'): string {
    const blocks: string[] = [];
    let rest = '';
    let cursor = 0;

    for (const match of source.matchAll(/@media[^{]*\{/gi)) {
        const start = match.index ?? 0;
        // Find the matching close brace for this at-rule.
        let depth = 0;
        let end = -1;
        for (let index = start + match[0].length - 1; index < source.length; index += 1) {
            if (source[index] === '{') {
                depth += 1;
            } else if (source[index] === '}') {
                depth -= 1;
                if (depth === 0) {
                    end = index;
                    break;
                }
            }
        }
        if (end < 0) {
            // An unclosed at-rule would have been reported by `checkBraces`;
            // treat the rest of the file as its body rather than dropping it.
            end = source.length - 1;
        }
        const prelude = source.slice(start, start + match[0].length - 1).trim();
        const body = source.slice(start + match[0].length, end);
        blocks.push(`${prelude} {\n${indent(scopedCss(body, selector))}\n}`);
        rest += source.slice(cursor, start);
        cursor = end + 1;
    }
    rest += source.slice(cursor);

    const ordinary = rest.trim();
    const scoped = ordinary ? `${selector} {\n${indent(ordinary)}\n}` : '';
    return [scoped, ...blocks].filter(Boolean).join('\n\n');
}

function indent(value: string): string {
    return value
        .split('\n')
        .map((line) => (line.trim() ? `    ${line}` : line))
        .join('\n');
}

/**
 * Rewrite relative `url()` paths so they resolve against the skin's own folder.
 *
 * Done after the checks, on the already-approved sheet: a `data:` URL is left
 * alone, and a relative one becomes an absolute path under the skin's media
 * route. The route answers 404 outside the folder, so a path that tried to
 * climb out would have nothing to climb to.
 */
export function rewriteSkinUrls(source: string, skinId: string): string {
    return source.replace(/url\(\s*(['"]?)([^'")]*)\1\s*\)/gi, (whole, _quote: string, target: string) => {
        const trimmed = target.trim();
        if (!trimmed || /^data:/i.test(trimmed)) {
            return whole;
        }
        const relative = trimmed.replace(/^\.?\//, '');
        const url = `/api/skins/${encodeURIComponent(skinId)}/media/${relative}`;
        return `url("${url}")`;
    });
}
