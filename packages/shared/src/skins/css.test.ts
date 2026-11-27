import { describe, expect, it } from 'vitest';

import { checkSkinCss, rewriteSkinUrls, scopedCss } from './css.js';

/**
 * The rule this file exists for is one sentence: a skin cannot make a request.
 * Everything below is about refusing the ways a stylesheet would try.
 */

describe('checkSkinCss', () => {
    it('accepts a plain sheet and wraps it in the scope', () => {
        const result = checkSkinCss('.message { color: red; }');
        expect(result.problems).toEqual([]);
        expect(result.scoped).toBe('[data-skin] {\n    .message { color: red; }\n}');
    });

    it('refuses @import, naming the line', () => {
        const result = checkSkinCss('.a { color: red; }\n@import url("x.css");');
        expect(result.problems).toHaveLength(1);
        expect(result.problems[0]?.line).toBe(2);
        expect(result.problems[0]?.message).toMatch(/@import/);
        expect(result.scoped).toBeNull();
    });

    it('refuses a remote url() — the beacon this exists to stop', () => {
        const result = checkSkinCss('.a { background: url("https://tracker.example/?pack=gr"); }');
        expect(result.problems).toHaveLength(1);
        expect(result.problems[0]?.message).toMatch(/would leave the skin/);
    });

    it('refuses a protocol-relative and an absolute url()', () => {
        for (const url of ['//evil.example/x.png', '/etc/passwd', 'file:///c:/secret']) {
            const result = checkSkinCss(`.a { background: url(${url}); }`);
            expect(result.problems.length, url).toBeGreaterThan(0);
        }
    });

    it('allows a data: URL and a path relative to the skin', () => {
        expect(checkSkinCss('.a { background: url(data:image/png;base64,AAA); }').problems).toEqual([]);
        expect(checkSkinCss('.a { background: url(images/paper.png); }').problems).toEqual([]);
        expect(checkSkinCss('.a { background: url("./images/paper.png"); }').problems).toEqual([]);
    });

    it('refuses @font-face, and says what to do instead', () => {
        const result = checkSkinCss('@font-face { font-family: X; src: url(x.woff2); }');
        expect(result.problems.some((problem) => /@font-face/.test(problem.message))).toBe(true);
        expect(result.problems.some((problem) => /tokens\.font/.test(problem.message))).toBe(true);
    });

    it('does not report a rule named in a comment', () => {
        // An author explaining "no @import here" should not be refused for it.
        const result = checkSkinCss('/* we deliberately avoid @import and @font-face */\n.a { color: red; }');
        expect(result.problems).toEqual([]);
        expect(result.scoped).toContain('.a');
    });

    it('reports an unclosed rule with the line it opened on', () => {
        const result = checkSkinCss('.a { color: red;\n');
        expect(result.problems).toHaveLength(1);
        expect(result.problems[0]?.line).toBe(1);
        expect(result.problems[0]?.message).toMatch(/never closed/);
    });

    it('reports a stray closing brace', () => {
        const result = checkSkinCss('.a { color: red; }\n}');
        expect(result.problems[0]?.line).toBe(2);
    });

    it('refuses a sheet past the size cap', () => {
        const result = checkSkinCss('.a{color:red}'.repeat(10_000));
        expect(result.problems[0]?.message).toMatch(/capped/);
    });

    it('returns nothing to insert for a blank sheet', () => {
        expect(checkSkinCss('   \n\n').scoped).toBeNull();
    });
});

describe('scopedCss', () => {
    it('lifts a @media out and wraps the inside, rather than nesting it in a selector', () => {
        const scoped = scopedCss('@media (min-width: 768px) { .a { color: red; } }');
        // A naive wrap would give `[data-skin] { @media … }`, which no browser reads.
        expect(scoped.startsWith('@media (min-width: 768px) {')).toBe(true);
        expect(scoped).toContain('[data-skin]');
        expect(scoped).toContain('.a { color: red; }');
    });

    it('scopes a selector that names html, so it cannot reach outside', () => {
        const scoped = scopedCss('html { background: black; }');
        expect(scoped.startsWith('[data-skin] {')).toBe(true);
        expect(scoped).toContain('html { background: black; }');
    });
});

describe('rewriteSkinUrls', () => {
    it('sends a relative path to the skin’s own media route', () => {
        expect(rewriteSkinUrls('.a { background: url(paper.png); }', 'grimoire-night')).toBe(
            '.a { background: url("/api/skins/grimoire-night/media/paper.png"); }',
        );
    });

    it('leaves a data: URL alone', () => {
        const sheet = '.a { background: url(data:image/png;base64,AAA); }';
        expect(rewriteSkinUrls(sheet, 'x')).toBe(sheet);
    });

    it('encodes an id that needs it', () => {
        expect(rewriteSkinUrls('url(a.png)', 'a b')).toContain('/api/skins/a%20b/media/a.png');
    });
});
