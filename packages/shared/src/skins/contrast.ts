import {
    SKIN_TOKENS,
    SKIN_VARIABLES,
    type SkinTokenGroup,
    skinManifestSchema,
    skinTokenVariable,
} from '../schemas/skin.js';

type Rgb = { r: number; g: number; b: number };

/**
 * Read a CSS colour into linear-light RGB.
 *
 * Only the forms a hand-written skin realistically uses: `#rgb`, `#rrggbb`,
 * `rgb()`/`rgba()` with commas, and the named colours the palette itself is
 * built from. Anything else — `oklch()`, `color-mix()`, a `var()` chain —
 * returns `null`, and the caller skips that pair rather than guessing.
 *
 * Guessing is the thing to avoid here: a checker that silently misreads a
 * colour is worse than one that says it cannot read it, because the first
 * trains people to trust a wrong number.
 */
export function parseColor(value: string | undefined): Rgb | null {
    if (!value) {
        return null;
    }
    const text = value.trim().toLowerCase();

    const named: Record<string, string> = {
        black: '#000000',
        white: '#ffffff',
        transparent: '',
    };
    const hex = named[text] ?? text;

    const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
    if (short) {
        const [, r, g, b] = short as unknown as [string, string, string, string];
        return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
    }

    const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(hex);
    if (long) {
        const [, r, g, b] = long as unknown as [string, string, string, string];
        return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
    }

    const fn = /^rgba?\(\s*([0-9.]+)\s*[, ]\s*([0-9.]+)\s*[, ]\s*([0-9.]+)/.exec(text);
    if (fn) {
        const [, r, g, b] = fn as unknown as [string, string, string, string];
        return { r: Number(r), g: Number(g), b: Number(b) };
    }

    return null;
}

function channel(value: number): number {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: Rgb): number {
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * WCAG contrast ratio between two colours, or `null` when either cannot be read.
 *
 * This is the same arithmetic `docs/DESIGN.md` quotes for the built-in palette —
 * `wine` on `surface` is 2.24:1 by this function — so a skin's number and the
 * app's own number are directly comparable.
 */
export function contrastRatio(foreground: string | undefined, background: string | undefined): number | null {
    const fg = parseColor(foreground);
    const bg = parseColor(background);
    if (!fg || !bg) {
        return null;
    }
    const a = luminance(fg);
    const b = luminance(bg);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
}

/** One pair the checker measured. */
export interface ContrastFinding {
    /** The custom property the text colour came from, e.g. `--color-muted`. */
    foreground: string;
    background: string;
    ratio: number;
}

export interface SkinCheckResult {
    /** Pairs measured below the floor, worst first. */
    findings: ContrastFinding[];
    /** Pairs the checker could not read — a skin may use a syntax it does not know. */
    unreadable: string[];
}

/**
 * The app's own palette, as the baseline a skin is compared against.
 *
 * Kept here rather than read from the stylesheet because the shared package has
 * no DOM and no build step that could parse CSS. A test asserts these values
 * match `apps/web/src/styles.css`, so the two cannot drift silently.
 */
export const BUILTIN_COLORS = {
    ink: '#0d0a08',
    'ink-soft': '#14100c',
    surface: '#1b1410',
    'surface-2': '#241a13',
    'surface-3': '#2f2218',
    'line-soft': '#2a1f16',
    line: '#3b2b1f',
    parchment: '#f1e7d8',
    'parchment-dim': '#c9b7a0',
    muted: '#94806a',
    amber: '#e2a55a',
    'amber-strong': '#f3c27a',
    ember: '#b4652f',
    wine: '#7e3b3f',
    sage: '#7f9b6d',
    danger: '#e08585',
    'danger-strong': '#f0a8a8',
} as const;

/** A skin's effective colour: what it sets, falling back to the built-in value. */
export function effectiveColors(tokens: { color?: Partial<Record<string, string>> }): Record<string, string> {
    return { ...BUILTIN_COLORS, ...(tokens.color ?? {}) };
}

/**
 * Measure a skin's colour pairs and report what falls under the floor.
 *
 * A warning, never a refusal: `docs/DESIGN.md` says degrade, do not disable, and
 * someone may want a deliberately low-contrast skin. What this is for is the
 * *accidental* one — the app's own palette shipped `wine` at 2.24:1 as error
 * text for two years, and no one noticed until it was measured.
 */
export function checkSkin(
    tokens: { color?: Partial<Record<string, string>> },
    pairs: readonly { text: string; background: string }[],
    floor = 4.5,
): SkinCheckResult {
    const colors = effectiveColors(tokens);
    const findings: ContrastFinding[] = [];
    const unreadable: string[] = [];

    for (const pair of pairs) {
        const foreground = colors[pair.text];
        const background = colors[pair.background];
        const ratio = contrastRatio(foreground, background);
        if (ratio === null) {
            unreadable.push(
                `${skinTokenVariable('color', pair.text)} on ${skinTokenVariable('color', pair.background)}`,
            );
            continue;
        }
        if (ratio < floor) {
            findings.push({
                foreground: skinTokenVariable('color', pair.text),
                background: skinTokenVariable('color', pair.background),
                ratio,
            });
        }
    }

    findings.sort((left, right) => left.ratio - right.ratio);
    return { findings, unreadable };
}

/**
 * Which of a skin's token names the app does not have.
 *
 * `skinManifestSchema` already refuses these, so this exists for the two
 * callers that read a manifest without going through it: the stylesheet drift
 * test, and any future migration that has to report what an older file used.
 */
export function unknownTokenNames(tokens: Record<string, Record<string, string> | string>): string[] {
    const unknown: string[] = [];
    for (const [group, members] of Object.entries(tokens)) {
        if (group === 'spacing' || typeof members === 'string') {
            continue;
        }
        const known = SKIN_TOKENS[group as keyof typeof SKIN_TOKENS] as readonly string[] | undefined;
        if (!known) {
            unknown.push(`--${group}.*`);
            continue;
        }
        for (const name of Object.keys(members)) {
            if (!known.includes(name)) {
                unknown.push(skinTokenVariable(group as keyof typeof SKIN_TOKENS, name));
            }
        }
    }
    return unknown;
}

/**
 * Flatten a manifest's tokens into the custom properties a browser will see.
 *
 * A token set to an empty string is skipped rather than emitted: `--color-x:`
 * would clear the value and inherit nothing, which makes an interface that
 * looks broken in a way the skin author cannot see in their file.
 */
export function skinCustomProperties(manifest: { tokens?: Record<string, unknown> }): Record<string, string> {
    const properties: Record<string, string> = {};
    const tokens = manifest.tokens ?? {};

    for (const [group, members] of Object.entries(tokens)) {
        if (group === 'spacing') {
            if (typeof members === 'string' && members.trim()) {
                properties['--spacing'] = members.trim();
            }
            continue;
        }
        if (!members || typeof members !== 'object') {
            continue;
        }
        for (const [name, value] of Object.entries(members as Record<string, unknown>)) {
            if (typeof value === 'string' && value.trim()) {
                properties[skinTokenVariable(group as SkinTokenGroup, name)] = value.trim();
            }
        }
    }

    return properties;
}

/** Re-exported so a caller needs one import. */
export { SKIN_VARIABLES, skinManifestSchema };
