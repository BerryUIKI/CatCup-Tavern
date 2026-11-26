# Desktop shell

> Status: packaging implemented 2026-11-11; since 2026-11-13 a merge into `main` that carries an untagged version builds and publishes the installer. See [MILESTONES.md](MILESTONES.md) for the release step.

The desktop build is a Tauri 2 window around the same Fastify server and React SPA the web build uses. It is not a second implementation: the shell starts the bundled server as a child process and points a webview at it.

## Why a child process

The server owns authentication, storage and the SSE stream. Running it as a process keeps one code path for the web, LAN and desktop shapes, and means a crash in one does not take the other down. Embedding it would require a Tauri-specific transport and a second way to serve the SPA.

```mermaid
sequenceDiagram
    participant T as Tauri shell
    participant S as Node sidecar
    participant W as Webview
    T->>S: spawn with HOST=127.0.0.1, PORT=0, app-data dir
    S-->>T: CATCUP_READY &lt;port&gt;
    T->>W: open http://127.0.0.1:&lt;port&gt;
    Note over T,S: child runs in a job object with KILL_ON_JOB_CLOSE
    T->>S: kill and reap on exit
```

## What ships

| Part                    | Where it comes from                                       | Size   |
| ----------------------- | --------------------------------------------------------- | ------ |
| Shell                   | `apps/desktop/src-tauri`                                  | ~9 MB  |
| Node runtime            | the Node running `scripts/fetch-node.mjs`                 | ~88 MB |
| Server                  | one bundled `dist/index.js` from `CATCUP_BUNDLE_DEPS=1`   | ~8 MB  |
| SPA                     | `apps/web/dist`, served by the server as on the web build | ~2 MB  |
| Claude vocabulary       | `apps/server/assets`                                      | ~2 MB  |
| Claude tokenizer module | `@agnai/web-tokenizers`, kept as a real module            | ~4 MB  |

The installer compresses all of that to roughly 27 MB.

The server is bundled into a single file so there is no `node_modules` to install beside it. One package stays external: `@agnai/web-tokenizers` ships a UMD wrapper that only loads through `require`, so it is copied into `server/node_modules` and resolved the same way it is in development.

`pnpm --filter @catcup/desktop build` runs three steps: prepare the server and web folders, copy the Node runtime, then `tauri build`. The installer is NSIS, installed per user, so it needs no administrator prompt.

## Packaging notes

Four things had to change to make the packaged layout behave like the development one:

- **A real `require` in the bundle.** The dependencies are CommonJS and call `require` internally, which an ESM bundle cannot satisfy. The bundle build prepends a `createRequire` shim, and also defines `__filename` and `__dirname` from `import.meta.url`. Without them `write-file-atomic` — which every settings and data write goes through — throws `ReferenceError: __filename is not defined` and the write fails, so the packaged app could not save a single setting.
- **Pretty logs only on a terminal.** The packaged server's stdout is piped into the shell, so `pino-pretty` — which is not installed there — is skipped whenever stdout is not a TTY. The piped output goes to `shell.log`; see the readiness contract below.
- **Verbatim paths.** Tauri hands back resource paths with the `\\?\` prefix on Windows, and Node cannot resolve a main module given that prefix; the shell strips it before spawning.
- **The sidecar is named `catcup-node`, not `node`.** On Windows either name works, but a deb or rpm install puts external binaries in `/usr/bin`, where a binary called `node` would replace the distribution's nodejs package. The shell looks for `catcup-node` next to its own executable and falls back to `CATCUP_NODE` or whatever `node` is on `PATH`.
- **The sidecar name carries the target triple.** `scripts/fetch-node.mjs` derives it from the running Node (`TAURI_ENV_TARGET_TRIPLE` is only set for `beforeBuildCommand` hooks, and this project has none), so a macOS or Linux build does not quietly ship a Windows executable.
- **The SPA ships beside the server.** The server serves `../../web/dist` relative to its own `dist`, so the bundle keeps that shape and the desktop build needs `pnpm --filter @catcup/web build` as well.

## Readiness contract

The shell starts the server with:

| Variable          | Value                             | Why                                                  |
| ----------------- | --------------------------------- | ---------------------------------------------------- |
| `CATCUP_HOST`     | `127.0.0.1`                       | The desktop app is loopback-only; it has no LAN mode |
| `CATCUP_PORT`     | `0`                               | The OS picks a free port                             |
| `CATCUP_DATA_DIR` | the app data dir, or the override | Keeps desktop data out of the install directory      |

Once listening, the server writes exactly one line to stdout:

```text
CATCUP_READY <port>
```

The shell reads stdout until that line, with a 30 second timeout, then opens `http://127.0.0.1:<port>`. Everything else the server prints — stdout and stderr alike — is appended to `shell.log` in the data directory, beside the chats and settings. That is where to look when the app will not start or an API call fails: a release build has no console to print to. The file is rotated to `shell.log.1` at launch once it passes 4 MB, so it keeps one previous launch rather than growing without limit.

The sidecar is started with `CREATE_NO_WINDOW` on Windows. It is a console-subsystem executable, and Windows allocates a console window for one started by a GUI process — without the flag, launching the app opened a black box that stayed on screen until Quit. The flag gives the child a hidden console: its standard handles still work, so the ready line, the log and the pipes behave exactly as before.

`CATCUP_PORT=0` is deliberate. Probing for a free port and then binding to it leaves a window where another process takes it; asking the OS to pick removes the race.

## Data directory

The desktop app keeps its data in the OS app-data directory — `%APPDATA%\dev.catcup.tavern` on Windows — which is separate from the web build's `data/`. That is deliberate: an installer that wrote into its own install folder would lose data on upgrade, and a shared folder would let two servers write the same chat files.

Setting `CATCUP_DATA_DIR` before launch overrides that. The shell passes it straight to the server, so pointing it at the web build's `data/` folder opens the desktop app on the same characters, chats, world info and presets, without copying anything:

```bash
CATCUP_DATA_DIR="F:/dev/CatCup-Tavern/data" catcup-tavern.exe
```

Two things to know before doing that:

- **Only one shape at a time.** The per-file locks in storage are in-process mutexes, not OS file locks, and nothing locks the folder itself. Two servers pointed at the same folder would overwrite each other, so stop the web server first.
- **The password travels with the folder.** If `auth.json` exists, the desktop app asks for that password like any other install; only a folder with no `auth.json` opens straight into the app.

Pointing at a copy is the safer way to try a migration: copy `data/`, point the app at the copy, and keep the original untouched until the desktop build has been used for a while.

The shell's log — `shell.log`, described under the readiness contract — lives in this directory too, so it follows `CATCUP_DATA_DIR`. When the data directory cannot be opened for writing the app still starts; its log is simply empty, and the pipes are still drained so the server is never blocked.

## Lifecycle

- **Closing the window.** The close button hides the window to the notification area. The shell, the server and any generation in flight keep running: `WindowEvent::CloseRequested` calls `prevent_close()` and hides the window instead of letting it close. **Quit** on the tray menu is the only way to exit.
- **Normal exit.** **Quit** calls `app.exit(0)`, which ends the event loop without raising a close request; on `RunEvent::Exit` the shell kills and reaps the child.
- **Crash.** The child is placed in a Windows job object with `KILL_ON_JOB_CLOSE`, so killing the shell — Task Manager included — takes the server with it. If the process is already in a job that forbids nesting, the assignment is skipped and the normal exit path still applies.
- **Second launch.** The single-instance plugin shows and focuses the existing window instead of starting a second server against the same data directory, and it works while the window is hidden — `set_focus` alone would do nothing to a hidden window.
- **Window state.** Size, position, maximised and full-screen state are remembered between launches through `tauri-plugin-window-state`, which stores them in `.window-state.json` under the app config directory. Visibility is deliberately not restored: quitting from the tray while the window is hidden must not start the next launch with no window on screen. A saved position is only reused when it still intersects a monitor, so unplugging a second display does not strand the window off-screen. On a first launch, or after the file is deleted, the window opens at its default 1280 × 820.
- **Title bar.** On Windows the native title bar is removed and the page draws its own (see _Custom title bar_ below). macOS and Linux keep the native decoration; the SPA reads `titleBar: null` from `/api/auth/status` there and draws nothing.
- **Tray icon.** An icon sits in the notification area from startup. Its menu has **Open CatCup Tavern** and **Quit**; left-clicking the icon opens the window and focuses it, and right-clicking opens the menu. This is the only way back once the window is hidden, which is why the left click is wired to open rather than to the menu.

## Custom title bar

The shell removes the native frame on Windows and the page draws the bar. The implementation is `apps/desktop/src-tauri/src/chrome.rs` (frame removal, corners) and `apps/web/src/components/TitleBar.tsx` (everything the user sees and presses).

**Fusion, not a second strip.** The bar is an overlay, not a row: the window buttons float over the top-right corner of the library rail and the chat header, and those two add `titleBarHeight` to their own top padding so nothing sits under them. The brand — logo and product name — stays in the library rail where it already was, so it appears once rather than in a bar and again below it. The cost is 32 logical pixels on those two headers; a separate bar would have cost a full row and repeated the brand.

**Where the geometry comes from.** `chrome.rs` owns the numbers: `TITLE_BAR_HEIGHT` (32), `BUTTON_WIDTH` (46) and `BUTTON_ORDER`. The shell passes them to the server as `CATCUP_TITLE_BAR_*`, the server hands them back on `/api/auth/status` as `titleBar`, and the SPA sizes the strip and the buttons from that. One source, so the two sides cannot drift apart.

**Why the page drives the window.** The obvious implementation subclasses the window and answers `WM_NCCALCSIZE`, `WM_NCHITTEST` and `WM_NCLBUTTONDOWN` — that is how Electron's `titleBarStyle: "hidden"` works, and `HTMAXBUTTON` over the page's maximise button is what raises the Snap Layout flyout. **It does not work in a Tauri/webview window, and this was measured rather than assumed.** WebView2 runs as a child window covering the whole client area and takes every mouse message itself, so the top-level window procedure never sees a hit test over the bar. A subclass installed on the top-level window received no `WM_NCHITTEST` at all while the pointer moved across the bar — the only `WM_NCLBUTTONDOWN` it ever saw was `HTTOP` from a resize gutter — and the window could neither be dragged nor have its buttons pressed. Hence:

- **Dragging** is `data-tauri-drag-region` on the strip, which invokes `plugin:window|start_dragging` from the page. A double click on the strip toggles maximise.
- **The buttons** are real `<button>`s that invoke `plugin:window|minimize`, `toggle_maximize` and `close`. They are focusable and named (**Minimize**, **Maximize**/**Restore**, **Close**), and the glyph flips to Restore from `is_maximized`.
- **The capability.** The page is served by the sidecar over loopback, which Tauri treats as a remote origin, so `capabilities/title-bar.json` grants those five window commands to `http://127.0.0.1:*` on the `main` window. Nothing else is granted; this is the only IPC surface the page has.

**What the frame costs.** `set_decorations(false)` drops `WS_THICKFRAME` with the frame, so `install` puts that style back — that is what keeps the resize gutters and Aero Snap. Rounded corners come from `DWM_WINDOW_CORNER_PREFERENCE` = `DWMWCP_ROUND`, because a frameless window loses them.

**Known limitation: no Snap Layout flyout.** Hovering the maximise button does not raise Windows 11's Snap Layout panel, because raising it requires a non-client `HTMAXBUTTON` hit that the webview never lets the window procedure see. `Win`+arrow keys and dragging to a screen edge still snap. This is the price of a webview-based custom title bar and is listed in `docs/LIMITATIONS.md`.

**What was rejected.** `tauri-plugin-decorum` was evaluated and not used. Its snap support is a simulated `Win+Z` sent through `enigo` some 620 ms after the pointer rests on its button — a keyboard-driven overlay, not the native flyout — and its last release (2024-09) pins `tauri 2.0.0-rc`.

## Opening a card file

The installer registers `.catcup` as a CatCup file type, so double-clicking one — or **Open with** from Explorer — starts the app with that file's path as its argument. Windows hands it over as `"<install dir>\catcup-desktop.exe" "C:\…\card.catcup"`.

The path is taken literally. It is **not** run through the URL parser first: `C:\cards\mira.catcup` parses as a URL whose scheme is `c`, and converting that back to a path fails, so every drive-letter argument would be dropped and nothing would open. Only a `file://` argument — which macOS and Linux deliver — goes through the parser, so porting the shell does not quietly lose those. Arguments are accepted only when the file exists and has an extension the server imports: `.png`, `.json`, `.charx` or `.catcup`.

The shell does not import the file itself. The path waits until the webview reports that the page has finished loading, then the shell evaluates a small script in the page that posts it to `POST /api/characters/import-path` and reloads, so the library shows the new card. The import is a **copy**: the original file is left where it is, and so is any later editing of the card.

A second launch never starts a second server. The single-instance plugin forwards its arguments to the running app, which imports the card and brings its window to the front — including when the window was hidden in the tray. A card opened while the page is still loading waits in the same queue as one opened at startup.

**Only `.catcup` is registered.** `.png` and `.json` are accepted on import, but claiming either in the installer would make CatCup the default handler for every image and every JSON file on the machine; `.charx` is RisuAI's format, so CatCup opens it but does not claim it.

## Still open

- **The 0.3.2 and 0.4.0 installers cannot update themselves.** Their `latest.json` named a download URL that answers 404 — the manifest was built from the bundler's on-disk file name while `gh release upload` stored it with the spaces replaced by dots. The publish step is fixed (see [Releasing an update](#releasing-an-update)), so the next release's manifest is checked before it is published, but nothing already installed can cross that gap: an app on 0.3.2 or 0.4.0 has to be replaced by a fresh install once, and updates work from then on.
- **Downloads.** The export buttons are `<a download>` links; WebView2's save behaviour has not been exercised yet.
- **Session persistence.** The webview keeps cookies in its own profile; confirm a login survives a restart.
- **Browser speech voices.** WebView2's `speechSynthesis` voice list has not been exercised; if it is empty, use the OpenAI-compatible TTS backend.
- **Code signing is deferred.** The installer has no Authenticode certificate, so SmartScreen warns once on the first run of a downloaded installer; the user clicks through it. This does not hold anything back: the update archive is signed with CatCup's own key and verified before it installs, and an update downloaded by the app never carries the browser's download mark, so SmartScreen does not appear on updates at all. Signing buys a publisher name in that one warning — not the ability to run.
- **The access password is optional here.** The shell sets `CATCUP_DESKTOP=1`, so a fresh install opens straight into the app and never shows a setup screen. A password set from About → Access password brings the login screen back, and removing it returns to open mode. Web and LAN installs are unchanged. The server refuses to start in this mode with a non-loopback host, so an unauthenticated desktop API cannot reach the LAN.
- **macOS and Linux.** The shell builds and packages on both: `tauri.macos.conf.json` produces `.app` and `.dmg`, `tauri.linux.conf.json` produces `.deb` and `.AppImage`, and CI compiles all three platforms on every pull request. But only Windows is released. An unsigned macOS build is refused by Gatekeeper on any machine that did not build it, and neither platform has been run — the CI job proves it compiles, not that the app works there.

## Tray icon

The icon is built in `install_tray` from the window icon declared in `tauri.conf.json`. Tauri keeps it alive in its resource table, so the shell does not have to store the handle. The menu is a `Menu` with **Open CatCup Tavern**, **Check for Updates…** and **Quit**, separated from **Quit** by a separator; **Quit** calls `app.exit(0)`, which skips the close handler and still runs the exit path that kills the sidecar.

The icon needs the `tray-icon` feature on the `tauri` crate. Left-click handling is enabled by turning `show_menu_on_left_click` off, which is the opposite of the Windows default; with the default, Windows fires the click event _and_ pops the menu over the window it just opened.

The tray is not optional, and `install_tray` failing aborts startup. With close-to-tray, a build that hid its only window and had no icon to bring it back would be unrecoverable — and a release build has no console to fall back on (`windows_subsystem = "windows"`).

## Updates

The shell carries `tauri-plugin-updater`. **Check for Updates…** in the tray menu asks the configured endpoint for a newer release; if there is one, the archive is downloaded, the server is stopped, and the installer replaces the app and starts it again. The check runs on a background thread so the menu stays usable, and its result — installed, up to date, or failed — appears in a native message box, because a release build has no console.

| Piece              | Where                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Update endpoint    | `plugins.updater.endpoints` in `tauri.conf.json` — `…/releases/latest/download/latest.json`     |
| Signing public key | `plugins.updater.pubkey`, generated with `tauri signer generate`                                |
| Installer UI       | `plugins.updater.windows.installMode` — `passive`, so progress shows but no questions are asked |

Both the endpoint and the key are mandatory: the plugin panics at startup rather than silently disabling updates when either is missing or malformed, so a broken config fails immediately instead of shipping an app that can never update.

The server is stopped before the installer runs, because the Node runtime, the server bundle and the SPA all live inside the install directory and cannot be replaced while the server holds them open. That is why `download` and `install` are called separately instead of `download_and_install`, which gives no point to intervene between the two.

### Releasing an update

`createUpdaterArtifacts` is deliberately **not** in `tauri.conf.json` — the release workflow enables it for the build:

```bash
pnpm --filter @catcup/desktop exec tauri build --config '{"bundle":{"createUpdaterArtifacts":true}}'
```

Keeping it out of the checked-in config means a local `tauri build` still works without the signing key. The key lives in repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY` — the contents of the key file from `tauri signer generate`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — only when the key was generated with a password

Without the key the workflow still builds and publishes the plain installer and says so in the run summary; that release just cannot be offered as an update. With it, the signed artifact and a `latest.json` manifest are published: the manifest names the artifact by URL and carries the contents of its `.sig`, and `releases/latest/download/latest.json` resolves that manifest for every installed app.

What gets signed depends on the bundler version. Current Tauri signs the NSIS installer itself and leaves `<installer>.exe.sig` beside it — there is no separate archive — while older bundlers produced a `*.nsis.zip` to sign. The publish step prefers the archive when one exists and otherwise uses the signed installer, publishing the installer once either way, plus its `.sig` and `latest.json`. A release that lists only an `.exe` and no `latest.json` was built without a key, whatever the secret list says.

Two details decide whether the workflow takes the signed path, and both have gone wrong before:

- **The secret must hold the key's content, not a path.** `gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/catcup.key` uploads the file; setting it to the path string produces a non-empty secret that cannot sign, and the build fails rather than skipping.
- **The stored public key must be the one that pairs with that private key.** A mismatch is silent until an update is attempted: the app downloads the archive, rejects the signature and reports the failure to the user. 0.3.0 and 0.3.1 both shipped without updater artifacts because the secret existed but carried no key, so neither could sign; the pinned key has to be replaced in the same change that re-uploads the secret.
- **The URL in the manifest has to name the asset as GitHub stored it, not as the bundler wrote it.** `gh release upload` substitutes every character outside `[A-Za-z0-9._-]` with `.`, so the bundler's `CatCup Tavern_1.2.3_x64-setup.exe` is published as `CatCup.Tavern_1.2.3_x64-setup.exe`. Building the manifest URL from the on-disk name therefore produced a signed, well-formed `latest.json` pointing at a 404 — which is exactly as indistinguishable from a working update as the key problems above. **0.3.2 and 0.4.0 both shipped that way.** The publish step now uploads the installer first, reads the stored name back from the release listing, builds the URL from that, and then fetches the URL it just wrote; a release whose manifest does not answer `200` or `206` fails instead of publishing. The comparison applies the same substitution to both names, so it keeps working if `gh` ever stops renaming.

The key currently deployed was generated without a password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is deliberately absent. Adding a password later means re-generating the keypair and replacing both, because a mismatched pair cannot verify.

Losing the private key means every installed app has to be updated by hand once: the public key pinned in `tauri.conf.json` no longer matches anything the workflow can sign.

## Layout

```text
apps/desktop/
  src-tauri/          Rust shell, Tauri config, icons
  scripts/            prepare-server.mjs and fetch-node.mjs, run by `pnpm build`
  ui/                 placeholder frontend dist; the window loads the server URL instead
```

## Building

```bash
CATCUP_BUNDLE_DEPS=1 pnpm --filter @catcup/server build   # one-file server
pnpm --filter @catcup/web build                            # SPA served beside it
pnpm --filter @catcup/desktop build                        # prepares, then tauri build
```

The installer lands in `apps/desktop/src-tauri/target/release/bundle/nsis/`.

The same three commands build the other platforms, because `fetch-node.mjs` picks the target triple from the running Node and the per-platform config files pick the bundle targets:

| Host    | Config                  | Artifacts                                                      |
| ------- | ----------------------- | -------------------------------------------------------------- |
| Windows | `tauri.conf.json`       | NSIS installer in `bundle/nsis/`                               |
| macOS   | `tauri.macos.conf.json` | `.app` and `.dmg` in `bundle/macos/` and `bundle/dmg/`         |
| Linux   | `tauri.linux.conf.json` | `.deb` and `.AppImage` in `bundle/deb/` and `bundle/appimage/` |

Linux needs the Tauri prerequisites installed first — the CI job installs exactly these:

```bash
sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
    librsvg2-dev libxdo-dev patchelf
```

GitHub Actions runs the same three steps on `windows-latest` when a merge into `main` carries an untagged version, or when a `v*` tag is pushed, and attaches the installer to the GitHub release; see [DEVELOPMENT.md](DEVELOPMENT.md#continuous-integration). The local commands above are for iterating on the shell.

Two environment variables help when iterating: `CATCUP_SERVER_ENTRY` points the shell at a different server entry file, and `CATCUP_NODE` selects a different Node binary. Both are ignored when the bundled copies exist.

## Related docs

- [Milestones](MILESTONES.md) — the MVP scope and sequence
- [Architecture](ARCHITECTURE.md) — how the three shapes share one server
- [Deployment](DEPLOYMENT.md) — `CATCUP_PORT` and the ready line for supervisors
