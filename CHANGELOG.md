# Changelog

All notable changes to CatCup Tavern are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). `0.1.0` records the M0 scaffold; `0.2.0` is the first early-access release; `0.2.1` is a compatibility patch; `0.3.0` is the M2 feature release.

## Unreleased

### Added

- `.catcup` is CatCup's own character card package: the same ZIP container CharX uses — a V3 `card.json` plus `assets/**` — under CatCup's extension. A `.catcup` renamed to `.charx` opens in RisuAI and the reverse, and one parser serves both. The library import button and the character editor accept and produce it, the editor gains a **CatCup** export button, and `?format=catcup` is a new value on the export endpoint.
- A desktop-only `POST /api/characters/import-path` endpoint imports one card from a path on the machine, accepting the same `.png`, `.json`, `.charx` and `.catcup` files as the upload route. A web or LAN server does not register it and answers `404`. It exists so the shell can open a card the user picked in Explorer, and the per-file import logic is now shared with the multipart route so both store package assets the same way.
- The release notes the workflow writes now describe group roleplay alongside single-character roleplay, matching what 0.3.0 actually ships.
- The desktop app opens without an access password. The shell passes `CATCUP_DESKTOP=1`, a fresh install goes straight to the library instead of a setup screen, and About → Access password can set one (the sign-in screen returns) or remove it later. Web and LAN installs keep the password model unchanged. The server refuses to start in this mode when bound to a non-loopback host, so the open API cannot reach the LAN. New endpoint: `PUT /api/auth/password`; `/api/auth/status` gains `openSession`.

### Fixed

- A documentation accuracy pass: the handbook's status claims now match the code (M2 complete in 0.3.0, M4 in progress), the API error table lists `SUMMARY_FAILED`, `PROVIDER_DISABLED`, `PROVIDER_KEY_REUSE` and `INVALID_BASE_URL`, two SSE endpoints rather than one are documented, the design breakpoints match the implementation, and the troubleshooting page no longer points at server logs that stay quiet on handled errors.

## 0.3.0 — 2026-11-13

### Added

- Group chat storage and REST endpoints: groups are stored in SillyTavern's `data/groups/<id>.json` shape and their chats in `data/group chats/<chatId>.jsonl`, with `members` as avatar file names and `original_avatar` on every group message. `/api/groups` can create, edit and delete groups, their chats and their messages.
- Group chats are usable end to end: a Groups tab with a group editor, a group chat pane with per-member avatars, and server-side replies. Natural, list, manual and pooled speaker selection; each reply uses the chosen member's card, with a group nudge, `Name:` history prefixes, ST's group new-chat marker, reply trimming and a manual speaker picker. New chats seed one greeting per member, muted members included.
- Summary memory: a rolling summary stored as `extra.memory` on the message it covers, as SillyTavern's Memory extension does. Automatic updates run after a reply when the message or word interval is reached; the Memory panel can summarize now, edit, restore or delete it; the injection template and position (after/before the main prompt, or in chat at a depth with a role) mirror the extension. `{{summary}}` and `{{words}}` expand in prompts, the context inspector has a Memory tab with the injected text and its token cost, and a new Settings → Memory tab edits the schedule and injection. Works in group chats too. New endpoints: `POST …/summarize`, `PUT …/memory` and `DELETE …/memory` for both chat kinds.
- Quick Replies (subset): SillyTavern version 2 quick reply sets are stored one file per set in `data/quickreplies/`, with import, export, rename and delete. A bar above the message box shows the enabled sets in account order and runs a button; a Settings → Quick Replies tab edits sets, their buttons, colors and the bar order. Plain-text replies fill the message box (or the whole set can paste instead of run), and `/send`, `/sys` (`/nar`), `/echo`, `/trigger`, `/continue`, `/regenerate` and `/run` execute as SillyTavern's do, chained with `|`. `/trigger` and Quick Replies in group chats choose a speaker by name or index. A chat's own `chat_metadata.quickReply` set links are honoured. New endpoints: `/api/quick-replies` and `POST …/quick-replies/execute` for both chat kinds, plus a `trigger` generation action.
- Text to speech: browser speech synthesis or any OpenAI-compatible `/audio/speech` endpoint, configured in Settings → TTS. A play button on each reply (and on narrator notes) speaks it with a per-character voice; autoplay follows new replies. The remote backend keeps its API key in `data/secrets.json` and the response only exposes whether one is set. Message text is cleaned of code blocks, tags, links and markdown before speaking, and audio is generated on demand rather than stored. New endpoint: `POST /api/tts/speak`.
- Image generation: Automatic1111/Forge or any OpenAI-compatible `/images/generations` endpoint, configured in Settings → Images. A prompt can be typed or drafted from the recent chat by the active text model. Generated images are written to `data/user/images/<character or group>/` with a metadata sidecar, listed in a per-character and per-group gallery, and inserted into a chat as SillyTavern `extra.media` messages that the ST client can read back. The API key is write-only in `data/secrets.json`, and `/api/settings` only reports `imageHasKey`. New endpoints: `POST /api/images/draft`, `/generate`, `/attach` and `/test`, plus `GET /api/images`, `GET|DELETE /api/images/:folder/:file`.
- ComfyUI image generation: paste an API-format workflow in Settings → Images and its `%prompt%`, `%negative_prompt%`, `%seed%`, `%width%`, `%height%`, `%steps%`, `%scale%`, `%sampler%`, `%scheduler%` and `%model%` placeholders are filled before the graph is posted to `/prompt`. The adapter polls `/history/<id>`, downloads the first image from `/view`, reports node tracebacks and validation details in errors, and posts `/interrupt` when the browser disconnects or the job times out. Interface-format workflows are rejected with a hint to use **Save (API Format)**; the default is SillyTavern's starter graph with `CatCup` as the filename prefix.
- CharX import and export. A `.charx` package (RisuAI's ZIP format) is imported from the character library: the card becomes a PNG card when it has a PNG icon, or a JSON card otherwise, and every `assets/**` file is kept under `data/character-assets/<character>/`. The character editor exports a V3 `card.json` with the PNG image as its icon and the stored assets, so a package round-trips; Risu `module.risum` bundles and `.charx` embedded-JPEG files are not imported. ZIP entries are checked for path traversal and capped at 200 files, 25 MB per file and 60 MB in total.
- Character library improvements: a star on every card toggles SillyTavern's `data.extensions.fav` flag (read from a legacy root `fav` on flat cards), a favorites-only filter and favorite-first sorting, tag chips with multi-select AND filtering, sorting by name A–Z/Z–A, recently changed, newest created and favorites, and a selection mode for bulk favorite/unfavorite, add/remove tag and delete. Bulk tag edits leave existing tag spelling untouched and skip redundant writes. New endpoints: `PATCH /api/characters/:id/favorite` and `POST /api/characters/bulk`. A card's first write stamps a V2/V3 `creation_date` when it has none, so the creation sort survives atomic file replacement; bulk delete keeps chat files on disk.
- GitHub Actions builds the Windows installer when a merge into `main` carries an untagged version, or when a `v*` tag is pushed, and attaches it to the matching GitHub release, using that version's `CHANGELOG.md` section as the release body. Run the Release workflow manually with an existing tag to rebuild or republish an installer.
- `main` and `dev` are protected on GitHub: both only change through a pull request whose `Typecheck, lint, test and build` check passes, and neither accepts a force push or deletion. `main` additionally requires the branch to be up to date before merging. Branches are named by prefix (`feat/`, `fix/`, `docs/`, `ci/`, `chore/`, `release/`, `hotfix/`) and deleted once merged.
- Releases are cut automatically from `main`. A merge into `main` whose `package.json` version has no tag yet creates the `v<version>` tag on that commit and runs the installer build and release publish in one pass, so tagging by hand is no longer part of the flow. A merge whose version is already tagged is skipped.
- Settings and provider management were redesigned around the new `docs/DESIGN.md` system. Settings now uses a grouped left navigation (Model, Prompt, Chat, Media, About) at 768 px and wider, with a section select on narrow screens, so all eleven sections stay reachable. Providers is a master–detail panel: adding one starts from a type template, the list shows Active, Disabled and missing-key state, **Fetch models** and **Test connection** both run against the unsaved form, **Advanced** exposes custom request headers, and the provider actions are separated from the save bar. Unsaved provider and Generation edits are protected by a three-way guard (Save and continue, Discard changes, Keep editing) when switching provider, switching section or closing the dialog. Clearing a stored API key is staged and applied on save. New endpoint: `POST /api/providers/test`.
- The modal shell now traps focus, focuses the dialog on open, restores focus to the trigger on close, and supports reduced motion. Stacked layers such as the image lightbox participate in the same focus stack. Buttons and inputs have visible `focus-visible` rings, and essential hints use solid `muted` text instead of low-contrast opacity.

### Changed

- An active provider is always enabled. Disabling or deleting the active provider moves `activeProviderId` to the first other enabled provider, or to `null` when none is enabled; enabling a provider while none is active makes it active. The UI cannot disable the active provider, and `PATCH /api/settings` rejects a disabled provider with `400 PROVIDER_DISABLED`.
- **Test connection** no longer saves the provider first; it tests the current form through the new draft endpoint. The old **Load** button became **Fetch models**, which also tests the connection. Saving is a separate, explicit action.
- A draft test reuses a stored key only when the form's provider kind and base URL match the saved provider; testing a different endpoint requires entering the key again. The endpoint accepts only http(s) URLs, times out model lookups after 15 seconds, and is rate-limited.

### Fixed

- A failed settings load shows an error with a retry action instead of an endless spinner; a failed refresh keeps the open provider form and its unsaved edits. Switching providers no longer silently discards edits.
- Settings navigation moves focus from the tab that currently has it, every tab's `aria-controls` resolves to the single panel, scroll-only sections such as About are keyboard-scrollable, the temperature and top-p sliders have accessible names, and file imports use a visible button instead of an invisible focused input.
- Draft connection results, model suggestions and late save responses are discarded when the form changes or another provider is selected, so they cannot appear against the wrong configuration.

## 0.2.1 — 2026-11-11

### Added

- Providers can be added, duplicated and deleted in Settings. A new one starts as a custom endpoint, and **Load** fills the model suggestions from the provider's own model list without saving first.
- The library footer switches the active provider from a list that shows each one's model, so changing servers no longer means opening settings.
- GitHub Actions CI runs `typecheck`, `lint`, `test` and `build` on every pull request into `dev` or `main`, and on every push to either branch, replacing the manual post-merge checks.
- **Import lore** in the character editor copies a card's embedded `character_book` into the world info library and links it to the card through `extensions.world`. The imported book is editable in the World Info tab, and repeating the action on a linked card reuses the existing book.
- A chat's opening message can be switched to any of the card's greetings from the chat header. New chats keep every greeting as a swipe on the first message, as SillyTavern does, so swiping also changes the opening.

### Fixed

- Macros in greetings, chat history and typed messages now expand to the character and persona names, both in the assembled prompt and in the chat view. Sent and edited messages are stored expanded, as SillyTavern does, while a greeting keeps its macros in the chat file and is expanded when it is used or displayed.

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
