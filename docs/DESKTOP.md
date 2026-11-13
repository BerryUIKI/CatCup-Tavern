# Desktop shell

> Status: packaging implemented 2026-11-11; since 2026-11-13 a merge into `main` that carries an untagged version builds and publishes the installer. See [MILESTONES.md](MILESTONES.md) for the release step.

The desktop build is a Tauri 2 window around the same Fastify server and React SPA the web build uses. It is not a second implementation: the shell starts the bundled server as a child process and points a webview at it.

## Why a child process

The server owns authentication, storage and the SSE stream. Running it as a process keeps one code path for the web, LAN and desktop shapes, and means a crash in one does not take the other down. Embedding it would require a Tauri-specific transport and a second way to serve the SPA.

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
- **Pretty logs only on a terminal.** The packaged server's stdout is piped into the shell, so `pino-pretty` — which is not installed there — is skipped whenever stdout is not a TTY.
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

The shell reads stdout until that line, with a 30 second timeout, then opens `http://127.0.0.1:<port>`. Everything else the server prints is forwarded to the shell's console.

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

## Lifecycle

- **Normal exit.** Closing the last window ends the event loop; on `RunEvent::Exit` the shell kills and reaps the child.
- **Crash.** The child is placed in a Windows job object with `KILL_ON_JOB_CLOSE`, so killing the shell — Task Manager included — takes the server with it. If the process is already in a job that forbids nesting, the assignment is skipped and the normal exit path still applies.
- **Second launch.** The single-instance plugin focuses the existing window instead of starting a second server against the same data directory.

## Still open

- **Downloads.** The export buttons are `<a download>` links; WebView2's save behaviour has not been exercised yet.
- **Session persistence.** The webview keeps cookies in its own profile; confirm a login survives a restart.
- **Browser speech voices.** WebView2's `speechSynthesis` voice list has not been exercised; if it is empty, use the OpenAI-compatible TTS backend.
- **Signing and the auto-updater.** Both need certificates and a hosting story that a demo does not have; until they land, an upgrade is a manual download of the new installer.
- **Tray icon and window state.** The window is a single webview that closes the app; there is no tray icon, and the window's size and position are not remembered between launches.
- **The access password is optional here.** The shell sets `CATCUP_DESKTOP=1`, so a fresh install opens straight into the app and never shows a setup screen. A password set from About → Access password brings the login screen back, and removing it returns to open mode. Web and LAN installs are unchanged. The server refuses to start in this mode with a non-loopback host, so an unauthenticated desktop API cannot reach the LAN.
- **macOS and Linux.** The shell builds and packages on both: `tauri.macos.conf.json` produces `.app` and `.dmg`, `tauri.linux.conf.json` produces `.deb` and `.AppImage`, and CI compiles all three platforms on every pull request. But only Windows is released. An unsigned macOS build is refused by Gatekeeper on any machine that did not build it, and neither platform has been run — the CI job proves it compiles, not that the app works there.

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
