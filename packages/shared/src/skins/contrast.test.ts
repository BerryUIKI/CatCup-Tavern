import { describe, expect, it } from 'vitest';
import { SKIN_CONTRAST_PAIRS, SKIN_TOKENS, SKIN_VARIABLES, skinManifestSchema } from '../schemas/skin.js';
import {
    BUILTIN_COLORS,
    checkSkin,
    contrastRatio,
    effectiveColors,
    parseColor,
    skinCustomProperties,
    unknownTokenNames,
} from './contrast.js';

describe('parseColor', () => {
    it('reads the three hex forms a skin is likely to use', () => {
        expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
        expect(parseColor('#1b1410')).toEqual({ r: 27, g: 20, b: 16 });
        expect(parseColor('#1b1410ff')).toEqual({ r: 27, g: 20, b: 16 });
    });

    it('reads rgb() with commas and with spaces', () => {
        expect(parseColor('rgb(27, 20, 16)')).toEqual({ r: 27, g: 20, b: 16 });
        expect(parseColor('rgb(27 20 16)')).toEqual({ r: 27, g: 20, b: 16 });
    });

    it('returns null for a syntax it cannot read rather than guessing', () => {
        expect(parseColor('oklch(0.3 0.02 40)')).toBeNull();
        expect(parseColor('var(--color-ink)')).toBeNull();
        expect(parseColor('')).toBeNull();
        expect(parseColor(undefined)).toBeNull();
    });
});

describe('contrastRatio', () => {
    it('reproduces the numbers docs/DESIGN.md quotes for the built-in palette', () => {
        // These are the measured values the design document states; if the
        // arithmetic drifts, the document and the checker stop agreeing.
        expect(contrastRatio(BUILTIN_COLORS.wine, BUILTIN_COLORS.surface)).toBeCloseTo(2.24, 1);
        expect(contrastRatio(BUILTIN_COLORS.danger, BUILTIN_COLORS.surface)).toBeCloseTo(6.81, 1);
        expect(contrastRatio(BUILTIN_COLORS.muted, BUILTIN_COLORS.surface)).toBeCloseTo(4.81, 1);
        expect(contrastRatio(BUILTIN_COLORS.parchment, BUILTIN_COLORS.surface)).toBeCloseTo(14.87, 1);
    });

    it('is symmetric and reaches 21:1 for black on white', () => {
        expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
    });

    it('is null when either side is unreadable', () => {
        expect(contrastRatio('oklch(0.3 0.02 40)', '#000')).toBeNull();
    });
});

describe('checkSkin', () => {
    const pairs = [
        { text: 'muted', background: 'surface' },
        { text: 'danger', background: 'surface' },
    ];

    it('passes the built-in palette for the pairs the app actually paints', () => {
        const result = checkSkin({}, SKIN_CONTRAST_PAIRS);
        // Every pair the app draws with today clears the floor except the ones
        // deliberately excluded from the list — `wine` is a fill, not text.
        expect(result.findings).toEqual([]);
    });

    it('reports a pair under the floor with its ratio, worst first', () => {
        const result = checkSkin({ color: { muted: '#3a3a3a', danger: '#3b3b3b' } }, pairs);
        expect(result.findings).toHaveLength(2);
        expect(result.findings[0]?.ratio).toBeLessThan(result.findings[1]?.ratio);
        expect(result.findings[0]?.foreground).toBe('--color-muted');
    });

    it('separates unreadable pairs from failing ones', () => {
        const result = checkSkin({ color: { muted: 'oklch(0.4 0.02 40)' } }, pairs);
        expect(result.findings.some((finding) => finding.foreground === '--color-muted')).toBe(false);
        expect(result.unreadable).toContain('--color-muted on --color-surface');
    });

    it('falls back to the built-in colour for a token the skin does not set', () => {
        const result = checkSkin({ color: { amber: '#000000' } }, [{ text: 'muted', background: 'surface' }]);
        expect(result.findings).toEqual([]);
        expect(effectiveColors({ color: { amber: '#000000' } }).amber).toBe('#000000');
        expect(effectiveColors({ color: { amber: '#000000' } }).muted).toBe(BUILTIN_COLORS.muted);
    });
});

describe('unknownTokenNames', () => {
    it('names a token the app does not declare', () => {
        expect(unknownTokenNames({ color: { surfce: '#000' } })).toEqual(['--color-surfce']);
    });

    it('accepts every token on the whitelist', () => {
        const all = Object.fromEntries(
            Object.entries(SKIN_TOKENS).map(([group, names]) => [
                group,
                Object.fromEntries(names.map((name) => [name, '#000000'])),
            ]),
        );
        expect(unknownTokenNames(all)).toEqual([]);
    });

    it('flags an unknown group', () => {
        expect(unknownTokenNames({ colr: { ink: '#000' } })).toEqual(['--colr.*']);
    });
});

describe('skinCustomProperties', () => {
    it('flattens groups into custom properties', () => {
        expect(skinCustomProperties({ tokens: { color: { ink: '#000' }, radius: { xl: '10px' } } })).toEqual({
            '--color-ink': '#000',
            '--radius-xl': '10px',
        });
    });

    it('treats spacing as one property, not a group', () => {
        expect(skinCustomProperties({ tokens: { spacing: '0.2rem' } })).toEqual({ '--spacing': '0.2rem' });
    });

    it('skips an empty value rather than emitting a property that clears it', () => {
        expect(skinCustomProperties({ tokens: { color: { ink: '' } } })).toEqual({});
    });
});

describe('skinManifestSchema', () => {
    const base = { format: 'catcup.skin', formatVersion: 1 };

    it('defaults scope to app and colorScheme to dark', () => {
        const parsed = skinManifestSchema.parse(base);
        expect(parsed.scope).toBe('app');
        expect(parsed.colorScheme).toBe('dark');
    });

    it('refuses a token the app does not declare, by name', () => {
        const result = skinManifestSchema.safeParse({ ...base, tokens: { color: { surfce: '#000' } } });
        expect(result.success).toBe(false);
        expect(JSON.stringify(result.error)).toContain('surfce');
    });

    it('refuses a token value that could escape its declaration', () => {
        for (const value of ['#000; } body { color: red', 'url(https://example.com/x.png)', '<script>']) {
            const result = skinManifestSchema.safeParse({ ...base, tokens: { color: { ink: value } } });
            expect(result.success).toBe(false);
        }
    });

    it('accepts a colour syntax it does not model, because CSS will', () => {
        const parsed = skinManifestSchema.parse({ ...base, tokens: { color: { amber: 'oklch(0.72 0.11 70)' } } });
        expect(parsed.tokens.color?.amber).toBe('oklch(0.72 0.11 70)');
    });

    it('refuses a format this schema does not own', () => {
        expect(skinManifestSchema.safeParse({ format: 'catcup.game', formatVersion: 1 }).success).toBe(false);
    });

    it('keeps an unknown top-level field, which is how a newer format stays readable', () => {
        const parsed = skinManifestSchema.parse({ ...base, futureField: 'kept' });
        expect((parsed as Record<string, unknown>).futureField).toBe('kept');
    });
});

describe('SKIN_VARIABLES', () => {
    it('is the flattened whitelist, with no duplicates', () => {
        expect(new Set(SKIN_VARIABLES).size).toBe(SKIN_VARIABLES.length);
        expect(SKIN_VARIABLES).toContain('--color-ink');
        expect(SKIN_VARIABLES).toContain('--radius-2xl');
        expect(SKIN_VARIABLES).toContain('--spacing');
    });
});
