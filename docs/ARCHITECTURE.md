# Architecture

> Last updated: 2026-11-12 · M0 and M1 complete, M2 in progress

## 1. Goals and principles

CatCup Tavern is a **SillyTavern-compatible AI roleplay client**, not a generic chat app.

1. **Experience first.** Follow SillyTavern's information architecture (character rail, chat stream, settings/parameters) and invest in a darker, quieter tavern atmosphere. Do not redesign for the sake of looking different.
2. **Data stays portable.** ST cards, chats, world info and presets import/export cleanly; files we write should remain readable by ST.
3. **Server-authoritative.** Prompt assembly, provider calls, API keys and persistence happen on the Node server. The browser only holds a session cookie.
4. **One codebase, three shapes.** Web, LAN and the Tauri desktop shell share the same server + SPA.
5. **Progressive compatibility.** Data formats and core semantics first; STscript and extension APIs in layers.

## 2. Runtime topology

### Web / LAN

```text
Browser (React SPA)
    │  REST + SSE (cookie auth)
    ▼
Node 24 + Fastify 5
    ├── /api/*       application endpoints
    ├── static       apps/web/dist (production)
    └── data/        ST-compatible file storage
    │  HTTPS (fetch)
    ▼
OpenAI / OpenRouter / Anthropic / Ollama
```

- Development: Vite on `:5173` proxies `/api` to `:8000`.
- Production: Fastify serves the SPA and API on the same port, default `127.0.0.1:8000`.
- LAN mode binds `0.0.0.0`; authentication is a single-user password session.

### Desktop (planned)

```text
Tauri 2 window (loads http://127.0.0.1:<port>)
    └── spawns Node sidecar (same @catcup/server)
          └── data dir = OS app-data directory
```

The desktop shell owns only process management, port selection, the data directory, tray/updater and file associations. No business logic is duplicated.

## 3. Stack decisions

| Area       | Choice                                       | Rationale                                                                                 |
| ---------- | -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Frontend   | React 19 + TypeScript                        | Mature ecosystem; ST/RisuAI UI code is not directly reusable, so the UI framework is free |
| Build      | Vite 8                                       | Fast SPA development; also Tauri-friendly                                                 |
| Styling    | Tailwind CSS 4 + CSS variables               | Theme tokens make skins and future theming straightforward                                |
| State      | Zustand (UI) + TanStack Query (server state) | Streaming is imperative; cached entities fit Query                                        |
| Server     | Node 24 + Fastify 5                          | Same ecosystem as ST, easy to port prompt/provider logic; SSE and file IO are direct      |
| Storage    | Filesystem (JSON/JSONL/PNG)                  | Matches ST's layout; single-user scale does not justify a database                        |
| Validation | Zod 4                                        | Shared schemas and inferred types across server and web                                   |
| Tooling    | pnpm workspaces + Biome + Vitest             | Lightweight and fast                                                                      |

## 4. Directory layout

```text
apps/server/
  src/
    app.ts               Fastify assembly
    index.ts             entrypoint
    config.ts            env + default paths
    cards/               PNG tEXt / JSON v2-v3 parsing
    generation/          shared SSE generation stream and stop registry
    group/               member resolution, speaker selection, reply cleanup
    memory/              rolling summaries: schedule, request building, injection
    providers/           provider adapters (normalized streaming chunks)
    prompt/              prompt assembly, macros, token budget
    quickreplies/        quick reply parsing target, command execution
    routes/              auth / characters / chats / generate / groups / memory / quick replies / providers / settings
    security/            scrypt password, HMAC session
    storage/             ST-compatible file storage, atomic writes, file locks
    sse.ts               client SSE writer
apps/web/
  src/
    components/          auth, sidebar, chat, settings
    hooks/               React Query wrappers
    lib/                 fetch / SSE / formatting
    store/               Zustand
packages/shared/
  src/schemas/           character / chat / worldinfo / preset / provider / settings / api
```

## 5. Data layer (SillyTavern compatible)

Default root `data/` (override with `CATCUP_DATA_DIR`):

```text
data/
├── characters/
│   ├── Seraphina.png          # PNG tEXt: chara (v2) + ccv3 (v3)
│   └── Custom.json            # v2/v3 wrapper or legacy flat card
├── chats/
│   └── Seraphina/
│       └── Seraphina - 2026-11-09_18-00-00.jsonl
├── groups/                    # ST group metadata
├── group chats/               # ST group chat JSONL
├── worlds/                    # ST World Info JSON
├── presets/                   # ST OpenAI preset JSON
├── quickreplies/              # ST Quick Replies v2 sets
├── regex.json                 # Regex scripts
├── settings.json
├── secrets.json               # API keys, server-only
└── auth.json                  # password hash + session secret
```

### Character cards

- PNG: read `tEXt` chunks; `ccv3` takes precedence over `chara`; payload is base64 JSON.
- JSON: accept `spec: chara_card_v2/v3` wrappers and legacy flat fields.
- Character id = file name without extension, matching ST's avatar naming.
- Unknown fields are preserved through passthrough schemas.

### Chats

SillyTavern JSONL:

- First line is a header: `{ chat_metadata, user_name: "unused", character_name: "unused" }`
- Each following line is a message: `{ name, is_user, mes, send_date, extra }`
- Unknown fields survive import/export.

The chat folder is named after the character (ST behavior), with the character id accepted as a fallback when reading.

### World info / presets

- World info is modeled after ST's `entries[uid]` structure (key/keysecondary/content/constant/order/position/depth/...).
- Presets accept ST OpenAI preset fields (`prompts`, `prompt_order`, sampling parameters).

Schemas exist in `packages/shared`; see [DATA-FORMATS.md](DATA-FORMATS.md). The scanner and prompt-manager execution arrive in M1; see [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md).

## 6. API and streaming

REST prefix `/api`. Everything except `/api/auth/*` and `/api/health` requires a session. Full request and response shapes are documented in [API.md](API.md).

| Method       | Path                                          | Purpose                                    |
| ------------ | --------------------------------------------- | ------------------------------------------ |
| GET          | `/api/auth/status`                            | `needsSetup` / `authenticated`             |
| POST         | `/api/auth/setup`                             | first-run password (loopback only)         |
| POST         | `/api/auth/login` / `logout`                  | session lifecycle                          |
| GET/POST     | `/api/characters`                             | list / import (multipart)                  |
| GET/DELETE   | `/api/characters/:id`                         | detail / delete                            |
| GET          | `/api/characters/:id/avatar`                  | avatar bytes                               |
| GET/POST     | `/api/characters/:id/chats`                   | chat list / create                         |
| GET          | `/api/chats/:characterId/:chatId`             | full chat                                  |
| PATCH/DELETE | `/api/chats/.../messages/:index`              | edit / delete (PATCH also selects a swipe) |
| CRUD         | `/api/groups`                                 | group metadata                             |
| CRUD         | `/api/groups/:groupId/chats`                  | group chats and messages                   |
| POST         | `/api/groups/:groupId/chats/:chatId/generate` | group reply, returns the same SSE stream   |
| POST         | `/api/generate`                               | start generation, returns SSE              |
| POST         | `/api/generate/:id/stop`                      | stop generation                            |
| CRUD         | `/api/quick-replies`                          | quick reply sets and their files           |
| POST         | `/api/chats/…/quick-replies/execute`          | run a quick reply, returns client actions  |
| POST         | `/api/groups/…/quick-replies/execute`         | the same for a group chat                  |
| GET/PATCH    | `/api/settings`                               | app settings                               |
| CRUD         | `/api/providers`                              | provider configuration; keys go to secrets |
| POST         | `/api/providers/:id/test`                     | connectivity test                          |
| GET          | `/api/providers/:id/models`                   | model list                                 |

`POST /api/generate` SSE events:

```text
event: start      data: { generationId, speaker? }
event: token      data: { text }
event: reasoning  data: { text }
event: done       data: { message, usage? }
event: error      data: { message }
```

`speaker` is present on group replies and names the member the server chose.

- The server persists the assistant message before emitting `done`.
- Client disconnect / Stop aborts the upstream request and saves the partial text with `extra.stopped = true`.
- A `: ping` comment is emitted every 15s to keep proxies from timing out.

## 7. Provider abstraction

```ts
interface ProviderAdapter {
    streamChat(cfg, request): AsyncIterable<StreamChunk>;
    listModels(cfg): Promise<ModelInfo[]>;
    test(cfg): Promise<ProviderTestResult>;
}
```

| kind         | default base                   | Notes                                          |
| ------------ | ------------------------------ | ---------------------------------------------- |
| `openai`     | `https://api.openai.com/v1`    | OpenAI and `/chat/completions` compatible      |
| `openrouter` | `https://openrouter.ai/api/v1` | OpenAI-compatible + `HTTP-Referer` / `X-Title` |
| `anthropic`  | `https://api.anthropic.com/v1` | Messages API, system extraction, SSE mapping   |
| `ollama`     | `http://127.0.0.1:11434`       | native `/api/chat` NDJSON, `/api/tags` models  |
| `custom`     | user supplied                  | any OpenAI-compatible endpoint                 |

Normalized stream chunks: `{ type: 'text' | 'reasoning' | 'usage', ... }`. See [PROVIDERS.md](PROVIDERS.md) for endpoint-level details and limitations.

## 8. Prompt pipeline

1. Macros expand in prompt entries, world info, the author's note, the summary and stored history.
2. The Prompt Manager builds the ordered collection from the active preset, or SillyTavern's defaults when none is active, merges the fixed system prompts, applies the card's `main` and `jailbreak` overrides and populates the slots in ST's call order.
3. World info runs its full scan first; the before/after entries, at-depth buckets and the author's note take their configured positions.
4. Chat history is trimmed newest-first against the model's context budget; `promptOnly` regex scripts run on the copy that becomes the prompt.
5. Summary memory is formatted with its template and injected after or before the main prompt, or in chat at a depth with a role. `{{summary}}` expands wherever macros run.
6. Dialogue examples, the continue nudge and the group nudge are added around the history.

The assembled prompt is also what the context inspector shows; `/api/chats/:characterId/:chatId/context` rebuilds it without generating.

## 9. ST compatibility tiers

| Tier             | Scope                                                         | Plan                                                        |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------------- |
| L1 data          | cards, chat JSONL, world info, presets                        | M0–M2                                                       |
| L2 semantics     | STscript/slash commands, Quick Replies, regex scripts         | M1–M3                                                       |
| L3 extension API | `SillyTavern.getContext()`, `event_types`, extension settings | M3                                                          |
| L4 UI extensions | extensions that depend on ST's DOM/jQuery                     | sandboxed iframe / optional compatibility DOM; highest risk |

`st-context.js` is the source of truth for the L3 API surface (~100 functions/objects). Implement by usage frequency, not all at once. See [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md) for the current feature matrix.

## 10. Security

- Password: `scrypt` (N=16384, r=8, p=1), constant-time comparison.
- Session: HMAC-SHA256 signed cookie, `HttpOnly` + `SameSite=Lax`, 30-day default.
- First-run setup accepts loopback requests only.
- API keys: only `data/secrets.json`; responses expose `hasKey` only; logs redact `authorization`, `cookie` and `x-api-key`.
- Paths: every `:id` / `:chatId` passes through `resolveInside()` to block traversal.
- Login rate limiting; put the LAN server behind HTTPS when exposing it beyond a trusted network.
- Uploads: 20 MB per file, `.png` / `.json` only.
- No trust-proxy support yet; see [SECURITY.md](SECURITY.md) before exposing the server behind a TLS proxy.

## 11. Milestones

The authoritative scope, status and acceptance criteria live in [MILESTONES.md](MILESTONES.md). Summary:

| Milestone | Status      | Theme                                                             |
| --------- | ----------- | ----------------------------------------------------------------- |
| M0        | Complete    | Runnable web + server foundation, ST cards/chats, four providers  |
| M1        | Next        | World info, Prompt Manager, presets, editing/branching, tokenizer |
| M2        | In progress | Group chats, memory, regex, TTS/image generation, card editing    |
| M3        | Planned     | STscript, Quick Replies, getContext/event bus, extension sandbox  |
| M4        | Planned     | Tauri desktop shell, Node sidecar, updater, packaging             |
| M5        | Planned     | Mobile, i18n, accessibility, CI, performance, v1.0                |

## 12. Decision log

- **Build a new client instead of forking ST.** ST's frontend is jQuery/vanilla and tightly coupled to its DOM; deep UI changes cost more than a rewrite. Data formats and algorithms remain reusable. RisuAI is Svelte, so under React its UI is equally non-reusable; only its TypeScript logic is adapted.
- **Assemble prompts on the server.** Keys, token budgeting and world-info scanning stay on one side; LAN mode never stores keys in a browser.
- **Filesystem storage.** ST's ecosystem is built on files. At single-user scale the migration and hand-editing convenience outweigh SQLite.
- **Single user + password.** v1 is explicitly not multi-tenant; per-user isolation would add cost to every endpoint and storage path. Revisit if the need appears.
- **English-first, i18n later.** The initial UI and docs are English; i18n is a deliberate later step rather than a half-built locale layer.

## 13. Related documentation

- [Documentation index](README.md)
- [Milestones](MILESTONES.md)
- [API](API.md)
- [Data formats](DATA-FORMATS.md)
- [Providers](PROVIDERS.md)
- [SillyTavern compatibility](ST-COMPATIBILITY.md)
- [Development](DEVELOPMENT.md)
- [Deployment](DEPLOYMENT.md)
- [Security](SECURITY.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Glossary](GLOSSARY.md)
- [Code reuse](REUSE.md)
