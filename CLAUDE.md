# CatCup Tavern — CLAUDE.md

## Project

A SillyTavern-style AI roleplay client. Three shapes share one codebase:

- **Web**: Node/Fastify server + React SPA
- **LAN**: the same server bound to `0.0.0.0`, single user + access password
- **Desktop**: Tauri 2 shell (planned) hosting the same server as a Node sidecar

Hard constraint: **high compatibility with SillyTavern's data formats and interaction semantics**. Character cards (PNG/JSON v2/v3), chat JSONL, world info JSON, prompt presets and STscript/slash commands must interoperate.

## Commands

```bash
pnpm dev          # server :8000 + web :5173
pnpm build        # build both workspaces
pnpm start        # production mode, one port :8000
pnpm typecheck
pnpm test
pnpm lint
```

## Layout

```text
apps/server/            Fastify server
  src/cards/            character card parsing (PNG tEXt / JSON v2-v3)
  src/providers/        OpenAI-compatible / OpenRouter / Anthropic / Ollama
  src/prompt/           prompt assembly and token budgeting
  src/routes/           REST + SSE routes
  src/security/         password hashing, session cookies
  src/storage/          ST-compatible file storage
apps/web/               React SPA
  src/components/       layout, chat, settings, auth
  src/hooks/            React Query data hooks
  src/lib/              API / SSE clients
  src/store/            Zustand UI state
packages/shared/        Zod schemas, shared types, ST data models
docs/                   architecture and reuse notes
.ref/                   SillyTavern / RisuAI reference checkouts (gitignored)
data/                   runtime data (gitignored)
```

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

## Current milestones

- **M0**: scaffold, auth, card import, chat persistence, streaming for four provider families, dark tavern UI (in progress)
- **M1**: STscript, world info, prompt manager, preset import, swipes/branches
- **M2**: group chats, summary memory, regex scripts, quick replies, TTS / image generation
- **M3**: ST extension compatibility (getContext + event bus + sandbox host)
- **M4**: Tauri desktop shell and Node sidecar packaging

## References

- SillyTavern 1.19.0 (`.ref/SillyTavern`)
- RisuAI (`.ref/RisuAI`, Svelte 5 + Tauri 2.5)
- Architecture: `docs/ARCHITECTURE.md`
- Reuse list: `docs/REUSE.md`
