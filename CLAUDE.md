# CatCup Tavern — CLAUDE.md

## Project

A SillyTavern-style AI roleplay client. Three shapes share one codebase:

- **Web**: Node/Fastify server + React SPA
- **LAN**: the same server bound to `0.0.0.0`, single user + access password
- **Desktop**: a Windows app that runs the same server as a child process and wraps it in a Tauri 2 window

Hard constraint: **high compatibility with SillyTavern's data formats and interaction semantics**. Character cards (PNG/JSON V2/V3), chat JSONL, world info JSON, prompt presets and STscript/slash commands must interoperate.

Current status: **0.2.1 released (2026-11-11)** — M1 and the 0.2.x MVP are complete; M2 is in progress with group chats, summary memory, a Quick Replies subset and text to speech usable end to end. The authoritative scope and acceptance criteria live in `docs/MILESTONES.md`; the user-facing gaps are listed in `docs/LIMITATIONS.md`.

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

Releases are built and published by `.github/workflows/release.yml`: push a `v*` tag on `main` and CI attaches the Windows installer to the GitHub release. The release body comes from that version's `CHANGELOG.md` section.

## Layout

```text
apps/server/            Fastify server
  src/cards/            character card parsing (PNG tEXt / JSON v2-v3)
  src/providers/        OpenAI-compatible / OpenRouter / Anthropic / Ollama
  src/prompt/           prompt assembly and token budgeting
  src/worldinfo/        world info loader, scanner, timed effects and prompt buckets
  src/routes/           REST + SSE routes
  src/security/         password hashing, session cookies
  src/storage/          ST-compatible file storage
apps/web/               React SPA
  src/components/       layout, chat, settings, auth
  src/hooks/            React Query data hooks
  src/lib/              API / SSE clients
  src/store/            Zustand UI state
apps/desktop/           Tauri 2 shell; src-tauri/ holds the Rust sidecar host
packages/shared/        Zod schemas, shared types, ST data models
docs/                   handbook (see docs/README.md)
.ref/                   SillyTavern / RisuAI reference checkouts (gitignored)
data/                   runtime data (gitignored)
```

## Documentation map

Read before changing behaviour:

- `docs/README.md` — documentation index and reading paths.
- `docs/MILESTONES.md` — source of truth for scope, status and acceptance criteria.
- `docs/ARCHITECTURE.md` — topology, stack decisions and data flow.
- `docs/API.md` — REST/SSE contracts.
- `docs/DATA-FORMATS.md` — ST-compatible cards, chats, world info, presets and internal files.
- `docs/PROVIDERS.md` — provider adapters and configuration.
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
- Single user + password. First-time setup is limited to loopback. LAN login uses the same password.
- Before changing character card / chat / world info / preset schemas, compare with `.ref/SillyTavern` and preserve field names and the JSONL header format.
- `.ref/` is for reading only. **Never import from it at runtime and never use it as a build input.**
- When adding code adapted from ST or RisuAI, update `NOTICE` and `docs/REUSE.md` in the same change.
- License: AGPL-3.0-only. SillyTavern is AGPL-3.0; RisuAI is GPL-3.0 (compatible under AGPLv3 §13).
- Frontend: React + Tailwind 4. Theme tokens live in the `@theme` block of `apps/web/src/styles.css`.
- Chat streaming uses SSE: `start` / `token` / `reasoning` / `done` / `error`. The server owns persistence; the client only renders optimistically.
- Do not transplant ST's jQuery/DOM code into React. Port algorithms and data semantics only.
- Never commit `data/`, `.ref/`, `.env`, build output or secrets.

## Current milestones

- **M0** (complete): scaffold, auth, card import, chat persistence, four provider families, streaming and dark tavern UI.
- **M1** (complete): world info scanning/editor, Prompt Manager, ST preset import/export, message editing/branching, alternate greetings, model-aware tokenizer.
- **M2** (in progress): group chats (storage, UI and generation landed; append modes, auto mode and multi-reply turns remain), summary memory (landed 2026-11-11), Quick Replies subset (landed 2026-11-12), TTS (landed 2026-11-12), image generation, CharX, library polish. Regex scripts and card editing/export shipped in 0.2.0.
- **M3** (planned): full STscript, Quick Replies, getContext/event bus, extension sandbox.
- **M4** (planned): desktop signing, auto-updater, file associations and macOS/Linux builds. The Windows shell and packaging shipped in 0.2.0.
- **M5** (planned): mobile, i18n, accessibility, CI, performance and v1.0 release.

The detailed acceptance criteria are in `docs/MILESTONES.md`.

## References

- SillyTavern 1.19.0 (`.ref/SillyTavern`)
- RisuAI (`.ref/RisuAI`, Svelte 5 + Tauri 2.5)
- Architecture: `docs/ARCHITECTURE.md`
- Reuse list: `docs/REUSE.md`
