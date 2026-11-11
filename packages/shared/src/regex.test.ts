import { describe, expect, it } from 'vitest';

import {
    applyRegexScripts,
    parseRegexFromString,
    runRegexScript,
    sanitizeRegexMacro,
    shouldRunRegexScript,
} from './regex.js';
import { REGEX_PLACEMENT, type RegexScript, regexScriptSchema, SUBSTITUTE_REGEX } from './schemas/regex.js';

function script(overrides: Partial<RegexScript> = {}): RegexScript {
    return {
        id: 'test',
        scriptName: 'test',
        findRegex: '/foo/g',
        replaceString: 'bar',
        trimStrings: [],
        placement: [REGEX_PLACEMENT.AI_OUTPUT],
        disabled: false,
        markdownOnly: false,
        promptOnly: false,
        runOnEdit: false,
        substituteRegex: SUBSTITUTE_REGEX.NONE,
        minDepth: null,
        maxDepth: null,
        ...overrides,
    };
}

describe('parseRegexFromString', () => {
    it('parses a delimited pattern and its flags', () => {
        const regex = parseRegexFromString('/dragon/gi');
        expect(regex).toBeInstanceOf(RegExp);
        expect(regex?.flags).toContain('g');
        expect(regex?.flags).toContain('i');
        expect(regex?.test('DRAGON')).toBe(true);
    });

    it('unescapes an escaped delimiter inside the pattern', () => {
        expect(parseRegexFromString('/a\\/b/')?.test('a/b')).toBe(true);
    });

    it('rejects an unescaped delimiter inside the pattern', () => {
        expect(parseRegexFromString('/a/b/')).toBeNull();
    });

    it('rejects text that is not delimited and patterns that do not compile', () => {
        expect(parseRegexFromString('dragon')).toBeNull();
        expect(parseRegexFromString('/(/')).toBeNull();
    });
});

describe('runRegexScript', () => {
    it('replaces every match of a global pattern', () => {
        expect(runRegexScript(script(), 'foo foo')).toBe('bar bar');
    });

    it('supports capture groups, named groups and {{match}}', () => {
        expect(runRegexScript(script({ findRegex: '/(\\w+)@(\\w+)/', replaceString: '$1 at $2' }), 'me@home')).toBe(
            'me at home',
        );
        expect(runRegexScript(script({ findRegex: '/(?<user>\\w+)@/', replaceString: 'by $<user>' }), 'me@home')).toBe(
            'by mehome',
        );
        expect(runRegexScript(script({ findRegex: '/foo/', replaceString: '[{{match}}]' }), 'a foo b')).toBe(
            'a [foo] b',
        );
        expect(runRegexScript(script({ findRegex: '/foo/', replaceString: '[$0]' }), 'a foo b')).toBe('a [foo] b');
    });

    it('drops a missing group instead of writing undefined', () => {
        expect(runRegexScript(script({ findRegex: '/foo(x)?/', replaceString: 'bar$1' }), 'foo')).toBe('bar');
    });

    it('removes trim strings from inserted groups', () => {
        const result = runRegexScript(
            script({ findRegex: '/\\[(.*?)\\]/', replaceString: '$1', trimStrings: ['think:'] }),
            '[think: hello]',
        );
        expect(result).toBe(' hello');
    });

    it('leaves the text alone when the pattern is invalid', () => {
        expect(runRegexScript(script({ findRegex: 'not a regex' }), 'foo')).toBe('foo');
    });

    it('leaves the text alone when the script is disabled or empty', () => {
        expect(runRegexScript(script({ disabled: true }), 'foo')).toBe('foo');
        expect(runRegexScript(script({ findRegex: '' }), 'foo')).toBe('foo');
        expect(runRegexScript(script(), '')).toBe('');
    });

    it('expands macros in the replacement', () => {
        const result = runRegexScript(script({ replaceString: '{{char}}' }), 'foo', {
            substitute: (text) => text.replace('{{char}}', 'Seraphina'),
        });
        expect(result).toBe('Seraphina');
    });

    it('substitutes and escapes the pattern for substituteRegex ESCAPED', () => {
        const options = {
            substitute: (text: string, escapeValues: boolean) =>
                text.replace('{{name}}', escapeValues ? sanitizeRegexMacro('a.b') : 'a.b'),
        };
        const raw = script({ findRegex: '/{{name}}/', replaceString: 'X', substituteRegex: SUBSTITUTE_REGEX.RAW });
        const escaped = script({
            findRegex: '/{{name}}/',
            replaceString: 'X',
            substituteRegex: SUBSTITUTE_REGEX.ESCAPED,
        });

        // Raw treats the macro value as pattern syntax, so `a.b` also matches `axb`.
        expect(runRegexScript(raw, 'axb', options)).toBe('X');
        // Escaped makes it a literal, so only the exact text matches.
        expect(runRegexScript(escaped, 'axb', options)).toBe('axb');
        expect(runRegexScript(escaped, 'a.b', options)).toBe('X');
    });
});

describe('shouldRunRegexScript', () => {
    it('runs a plain script only at the source, not for prompts or markdown', () => {
        const plain = script();
        expect(shouldRunRegexScript(plain, REGEX_PLACEMENT.AI_OUTPUT, {})).toBe(true);
        expect(shouldRunRegexScript(plain, REGEX_PLACEMENT.AI_OUTPUT, { isPrompt: true })).toBe(false);
        expect(shouldRunRegexScript(plain, REGEX_PLACEMENT.AI_OUTPUT, { isMarkdown: true })).toBe(false);
    });

    it('runs a promptOnly script only for prompts', () => {
        const promptOnly = script({ promptOnly: true });
        expect(shouldRunRegexScript(promptOnly, REGEX_PLACEMENT.AI_OUTPUT, { isPrompt: true })).toBe(true);
        expect(shouldRunRegexScript(promptOnly, REGEX_PLACEMENT.AI_OUTPUT, {})).toBe(false);
        expect(shouldRunRegexScript(promptOnly, REGEX_PLACEMENT.AI_OUTPUT, { isMarkdown: true })).toBe(false);
    });

    it('runs a markdownOnly script only when rendering', () => {
        const markdownOnly = script({ markdownOnly: true });
        expect(shouldRunRegexScript(markdownOnly, REGEX_PLACEMENT.AI_OUTPUT, { isMarkdown: true })).toBe(true);
        expect(shouldRunRegexScript(markdownOnly, REGEX_PLACEMENT.AI_OUTPUT, {})).toBe(false);
    });

    it('skips scripts whose placement does not match', () => {
        expect(shouldRunRegexScript(script(), REGEX_PLACEMENT.USER_INPUT, {})).toBe(false);
    });

    it('skips scripts that do not run on edit', () => {
        expect(shouldRunRegexScript(script(), REGEX_PLACEMENT.AI_OUTPUT, { isEdit: true })).toBe(false);
        expect(shouldRunRegexScript(script({ runOnEdit: true }), REGEX_PLACEMENT.AI_OUTPUT, { isEdit: true })).toBe(
            true,
        );
    });

    it('honors the depth window', () => {
        const limited = script({ minDepth: 1, maxDepth: 3 });
        expect(shouldRunRegexScript(limited, REGEX_PLACEMENT.AI_OUTPUT, { depth: 0 })).toBe(false);
        expect(shouldRunRegexScript(limited, REGEX_PLACEMENT.AI_OUTPUT, { depth: 2 })).toBe(true);
        expect(shouldRunRegexScript(limited, REGEX_PLACEMENT.AI_OUTPUT, { depth: 4 })).toBe(false);
    });

    it('ignores depth limits when no depth is given', () => {
        expect(shouldRunRegexScript(script({ minDepth: 5, maxDepth: 6 }), REGEX_PLACEMENT.AI_OUTPUT, {})).toBe(true);
    });

    it('skips disabled scripts', () => {
        expect(shouldRunRegexScript(script({ disabled: true }), REGEX_PLACEMENT.AI_OUTPUT, {})).toBe(false);
    });
});

describe('applyRegexScripts', () => {
    it('chains scripts in order', () => {
        const scripts = [
            script({ findRegex: '/foo/', replaceString: 'bar' }),
            script({ findRegex: '/bar/', replaceString: 'baz' }),
        ];
        expect(applyRegexScripts(scripts, 'foo', REGEX_PLACEMENT.AI_OUTPUT)).toBe('baz');
    });

    it('returns the input when no script matches', () => {
        expect(applyRegexScripts([script()], 'foo', REGEX_PLACEMENT.USER_INPUT)).toBe('foo');
        expect(applyRegexScripts([], 'foo', REGEX_PLACEMENT.AI_OUTPUT)).toBe('foo');
    });
});

describe('sanitizeRegexMacro', () => {
    it('escapes every regex metacharacter', () => {
        expect(sanitizeRegexMacro('a.b*c')).toBe('a\\.b\\*c');
        expect(sanitizeRegexMacro('line\nbreak')).toBe('line\\nbreak');
    });
});

describe('regex script schema', () => {
    it('fills the SillyTavern defaults for a bare script', () => {
        const parsed = regexScriptSchema.parse({ id: 'a', findRegex: '/x/', replaceString: 'y' });

        expect(parsed.placement).toEqual([]);
        expect(parsed.trimStrings).toEqual([]);
        expect(parsed.substituteRegex).toBe(SUBSTITUTE_REGEX.NONE);
        expect(parsed.minDepth).toBeNull();
        expect(parsed.maxDepth).toBeNull();
        expect(parsed.disabled).toBe(false);
        expect(parsed.markdownOnly).toBe(false);
        expect(parsed.promptOnly).toBe(false);
    });

    it('keeps unknown fields from a newer SillyTavern', () => {
        const parsed = regexScriptSchema.parse({ id: 'a', findRegex: '/x/', replaceString: 'y', somethingNew: 1 });

        expect((parsed as Record<string, unknown>).somethingNew).toBe(1);
    });
});
