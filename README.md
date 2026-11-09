# CatCup Tavern

A **SillyTavern-compatible AI roleplay client**. One codebase, three shapes:

- **Web** — open it in a browser, locally or across your LAN
- **Desktop** — Tauri 2 shell (planned, reusing the same server + SPA)
- **Data** — import/export SillyTavern character cards (PNG/JSON v2/v3), chat JSONL, world info and prompt presets
- **Providers** — OpenAI-compatible APIs, OpenRouter, Anthropic, Ollama

> Status: `v0.1` scaffold. The current build includes a working web + Node runtime, single-user password auth, character card import, ST-compatible chat persistence, and streaming generation for the four provider families above.

## Why another tavern?

SillyTavern's data model and prompt semantics are the ecosystem's lingua franca. CatCup Tavern keeps that compatibility while replacing the legacy jQuery UI with a modern React app and a server-owned generation pipeline:

- API keys never reach the browser.
- The same server powers localhost, LAN and the future desktop shell.
- Prompt assembly, token budgeting and provider calls live in one place.
- The UI follows SillyTavern's information architecture — character rail, chat stream, settings — with a darker, quieter tavern atmosphere.

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

The first password must be set on the machine running the server. After that, devices on the LAN sign in with the same password. Put the server behind an HTTPS reverse proxy if it is reachable beyond a trusted network.

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
├── worlds/              # World Info JSON (ST format)
├── presets/             # Prompt / sampling presets
├── settings.json        # App settings
├── secrets.json         # API keys (server-only)
└── auth.json            # Password hash + session secret
```

You can copy SillyTavern's `characters/`, `chats/` and `worlds/` folders into this directory to migrate existing content. `data/` and `.ref/` are gitignored.

## Language

The UI and documentation are English-first. Internationalization is intentionally deferred; when it lands, Chinese (zh-CN) will be the first additional locale.

## License and attribution

CatCup Tavern is released under **AGPL-3.0-only**. It reuses or adapts code and data formats from:

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) — AGPL-3.0. Character card parsing, data formats, prompt/world-info semantics, provider conversion references.
- [RisuAI](https://github.com/kwaroran/RisuAI) — GPL-3.0. Modern TypeScript request-layer references, character import and Tauri/LAN service design. Combined with this AGPL-3.0 project under AGPLv3 §13.

See [docs/REUSE.md](docs/REUSE.md) for the module-level list and [NOTICE](NOTICE) for attribution.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Code reuse assessment](docs/REUSE.md)
