import { useEffect } from 'react';

import { useSettings, useSkins } from '../hooks/data';
import { applySkin, toInstalledSkin } from '../store/skin';

/**
 * Keep the document wearing the skin the settings name.
 *
 * This lives at the app root rather than inside the Appearance panel, and that
 * is the whole point of it: a panel only mounts when a person opens Settings →
 * Appearance, so an effect there applies the skin the first time someone looks
 * at the list and never again. The first version of this feature did exactly
 * that — the skin was saved, survived a reload, and the window came back in the
 * built-in theme until the panel was opened.
 *
 * The server is the source of truth: the settings name an id, the skins route
 * returns the manifests, and this reads both. Nothing is cached locally, so a
 * skin edited on disk reaches the theme on the next load without an uninstall.
 */
export function SkinApplier() {
    const settings = useSettings().data;
    const skins = useSkins().data;

    useEffect(() => {
        if (!settings) {
            return;
        }
        const id = settings.ui.skinId;
        const manifest = id ? skins?.skins.find((skin) => skin.id === id) : undefined;
        // A selected id that no longer resolves clears the skin rather than
        // leaving the last one applied — the panel says why, and the window is
        // never a theme nobody chose.
        applySkin(manifest ? toInstalledSkin(manifest) : null);
    }, [settings, skins]);

    return null;
}
