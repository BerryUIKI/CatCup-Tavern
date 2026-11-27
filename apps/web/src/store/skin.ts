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
    /** Whether the package carried a stylesheet, so the applier knows to link it. */
    hasCss: boolean;
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

/** The `<style>` a skin's token properties are written into. */
const ROOT_ID = 'catcup-skin';
/** The `<link>` a skin's checked stylesheet is loaded through. */
const CSS_ID = 'catcup-skin-css';
/** The attribute the server's scoped stylesheet selects on. */
export const SKIN_SCOPE_ATTRIBUTE = 'data-skin';

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
    const tokens = document.getElementById(ROOT_ID);
    const sheet = document.getElementById(CSS_ID);

    if (!skin) {
        tokens?.remove();
        // A `<link>` is enough to undo: the browser drops the rules with it.
        sheet?.remove();
        document.documentElement.removeAttribute(SKIN_SCOPE_ATTRIBUTE);
        return;
    }

    // The attribute the server-written stylesheet is scoped to. It sits on the
    // root because an `app`-scope skin covers the window; a `surface` skin is
    // applied by whatever host scoped it, not by this function.
    document.documentElement.setAttribute(SKIN_SCOPE_ATTRIBUTE, skin.id);

    if (Object.keys(skin.properties).length === 0) {
        tokens?.remove();
    } else {
        const declarations = Object.entries(skin.properties)
            .map(([property, value]) => `${property}: ${value};`)
            .join('\n    ');

        const style = tokens ?? document.createElement('style');
        style.id = ROOT_ID;
        // A skin's values are validated by `skinManifestSchema` before they
        // reach here — no braces, no semicolons, no `url()` — so this cannot
        // close the rule it is written into. The check is restated in the type,
        // not trusted.
        style.textContent = `:root {\n    ${declarations}\n}`;
        if (!tokens) {
            document.head.appendChild(style);
        }
    }

    // The stylesheet is a `<link>`, not inlined text: the server already checked
    // and scoped it, and injecting the same rules through `textContent` would be
    // a second place deciding what CSS the document gets.
    if (skin.hasCss) {
        const link = sheet instanceof HTMLLinkElement ? sheet : document.createElement('link');
        link.id = CSS_ID;
        link.rel = 'stylesheet';
        link.href = `/api/skins/${encodeURIComponent(skin.id)}/css`;
        if (!sheet) {
            document.head.appendChild(link);
        }
    } else {
        sheet?.remove();
    }
}

/** Turn a parsed manifest into the shape the list and the applier use. */
export function toInstalledSkin(manifest: SkinManifest, fontAssets: Record<string, string> = {}): InstalledSkin {
    return {
        id: manifest.id,
        name: manifest.name,
        ...(manifest.description ? { description: manifest.description } : {}),
        scope: manifest.scope,
        colorScheme: manifest.colorScheme,
        hasCss: Boolean(manifest.css),
        // A font token that names a file becomes the family the server's
        // `@font-face` declares, so `--font-display` points at a face the
        // document has actually been told about. `fontAssets` maps an archive
        // path to that family, and is empty for a manifest read on its own —
        // which is why a path token falls back to being skipped rather than
        // silently emitting a family nothing declares.
        properties: skinCustomProperties(manifest, fontAssets),
    };
}

/** Every variable a skin may set — used by the editor's field list. */
export const SKIN_VARIABLE_NAMES = SKIN_VARIABLES;
