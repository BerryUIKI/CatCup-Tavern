# Changelog

All notable changes to CatCup Tavern are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). No release tag has been cut yet; `0.1.0` records the M0 scaffold.

## Unreleased

### Added

- Milestone roadmap with scope, sequencing and acceptance criteria (`docs/MILESTONES.md`).
- Documentation set: API, data formats, providers, ST compatibility, development, deployment, security, troubleshooting, glossary and documentation index.
- Pull request template and contributing guide.

### Changed

- README now links the full documentation map and the current milestone status.
- `CLAUDE.md` now points at the documentation set and records M0 as complete.

## 0.1.0 — 2026-11-09

### Added

- pnpm monorepo with TypeScript, Vite, Fastify, Tailwind CSS, Biome and Vitest.
- Shared Zod schemas for SillyTavern character cards, character books, chat JSONL, world info, presets, providers, settings and API payloads.
- Single-user password authentication: scrypt hashing, HMAC-signed session cookie, loopback-only first-run setup and rate-limited login.
- ST-compatible file storage under `data/`, with atomic writes and per-file locks.
- PNG `tEXt` / JSON character card import for V2, V3 and legacy flat cards.
- ST-style chat JSONL persistence: create, list, read, edit/delete messages, swipe selection, chat deletion.
- Provider adapters for OpenAI-compatible APIs, OpenRouter, Anthropic Messages API and native Ollama, including model lists and connection tests.
- Server-owned prompt assembly with core macros, character sheet, persona, approximate context trimming and post-history instructions.
- SSE generation with start/token/reasoning/done/error events, stop support, partial-reply persistence and usage metadata.
- React web UI: dark tavern theme, setup/login, character library and import, streaming chat, reasoning display, swipes, regenerate, delete, copy, provider settings, generation settings and persona editor.
- 13 unit tests covering shared schemas, character card normalization, chat JSONL round-trip and prompt assembly.
- Live end-to-end smoke test against a local OpenAI-compatible endpoint.
- Initial architecture, reuse, setup and licensing documentation.

### Security

- API keys are stored server-side only (`data/secrets.json`) and never returned by the API.
- API responses expose only `hasKey`.
- `data/`, `.ref/`, `.env` and build output are gitignored.
