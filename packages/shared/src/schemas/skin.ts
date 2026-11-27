import { z } from 'zod';

/**
 * The skin format's schema: `catcup.skin` inside a `.catcup` container.
 *
 * See `docs/RFC/0007-skins-and-packs.md`. Two things here are load-bearing and
 * should not drift:
 *
 * 1. **`SKIN_TOKENS` is a whitelist, and `styles.css` must agree with it.** The
 *    test beside this file reads the stylesheet and fails if the two lists
 *    differ by even one name. A token the app paints with but the schema does
 *    not know is invisible to skins; a token the schema accepts but the app
 *    never declares does nothing and looks like a bug in the skin.
 * 2. **A skin cannot name a token the app does not have.** That is checked here
 *    rather than tolerated at runtime, so a typo is an install error with the
 *    name in it, not an interface that quietly stays the wrong colour.
 */

/**
 * Every custom property a skin may set, grouped by what it controls.
 *
 * The values are the suffixes: a group `color` with a member `ink` becomes
 * `--color-ink`. Keeping the group separate from the CSS prefix would let the
 * two disagree, so the prefix is the group name.
 */
export const SKIN_TOKENS = {
    color: [
        'ink',
        'ink-soft',
        'surface',
        'surface-2',
        'surface-3',
        'line',
        'line-soft',
        'parchment',
        'parchment-dim',
        'muted',
        'amber',
        'amber-strong',
        'ember',
        'wine',
        'sage',
        'danger',
        'danger-strong',
    ],
    radius: ['lg', 'xl', '2xl'],
    font: ['display', 'sans', 'mono'],
    text: ['caption', 'footnote', 'code', 'body'],
    shadow: ['card', 'raised', 'float'],
    /**
     * Everything the app paints with that is not a colour scale, a radius, a
     * font, a type size or a shadow. Named by the variable's own suffix.
     */
    other: [
        'page-top',
        'page-bottom',
        'glow-a',
        'glow-b',
        'grain-opacity',
        'md-em',
        'md-strong',
        'md-code-surface',
        'md-pre-surface',
        'scrollbar-thumb',
        'scrollbar-thumb-hover',
        'selection-surface',
        'selection-text',
        'avatar-sat',
        'avatar-light',
        'logo-glow',
    ],
} as const;

export type SkinTokenGroup = keyof typeof SKIN_TOKENS;

/**
 * The CSS custom property a token sets, e.g. `--color-ink`.
 *
 * `other` is the one group whose name is not a prefix: its members are
 * variables the app declared for their own sake — `--page-top`, `--grain-opacity`
 * — and prefixing them would invent names the stylesheet does not have. Every
 * other group's name is exactly the prefix the variable uses, which is what
 * keeps this function and the stylesheet in step.
 */
export function skinTokenVariable(group: SkinTokenGroup, name: string): string {
    return group === 'other' ? `--${name}` : `--${group}-${name}`;
}

/**
 * Every variable a skin may set, flattened — the list the validator and the
 * stylesheet test both use.
 */
export const SKIN_VARIABLES: readonly string[] = [
    ...Object.entries(SKIN_TOKENS).flatMap(([group, names]) =>
        names.map((name) => skinTokenVariable(group as SkinTokenGroup, name)),
    ),
    // The spacing scale's base is a property of its own rather than a group
    // member, so it is not in `SKIN_TOKENS` — but a skin may set it, and the
    // drift test against `styles.css` has to know that.
    '--spacing',
];

/**
 * A token value as CSS will see it.
 *
 * Deliberately permissive about *what* colour syntax — a skin may want
 * `oklch()`, `color-mix()` or a `var()` chain — and strict about *shape*: no
 * braces, no semicolons, no `url()`, nothing that could escape the declaration
 * it is written into. The value is emitted as `--name: <value>`, so a value
 * carrying `}` would end the rule.
 */
const tokenValue = z
    .string()
    .min(1)
    .max(300)
    .refine((value) => !/[{};]/.test(value), { message: 'A token value cannot contain { } or ;' })
    .refine((value) => !/url\s*\(/i.test(value), { message: 'A token value cannot reference a url()' })
    .refine((value) => !/<\/?[a-z]/i.test(value), { message: 'A token value cannot contain markup' });

/**
 * One group of tokens.
 *
 * `strictObject` rather than `object`: an unknown member is an error naming it,
 * which is the whole point of the whitelist. Zod's default would strip it and
 * leave the skin author with a colour that silently did nothing.
 */
function tokenGroup<Group extends SkinTokenGroup>(group: Group) {
    const names = SKIN_TOKENS[group];
    const shape = Object.fromEntries(names.map((name) => [name, tokenValue.optional()]));
    return z.strictObject(shape);
}

export const skinTokensSchema = z.strictObject({
    color: tokenGroup('color').optional(),
    radius: tokenGroup('radius').optional(),
    font: tokenGroup('font').optional(),
    text: tokenGroup('text').optional(),
    shadow: tokenGroup('shadow').optional(),
    other: tokenGroup('other').optional(),
    /**
     * The spacing scale's base. Not a group: it is one number that every
     * `calc(var(--spacing) * N)` in the app multiplies, so a skin sets it to
     * make the whole interface denser or airier.
     */
    spacing: tokenValue.optional(),
});
export type SkinTokens = z.infer<typeof skinTokensSchema>;

/** Where a skin applies. See RFC 0007 §Scope. */
export const skinScopeSchema = z.enum(['app', 'surface']);
export type SkinScope = z.infer<typeof skinScopeSchema>;

/**
 * The `manifest.json` of a `catcup.skin`, on top of the shared header.
 *
 * The header fields — `format`, `formatVersion`, `id`, `name`, `version`,
 * `namespace`, `engine` — are validated by the container's own schema before
 * this one runs; see `packManifestSchema`.
 */
// `.loose()` rather than the default: Zod strips an unknown key, and RFC 0007
// promises that a field a newer format adds survives a read by an older host.
// A schema that quietly deletes it breaks that promise in the one direction
// nobody tests by hand.
export const skinManifestSchema = z.looseObject({
    format: z.literal('catcup.skin'),
    formatVersion: z.literal(1),
    /** `dark` or `light`; a light skin is what lets the app follow the OS later. */
    colorScheme: z.enum(['dark', 'light']).default('dark'),
    /** `app` restyles the window; `surface` only the element the app wraps content in. */
    scope: skinScopeSchema.default('app'),
    tokens: skinTokensSchema.default({}),
    /** One optional stylesheet, relative to the archive root. */
    css: z.string().max(300).optional(),
    /** `media/index.json`, when the skin carries fonts or decorative images. */
    assets: z.string().max(300).optional(),
    /** One sentence the Appearance list shows under the name. */
    description: z.string().max(300).optional(),
});
export type SkinManifest = z.infer<typeof skinManifestSchema>;

/**
 * The pairs `checkSkin` measures, and the floor each is held to.
 *
 * `text` is read on `background`; the app's rule is 4.5:1 for normal text
 * (`docs/DESIGN.md` §Colour). These are the pairs the interface actually
 * paints, not every combination — a full cross-product would warn about
 * combinations that never appear and train people to ignore the warnings.
 */
export const SKIN_CONTRAST_PAIRS = [
    { text: 'parchment', background: 'surface' },
    { text: 'parchment', background: 'ink' },
    { text: 'parchment-dim', background: 'surface' },
    { text: 'parchment-dim', background: 'ink-soft' },
    { text: 'muted', background: 'surface' },
    { text: 'muted', background: 'ink-soft' },
    { text: 'amber', background: 'surface' },
    { text: 'amber', background: 'ink' },
    { text: 'danger', background: 'surface' },
    { text: 'danger', background: 'ink-soft' },
    { text: 'sage', background: 'surface' },
] as const;

/** The minimum a text-on-background pair should reach. */
export const SKIN_CONTRAST_FLOOR = 4.5;
