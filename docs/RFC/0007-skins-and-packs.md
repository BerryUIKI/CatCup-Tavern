# RFC 0007 — One container: `.catcup`, discriminated by manifest

- **Issue:** — (raised from the GUI/UX review of 2026-11-27, not from a tracked issue)
- **Status:** Proposed 2026-11-27
- **Touches:** `packages/shared/src/schemas/`, `apps/server/src/packs/`, `apps/server/src/cards/`, `apps/server/src/routes/`, `apps/server/src/storage/`, `apps/server/src/app.ts`, `apps/web/src/lib/`, `apps/web/src/store/`, `apps/desktop/src-tauri/tauri.conf.json`, `docs/DATA-FORMATS.md`, `docs/DESIGN.md`, `docs/API.md`, `docs/LIMITATIONS.md`, `docs/MILESTONES.md`, `docs/SECURITY.md`, `docs/CHANGELOG.md`

## The problem

Three kinds of content want a file format.

**Skins.** The interface can now be re-coloured from a token file — the tokens landed in #185 and the fonts in #187 — but there is no format to write one in, no place to load one from, and no rule about what a skin may contain.

**Game packs.** [RFC 0005](0005-game-mode.md) says a game is a ZIP carrying no code: tools, views, state, content, media. It names the container and stops. It does not say what the manifest contains in full, how a pack ships a skin, how the app decides a pack is safe, or what happens when two packs disagree.

**Character cards, already.** `.png`, `.json`, `.charx` and `.catcup` — and `.catcup` is today only an alias: byte-identical to `.charx`, the same parser, the same layout (`docs/DATA-FORMATS.md` §CharX). A person looking at four extensions for one idea has to be told that two of them are the same file.

This document settles the container, the manifest, the loader and the security boundary for all three.

## One extension, discriminated by content

**Every CatCup-owned file is a `.catcup`.** What it is lives in `manifest.json` at the archive root, under `format`:

| Path | `format`              | What it is                                  | Status   |
| ---- | --------------------- | ------------------------------------------- | -------- |
| 1    | `catcup.card`         | One character card and its assets           | proposed |
| 2    | `catcup.skin`         | Appearance: tokens, one optional stylesheet | proposed |
| 3    | `catcup.game`         | A game: content, state, tools, views, media | RFC 0005 |
| 4    | `catcup.world`        | One world info book and the data beside it  | future   |
| 5    | `catcup.preset`       | One prompt preset                           | future   |
| 6    | `catcup.collection`   | Several items in one file                   | future   |
| 7    | `catcup.quickreplies` | One quick reply set                         | future   |
| 8    | `catcup.regex`        | A regex script set                          | future   |

The list is ordered by need, not by build order. **Only three are in scope here** — `card`, `skin`, `game`. The rest are named so the namespace is claimed and a later format is a number to fill in rather than a decision to reopen. A loader that meets a `format` it does not know says which one it was and which versions it does know, rather than "invalid file".

### Why this and not one extension per kind

A file extension is a promise to the operating system and to the person. Every additional one costs the same five code sites and two doc sections — measured in this tree:

```
apps/server/src/routes/characters.ts:43     the format enum
apps/server/src/routes/characters.ts:59     the package-extension regex
apps/server/src/routes/characters.ts:61     its error message
apps/web/src/components/MainApp.tsx:48      the drag-and-drop filter
apps/web/src/components/Sidebar.tsx:217     the file picker's accept list
apps/desktop/src-tauri/tauri.conf.json:31   the OS file association
docs/DATA-FORMATS.md, docs/LIMITATIONS.md   two sections each
```

Five of those are things a person can get wrong independently, and every new kind multiplies them. One extension means the OS association, the drag target and the picker are written once and are correct for every kind that will ever exist.

The cost is that the extension alone no longer tells a person what they have. That cost is paid on the screen, not in the OS: the library, the review sheet and the file's own name all say "Grimoire Night — skin". A double-click opening the review sheet is also the moment the app can explain what it found.

### Why not fold the kinds into one format

A skin is content a person installs to look at the app differently; a game is content that changes what is true. Merging them into one schema means every skin carries a licence block, a state declaration and a compatibility promise it does not need. The discriminator is a field, not a union: `catcup.skin` and `catcup.game` are separate schemas that share a header, a reader and an install path, and neither knows the other's body.

## The container

Everything is a ZIP read by the hardened reader that already opens `.charx` (`apps/server/src/cards/charx.ts`): **200 entries, 25 MB per entry, 60 MB total, 400-character path, no absolute paths, no `..`**. Those limits are not tuned — a ZIP header is the only thing that can be trusted before extraction, and they are already tested.

```
manifest.json          required, at the archive root, the only entry read before validation
<format files>         whatever the format names
media/
  index.json           every asset by id, type and path
  images/  audio/  fonts/
```

`manifest.json` is read first and alone. It is capped at 10 MB, must be valid JSON, and must declare `format`. Nothing else in the archive is read until that succeeds, so a 60 MB archive with a broken manifest costs one entry rather than sixty.

### The shared header

Every format begins with these fields, and the loader validates them before anything format-specific:

```jsonc
{
    "format": "catcup.game", // discriminator; required
    "formatVersion": 1, // the format's own contract
    "id": "example-course-pack", // unique within its scope
    "name": "Example Course Pack", // what the review sheet and the library show
    "version": "1.0.0", // the pack's own version, for updates
    "namespace": "ex", // every state key and content id is prefixed with this
    "engine": { "min": "0.6.0" }, // refused on an older host, naming both versions
    "author": "someone",
    "license": "free to redistribute; see LICENSE.txt",
    "preview": "media/preview.png" // optional, for the library card
}
```

Three rules make the compatibility promise real:

1. **`formatVersion` is the contract.** The loader reads every version it has published. A new optional field is a minor change and the number does not move; anything that changes the meaning of an existing field is a new number, and the old ones keep loading.
2. **`engine.min` is checked at install** against the running version. A pack that needs a newer host is refused with both versions named, rather than failing mysteriously in a view.
3. **`namespace` prefixes every state key and content id.** A write cannot reach another pack's data, and a key without the prefix is **refused**, not silently prefixed — a pack whose author believes the key is `credits` would otherwise find `ex.credits` and file a bug.

Unknown fields are preserved everywhere, as for cards and presets. That is what lets a newer format add a field that an older host keeps and writes back untouched.

## Format 1 — `catcup.card`

This is the one that already exists; it only gains a manifest.

```jsonc
{
    "format": "catcup.card",
    "formatVersion": 1,
    "id": "mira",
    "name": "Mira",
    "version": "1.0.0",
    "namespace": "mira"
}
```

```
manifest.json
card.json              the V3 card, unchanged
assets/**              the CharX asset tree, unchanged
```

**Backward compatibility is the whole rule here.** An existing `.catcup` — the one shipped by this app and by anyone who renamed a `.charx` — has **no `manifest.json`**. The loader reads that case as `catcup.card`, exactly as it does today, so no file on anyone's disk needs converting. The manifest is written on export from now on, and an import of a manifest-less archive is reported in the review sheet as a legacy card rather than a malformed pack.

**Why this is better than the alias.** Today `.catcup` is a `.charx` with a different name, which means two extensions for one layout and an explanation in the docs. Under this document `.catcup` is the container and `.charx` is a foreign format we read and write for compatibility. That removes the "they are the same file, but the extensions differ" note rather than restating it.

**What a card pack unlocks.** `docs/LIMITATIONS.md` records that world info aliases live in a `<book>.aliases.json` sidecar and **do not survive an export**. A card pack can carry its linked world info and the alias data inside `assets/`, so a card that ships with its lore travels as one file. That is a later change, but it is only possible because the container gained a manifest — it is not something a renamed `.charx` could express.

## Format 2 — `catcup.skin`

Appearance only, and installable with no game present.

```jsonc
{
    "format": "catcup.skin",
    "formatVersion": 1,
    "id": "grimoire-night",
    "name": "Grimoire Night",
    "version": "1.2.0",
    "namespace": "gr",
    "engine": { "min": "0.5.0" },
    "colorScheme": "dark",
    "scope": "app",
    "tokens": {
        "color": { "ink": "#0b0a0c", "surface": "#15131a", "amber": "#c9a227", "danger": "#e08a8a" },
        "radius": { "xl": "10px", "2xl": "14px" },
        "font": { "display": "media/display.woff2", "sans": "media/sans.woff2" },
        "text": { "footnote": "0.75rem" },
        "spacing": "0.25rem",
        "shadow": { "float": "0 25px 50px -12px rgba(0,0,0,0.6)" },
        "other": { "grain-opacity": "0", "logo-glow": "transparent" }
    },
    "css": "skin.css",
    "assets": "media/index.json"
}
```

### `tokens` is a whitelist, and the list is the contract

The app declares these names; a token not on the list is **rejected by name** at install, not ignored. A pack that sets `--color-surfce` should hear about the typo rather than wonder why its surface stayed dark.

| Group     | Tokens (complete)                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `color`   | `ink` `ink-soft` `surface` `surface-2` `surface-3` `line` `line-soft` `parchment` `parchment-dim` `muted` `amber` `amber-strong` `ember` `wine` `sage` `danger` `danger-strong`                                                          |
| `radius`  | `lg` `xl` `2xl`                                                                                                                                                                                                                          |
| `font`    | `display` `sans` `mono` — a path inside the pack, or a list of family names                                                                                                                                                              |
| `text`    | `caption` `footnote` `code` `body`                                                                                                                                                                                                       |
| `spacing` | one value, the scale's base                                                                                                                                                                                                              |
| `shadow`  | `card` `raised` `float`                                                                                                                                                                                                                  |
| `other`   | `page-top` `page-bottom` `glow-a` `glow-b` `grain-opacity` `md-em` `md-strong` `md-code-surface` `md-pre-surface` `scrollbar-thumb` `scrollbar-thumb-hover` `selection-surface` `selection-text` `avatar-sat` `avatar-light` `logo-glow` |

Written as `--color-ink` and so on, on the element that scopes the skin. The list lives in `packages/shared/src/schemas/skin.ts`, and a test fails if the schema knows a token `styles.css` does not declare or the reverse — the same drift guard the design tokens now need anyway.

**JSON rather than raw CSS, deliberately.** JSON can be validated, compared, rendered as a form, diffed in a review sheet and refused at install. A stylesheet cannot be any of those, and 95% of skins want nothing but colours.

### `css` is the exception

A pack may ship **one** stylesheet, and the validator **refuses** rather than sanitises:

1. No `@import`, no `@namespace`.
2. Every `url()` must resolve inside the pack's own `media/`; the loader rewrites it to that pack's read-only route, so a path that escapes simply 404s.
3. No `@font-face` — a font goes in `tokens.font` as a path, which the loader emits with the same rewriting. An `@font-face` in CSS is a way around rule 2.
4. 64 KB maximum, and the loader wraps what it reads in `[data-skin="<id>"] { … }` itself rather than trusting the file to be scoped, so a selector naming `html` or `:root` cannot reach outside.

A refusal is reported as a line-numbered error in the review sheet and the install fails. A pack we cannot verify is not rewritten into one we can.

**Shipped 2026-11-28** for `catcup.skin`: `checkSkinCss` and `scopedCss` in `packages/shared/src/skins/css.ts`, wired through the pack reader. One rule was added while implementing it, because a naive scope wrap produces CSS no browser reads: **a top-level `@media` is lifted out and re-wrapped around the scope** rather than nested inside a selector. A skin that names a `css` file the archive does not contain is also refused — otherwise it installs and silently looks like the built-in theme.

**What CSS can and cannot do here.**

- It cannot run code. No browser runs JavaScript from CSS, and `expression()` is long dead.
- It cannot make a request off the machine once rule 2 holds — and that is exactly what `url()` would otherwise break: `url("https://tracker/?pack=gr")` tells a third party that a person has this pack, from an app that otherwise makes no outbound request it did not initiate.
- It cannot cover the interface dishonestly in a way the person did not choose, because a skin is scoped and installed deliberately. Visual deception is a risk the installer accepts; covert exfiltration is not one they can see.

### Scope

```jsonc
"scope": "app"      // default — tokens on :root, the whole window
"scope": "surface"  // only inside the element the app wraps this content in
```

`surface` is what lets a game skin its own views without deciding what a person's Settings dialog looks like. Custom properties inherit, so the loader writes the tokens on a wrapper element (`<div data-skin="gr">`) and every descendant picks them up; the app's own chrome sits outside that wrapper and keeps the user's theme.

A pack's embedded skins are always `surface`. Only a user-installed skin may be `app`.

### Precedence

```
game's own skin (surface, inside the game view)
  > user skin (app)
    > built-in theme
```

And one rule overrides all three: **an unreadable interface is our bug, not the pack's.** A reset-to-built-in control sits in Settings → Appearance and in the game view's own header, outside anything a skin can reach.

### `checkSkin`

Every install computes WCAG contrast for each pair the app actually paints — `parchment`, `parchment-dim`, `muted`, `amber`, `danger` over `ink`, `surface`, `surface-2`, `ink-soft` — and lists every pair under 4.5:1 with its ratio.

It **warns and installs anyway**. `docs/DESIGN.md` says degrade, do not disable, and a person may want a deliberately low-contrast skin. What it prevents is an author shipping one **by accident** — which is exactly what this app's own palette did, with `wine` at 2.24:1 used as error text in 32 places (#185).

## Format 3 — `catcup.game`

RFC 0005 owns what a game _is_ — three modes, two switches, five effect kinds, nine view types, sentinel actions. This section owns the file.

```
manifest.json
state.json             state keys, types and defaults
tools.json             the primitives this pack uses
views.json             which host views to render, with what content
content/*.json         entities: classes, courses, items, …
skins/*.catcup         zero or more embedded skins, each with scope "surface"
media/…
```

```jsonc
{
    "format": "catcup.game",
    "formatVersion": 1,
    "id": "example-course-pack",
    "name": "Example Course Pack",
    "version": "1.0.0",
    "namespace": "ex",
    "engine": { "min": "0.6.0" },
    "state": "state.json",
    "tools": "tools.json",
    "views": "views.json",
    "content": ["content/classes.json", "content/courses.json"],
    "media": "media/index.json",
    "skins": ["skins/grimoire-night.catcup"],
    "defaultSkin": "skins/grimoire-night.catcup"
}
```

### `state.json` — declared before it is written

```jsonc
{
    "credits": { "type": "integer", "default": 0, "min": 0 },
    "mood": { "type": "enum", "values": ["calm", "tense", "warm"], "default": "calm" },
    "completed": { "type": "set", "of": "string", "default": [] },
    "flags": { "type": "record", "of": "boolean", "default": {} }
}
```

`integer`, `number`, `string`, `boolean`, `enum`, `set`, `record`. Every write is validated against the declaration, so an effect that sets `credits` to a string is rejected by name rather than stored and discovered a week later.

Declared in the pack because a save is a file a person can read and a pack can be migrated against: a key with no declaration is a key no future version can safely change.

### `media/index.json`

```jsonc
{
    "media": {
        "portrait-mira": { "type": "image", "path": "images/mira.webp", "width": 512, "height": 768 },
        "chime": { "type": "audio", "path": "audio/chime.ogg", "seconds": 2.4 },
        "display": { "type": "font", "path": "fonts/display.woff2", "family": "Grimoire" }
    }
}
```

Three types, because those are the three the host renders. Every id is verified present **at install**, so a missing file fails the install rather than the first task that needed it.

**Serving.** `GET /api/skins/:id/media/*` reads from that one skin's folder through `resolveInside` (`apps/server/src/storage/paths.ts`) — the helper the image route and character assets already use. Read-only: no upload, no write, no delete. A path escaping the folder answers **404**, not 403: a pack is not entitled to learn what else is on the disk.

**Shipped 2026-11-28** for `catcup.skin`: `storage/skinAssets.ts`, the media route, and `@font-face` emission for a `tokens.font` path. Two rules were tightened while implementing it, both recorded in that file:

- **The served set is the media index, not the folder.** A file dropped in by hand is not a way in, and the declaration is written before the assets so a crash halfway through leaves a folder the host will not serve rather than one it half-trusts.
- **A content type the host cannot speak fails the install.** With `nosniff` on, a browser left to guess from an unknown extension guesses wrong, and the failure arrives as a broken image with no reason attached.

## The install path

```
1. read manifest.json alone, under a 10 MB cap
2. parse it as the shared header, then as the schema for its `format`
3. check `formatVersion` is one this host reads, and `engine.min` against the running version
4. extract the entries that format names, under the archive limits
5. verify every referenced file exists — state, tools, views, content, every media id, every embedded skin
6. validate each embedded skin's tokens and CSS
7. checkSkin on every skin; warnings collected, not fatal
8. review sheet: what it is, how many entities and assets, which engine, every warning, the licence line
9. write on accept; write nothing otherwise
```

A rejection names the field and its place — `content/classes.json`, entry 42, `tier` — not "invalid pack". Step 2 is where an unknown `format` is reported with the list of known ones.

## On-disk layout

```
data/profiles/<profile>/
├─ packs/                      installed packs, unpacked
│  ├─ example-course-pack/
│  │  ├─ manifest.json
│  │  └─ …the archive's contents
│  └─ grimoire-night/          a skin is a pack like any other
├─ games/<gameId>/             a save (RFC 0005)
│  ├─ game.json
│  ├─ state.json
│  └─ saves/…
```

**Unpacked, not kept as a ZIP.** A pack is read many times per turn — every view render, every media lookup — and inflating an archive each time is both slow and keeps the bytes in memory. Unpacking once at install, through the limits above, means the read path touches ordinary files.

**Under the profile**, so a save's pack version is stable and two profiles can run the same pack independently. RFC 0005's shared layer stays open; this format allows it by resolving from `data/shared/packs/` too, with the profile's copy winning — the rule RFC 0001 already applies to every other kind of item.

## The security boundary

This is the part worth arguing about, because it is where a content format becomes an attack surface on an app that holds a person's entire chat history.

- **No code, in any format.** No JavaScript, no WASM, no `eval`, no sandbox. RFC 0005's argument stands: a sandbox, a CSP, an RPC bridge and a permission model for third-party content is a large attack surface bought for nothing — the effects a game needs are primitives the host already implements.
- **No network.** A pack cannot fetch; `url()` is restricted to its own media; nothing in the manifest is a remote URL.
- **Read-only serving.** A pack's folder is never written after install. Nothing is copied out of it and nothing is written into it.
- **The extension is not a permission.** Opening a `.catcup` shows the review sheet. It never installs on drop, never on a double-click without an accept.

**And the Tauri CSP lands in the same change.** `apps/desktop/src-tauri/tauri.conf.json` carries `"csp": null` today, which means the webview enforces nothing: rule 2 above is one bug in our CSS validator away from being decorative. The policy —

```
default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'
```

— moves "no request leaves the machine" from a promise our parser makes to a property the runtime enforces. That is worth doing for its own sake and was already owed; the skin work is what makes it urgent.

## Migration

Nothing on disk needs converting.

- An **existing `.catcup`** with no manifest is read as `catcup.card`. Export writes the manifest from now on.
- **`.charx`, `.png` and `.json`** keep importing exactly as today. `.charx` becomes "a foreign package we read and write", which is a truer description than "the same file with another extension".
- The **format enum**, the drag filter, the picker's `accept` and the OS association collapse to `.catcup` plus the three foreign extensions — five code sites become one list.

## What this does not do

- **No pack-defined views.** The nine view types are the host's; a tenth is a host change.
- **No content in this repository.** A pack is a file a person installs, and the licence boundary falls on the pack.
- **No update channel.** A pack records its `version`; how an updated pack replaces an installed one is a later question, and the answer will not need a new extension.
- **No signing.** A pack is trusted because a person installed it, not because of a certificate. If that changes, it changes inside this container.

## Open questions

1. **Does a game pack choose its own skin, or does the person?** As written the pack declares `defaultSkin` and applies it inside the game view; the person may override it per save. The alternative — always the person's choice — keeps one decision-maker but means a pack's identity is never seen. Leaning as written: the pack proposes, the person disposes.
2. **Can a pack ship an `app`-scope skin?** Not as written; a pack's skins are `surface`. That stops a game from restyling Settings, at the cost of a game that genuinely wants to look like itself everywhere. If reopened, it is a permission on the review sheet, not a manifest field.
3. **Does `catcup.card` absorb the world info book?** The container could carry a card and its linked book and alias data, which would fix the aliases-do-not-survive-export gap recorded in `docs/LIMITATIONS.md`. It is a change to what a card export means, so it belongs in its own decision rather than in this one.
4. **Is `catcup.collection` the answer to "export several characters at once"?** The library has no bulk export today. One container holding several items is cheap to define and needs no new extension; whether it is worth having is a product question.
5. **What happens when two installed packs declare the same `id`?** They cannot both install: `id` is a directory name, and the second install is refused with the first one's version named. A reinstall of a newer version replaces in place. Confirm this is the shape wanted before the Games tab is built.

## Acceptance criteria

### Container and discriminator

- [ ] A `.catcup` whose manifest says `catcup.skin` installs as a skin; the same bytes with `catcup.game` are read as a game; an unknown `format` is refused naming it and the formats the host knows.
- [ ] A `.catcup` with **no** manifest imports as a character card, and the review sheet says it is a legacy card rather than a malformed pack.
- [ ] A `.charx`, `.png` and `.json` still import as they do today.
- [ ] An archive over 200 entries, 25 MB per entry or 60 MB total is refused before extraction, and so is a manifest over 10 MB.
- [ ] A `formatVersion` this host does not read, or an `engine.min` above it, is refused with both versions named.

### Skin

- [ ] A skin setting every token in the list renders the app in those values with no rebuild, verified by comparing computed styles.
- [ ] A token **not** in the list is refused by name.
- [ ] `checkSkin` reports every pair under 4.5:1 and installs anyway.
- [ ] CSS containing `@import`, a remote `url()`, an `@font-face` or an unclosed brace is refused with a line number.
- [ ] A `scope: "surface"` skin changes the game view and leaves the Settings dialog at the user's theme.

### Game pack

- [ ] Two packs declaring the same state key both work, because both are namespaced; an unprefixed key is refused.
- [ ] Every state write is validated against the declaration, and a wrong type is rejected by name.
- [ ] `media/**` is served read-only from one pack's folder, and a path escaping it answers 404.
- [ ] A pack declaring no skin installs and runs.
- [ ] A second install of the same `id` is refused with the first one's version named.

### Card pack

- [ ] An export writes a `manifest.json` with `format: "catcup.card"`.
- [ ] That export re-imports with its card and assets intact, and round-trips through another client after renaming to `.charx`.

### Security

- [ ] `tauri.conf.json` carries a CSP, and the app runs under it: import, chat, generation and media all work.
- [ ] No pack, skin or state file can cause a network request off the machine, checked against the CSP and the CSS validator together.
- [ ] Dropping a `.catcup` anywhere in the app opens the review sheet and writes nothing until accepted.

### Docs

- [ ] `docs/DATA-FORMATS.md` documents the container, the shared header and all three formats field by field.
- [ ] `docs/API.md` documents the pack routes.
- [ ] `docs/DESIGN.md` records the token list as the skin contract.
- [ ] `docs/SECURITY.md` records the CSP and the CSS rules as the pack boundary.
- [ ] `docs/MILESTONES.md`, `docs/LIMITATIONS.md` and `CHANGELOG.md` are updated in the same change.
