# Desktop shell

> Status: spike verified on Windows, 2026-11-11. Packaging proper follows the MVP sequence in [MILESTONES.md](MILESTONES.md).

The desktop build is a Tauri 2 window around the same Fastify server and React SPA the web build uses. It is not a second implementation: the shell starts the built server as a child process and points a webview at it.

## Why a child process

The server owns authentication, storage and the SSE stream. Running it as a process keeps one code path for the web, LAN and desktop shapes, and means a crash in one does not take the other down. Embedding it would require a Tauri-specific transport and a second way to serve the SPA.

## Readiness contract

The shell starts the server with:

| Variable          | Value            | Why                                                    |
| ----------------- | ---------------- | ------------------------------------------------------ |
| `CATCUP_HOST`     | `127.0.0.1`      | The desktop app is loopback-only unless LAN is enabled |
| `CATCUP_PORT`     | `0`              | The OS picks a free port                               |
| `CATCUP_DATA_DIR` | the app data dir | Keeps desktop data out of the repository checkout      |

Once listening, the server writes exactly one line to stdout:

```text
CATCUP_READY <port>
```

The shell reads stdout until that line, with a 30 second timeout, then opens `http://127.0.0.1:<port>`. Everything else the server prints is forwarded to the shell's console.

`CATCUP_PORT=0` is deliberate. Probing for a free port and then binding to it leaves a window where another process takes it; asking the OS to pick removes the race. The ready line is how the shell learns what was picked.

## Shutdown

Closing the last window ends the Tauri event loop. On `RunEvent::Exit` the shell kills and reaps the child, so no server process outlives the window.

## What the spike proved

Verified on Windows 10, Rust 1.97.1, WebView2 136, 2026-11-11:

- Tauri 2 builds with the installed MSVC toolchain and the generated app starts.
- The shell spawns Node, parses `CATCUP_READY`, and opens the window on the reported port.
- The webview loads the SPA from the sidecar: `/`, the JS and CSS bundles, `/favicon.ico` and `/api/auth/status` all returned `200`, and the app rendered its first-run setup screen.
- A graceful window close (`taskkill` without `/F`) printed `[shell] stopping the server` and left no `node.exe` behind.

## Not yet proven, and required before 0.2.0

- **Bundled runtime.** The spike runs `node` from `PATH`. Shipping needs `node.exe` as a Tauri sidecar and the server's `dist/` plus `assets/` as resources; expect roughly 100 MB installed.
- **Crash cleanup.** A hard kill of the shell orphans the server. Windows needs a Job Object with `KILL_ON_JOB_CLOSE`, or the server has to exit when its stdin closes.
- **Single instance.** Two launches would share the data directory and run two servers. Needs the single-instance plugin or a lock file.
- **Downloads.** The export endpoints are `<a download>` links; WebView2's save behaviour is untested.
- **Session persistence.** The webview keeps cookies in its own profile; confirm a login survives a restart.
- **Window state, tray icon and first-run polish.** Planned, not built.

## Layout

```text
apps/desktop/
  src-tauri/     Rust shell, Tauri config and icons
  ui/            placeholder frontend dist; the window loads the server URL instead
```

## Running the spike

```bash
pnpm --filter @catcup/server build
cargo build --manifest-path apps/desktop/src-tauri/Cargo.toml
./apps/desktop/src-tauri/target/debug/catcup-desktop.exe
```

Two environment variables help when iterating: `CATCUP_SERVER_ENTRY` points the shell at a different server entry file, and `CATCUP_NODE` selects a different Node binary.

## Related docs

- [Milestones](MILESTONES.md) — the MVP scope and sequence
- [Architecture](ARCHITECTURE.md) — how the three shapes share one server
- [Deployment](DEPLOYMENT.md) — `CATCUP_PORT` and the ready line for supervisors
