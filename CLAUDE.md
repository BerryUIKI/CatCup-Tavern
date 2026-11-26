# CatCup Tavern — CLAUDE.md

## Project

A tavern-style AI roleplay client. Three shapes share one codebase:

- **Web**: Node/Fastify server + React SPA
- **LAN**: the same server bound to `0.0.0.0`, single user + access password
- **Desktop**: a Windows app that runs the same server as a child process and wraps it in a Tauri 2 window

Compatibility is **two rules, not one**:

- **Data formats are a hard constraint.** Character cards (PNG/JSON V2/V3), chat JSONL, world info JSON, prompt presets and STscript/slash commands must import, export and round-trip without loss, and every file we write must stay readable by the other tavern clients. Field names, the JSONL header shape and unknown-field preservation are not negotiable. These are a shared standard, not one product's file layout — implement the specification.
- **Runtime semantics are a default, not a mandate.** How world info is matched, how memory is stored and how a reply is assembled follows the reference implementations unless a divergence measurably improves the experience. A divergence is allowed when it is opt-in, leaves imported data readable by every client, and is recorded in `docs/ST-COMPATIBILITY.md` with the reason and the setting that controls it. Following another client's _algorithms_ is a compatibility convenience; reproducing its _limitations_ is not.

Current status: **0.4.0 released (2026-11-26)**, milestone **M2.5 — channels and guidance**; `main` carries the next batch, not yet released. 0.4.0 adds a per-chat director with options after each reply, a Telegram channel (chat binding, export import, finish notifications), world info aliases stored in a sidecar beside the book, an opt-in lexical (BM25F) retrieval pass, append-only summaries, the OpenAI Responses and Gemini native request protocols, a self-drawn desktop title bar, a nine-language landing page, trunk-based development on `main` alone, and the completion of the code-provenance rewrite — no file in the tree carries a `Derived from` header any more. M0, M1, M2, M2.5 and the 0.2.x MVP are complete; M4's shell is complete with signing deliberately deferred and macOS/Linux unreleased. 0.3.2 turned the provider form's Type list into a request protocol with a first-class custom-provider entry, replaced every native dropdown with CatCup's own `Select`/`Combobox`, and fixed the desktop console window, the Add-model button closing the Providers panel, and Sign out on an install with no password. 0.3.1 added profiles — a profile is a data scope, with an opt-in per-item shared layer — a multi-model provider list with per-character and per-profile model choice, group generation handling modes, book distillation from `.txt`/`.md`/`.epub`, and the desktop scope (tray icon, window-state restore, self-update with signed artifacts, `.catcup` file associations, packaged macOS/Linux builds), plus impersonation and drag-and-drop import. Story mode (RFC 0003 layer 2) is blocked on a plot-distillation design that does not exist yet. M3 (STscript, full Quick Replies, the extension API) and M5 (mobile, i18n, accessibility, UX stages C–E) are still ahead; M6 (game mode, RFC 0005/0006) is scoped and not started. The authoritative scope and acceptance criteria live in `docs/MILESTONES.md`; the user-facing gaps are listed in `docs/LIMITATIONS.md`. A full-app UX overhaul is in progress (stage A: Settings and Providers landed 2026-11-12; stage B: app shell and chat chrome landed 2026-11-13); follow `docs/DESIGN.md` for interface work.

## Commands

```bash
pnpm dev          # server :8000 + web :5173
pnpm build        # build both workspaces
pnpm start        # production mode, one port :8000
pnpm --filter @catcup/desktop build  # Windows installer (needs Rust)
pnpm typecheck
pnpm test
pnpm lint
pnpm site         # build the GitHub Pages landing page into site/dist
```

The desktop shell is Rust. `cargo check` runs the Tauri build script, which copies the server bundle, the SPA and the Node sidecar into `target/`, so prepare those first:

```bash
CATCUP_BUNDLE_DEPS=1 pnpm --filter @catcup/server build
pnpm --filter @catcup/web build
pnpm --filter @catcup/desktop bundle
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml   # what CI runs, on all three platforms
cargo test  --manifest-path apps/desktop/src-tauri/Cargo.toml   # shell unit tests
```

Releases are cut by landing a version bump on `main` as a normal squash-merged PR: `.github/workflows/release.yml` notices the untagged `package.json` version, creates the `v<version>` tag on that commit and attaches the Windows installer to the GitHub release. When `TAURI_SIGNING_PRIVATE_KEY` is in the repository secrets it also publishes the signed updater archive and `latest.json`, which is what lets an installed app update itself. The release body comes from that version's `CHANGELOG.md` section. See `CONTRIBUTING.md#releases`.

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
    src/retrieval/      lexical tokenizer and BM25F index (world info; no model, no deps)
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
packages/compat-st/     code adapted from another tavern client — see below
assets/brand/           brand masters and their generated icons (see assets/brand/README.md)
docs/                   handbook (see docs/README.md)
scripts/                repository tooling; `pnpm icons` rebuilds every icon from the brand masters,
                        `scripts/build-site.mjs` renders the landing page
site/                   the public landing page: template, styles, `main.js`, nine locale decks in
                        `content/`; published to `gh-pages` by `.github/workflows/pages.yml`
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

Trunk-based development. `main` is the trunk and the only long-lived branch.

- Every change lands on `main` through a short-lived branch and a pull request
  that targets `main`. Nothing merges into a branch other than `main`.
- **Squash merge.** One PR becomes one commit on `main`, so the trunk reads as a
  linear list of changes and `git log` on `main` is the history that matters.
- Keep branches small and short-lived — hours to a couple of days. A branch that
  lives a week is a branch that will conflict; split the work instead.
- Branch from `main`, and rebase on `main` rather than merging it back in.
- Delete the branch after it merges, locally and on the remote.
- `release/<version>` and `hotfix/<version>` are cut from `main` when a release
  or a fix genuinely needs stabilising, and merge back into `main` — they are
  exceptions, not a second trunk.
- Small PRs, atomic commits; see `CONTRIBUTING.md`.

## Conventions

- **English-first.** UI copy, comments, docs and error messages are English. i18n is deferred; keep user-facing strings centralized enough to extract later, but do not add an i18n framework yet.
- API keys may only live in `data/secrets.json`. No API response may contain a plaintext key; the client sees only `hasKey`.
- Single user + password. First-time setup is limited to loopback. LAN login uses the same password. Every shape can change the password; only the desktop can remove one, because a LAN server with none would be reachable and unauthenticated.
- Before changing character card / chat / world info / preset schemas, compare with `.ref/SillyTavern` and preserve field names and the JSONL header format.
- **Code adapted from another client lives in `packages/compat-st`.** It is a home for the attribution, not a licence boundary — the app imports it and is built with it, so the result is one program. Add to that package rather than scattering new ports through `apps/server/src`, and keep the per-file header naming the upstream file. Prefer writing against a format specification over adapting an implementation; `docs/REUSE-ISOLATION.md` keeps the lists.
- CatCup-only state never goes inside an ST file it would confuse: derived data (indexes, embeddings, caches) lives in a sidecar file beside the source, and anything written into an ST object goes under `extensions.catcup`, which ST preserves and ignores.
- `.ref/` is for reading only. **Never import from it at runtime and never use it as a build input.**
- When adding code adapted from another client, update `NOTICE` and `docs/REUSE.md` in the same change, and record in `docs/REUSE-ISOLATION.md` whether it implements a format or reproduces behaviour.
- License: AGPL-3.0-only, CatCup's own choice. Adapted code keeps its original terms; see `NOTICE` and `docs/REUSE-ISOLATION.md`.
- Frontend: React + Tailwind 4. Theme tokens live in the `@theme` block of `apps/web/src/styles.css`.
- Interface work follows `docs/DESIGN.md`: one primary action per surface, explicit save with a leave guard for configuration forms, visible focus, focus-trapped dialogs and no hover-only actions.
- Chat streaming uses SSE: `start` / `token` / `reasoning` / `done` / `error`. The server owns persistence; the client only renders optimistically. The `start` event carries the model the request resolved to.
- Do not transplant ST's jQuery/DOM code into React. Port algorithms and data semantics only.
- Never commit `data/`, `.ref/`, `.env`, build output or secrets.

## Current milestones

- **M0** (complete): scaffold, auth, card import, chat persistence, four provider families, streaming and dark tavern UI.
- **M1** (complete): world info scanning/editor, Prompt Manager, ST preset import/export, message editing/branching, alternate greetings, model-aware tokenizer.
- **M2** (complete, shipped in 0.3.0): group chats (storage, UI and generation, all three SillyTavern card modes, card depth prompts and auto mode; multi-member replies in one request are still M3-era work), summary memory, the Quick Replies subset, TTS, image generation (Automatic1111, ComfyUI and OpenAI-compatible), CharX import/export, and library favorites/tags/sorting/bulk actions. Regex scripts and card editing/export shipped in 0.2.0.
- **M2.5** (complete, shipped in 0.4.0): the per-chat director (RFC 0003 layer 1; story mode layer 2 is blocked on a plot-distillation design), the Telegram channel (RFC 0004: binding, commands, export import, finish notifications), world info aliases in a sidecar and the opt-in lexical pass, append-only summaries, two more request protocols, the desktop title bar and the landing page.
- **M3** (planned): full STscript, the full Quick Replies engine (STscript-backed, with auto-execution and context menus), getContext/event bus and the extension sandbox.
- **M4** (shipped in 0.3.1): tray icon, window-state restore, self-update from signed release artifacts, `.catcup` file associations, macOS/Linux packaging and a CI job that compiles the shell on all three platforms. Authenticode signing is deferred on purpose — see `docs/MILESTONES.md`. The Windows shell and packaging shipped in 0.2.0.
- **M5** (planned): mobile, i18n, accessibility, UX stages C–E, performance and v1.0 release.
- **M6** (planned, scoped 2026-11-24 as RFC 0005 and RFC 0006): game mode — Chat/Story/Game over a per-chat director and a per-save game — with a declarative `.catcupgame` plugin host that carries no code, saves under a profile, sentinel-block actions instead of native tool calling, and workspaces for writing and authoring. Not started; a plugin executor and game state do not exist yet.

The detailed acceptance criteria are in `docs/MILESTONES.md`.

## References

- SillyTavern 1.19.0 (`.ref/SillyTavern`)
- RisuAI (`.ref/RisuAI`, Svelte 5 + Tauri 2.5)
- Architecture: `docs/ARCHITECTURE.md`
- Reuse list: `docs/REUSE.md`
