# Brand assets

The designer's vector masters. This directory is the only source of truth for the brand: every
icon, favicon and banner in the repository is generated from it.

| File                  | Use                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catcup-icon.svg`     | App icon master (1134×1134): a cat in a teacup in cream `#fdf4e2` on a coffee `#3a241c` disc, over a cream rounded tile. Every PNG, ICO, ICNS and favicon derives from it |
| `readme-banner-d.svg` | README banner for dark backgrounds (cream artwork)                                                                                                                        |
| `readme-banner-w.svg` | README banner for light backgrounds (coffee artwork)                                                                                                                      |
| `og-image.png`        | 1280×640 social preview: the tavern scene with the lockup                                                                                                                 |
| `BRIEFS.md`           | Design work that is still outstanding                                                                                                                                     |

Palette: cream `#fdf4e2`, coffee `#3a241c`.

## Where the exports land

- `export/` — every generated bitmap, kept as an archive: PNG 16–1024, the multi-size `icon.ico`,
  `favicon.ico`, `favicon.svg`, `apple-touch-icon.png`, `tauri-icons/`, the light illustrations and
  the social preview.
- `apps/desktop/src-tauri/icons/` — the Tauri icon set named in `tauri.conf.json`.
- `apps/web/public/` — `favicon.svg`, `favicon.ico`, `apple-touch-icon.png` and `brand-banner.svg`
  (a copy of `readme-banner-d.svg` used at the top of Settings → About).
- The README points at this directory through `<picture>` and `prefers-color-scheme`, so the light
  and dark banners switch with the reader's theme.

## Regenerating the bitmaps

```bash
pnpm icons
```

`scripts/export-icons.mjs` rasterises `catcup-icon.svg`, rebuilds the ICO, favicon and Apple touch
icon, runs the Tauri icon generator for the `.icns`, `.ico` and PNG set, and copies the result into
both apps. It needs ImageMagick 7 (`magick`) on `PATH` and an installed workspace (`pnpm install`).

The 16–32 px slots are still scaled down from the full master. A drawing made for that size is
outstanding — see `BRIEFS.md`.

## Social preview and empty-state illustrations

- `og-image.png` is the 1280×640 social preview; the same image is archived at
  `export/og/og-image-1280x640.png`.
- Empty-state illustrations: the dark, transparent versions the app uses live in
  `apps/web/public/illustrations/`; the light versions are archived at `export/illustrations/` for
  light-theme documentation and a future light theme.
