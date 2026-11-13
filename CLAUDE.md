# CatCup Tavern — CLAUDE.md

## Project

A SillyTavern-style AI roleplay client. Three shapes share one codebase:

- **Web**: Node/Fastify server + React SPA
- **LAN**: the same server bound to `0.0.0.0`, single user + access password
- **Desktop**: a Windows app that runs the same server as a child process and wraps it in a Tauri 2 window

Hard constraint: **high compatibility with SillyTavern's data formats and interaction semantics**. Character cards (PNG/JSON V2/V3), chat JSONL, world info JSON, prompt presets and STscript/slash commands must interoperate.

Current status: **0.3.0 released (2026-11-13)**; `dev` carries the next batch, not yet released. M0, M1, M2 and the 0.2.x MVP are complete. Since 0.3.0, `dev` has the whole desktop scope — tray icon, window-state restore, self-update with signed artifacts, `.catcup` file associations, packaged macOS/Linux builds and a CI job that compiles the shell on all three platforms — plus CatCup's own `.catcup` package format, a password-change screen for web and LAN, impersonation and drag-and-drop import. Windows code signing is deliberately deferred. M3 (STscript, full Quick Replies, the extension API) and M5 (mobile, i18n, accessibility, UX stages C–E) are still ahead. The authoritative scope and acceptance criteria live in `docs/MILESTONES.md`; the user-facing gaps are listed in `docs/LIMITATIONS.md`. A full-app UX overhaul is in progress (stage A: Settings and Providers landed 2026-11-12; stage B: app shell and chat chrome landed 2026-11-13); follow `docs/DESIGN.md` for interface work.

## Commands

```bash
pnpm dev          # server :8000 + web :5173
pnpm build        # build both workspaces
pnpm start        # production mode, one port :8000
pnpm --filter @catcup/desktop build  # Windows installer (needs Rust)
pnpm typecheck
pnpm test
pnpm lint
```

The desktop shell is Rust. `cargo check` runs the Tauri build script, which copies the server bundle, the SPA and the Node sidecar into `target/`, so prepare those first:

```bash
CATCUP_BUNDLE_DEPS=1 pnpm --filter @catcup/server build
pnpm --filter @catcup/web build
pnpm --filter @catcup/desktop bundle
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # what CI runs, on all three platforms
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml   # shell unit tests
```

Releases are cut by merging `dev` into `main` after bumping the version: `.github/workflows/release.yml` notices the untagged `package.json` version, creates the `v<version>` tag on that commit and attaches the Windows installer to the GitHub release. When `TAURI_SIGNING_PRIVATE_KEY` is in the repository secrets it also publishes the signed updater archive and `latest.json`, which is what lets an installed app update itself. The release body comes from that version's `CHANGELOG.md` section. See `CONTRIBUTING.md#releases`.

## Layout

```text
.github/                CI and release workflows, issue and pull-request templates, Dependabot
apps/
  server/               Fastify server
    src/cards/          character card parsing (PNG tEXt / JSON v2-v3) and CharX/CatCup packages
    src/providers/      OpenAI-compatible / OpenRouter / Anthropic / Ollama
    src/prompt/         prompt assembly, token budgeting and group prompts
    src/generation/     the SSE stream shared by single-character and group generation
    src/worldinfo/      world info loader, scanner, timed effects and prompt buckets
    src/group/          group member resolution, speaker selection and reply cleanup
    src/memory/         rolling summaries: schedule, request building and injection
    src/quickreplies/   quick reply storage target and command execution
    src/tts/            OpenAI-compatible speech adapter
    src/images/         A1111 / ComfyUI / OpenAI-compatible image adapters
    src/import/         SillyTavern folder import
    src/routes/         REST + SSE routes
    src/security/       password hashing, session cookies
    src/storage/        ST-compatible file storage
  web/                  React SPA
    src/components/     layout, chat, groups, settings, auth
    src/hooks/          React Query data hooks
    src/lib/            API / SSE clients
    src/store/          Zustand UI state
  desktop/              Tauri 2 shell; src-tauri/ holds the Rust sidecar host, tray, updater and window state
packages/shared/        Zod schemas, shared types, ST data models
assets/brand/           brand masters and their generated icons (see assets/brand/README.md)
docs/                   handbook (see docs/README.md)
scripts/                repository tooling; `pnpm icons` rebuilds every icon from the brand masters
.ref/                   SillyTavern / RisuAI reference checkouts (gitignored)
data/                   runtime data (gitignored)
```

## Documentation map

Read before changing behaviour:

- `docs/README.md` — documentation index and reading paths.
- `docs/MILESTONES.md` — source of truth for scope, status and acceptance criteria.
- `docs/ARCHITECTURE.md` — topology, stack decisions and data flow.
- `docs/DESIGN.md` — interface principles, layout, tokens, components, interaction and accessibility.
- `docs/API.md` — REST/SSE contracts.
- `docs/DATA-FORMATS.md` — ST-compatible cards, chats, world info, presets and internal files.
- `docs/PROVIDERS.md` — provider adapters and configuration.
- `docs/LIMITATIONS.md` — user-facing: what this release does and does not do; the About tab links here.
- `docs/ST-COMPATIBILITY.md` — what works, what is partial, what is planned.
- `docs/DEVELOPMENT.md` — setup, testing and extension workflows.
- `docs/DEPLOYMENT.md` — production, LAN, reverse proxy, backup and upgrades.
- `docs/DESKTOP.md` — Tauri shell, server sidecar and the readiness contract.
- `docs/SECURITY.md` — auth, secrets, threat model and hardening backlog.
- `docs/TROUBLESHOOTING.md` — common failures.
- `docs/GLOSSARY.md` — terminology.
- `docs/REUSE.md` — licensing and code reuse.

**Docs are part of done.** Update the relevant page and `CHANGELOG.md` in the same change. If scope moves, update `docs/MILESTONES.md` first.

## Git workflow

- `main` is the release baseline.
- `dev` is the integration branch.
- Feature branches are cut from `dev`; PRs target `dev`.
- Use merge commits, not squash, for stacked PRs.
- Small PRs, atomic commits; see `CONTRIBUTING.md`.

## Conventions

- **English-first.** UI copy, comments, docs and error messages are English. i18n is deferred; keep user-facing strings centralized enough to extract later, but do not add an i18n framework yet.
- API keys may only live in `data/secrets.json`. No API response may contain a plaintext key; the client sees only `hasKey`.
- Single user + password. First-time setup is limited to loopback. LAN login uses the same password. Every shape can change the password; only the desktop can remove one, because a LAN server with none would be reachable and unauthenticated.
- Before changing character card / chat / world info / preset schemas, compare with `.ref/SillyTavern` and preserve field names and the JSONL header format.
- `.ref/` is for reading only. **Never import from it at runtime and never use it as a build input.**
- When adding code adapted from ST or RisuAI, update `NOTICE` and `docs/REUSE.md` in the same change.
- License: AGPL-3.0-only. SillyTavern is AGPL-3.0; RisuAI is GPL-3.0 (compatible under AGPLv3 §13).
- Frontend: React + Tailwind 4. Theme tokens live in the `@theme` block of `apps/web/src/styles.css`.
- Interface work follows `docs/DESIGN.md`: one primary action per surface, explicit save with a leave guard for configuration forms, visible focus, focus-trapped dialogs and no hover-only actions.
- Chat streaming uses SSE: `start` / `token` / `reasoning` / `done` / `error`. The server owns persistence; the client only renders optimistically. The `start` event carries the model the request resolved to.
- Do not transplant ST's jQuery/DOM code into React. Port algorithms and data semantics only.
- Never commit `data/`, `.ref/`, `.env`, build output or secrets.

## Current milestones

- **M0** (complete): scaffold, auth, card import, chat persistence, four provider families, streaming and dark tavern UI.
- **M1** (complete): world info scanning/editor, Prompt Manager, ST preset import/export, message editing/branching, alternate greetings, model-aware tokenizer.
- **M2** (complete, shipped in 0.3.0): group chats (storage, UI and generation, all three SillyTavern card modes, card depth prompts and auto mode; multi-member replies in one request are still M3-era work), summary memory, the Quick Replies subset, TTS, image generation (Automatic1111, ComfyUI and OpenAI-compatible), CharX import/export, and library favorites/tags/sorting/bulk actions. Regex scripts and card editing/export shipped in 0.2.0.
- **M3** (planned): full STscript, the full Quick Replies engine (STscript-backed, with auto-execution and context menus), getContext/event bus and the extension sandbox.
- **M4** (landed on `dev` 2026-11-13, unreleased): tray icon, window-state restore, self-update from signed release artifacts, `.catcup` file associations, macOS/Linux packaging and a CI job that compiles the shell on all three platforms. Authenticode signing is deferred on purpose — see `docs/MILESTONES.md`. The Windows shell and packaging shipped in 0.2.0.
- **M5** (planned): mobile, i18n, accessibility, UX stages B–E, performance and v1.0 release.

The detailed acceptance criteria are in `docs/MILESTONES.md`.

## References

- SillyTavern 1.19.0 (`.ref/SillyTavern`)
- RisuAI (`.ref/RisuAI`, Svelte 5 + Tauri 2.5)
- Architecture: `docs/ARCHITECTURE.md`
- Reuse list: `docs/REUSE.md`
