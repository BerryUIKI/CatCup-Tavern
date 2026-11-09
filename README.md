# CatCup Tavern

A **SillyTavern-compatible AI roleplay client**. One codebase, three shapes:

- **Web** — open it in a browser, locally or across your LAN
- **Desktop** — Tauri 2 shell (planned, reusing the same server + SPA)
- **Data** — import SillyTavern character cards (PNG/JSON V2/V3) and read/write ST-style chat JSONL; world info and preset schemas are ready for the next milestone
- **Providers** — OpenAI-compatible APIs, OpenRouter, Anthropic and Ollama

> **Status: v0.1 M0 complete (2026-11-09). M1 is next.**
> See the [milestone document](docs/MILESTONES.md) for scope, acceptance criteria and the current roadmap.

## Why another tavern?

SillyTavern's data model and prompt semantics are the ecosystem's lingua franca. CatCup Tavern keeps that compatibility while replacing the legacy jQuery UI with a modern React app and a server-owned generation pipeline:

- API keys never reach the browser.
- The same server powers localhost, LAN and the future desktop shell.
- Prompt assembly, token budgeting and provider calls live in one place.
- The UI follows SillyTavern's information architecture — character rail, chat stream, settings — with a darker, quieter tavern atmosphere.

## What works today

- Password setup/login, server-side sessions and a single-user LAN mode.
- Character card import (PNG `tEXt` V2/V3, JSON V2/V3 and legacy flat cards).
- Character library with search, tags and avatars.
- ST-style chat JSONL persistence, multiple chats, swipes, regenerate, delete and copy.
- Streaming replies with reasoning display.
- Provider configuration for OpenAI-compatible, OpenRouter, Anthropic and Ollama, including model list and connection test.
- Provider keys stored only on the server.
- Dark tavern UI, English-first.

### What is next

M1 adds the core SillyTavern experience: world info scanning/editor, Prompt Manager and ordering, ST preset import/export, message editing/branching, alternate greeting selection and a model-aware tokenizer. See [docs/MILESTONES.md](docs/MILESTONES.md).

## Stack

| Layer   | Choice                                                  |
| ------- | ------------------------------------------------------- |
| Web     | React 19 · TypeScript · Vite 8 · Tailwind CSS 4         |
| Server  | Node.js 24 · Fastify 5                                  |
| Desktop | Tauri 2 (planned)                                       |
| Storage | SillyTavern-compatible files (JSON / JSONL / PNG cards) |
| License | AGPL-3.0-only                                           |

## Quick start

```bash
pnpm install
pnpm dev
```

- App (dev): http://localhost:5173
- API: http://127.0.0.1:8000
- Production build: `pnpm build && pnpm start`, then open http://127.0.0.1:8000

On first run you will be asked to set an access password. Passwords, API keys and chats live under the local `data/` directory. API keys are stored server-side only.

### LAN access

```bash
CATCUP_HOST=0.0.0.0 pnpm start
```

The first password must be set on the machine running the server. After that, devices on the LAN sign in with the same password. Put the server behind an HTTPS reverse proxy or VPN if it is reachable beyond a trusted network; see [Deployment](docs/DEPLOYMENT.md) and [Security](docs/SECURITY.md).

## Scripts

| Command                       | What it does                                           |
| ----------------------------- | ------------------------------------------------------ |
| `pnpm dev`                    | Run server (:8000) and web (:5173) together            |
| `pnpm build`                  | Build server and web                                   |
| `pnpm start`                  | Run the built server (serves the SPA on the same port) |
| `pnpm typecheck`              | TypeScript check across the workspace                  |
| `pnpm test`                   | Unit tests                                             |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix                                  |
| `pnpm format`                 | Biome format                                           |

## Data directory

Defaults to `./data` at the repository root; override with `CATCUP_DATA_DIR`.

```text
data/
├── characters/          # .png cards with tEXt metadata, or .json cards
├── chats/
│   └── <character name>/  # SillyTavern-style JSONL chats
├── worlds/              # World Info JSON (schema ready; scanner M1)
├── presets/             # Prompt / sampling presets (schema ready; import M1)
├── settings.json        # App settings
├── secrets.json         # API keys (server-only)
└── auth.json            # Password hash + session secret
```

You can copy SillyTavern's `characters/`, `chats/` and `worlds/` folders into this directory to migrate existing content. `data/` and `.ref/` are gitignored. Details: [Data formats](docs/DATA-FORMATS.md).

## Documentation

| Document                                              | What it covers                                            |
| ----------------------------------------------------- | --------------------------------------------------------- |
| [Documentation index](docs/README.md)                 | Start here; map of all docs                               |
| [Milestones](docs/MILESTONES.md)                      | Scope, status and acceptance criteria                     |
| [Architecture](docs/ARCHITECTURE.md)                  | Runtime topology, stack and data flow                     |
| [API](docs/API.md)                                    | REST endpoints, SSE protocol and errors                   |
| [Data formats](docs/DATA-FORMATS.md)                  | Cards, chat JSONL, world info, presets and internal files |
| [Providers](docs/PROVIDERS.md)                        | Provider kinds, endpoints and adapter guide               |
| [SillyTavern compatibility](docs/ST-COMPATIBILITY.md) | Feature matrix and known deviations                       |
| [Development](docs/DEVELOPMENT.md)                    | Setup, testing and extension workflows                    |
| [Deployment](docs/DEPLOYMENT.md)                      | LAN, reverse proxy, services, backup and upgrades         |
| [Security](docs/SECURITY.md)                          | Auth, secrets, LAN guidance and hardening backlog         |
| [Troubleshooting](docs/TROUBLESHOOTING.md)            | Common failures and diagnostics                           |
| [Glossary](docs/GLOSSARY.md)                          | Terminology                                               |
| [Code reuse](docs/REUSE.md)                           | Licensing and reuse assessment                            |
| [Changelog](CHANGELOG.md)                             | Release history and unreleased changes                    |

## Language

The UI and documentation are English-first. Internationalization is intentionally deferred; when it lands, Chinese (zh-CN) will be the first additional locale.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version:

- GitFlow: `main` is the release baseline, `dev` is integration, feature branches target `dev`.
- Atomic commits, small PRs, merge commits.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build` before pushing.
- Update docs and `CHANGELOG.md` in the same change.
- Never commit `data/`, `.ref/` or secrets.

## Security

- Single-user password auth; first-run setup is loopback-only.
- API keys are stored server-side and never sent to the browser.
- The app has no built-in TLS. Use a reverse proxy/VPN beyond a trusted LAN.
- See [Security](docs/SECURITY.md) for the full model, known gaps and incident response.

## License and attribution

CatCup Tavern is released under **AGPL-3.0-only**. It reuses or adapts code and data formats from:

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) — AGPL-3.0. Character card parsing, data formats, prompt/world-info semantics and provider conversion references.
- [RisuAI](https://github.com/kwaroran/RisuAI) — GPL-3.0. Modern TypeScript request-layer references, character import and Tauri/LAN service design. Combined with this AGPL-3.0 project under AGPLv3 §13.

See [Code reuse](docs/REUSE.md) for the module-level list and [NOTICE](NOTICE) for attribution.
