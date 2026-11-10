# Changelog

All notable changes to CatCup Tavern are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). No release tag has been cut yet; `0.1.0` records the M0 scaffold.

## Unreleased

### Added

- Milestone roadmap with scope, sequencing and acceptance criteria (`docs/MILESTONES.md`).
- Documentation set: API, data formats, providers, ST compatibility, development, deployment, security, troubleshooting, glossary and documentation index.
- Pull request template and contributing guide.
- World info loader that reads SillyTavern books from `data/worlds/`, including wrapped `{ entries }` files and bare uid maps, with decorator parsing and per-record validation.
- World info scanner core: constant entries, primary and secondary keys with all four `selectiveLogic` modes, `scanDepth`, case and whole-word options, regex keys, probability, ordering, token budget, global-scan opt-ins and generation-type triggers.
- Full world info scan semantics: the `INITIAL` / `RECURSION` / `MIN_ACTIVATIONS` state machine with `minActivations`, `maxRecursionSteps`, `excludeRecursion`, `preventRecursion` and `delayUntilRecursion`; inclusion groups with scoring, overrides and weighted rolls; character name and tag filters; and every position bucket including example messages and outlets.
- Timed world info effects: `sticky`, `cooldown` and stateless `delay`, persisted as `chat_metadata.timedWorldInfo` with SillyTavern-compatible entry hashes and the sticky-to-cooldown hand-off.
- World info prompt helper: `buildWorldInfoPrompt`, `wi_format` handling and Author's Note composition.
- Per-entry activation trace on the scan result, recording the pass and reason, ready for the context inspector.
- Shared world info schema extended with SillyTavern's full position, logic, role and scan opt-in fields.
- Prompt Manager model and assembly: SillyTavern's default prompt definitions and order, order sanitizing, generation-type triggers, fixed system-prompt merging, character-card `main` and `jailbreak` overrides, ordered message slots, relative and absolute in-chat injection, and optional system-message squashing.
- World info now reaches generation: `worldInfoBefore` and `worldInfoAfter` occupy their prompt-order slots, at-depth entries are injected into the chat, and `chat_metadata.timedWorldInfo` is persisted after each scan.
- Author's Note: composed with world info's top and bottom buckets, scheduled by interval, and injected in prompt, in chat, or before the prompt.
- Settings gain a `worldInfo` block (books, depth, budget, recursion and matching options) and an `authorNote` block.
- SillyTavern OpenAI presets can be imported, exported, listed and deleted over `/api/presets`, and activated through `activePresetId`. The body is stored verbatim so unknown fields survive a round trip.
- An active preset now supplies the prompt list and order, the assembly formats, the chat and example separators, the continue nudge, `squash_system_messages` and the sampling parameters; omitted fields fall back to the app's generation settings.
- Settings has a Prompts tab for selecting, importing, exporting and deleting presets.
- Chat editing: inline message editor, a Continue button below the latest reply, branching a chat from any message, chat rename and delete, and an alternate-greeting picker when the card has more than one opening.
- `PATCH /api/chats/:characterId/:chatId` renames a chat by moving its file, and `POST /api/chats/:characterId/:chatId/branch` copies the conversation up to a message into a new chat.
- ST preset schema now carries `injection_trigger`, `extension`, `position` and the assembly strings, and keeps `system_prompt` optional so its three states survive a round trip.

### Fixed

- World info entries are no longer dropped when `sticky`, `cooldown`, `delay`, `group`, `groupWeight`, `triggers` or a key list is `null`, which is what the SillyTavern editor and several card exporters write.

### Changed

- Prompt assembly replaces the M0 builder's single labelled character sheet with one message per marker, in prompt-order order.
- README now links the full documentation map and the current milestone status.
- `CLAUDE.md` now points at the documentation set and records M1 as in progress.

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
