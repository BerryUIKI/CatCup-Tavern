import { SKIN_VARIABLES, type SkinManifest, skinCustomProperties } from '@catcup/shared';
import { create } from 'zustand';

/**
 * Which skin is applied, and what a skin does to the document when it is.
 *
 * A skin is a list of CSS custom properties and nothing else at this layer —
 * `styles.css` already reads every one of them, so applying a skin is writing
 * values onto an element and nothing else. That is deliberate: there is no
 * per-skin component, no conditional in the interface, and no path where a skin
 * changes behaviour. See `docs/RFC/0007-skins-and-packs.md`.
 */

/** An installed skin, as the Appearance list shows it. */
export interface InstalledSkin {
    /** The manifest's `id`. */
    id: string;
    name: string;
    description?: string;
    /** `app` restyles the window; `surface` waits for a host to scope it. */
    scope: SkinManifest['scope'];
    colorScheme: SkinManifest['colorScheme'];
    /** Flattened `--name` → value, ready to write. */
    properties: Record<string, string>;
}

interface SkinState {
    /** The skin applied to the window, or `null` for the built-in theme. */
    active: InstalledSkin | null;
    /** Every skin a person has installed, in the order they were added. */
    installed: InstalledSkin[];
    setActive: (skin: InstalledSkin | null) => void;
    setInstalled: (skins: InstalledSkin[]) => void;
}

export const useSkinStore = create<SkinState>((set) => ({
    active: null,
    installed: [],
    setActive: (skin) => set({ active: skin }),
    setInstalled: (skins) => set({ installed: skins }),
}));

/** The element a skin's properties are written onto. */
const ROOT_ID = 'catcup-skin';

/**
 * Write a skin's properties, or clear them for the built-in theme.
 *
 * A `<style>` element rather than inline `style` on `<html>`, because the
 * properties have to reach `::selection`, `::-webkit-scrollbar` and `body::after`
 * — pseudo-elements an inline style cannot address — and because clearing one
 * element is a cleaner undo than removing thirty properties one by one.
 *
 * The rule is unlayered on purpose. Every token in `styles.css` lives inside
 * `@layer theme`, and an unlayered rule wins over a layered one regardless of
 * source order, so this needs no `!important` and no cooperation from Tailwind.
 */
export function applySkin(skin: InstalledSkin | null): void {
    const existing = document.getElementById(ROOT_ID);
    if (!skin || Object.keys(skin.properties).length === 0) {
        existing?.remove();
        return;
    }

    const declarations = Object.entries(skin.properties)
        .map(([property, value]) => `${property}: ${value};`)
        .join('\n    ');

    const style = existing ?? document.createElement('style');
    style.id = ROOT_ID;
    // A skin's values are validated by `skinManifestSchema` before they reach
    // here — no braces, no semicolons, no `url()` — so this cannot close the
    // rule it is written into. The check is restated in the type, not trusted.
    style.textContent = `:root {\n    ${declarations}\n}`;

    if (!existing) {
        document.head.appendChild(style);
    }
}

/** Turn a parsed manifest into the shape the list and the applier use. */
export function toInstalledSkin(manifest: SkinManifest): InstalledSkin {
    return {
        id: manifest.id,
        name: manifest.name,
        ...(manifest.description ? { description: manifest.description } : {}),
        scope: manifest.scope,
        colorScheme: manifest.colorScheme,
        properties: skinCustomProperties(manifest),
    };
}

/** Every variable a skin may set — used by the editor's field list. */
export const SKIN_VARIABLE_NAMES = SKIN_VARIABLES;
