import { readFileSync } from 'node:fs';
import path from 'node:path';

import { BUILTIN_COLORS, SKIN_VARIABLES } from '@catcup/shared';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(path.resolve(import.meta.dirname, '../../../web/src/styles.css'), 'utf8');

/**
 * The schema and the stylesheet must declare the same tokens.
 *
 * This lives in the server workspace rather than beside the schema because it
 * reads a file and the shared package is deliberately browser-safe with no Node
 * types. The server already imports `@catcup/shared`, so the check is the same
 * one in the same run — just from the side that can open a file.
 *
 * A skin is a list of custom properties; the app is the list of properties it
 * paints with. If the schema knows a token `styles.css` never sets, a skin can
 * set it and nothing happens — which reads as a bug in the skin. If the
 * stylesheet declares one the schema does not know, a skin cannot reach it and
 * the whitelist is quietly incomplete.
 *
 * Neither failure is visible at runtime, so this test is the only thing that
 * would catch either.
 */
/** Every `--name` declared inside the stylesheet's `:root` blocks and `@theme`. */
function declaredVariables(source: string): Set<string> {
    const declared = new Set<string>();
    // Matches a declaration, not a use: `--name:` at the start of a property.
    for (const match of source.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) {
        const name = match[1];
        if (name) {
            declared.add(name);
        }
    }
    return declared;
}

describe('the skin token whitelist', () => {
    const declared = declaredVariables(stylesheet);

    it('declares every token the schema accepts', () => {
        const missing = SKIN_VARIABLES.filter((name) => !declared.has(name));
        expect(missing, 'a skin may set a token the stylesheet never declares').toEqual([]);
    });

    it('accepts every token the stylesheet declares for painting', () => {
        // Tailwind emits its own custom properties into the built stylesheet,
        // but this reads the source, so anything here was written by hand and
        // is therefore something a skin ought to be able to reach — except the
        // ones listed below, which are derived rather than painted.
        // `--font-sans` and `--font-mono` are in the whitelist under the `font`
        // group, which flattens to exactly those names; the colours likewise.
        const derived = new Set(Object.keys(BUILTIN_COLORS).map((name) => `--color-${name}`));
        const reachable = new Set<string>([...SKIN_VARIABLES, ...derived]);

        const unreachable = [...declared].filter((name) => {
            if (reachable.has(name)) {
                return false;
            }
            // A Tailwind theme token with a line-height companion, e.g.
            // `--text-body--line-height`, belongs to a size the schema names.
            if (name.endsWith('--line-height')) {
                return false;
            }
            return true;
        });

        expect(unreachable, 'a painted token no skin can reach').toEqual([]);
    });

    it('agrees with the built-in palette the contrast checker measures against', () => {
        // `BUILTIN_COLORS` lives in the shared package because it has no DOM;
        // this is what stops it drifting from the real values.
        for (const [name, value] of Object.entries(BUILTIN_COLORS)) {
            const pattern = new RegExp(`--color-${name}\\s*:\\s*${value}`, 'i');
            expect(pattern.test(stylesheet), `--color-${name} is ${value} in BUILTIN_COLORS`).toBe(true);
        }
    });
});
