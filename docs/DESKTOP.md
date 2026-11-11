# Desktop shell

> Status: packaging implemented, installer built and verified on Windows, 2026-11-11. See [MILESTONES.md](MILESTONES.md) for the release step.

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

- **A real `require` in the bundle.** The dependencies are CommonJS and call `require` internally, which an ESM bundle cannot satisfy. The bundle build prepends a `createRequire` shim.
- **Pretty logs only on a terminal.** The packaged server's stdout is piped into the shell, so `pino-pretty` — which is not installed there — is skipped whenever stdout is not a TTY.
- **Verbatim paths.** Tauri hands back resource paths with the `\\?\` prefix on Windows, and Node cannot resolve a main module given that prefix; the shell strips it before spawning.
- **The SPA ships beside the server.** The server serves `../../web/dist` relative to its own `dist`, so the bundle keeps that shape and the desktop build needs `pnpm --filter @catcup/web build` as well.

## Readiness contract

The shell starts the server with:

| Variable          | Value            | Why                                                    |
| ----------------- | ---------------- | ------------------------------------------------------ |
| `CATCUP_HOST`     | `127.0.0.1`      | The desktop app is loopback-only unless LAN is enabled |
| `CATCUP_PORT`     | `0`              | The OS picks a free port                               |
| `CATCUP_DATA_DIR` | the app data dir | Keeps desktop data out of the install directory        |

Once listening, the server writes exactly one line to stdout:

```text
CATCUP_READY <port>
```

The shell reads stdout until that line, with a 30 second timeout, then opens `http://127.0.0.1:<port>`. Everything else the server prints is forwarded to the shell's console.

`CATCUP_PORT=0` is deliberate. Probing for a free port and then binding to it leaves a window where another process takes it; asking the OS to pick removes the race.

## Lifecycle

- **Normal exit.** Closing the last window ends the event loop; on `RunEvent::Exit` the shell kills and reaps the child.
- **Crash.** The child is placed in a Windows job object with `KILL_ON_JOB_CLOSE`, so killing the shell — Task Manager included — takes the server with it. If the process is already in a job that forbids nesting, the assignment is skipped and the normal exit path still applies.
- **Second launch.** The single-instance plugin focuses the existing window instead of starting a second server against the same data directory.

## Still open

- **Downloads.** The export buttons are `<a download>` links; WebView2's save behaviour has not been exercised yet.
- **Session persistence.** The webview keeps cookies in its own profile; confirm a login survives a restart.
- **Signing and the auto-updater.** Both need certificates and a hosting story that a demo does not have.
- **macOS and Linux.** Only Windows is packaged. The Rust code is portable apart from the job object, which is behind `#[cfg(windows)]`.

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
pnpm --filter @catcup/desktop build                        # prepares, then tauri build
```

The installer lands in `apps/desktop/src-tauri/target/release/bundle/nsis/`.

Two environment variables help when iterating: `CATCUP_SERVER_ENTRY` points the shell at a different server entry file, and `CATCUP_NODE` selects a different Node binary. Both are ignored when the bundled copies exist.

## Related docs

- [Milestones](MILESTONES.md) — the MVP scope and sequence
- [Architecture](ARCHITECTURE.md) — how the three shapes share one server
- [Deployment](DEPLOYMENT.md) — `CATCUP_PORT` and the ready line for supervisors
