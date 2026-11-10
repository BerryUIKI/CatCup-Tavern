# Milestones

> Current status: **M0 complete** (2026-11-09). **M1 in progress.**
>
> This document is the source of truth for scope, sequencing and acceptance criteria. If a roadmap table elsewhere disagrees with this file, this file wins.

## Status model

| Status          | Meaning                                                            |
| --------------- | ------------------------------------------------------------------ |
| **Complete**    | Scope landed, acceptance criteria met, docs and changelog updated. |
| **In progress** | Actively being implemented; may be split into several PRs.         |
| **Planned**     | Scoped but not started.                                            |
| **Blocked**     | Waiting on a dependency or decision.                               |
| **Cut**         | Explicitly removed from the current release scope.                 |

## Definition of done

A milestone item is not done until all of the following are true:

1. **Behaviour** is implemented end-to-end, including the failure path.
2. **Tests** cover the new logic; UI-facing work has a manual smoke test.
3. **Docs** are updated (`README.md`, the relevant `docs/` page, and this file).
4. **Changelog** has an entry if the change is user-facing.
5. `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass.
6. No secret, `data/` file or `.ref/` content is committed.
7. The work reaches `dev` through a small PR (see [CONTRIBUTING.md](../CONTRIBUTING.md)).

A milestone is complete when all of its acceptance criteria pass and its status table here is updated.

## At a glance

| Milestone | Theme                                                                         | Status   | Depends on |
| --------- | ----------------------------------------------------------------------------- | -------- | ---------- |
| **M0**    | Runnable foundation: web + server + ST data basics                            | Complete | —          |
| **M1**    | Core SillyTavern experience: world info, prompt manager, presets, editing     | Complete | M0         |
| **M2**    | Extended roleplay: groups, memory, regex, TTS, image generation, card editing | Planned  | M1         |
| **M3**    | Scripting and extension compatibility: STscript, Quick Replies, getContext    | Planned  | M1, M2     |
| **M4**    | Desktop: Tauri shell, Node sidecar, updater, packaging                        | Planned  | M0–M3      |
| **M5**    | Polish and release: mobile, i18n, accessibility, performance, CI, v1.0        | Planned  | M0–M4      |

## M0 — Runnable foundation (Complete)

**Goal:** a locally runnable tavern that can import ST cards, keep ST-style chats, stream from the four required provider families, and look and feel like a SillyTavern-style client.

### Delivered

- pnpm monorepo with TypeScript, Biome and Vitest.
- Shared Zod schemas for character cards, character books, chats, world info, presets, providers, settings and API payloads.
- Fastify server with:
  - first-run password setup, scrypt hashing, HMAC session cookie;
  - ST-compatible file storage with atomic writes and per-file locks;
  - PNG `tEXt` / JSON character card import (v2, v3, legacy flat cards);
  - chat JSONL list/create/read/update/delete, swipe selection and chat deletion;
  - provider CRUD, server-only API keys, active-provider selection;
  - OpenAI-compatible, OpenRouter, Anthropic and Ollama streaming adapters;
  - prompt assembly with core macros, character sheet, persona, context trimming and post-history instructions;
  - SSE generation with stop, partial persistence, reasoning and usage.
- React SPA with:
  - setup/login screens;
  - character library, search and PNG/JSON import;
  - streaming chat, reasoning display, swipes, regenerate, delete and copy;
  - provider, generation and persona settings;
  - dark tavern theme and responsive sidebar.
- 13 unit tests (shared + server), plus a live end-to-end smoke test against a local OpenAI-compatible endpoint.
- Initial architecture, reuse, setup and licensing documentation.

### Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

M0 also passed a live smoke test covering: password setup, character import, chat creation, streaming reply, reasoning persistence and ST JSONL output.

### Known gaps deferred to later milestones

- No world info scanner or editor.
- No Prompt Manager execution, prompt-order editor or ST preset import.
- No STscript, Quick Replies or regex scripts.
- No character card editing/export, CharX import, or PNG write.
- No group chats, summary memory, TTS or image generation.
- No ST extension API or UI extension host.
- No Tauri shell.
- English UI only; no i18n yet.
- No CI workflow; quality gates are currently run locally.
- Approximate token counting; no model-specific tokenizer yet.
- Provider adapters cover text chat only (no vision, tool calling or embeddings).

### M0 exit criteria met

- [x] A new user can set a password, import a card, create a chat and stream a reply.
- [x] Chat and card formats remain readable as SillyTavern-style files.
- [x] API keys never reach the browser.
- [x] The production build serves the SPA and API from one process.
- [x] The four required provider families are implemented.
- [x] The project builds and tests cleanly from a fresh checkout.

## M1 — Core SillyTavern experience (In progress)

**Goal:** make single-character roleplay genuinely useful day to day. This is the milestone that turns the scaffold into a proper SillyTavern-compatible tavern.

### Delivered so far

- **World info loader** (`apps/server/src/worldinfo/loader.ts`): wrapped `{ entries }` and bare uid maps, uid fallback from the record key, decorator parsing, per-record validation, `null`-tolerant field handling and a SillyTavern-compatible entry hash.
- **World info scanner** (`apps/server/src/worldinfo/scanner.ts`): the full SillyTavern evaluation pipeline — activation, `INITIAL`/`RECURSION`/`MIN_ACTIVATIONS` scan states, inclusion groups with scoring and weighted rolls, timed effects, the budget latch, and every position bucket including example messages and outlets.
- **Timed effects** (`apps/server/src/worldinfo/timedEffects.ts`): `sticky`, `cooldown` and stateless `delay`, persisted as `chat_metadata.timedWorldInfo` and matched by entry hash.
- **Prompt helper** (`apps/server/src/worldinfo/prompt.ts`): `buildWorldInfoPrompt`, `wi_format`, and Author's Note composition.
- **Shared world info schema** extended to SillyTavern's full field set, with `null` accepted wherever SillyTavern writes it.
- **Prompt Manager** (`apps/server/src/prompt/`): SillyTavern's default prompt definitions and order, sanitizing, generation-type triggers, the collection model, fixed system-prompt merging, character-card `main`/`jailbreak` overrides, ordered message slots, relative and absolute injection, and system-message squashing.
- **Prompt assembly** now emits each marker as its own message — world info before/after, persona, description, personality, scenario, examples and history — instead of the M0 labelled character sheet.
- **World info and Author's Note are wired into generation**: the route scans the full conversation, persists `timedWorldInfo`, and passes the scan result to the assembler.
- **Preset import, export and activation**: ST OpenAI presets are stored verbatim under `data/presets/`, listed, imported, exported and deleted over the API, and an active preset supplies the prompt list, order, formats and sampling parameters. Settings gain a Presets section in the UI.
- **Chat editing and branching**: inline message editing, continue generation from the latest reply, branching a conversation from any message, chat rename and delete, and an alternate-greeting picker when starting a chat.
- **World info library**: books can be listed, imported, exported, deleted and enabled per account from a World Info settings tab. Importing stores the file verbatim; deleting removes the id from the enabled list.
- **Context inspector**: `GET /api/chats/:characterId/:chatId/context` rebuilds the prompt against a cloned `chat_metadata`, and the inspector shows the assembled messages, the per-entry world info trace (activated or skipped, reason, pass) and per-slot token counts.
- **Prompt order editor**: reorder entries, enable or disable them, and move a prompt between the ordered list and an in-chat injection with a depth, order and role, saved back into the active preset through `PATCH /api/presets/:id`. Edits merge into the stored body, so sampling fields the editor does not show are preserved.
- **World info entry editor**: entries can be created, edited, duplicated, reordered and deleted in the World Info settings tab. The form covers keywords and secondary-key logic, content, placement, scan overrides, inclusion groups, timed effects, recursion and matching sources; the API merges each patch into the stored entry, so `extensions`, `vectorized` and unknown fields survive. New entries take the lowest free uid and are built from SillyTavern's `newWorldInfoEntryTemplate`.
- **Model-aware tokenizer**: generation and the context inspector count with the exact tiktoken encoding for the active OpenAI or OpenAI-compatible model (`o200k_base`, `cl100k_base`, `p50k_base` or `r50k_base`), and with the bundled Claude vocabulary for Anthropic providers. Models with their own tokenizer, such as a local Llama, fall back to a character-based estimate. The inspector names the counter in use.
- 124 unit tests covering matching, loading, recursion, groups, timed effects, positions, prompt ordering, injection, macro expansion, preset resolution, world info turn helpers, entry editing, keyword splitting and tokenizer selection, plus the SillyTavern sample book as a fixture.

M1 is complete. Next is M2.

### Scope

#### 1. World Info engine

- Load ST world info files from `data/worlds/` and bind one or more books to a character/chat.
- Scan recent chat messages using ST-compatible semantics:
  - primary and secondary keys;
  - `constant`, `selective`, `selectiveLogic`;
  - `scanDepth`, `caseSensitive`, `matchWholeWords`;
  - `order`, `position`, `depth`, `role`;
  - probability and `useProbability`;
  - recursion (`excludeRecursion`, `preventRecursion`, `delayUntilRecursion`);
  - groups and `useGroupScoring`;
  - `sticky`, `cooldown`, `delay`;
  - token budget and truncation.
- Inject triggered entries at the correct prompt positions (before/after character, author's note top/bottom, at depth).
- World Info editor UI and import/export.
- A debug/preview panel showing which entries fired and why.

#### 2. Prompt Manager

- ST-style prompt entries with `identifier`, `role`, `content`, `system_prompt`, `marker`, `injection_position`, `injection_depth`, `injection_order`, `enabled`.
- Default prompt order and per-character/per-preset order overrides.
- Markers for `chatHistory`, `dialogueExamples`, `worldInfoBefore`, `worldInfoAfter`, `charDescription`, `charPersonality`, `scenario`.
- Main prompt, auxiliary prompt, post-history instructions, author's note.
- Prompt order editor UI with drag/reorder and enable/disable.

#### 3. Preset import and management

- Import/export ST OpenAI preset JSON.
- Active preset selection; per-character prompt order.
- Sampling parameters (temperature, top P, max tokens, context size, penalties, stop strings where supported).
- Preset manager UI.

#### 4. Chat editing and branching

- Inline message editing in the SPA (the API already supports message PATCH).
- Branch/checkpoint creation from an earlier message.
- Swipe metadata and navigation refinements; regenerate should preserve provider/reasoning metadata per swipe.
- Alternate greeting selection when creating a new chat.
- Continue generation from the UI.
- Rename and delete chat from the UI.

#### 5. Tokenization and context budget

- Real token counting for supported model families (tiktoken-compatible or model-specific), with the current estimator as fallback.
- Context budget preview and token counter.
- Deterministic history trimming that matches the Prompt Manager's order.

#### 6. UI surfaces

- World Info editor.
- Prompt Manager and preset manager.
- Author's note panel.
- Context inspector / triggered-lore debug view.

### Out of scope for M1

- STscript, slash commands and Quick Replies (M3; a small command palette may land earlier if needed).
- ST extension host (M3).
- Group chats (M2).
- TTS and image generation (M2).
- Character card editing/export and CharX (M2).
- Tauri shell (M4).

### Acceptance criteria

- [x] An ST world info file + an ST OpenAI preset + a v2/v3 character card can be imported and used together.
- [x] Triggering a world info key visibly changes the generated prompt and the debug panel explains why.
- [x] Prompt order and injection positions are editable and persist per character/preset.
- [x] Token budget is enforced with a real tokenizer for at least the OpenAI-compatible and Anthropic model families.
- [x] Message edit, branch and continue round-trip through the ST JSONL format without losing unknown fields.
- [x] World info and preset files can be exported and re-imported without data loss.
- [x] Unit tests cover the scanner, prompt ordering, token budget and preset conversion.
- [x] Docs (`MILESTONES.md`, `API.md`, `DATA-FORMATS.md`, `ST-COMPATIBILITY.md`) and `CHANGELOG.md` are updated.

### Suggested PR slices

1. `feat(world-info): add schema-backed loader and scanner core` + tests.
2. `feat(world-info): add positions, recursion and debug trace` + tests.
3. `feat(prompt): add prompt manager model and ordering` + tests.
4. `feat(presets): import/export ST OpenAI presets` + tests.
5. `feat(tokens): add model-aware tokenizer and context budget`.
6. `feat(chat): add edit, branch, continue and alternate greetings`.
7. `feat(web): add world info, prompt manager, preset and context UI`.
8. `docs: update compatibility and milestone status`.

### Risks

- ST's world info scanner has many interacting flags; fidelity requires fixtures from real ST data.
- Prompt Manager ordering is the most compatibility-sensitive part of the app.
- Tokenizer model coverage may lag the model list; always keep the estimator fallback.
- Scope creep: group chat and STscript must stay out of M1.

## M2 — Extended roleplay (Planned)

**Goal:** cover the common "table full of characters" and media features without yet implementing the full ST extension/scripting platform.

### Scope

- **Group chats**: multiple characters in one chat, speaker selection, turn order, ST-compatible group chat storage.
- **Summary memory**: rolling summaries and memory injection with a visible budget.
- **Regex scripts**: ST-compatible regex transform rules (import/export, placement, flags).
- **Quick Replies (subset)**: UI buttons and basic execution; full STscript integration lands in M3.
- **TTS**: provider-agnostic TTS adapter with at least one local/remote backend.
- **Image generation**: provider-agnostic image generation adapter and gallery integration.
- **Character card editing**: edit card fields, alternate greetings, character book, avatar; export PNG/JSON.
- **CharX / asset bundles**: import/export CharX packages and character assets.
- **Library improvements**: tags, favorites, sorting and bulk actions.

### Acceptance criteria

- [ ] Group chat with at least three characters can be created, persisted and reloaded.
- [ ] Summary memory survives restarts and is visible in the context inspector.
- [ ] Regex rules round-trip with ST and apply in prompt/render paths as configured.
- [ ] A basic Quick Reply executes and appears in the UI.
- [ ] TTS and image generation have at least one working adapter each and clear configuration docs.
- [ ] Character edits export to a valid PNG/JSON card that ST can open.

### Suggested PR slices

Group chat storage → group chat UI → summary memory → regex engine → quick replies → TTS → image generation → card editing/export → CharX → library polish.

## M3 — Scripting and extension compatibility (Planned)

**Goal:** run the parts of the ST scripting/extension ecosystem that are practical, in compatibility layers L2–L4.

### Scope

- **STscript engine**: parser, executor, pipes, closures, variables, `/commands`, slash-command registry, error handling and autocomplete.
- **Macro engine**: full ST macro set and custom macros.
- **Quick Replies (full)**: STscript-backed quick replies and auto-execution.
- **Extension loader**: manifest-based extension discovery, enable/disable, extension settings.
- **getContext compatibility layer**: expose the practical subset of `SillyTavern.getContext()`.
- **Event bus**: ST `event_types` / `eventSource` compatibility.
- **Sandboxed UI extension host**: iframe-based host with explicit RPC and a safe DOM wrapper.
- **Compatibility matrix**: document exactly which ST APIs and extension classes are supported.

### Acceptance criteria

- [ ] Representative STscript sequences and Quick Replies execute with ST-compatible output.
- [ ] A sample ST extension that uses `getContext()` and the event bus can load and run.
- [ ] UI extensions run in a sandbox with no direct access to the host DOM unless explicitly granted.
- [ ] The compatibility matrix lists supported, partial and unsupported APIs.
- [ ] Failures are visible to the user and do not crash the server or the SPA.

### Risks

- ST extension compatibility is the highest-risk area; arbitrary DOM/jQuery extensions may never be fully compatible.
- The sandbox must not become a security bypass.
- STscript is large; implement by usage frequency and document the gaps.

## M4 — Desktop (Planned)

**Goal:** ship a Windows-first Tauri 2 desktop app that reuses the same server and SPA.

### Scope

- Tauri 2 shell with a bundled Node sidecar (`CATCUP_DATA_DIR` set to the OS app-data directory).
- Port selection and readiness handshake; single-instance behaviour.
- Tray icon, window state, graceful shutdown of the sidecar.
- Auto-updater and signed release artifacts.
- File associations for `.png` / `.json` character cards.
- Windows installer first; macOS/Linux packaging after.
- LAN mode remains available from the same server.

### Acceptance criteria

- [ ] A clean Windows machine can install and run the app without a separate Node installation.
- [ ] The desktop app and the browser/LAN mode share the same data directory and behaviour.
- [ ] The sidecar stops when the app exits and does not leave orphan processes.
- [ ] Updates and file associations work.
- [ ] Data can be migrated from the web build.

## M5 — Polish and release (Planned)

**Goal:** a v1.0 that is comfortable on phones, accessible, translatable and releasable.

### Scope

- Mobile browser polish (chat view, composer, sidebar, settings).
- i18n with English and zh-CN first, then community locales.
- Accessibility pass: focus management, labels, keyboard navigation, contrast.
- Performance: route/feature code splitting, smaller initial bundle, streaming render efficiency.
- CI workflow (typecheck, lint, test, build) and release automation.
- Backup/restore and upgrade documentation.
- Security hardening: trust-proxy/TLS guidance, optional CSRF tokens, key encryption at rest evaluation.
- Release notes and v1.0 checklist.

### Acceptance criteria

- [ ] The app is usable on a phone-sized viewport without horizontal scrolling.
- [ ] English and zh-CN UI can be selected at runtime.
- [ ] CI runs all quality gates on every PR into `dev`.
- [ ] The v1.0 release checklist and upgrade notes are published.

## Cross-cutting tracks

### Security

Tracked in [SECURITY.md](SECURITY.md). Every milestone must keep API keys server-side, preserve the single-user boundary and avoid introducing new unauthenticated endpoints.

### Compatibility

Tracked in [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md) and [DATA-FORMATS.md](DATA-FORMATS.md). Any schema change must preserve unknown fields and be tested against ST fixtures.

### Testing

- Unit tests: Vitest, colocated with source.
- Integration smoke tests: local server + local provider endpoint.
- Compatibility fixtures: ST sample cards, chats and world info.
- UI smoke tests: setup, import, chat, stream, settings.

### Documentation

Every user-facing change updates `README.md`, the relevant `docs/` page and `CHANGELOG.md`. Scope changes update this file. Provider changes update [PROVIDERS.md](PROVIDERS.md). API changes update [API.md](API.md).

## v1.0 release criteria

- M0–M5 complete, or explicitly waived in this document.
- Security review completed; known limitations documented.
- Backup, restore and upgrade paths tested.
- CI passes on the release branch.
- License and attribution reviewed (`NOTICE`, [REUSE.md](REUSE.md)).
- No known data-loss bugs in character card, chat or world info handling.

## Risks and open questions

| Risk                                        | Impact                         | Mitigation                                              |
| ------------------------------------------- | ------------------------------ | ------------------------------------------------------- |
| ST extension compatibility is unbounded     | Schedule and scope             | Compatibility tiers; sandbox; document unsupported APIs |
| World Info/Prompt Manager semantics diverge | Users notice different replies | Port algorithms; fixture tests; compare with ST         |
| Tokenizer coverage lags providers           | Context budget wrong           | Estimator fallback; per-family tokenizers               |
| Tauri sidecar packaging on Windows          | Desktop milestone slips        | Prototype early in M4; keep web mode independent        |
| Single-user assumption                      | No multi-user LAN              | Document explicitly; defer multi-user                   |
| i18n late                                   | Rework if strings scattered    | English-first with centralized UI strings               |
| No CI yet                                   | Regressions reach dev          | Add CI in M5; run local gates before pushing            |

## Document history

- 2026-11-09: Initial milestone document. M0 marked complete; M1 scoped.
