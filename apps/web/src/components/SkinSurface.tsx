import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo } from 'react';

/**
 * Apply a skin to one element instead of the whole window.
 *
 * A `surface` skin exists so a pack can restyle its own views without deciding
 * what a person's Settings dialog looks like. The mechanism is the one CSS
 * already gives us: custom properties inherit, so writing them on a wrapping
 * element changes everything under it and nothing outside.
 *
 * Three rules hold here, and each of them is a way this could go wrong:
 *
 * 1. **The variables are written inline on the wrapper, not on `:root`.** That
 *    is what makes the scope real — a `:root` write would leak into the app.
 * 2. **The stylesheet is scoped by the server, and the attribute matches the
 *    id.** The server wraps what it read in `[data-skin]`, so the wrapper must
 *    carry that attribute with the skin's id or no rule applies.
 * 3. **The stylesheet is loaded while the surface exists and removed with it.**
 *    A `<link>` cannot live inside the wrapper element, so it goes in the head
 *    — but it is created by this component and dropped on unmount, so a surface
 *    skin's rules exist only as long as the surface does.
 */
interface InstalledSkinLike {
    id: string;
    scope: 'app' | 'surface';
    properties: Record<string, string>;
    hasCss: boolean;
}

/**
 * A skin's tokens as a React style object.
 *
 * `CSSProperties` does not admit `--custom` keys in its type, so the cast is
 * local and the values are the ones `skinManifestSchema` already refused
 * anything dangerous from.
 */
export function surfaceProperties(skin: InstalledSkinLike | null): CSSProperties {
    if (!skin) {
        return {};
    }
    return { ...(skin.properties as unknown as CSSProperties) };
}

/**
 * A wrapper element for a surface-scoped skin.
 *
 * Use it around anything a pack should be able to restyle. With no skin it
 * renders its children in a plain `div`, so a host does not have to branch on
 * whether a skin is installed — an unscoped surface and a scoped one are the
 * same component.
 */
export function SkinSurface({
    skin,
    className,
    children,
}: {
    skin: InstalledSkinLike | null;
    className?: string;
    children: ReactNode;
}) {
    const style = useMemo(() => surfaceProperties(skin), [skin]);

    // A `<link>` has to live in the document, not inside this wrapper; what
    // keeps it scoped is the server's `[data-skin]` wrap plus the attribute
    // below. It is removed when the host unmounts or the skin changes, so
    // closing a view takes its rules with it and leaves nothing behind.
    useEffect(() => {
        if (!skin?.hasCss) {
            return undefined;
        }
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `/api/skins/${encodeURIComponent(skin.id)}/css`;
        link.setAttribute('data-skin-css', skin.id);
        document.head.appendChild(link);
        return () => {
            link.remove();
        };
    }, [skin]);

    const attributes = skin ? { 'data-skin': skin.id } : {};
    return (
        <div {...attributes} style={style} className={className} data-surface="skin">
            {children}
        </div>
    );
}
