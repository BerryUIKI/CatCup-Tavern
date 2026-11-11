# Changelog

All notable changes to CatCup Tavern are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). `0.1.0` records the M0 scaffold; `0.2.0` is the first early-access release.

## Unreleased

### Added

- Providers can be added, duplicated and deleted in Settings. A new one starts as a custom endpoint, and **Load** fills the model suggestions from the provider's own model list without saving first.
- The library footer switches the active provider from a list that shows each one's model, so changing servers no longer means opening settings.

## 0.2.0 — 2026-11-11

### Added

- Bundled sample character, added from the empty library with one click; the card is original to this project and safe to delete.
- An About tab that states what this build does and does not do, next to the version it is running.
- `docs/LIMITATIONS.md`, the user-facing page behind that tab.
- Version 0.2.0 across the workspace, the server and the desktop bundle.
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
- World info library: `GET/POST/DELETE /api/worlds` plus import and export, and a World Info settings tab to enable books, import JSON, export and delete them.
- Context inspector: `GET /api/chats/:characterId/:chatId/context` rebuilds the prompt without generating, and a dialog shows the assembled messages, the world info activation trace and per-slot token estimates.
- World info books bound by a character card and enabled globally are deduplicated case-insensitively, so a book is never scanned twice.
- Prompt order editor: reorder entries, enable or disable them, and switch a prompt between the ordered list and an in-chat injection with depth, order and role. Saved with `PATCH /api/presets/:id`, which merges the prompt fields into the stored preset and leaves the rest of the body untouched.
- World info entry editor: create, edit, duplicate, reorder and delete entries from the World Info settings tab. The form covers keywords and secondary-key logic, content, always-active and disabled state, position with depth and role, scan overrides, inclusion groups, sticky/cooldown/delay, recursion and matching sources.
- World info entry endpoints: `POST /api/worlds/:id/entries`, `POST /api/worlds/:id/entries/:uid/duplicate`, `PATCH /api/worlds/:id/entries/:uid`, `DELETE /api/worlds/:id/entries/:uid` and `PUT /api/worlds/:id/entries/order`. Patches merge into the stored entry, so `extensions`, `vectorized` and unknown fields survive.
- `GET /api/worlds/:id` now returns the normalized entry list alongside the stored body, in editor order.
- `splitKeywordsAndRegexes` in the shared package: comma-separated keyword input keeps commas inside `/pattern/flags` keys, matching SillyTavern's editor.
- ST preset schema now carries `injection_trigger`, `extension`, `position` and the assembly strings, and keeps `system_prompt` optional so its three states survive a round trip.
- Model-aware token counting: generation and the context inspector count with the exact tiktoken encoding for the active OpenAI or OpenAI-compatible model (`o200k_base`, `cl100k_base`, `p50k_base` or `r50k_base`) and with the bundled Claude vocabulary for Anthropic providers. Models with their own tokenizer fall back to the byte-based estimate.
- The context inspector names the counter in use (`counter` and `counterSource` on `budget`), so a surprising budget has an explanation.
- Desktop shell spike: a Tauri 2 window starts the server on an OS-chosen port, opens the SPA and kills the child on exit. See `docs/DESKTOP.md` for what is proven and what is still missing.
- `CATCUP_PORT=0` asks the OS for a free port; the server then writes `CATCUP_READY <port>` to stdout so a supervisor or the desktop shell can find it.
- Regex scripts: SillyTavern's engine, placements and field names, with scripts stored in `data/regex.json`, imported and exported as JSON, and managed from a new Regex settings tab that includes a live test box.
- Regex scripts run at the four points SillyTavern uses: user input and AI output before they are stored, world info entry content, reasoning, and the chat view for display-only scripts. Message edits re-run scripts that opt into `runOnEdit`.
- Character card editing: `PATCH /api/characters/:id` merges every text field into the stored card and writes it back, preserving `extensions`, the character book and V3 assets. PNG cards get both `chara` and `ccv3` rewritten; the image is untouched.
- A character editor dialog, opened from the library, with a PNG or JSON export alongside it.
- `GET /api/characters/:id/export?format=png|json` downloads a card; a legacy flat card is promoted to a V2 wrapper so the file is valid on its own.
- Multiple personas: a list in settings with one marked default, a persona manager in the Persona tab, and a per-chat pin stored as `chat_metadata.persona_id` so the choice travels with the chat file.
- A file written before the persona list existed is migrated on read: its single `persona` object becomes the first entry, under the id `default`.
- SillyTavern import: point at an existing user folder and copy its characters, chats, world info and OpenAI presets in one action. A scan shows what was found before anything is written; chats are matched to characters by folder name and unmatched ones are reported instead of guessed at. `POST /api/import/sillytavern`.
- An "Import from SillyTavern" entry in the character library that drives that endpoint.
- Windows desktop app: a per-user NSIS installer that bundles its own Node runtime, a single-file server build and the SPA. It starts the server on an OS-chosen port, opens it in a window, and stops the server when the window closes.
- The desktop app is single-instance — a second launch focuses the open window — and puts the server in a job object, so killing the shell also kills the server.
- `CATCUP_BUNDLE_DEPS=1` builds the server with every dependency inlined, which is what the desktop bundle ships.

### Changed

- Pretty log output is now used only when stdout is a terminal. A packaged build pipes stdout into the desktop shell, where `pino-pretty` is not installed.

### Changed

- Settings replace `persona` with `personas` and `activePersonaId`. `PATCH /api/settings` accepts the new fields; sending `persona` is now a validation error.

### Fixed

- World info entries are no longer dropped when `sticky`, `cooldown`, `delay`, `group`, `groupWeight`, `triggers` or a key list is `null`, which is what the SillyTavern editor and several card exporters write.
- An entry with no `selective` field now defaults to `true`, as SillyTavern's entry template does, so an entry that only lists secondary keys applies their logic.
- An explicit `order: null` now reads as `0`; before, it shared the missing-field default of `100` and sorted lorebook entries differently from SillyTavern.

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
