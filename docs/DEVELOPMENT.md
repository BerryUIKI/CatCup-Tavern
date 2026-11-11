# Development

## Prerequisites

| Tool    | Version                                 | Notes                                |
| ------- | --------------------------------------- | ------------------------------------ |
| Node.js | **24.x** (>=22.13 supported by engines) | The repo is developed on Node 24     |
| pnpm    | **11.x**                                | `packageManager` pins `pnpm@11.18.0` |
| Git     | 2.40+                                   | GitFlow workflow                     |
| Rust    | current stable                          | Needed only to build the desktop app |

## Install and run

```bash
pnpm install
pnpm dev
```

- Web dev server: http://localhost:5173
- API server: http://127.0.0.1:8000
- Vite proxies `/api` to the server.

Production-like run:

```bash
pnpm build
pnpm start
# http://127.0.0.1:8000
```

The server serves `apps/web/dist` when it exists. The first run asks for a password.

## Scripts

| Command                               | Description                                             |
| ------------------------------------- | ------------------------------------------------------- |
| `pnpm dev`                            | Run server (`tsx watch`) and web (`vite`) together      |
| `pnpm build`                          | Build server with tsup and web with Vite                |
| `pnpm start`                          | Run the built server                                    |
| `pnpm typecheck`                      | TypeScript across all workspace packages                |
| `pnpm test`                           | Vitest across packages                                  |
| `pnpm lint` / `pnpm lint:fix`         | Biome check / safe fixes                                |
| `pnpm format`                         | Biome formatter                                         |
| `pnpm --filter @catcup/server test`   | Server tests only                                       |
| `pnpm --filter @catcup/web build`     | Web build only                                          |
| `pnpm --filter @catcup/desktop build` | Windows installer: prepares the bundle, then runs Tauri |

## Environment variables

| Variable                    | Default       | Purpose                                                       |
| --------------------------- | ------------- | ------------------------------------------------------------- |
| `CATCUP_HOST`               | `127.0.0.1`   | Bind address; `0.0.0.0` enables LAN                           |
| `CATCUP_PORT`               | `8000`        | HTTP port                                                     |
| `CATCUP_DATA_DIR`           | `<repo>/data` | Data root; relative values resolve from the process cwd       |
| `CATCUP_LOG_LEVEL`          | `info`        | Pino level (`debug`, `info`, `warn`, `error`)                 |
| `CATCUP_ALLOW_REMOTE_SETUP` | `false`       | Allow first-run setup from a non-loopback address; keep false |

`.env.example` is committed; copy it to `.env` if you prefer a file. `data/`, `.env`, `.ref/` and build output are gitignored.

## Repository layout

```text
apps/server/src/
  app.ts          Fastify assembly and hooks
  index.ts        entrypoint and graceful shutdown
  config.ts       env, paths, data dir
  cards/          PNG tEXt / JSON card parsing
  providers/      OpenAI-compatible / Anthropic / Ollama adapters
  prompt/         prompt assembly and token estimation
  routes/         auth, characters, chats, generate, providers, settings, health
  security/       scrypt password, HMAC sessions
  storage/        paths, atomic JSON, locks, settings, characters, chats
  sse.ts          SSE writer
apps/web/src/
  App.tsx         auth gate
  components/     auth, sidebar, chat, messages, composer, settings, toasts
  hooks/          React Query data hooks + generation hook
  lib/            HTTP API client, SSE parser, formatting, classnames
  store/          Zustand UI state
packages/shared/
  src/schemas/    Zod schemas and shared types
```

## Request flow

1. The SPA calls `/api/*` with the session cookie.
2. Fastify checks the origin for mutating requests, then the session.
3. Routes load characters/chats/settings from the data directory.
4. Generation builds the prompt on the server, calls the provider adapter, and writes the assistant message before sending SSE `done`.
5. The browser renders optimistic user/assistant state while streaming, then refetches the chat.

## Testing

```bash
pnpm test                       # everything
pnpm --filter @catcup/server test
pnpm --filter @catcup/shared test
pnpm --filter @catcup/server exec vitest run src/cards/parse.test.ts
```

Current coverage (M0):

- shared: schema defaults;
- server: character card normalization, chat JSONL parsing/round-trip, prompt builder macros and history trimming.

UI testing is manual at this stage: password setup, card import, chat creation, streaming, swipes, settings. Add a unit test for any new parsing/ordering logic. Add a fixture-based test for ST compatibility changes.

## Adding a feature

Use this checklist for a typical vertical slice:

1. **Shared contract**: add or update a Zod schema/type in `packages/shared`.
2. **Server**: storage helper + route + error handling; keep keys and prompt logic server-side.
3. **Client**: add an API method in `apps/web/src/lib/api.ts`, a query/mutation hook in `hooks/data.ts`, then the UI.
4. **Tests**: unit tests for logic; a manual smoke test for UI paths.
5. **Docs**: update the relevant `docs/` page, `CHANGELOG.md` and, if scope changed, `MILESTONES.md`.
6. **Quality gates**: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.
7. **PR**: branch from `dev`, keep it small, target `dev`; see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Adding a provider

See [PROVIDERS.md](PROVIDERS.md). The short version:

1. Extend `providerKindSchema` and defaults in `packages/shared/src/schemas/provider.ts`.
2. Implement `ProviderAdapter` under `apps/server/src/providers/`.
3. Register it in `providers/index.ts`.
4. Add/adjust tests and docs; update `NOTICE`/`REUSE.md` if code was adapted.

## Debugging

- Server logs use pino; set `CATCUP_LOG_LEVEL=debug` for more detail. Authorization, cookie and `x-api-key` headers are redacted.
- `curl http://127.0.0.1:8000/api/health` checks the server without auth.
- For authenticated API debugging, log in with curl and keep a cookie jar, or use the browser dev tools.
- For SSE, use `curl -N` (no buffering) and a POST body. The browser uses `fetch` + `ReadableStream`, not `EventSource`.
- The data directory is human-readable JSON/JSONL/PNG; inspect it after a failed operation.
- Stop the preview server before copying or manually editing chats to avoid racing an in-flight write.

## Resetting local state

Stop the server first.

- **Reset password / sessions:** delete `data/auth.json` and restart the server. The next visit runs first-time setup again.
- **Keep chats, reset providers:** delete `data/settings.json` and `data/secrets.json`; defaults are recreated.
- **Full reset:** back up and remove `data/`. This deletes characters, chats and credentials. Destructive; confirm first.

Do not commit any file under `data/`.

## Continuous integration

`.github/workflows/ci.yml` runs `pnpm install --frozen-lockfile`, then `typecheck`, `lint`, `test` and `build` on Ubuntu with Node 24. It triggers on every pull request into `dev` or `main` and on every push to either branch, so a merged pull request is verified again on the integration branch without anyone re-running the gates by hand.

The workflow does not build the desktop app: that needs Rust and the Tauri toolchain, and it is still a manual step before a release (see [DESKTOP.md](DESKTOP.md)).

Run the same gates locally before pushing — CI is a backstop, not a substitute:

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

## Related docs

- [Architecture](ARCHITECTURE.md)
- [API](API.md)
- [Data formats](DATA-FORMATS.md)
- [Providers](PROVIDERS.md)
- [Security](SECURITY.md)
- [Deployment](DEPLOYMENT.md)
- [Troubleshooting](TROUBLESHOOTING.md)
