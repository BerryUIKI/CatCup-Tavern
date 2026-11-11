# SillyTavern compatibility

CatCup Tavern aims to be a compatible **client**, not a byte-for-byte reimplementation of SillyTavern. Compatibility is delivered in layers. This page records what works today, what is partial, and what is planned.

> Status snapshot: **M1 complete** (2026-11-10). M1 is the core compatibility milestone. See [MILESTONES.md](MILESTONES.md).

## Compatibility layers

| Layer                | Scope                                                     | Status                                                                           |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **L1 data**          | Character cards, chats, world info, presets               | Partial: cards and chats work; world info loads, scans and edits; presets import |
| **L2 semantics**     | Prompt semantics, macros, STscript, Quick Replies, regex  | Partial: prompt manager, world info and macros work; STscript and regex not yet  |
| **L3 extension API** | `SillyTavern.getContext()`, event bus, extension settings | Planned for M3                                                                   |
| **L4 UI extensions** | Extensions that manipulate ST's DOM/jQuery                | Planned for M3, highest risk; not promised for v1                                |

## Data compatibility matrix

| Feature                            | Status             | Notes                                                                    |
| ---------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| Character Card V2 PNG (`chara`)    | ✅ Read            | `ccv3` wins when both exist                                              |
| Character Card V3 PNG (`ccv3`)     | ✅ Read            | Assets are preserved but not processed                                   |
| Character JSON V2/V3 wrapper       | ✅ Read            | Unknown fields preserved                                                 |
| Legacy flat character JSON         | ✅ Read            | Normalized into the V3 data shape                                        |
| Character card write/export        | ✅ Yes             | PNG with both `chara` and `ccv3`, and JSON; unknown fields kept          |
| CharX (`.charx`) import/export     | ❌ Planned         | M2                                                                       |
| Character book (embedded lorebook) | 🟡 Parsed          | Scanner and UI planned for M1                                            |
| Character editing                  | ✅ Yes             | Every card field except the book and the avatar image                    |
| Chat JSONL (ST header + messages)  | ✅ Read/write      | Header `user_name` / `character_name` use `"unused"`                     |
| Chat swipes                        | ✅ Yes             | Regenerate creates a swipe; selecting a swipe is supported               |
| Chat branches/checkpoints          | ✅ Yes             | Branch from any message into a new chat                                  |
| Group chats                        | ❌ Planned         | M2                                                                       |
| World Info JSON schema             | ✅ Schema          | Field names, defaults and `null` handling match ST                       |
| World Info loader                  | ✅ Read            | Wrapped `{ entries }` and bare uid maps; decorators split                |
| World Info scanner                 | ✅ Implemented     | Full ST evaluation, including recursion, groups and timed effects        |
| World Info injection               | ✅ Yes             | Before/after, at-depth and example buckets reach the prompt              |
| Timed effects (`timedWorldInfo`)   | ✅ Implemented     | Sticky, cooldown, delay and the sticky-to-cooldown hand-off              |
| World Info library                 | ✅ Yes             | List, import, export and delete books; enable them per chat              |
| World Info entry editor            | ✅ Yes             | Every scan-relevant field; character filters are preserved, not editable |
| Context inspector                  | ✅ Yes             | Assembled prompt, world info trace and per-slot token estimates          |
| ST OpenAI preset schema            | ✅ Schema          | Field names and defaults match ST                                        |
| Themes                             | ❌ Not implemented | Dark tavern theme only                                                   |
| Personas                           | 🟡 Single persona  | Name + description; multiple personas planned later                      |
| Multi-user directories             | ❌ Not supported   | Single-user `data/`                                                      |

## Semantic compatibility

| Feature                                                            | Status             | Notes                                                                                           |
| ------------------------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------- |
| Character sheet prompt (description/personality/scenario/examples) | ✅ Yes             | Each marker is its own message, in prompt-order order                                           |
| Character `system_prompt` override                                 | ✅ Yes             | Used when non-empty                                                                             |
| Post-history instructions                                          | ✅ Yes             | Appended after history                                                                          |
| Core macros (`{{char}}`, `{{user}}`, ...)                          | 🟡 Partial         | `char`, `user`, `persona`, `description`, `personality`, `scenario`, `time`, `date`, `original` |
| Full ST macro engine                                               | ❌ Planned         | M3                                                                                              |
| Prompt Manager ordering/injection                                  | ✅ Implemented     | Default order, markers, relative and absolute injection                                         |
| Prompt Manager editor UI                                           | ✅ Yes             | Reorder, enable/disable and injection position per preset prompt                                |
| Preset import/export                                               | ✅ Yes             | Import, export and activation through the API                                                   |
| Author's note                                                      | ✅ Yes             | Composed with world info, scheduled and injected at its position                                |
| World Info scanning                                                | ✅ Implemented     | Activation, recursion, groups, timed effects, budget and trace                                  |
| World Info injection                                               | ✅ Yes             | Before/after, at-depth and example buckets are consumed by the assembler                        |
| World Info entry editing                                           | ✅ Yes             | Keys, content, placement, groups, timing, recursion and matching, saved per entry               |
| Context budget                                                     | ✅ Yes             | tiktoken for OpenAI models, the bundled Claude vocabulary, estimate otherwise                   |
| Message editing                                                    | ✅ Yes             | Inline editor in the chat view; edits keep unknown `extra` fields                               |
| Regenerate/swipe                                                   | ✅ Yes             | Swipe selection via API and UI                                                                  |
| Continue generation                                                | ✅ Yes             | Continue button below the latest reply                                                          |
| Branch from message                                                | ✅ Yes             | Branch from any message into a new chat                                                         |
| Alternate greetings                                                | ✅ Yes             | Picker when starting a chat with a card that has alternates                                     |
| Chat rename/delete in UI                                           | ✅ Yes             | Rename moves the chat file; delete asks for confirmation                                        |
| Group chat                                                         | ❌ Planned         | M2                                                                                              |
| Summary memory                                                     | ❌ Planned         | M2                                                                                              |
| Regex scripts                                                      | ✅ Yes             | All placements, prompt/display scoping, depth window and import/export                          |
| Quick Replies                                                      | ❌ Planned         | M2 subset, full in M3                                                                           |
| STscript / slash commands                                          | ❌ Planned         | M3                                                                                              |
| Text completion mode (Kobold/Ooba)                                 | ❌ Not implemented | Chat completion only                                                                            |
| TTS                                                                | ❌ Planned         | M2                                                                                              |
| Image generation                                                   | ❌ Planned         | M2                                                                                              |
| ST extension API                                                   | ❌ Planned         | M3                                                                                              |
| Extension loading/sandbox                                          | ❌ Planned         | M3                                                                                              |

## Provider compatibility

| Provider                                         | Status             |
| ------------------------------------------------ | ------------------ |
| OpenAI / OpenAI-compatible `/chat/completions`   | ✅ Yes             |
| OpenRouter                                       | ✅ Yes             |
| Anthropic Messages API                           | ✅ Yes             |
| Ollama native API                                | ✅ Yes             |
| Google Gemini / Vertex                           | ❌ Planned, later  |
| KoboldAI / Ooba text completion                  | ❌ Not implemented |
| NovelAI, AI Horde and other ST-specific backends | ❌ Not implemented |

See [PROVIDERS.md](PROVIDERS.md) for adapter details.

## Importing SillyTavern content

### Cards

Copy `.png` or `.json` cards into `data/characters/`, or use the UI import button. Both V2 and V3 cards work. `.charx` is not supported yet.

### Chats

Copy ST chat folders into `data/chats/`. CatCup looks for a folder named after the character name first, then the character ID. The JSONL header and unknown fields are preserved.

### World info and presets

World info files load from `data/worlds/` and are scanned with SillyTavern's full evaluation pipeline, including recursion, inclusion groups and timed effects. The result now reaches generation: `worldInfoBefore`/`worldInfoAfter` land in their prompt-order slots, at-depth entries are injected into the chat, and the Author's Note is composed from the top and bottom buckets. ST OpenAI presets can be imported, exported and activated; an active preset supplies the prompt list, order, formats and sampling parameters, and without one the built-in defaults are used.

## Known deviations

- **`send_date` format:** CatCup writes ISO 8601 strings; ST writes humanized strings. Both are treated as opaque strings by the readers.
- **Card file naming:** CatCup names the saved file after the card's display name; ST often keeps the uploaded file name. IDs therefore follow the display name.
- **Chat folder naming:** Character name first, character ID fallback. This differs slightly from ST's single-folder rule but makes imported folders more tolerant.
- **Prompt construction:** the Prompt Manager model is implemented, preset activation replaces the built-in defaults, and the prompt order and injection positions are editable per preset.
- **Continue generation:** CatCup appends SillyTavern's continue nudge, but does not implement `continue_prefill` displacement of the newest message.
- **Anthropic start marker:** If a prompt starts with an assistant message, CatCup inserts a `[Start of chat]` user message for the Messages API.
- **Unknown macros:** Unrecognized `{{macros}}` are left untouched rather than expanded.
- **World info group removal:** SillyTavern's inclusion-group `removeEntry` calls `splice(indexOf(entry), 1)`; when the entry is already gone this removes the last unrelated candidate. CatCup guards the index instead of reproducing that data loss.
- **World info book binding:** a card's own book and the global book list are merged and deduplicated case-insensitively, because `Eldoria` and `eldoria` are the same file on Windows. SillyTavern would load it twice.
- **World Info entry list order:** the editor sorts by `displayIndex` (falling back to `uid`), then `order` descending, then uid — SillyTavern's Custom sort. SillyTavern's own editor defaults to a Priority sort with drag handles only in Custom mode; this editor always uses Custom order because it exposes explicit up/down buttons instead of dragging.
- **World Info character filter:** `characterFilter` is honored by the scanner but not editable in the UI, because CatCup's character ids and tag values do not yet line up with SillyTavern's avatar file names and numeric tag ids. The field is preserved on save, so it survives a round trip.
- **World Info missing `position`:** entries without a `position` field — or with an explicit `null` — default to `0` (before character). SillyTavern only defaults the missing case and drops a `null` position from the prompt entirely.
- **World Info omitted defaults:** the editor writes the fields it exposes. SillyTavern's editor backfills every template field into the in-memory entry on render and persists them on the next save, so a file edited there gains keys a CatCup edit leaves absent. Both shapes read the same, because an absent field falls back to the same default.
- **World info hash for uid-less entries:** CatCup assigns a uid from the record key before hashing, so such an entry's hash differs from the one SillyTavern would compute. SillyTavern always writes a uid, so this only affects hand-written files.
- **Tokenizer for unrecognised models:** SillyTavern resolves every unknown model id to `gpt-3.5-turbo` and counts it with `cl100k_base`. CatCup falls back to its own byte-based estimate instead, because a local Llama or DeepSeek model does not use an OpenAI vocabulary and a wrong exact count is more misleading than a labelled estimate. The inspector names whichever counter is in use.
- **Tokenizer overhead:** CatCup adds the same four tokens per message that SillyTavern uses for OpenAI chat completion. SillyTavern varies that number by call site — world info entries are measured through a path that adds six — so its world info budget can differ from CatCup's by a few tokens per entry.
- **Regex script scopes:** SillyTavern stores scripts globally, on a character (`data.extensions.regex_scripts`) and inside a preset, and runs them in that order behind per-scope allowlists. CatCup has one global list in `data/regex.json`; character and preset scopes, and the allowlists that gate them, are not implemented. An imported global set works unchanged.
- **Regex extension switch:** SillyTavern can disable the regex extension wholesale through `extension_settings.disabledExtensions`. CatCup has no extension registry, so the per-script `disabled` flag is the only switch.
- **Regex and the slash-command placement:** the `SLASH_COMMAND` placement is accepted and stored, but nothing runs it yet because there are no slash commands.
- **World Info regex needs `promptOnly`:** world info is assembled with the prompt flag set, so only `promptOnly` scripts run over entry content. This matches SillyTavern's engine, where a plain script with only the world-info placement would never run either, but it surprises people who expect the placement alone to be enough.
- **Character card rename:** editing a card's `name` changes only the field; the file keeps its original name, because that name is the character id chats, avatars and world info already reference. SillyTavern keeps a stable avatar file name too, so this lands in the same place, but re-importing is how you rename the file.
- **Character card avatar and book:** the editor covers the text fields. Replacing the avatar image and editing the embedded character book are not in it yet; a book can be edited from the World Info tab once the card's book is imported as a world.
- **Legacy cards on export:** a card with no `spec` is promoted to a V2 wrapper when it is written back or exported, because a flat card cannot round-trip losslessly. The fields are kept; only the wrapper is added.
- **Extension compatibility:** None yet. L4 is explicitly a long-term, bounded goal.

## Testing compatibility

The local `.ref/SillyTavern` checkout (gitignored) is the reference for fixtures:

- `default/content/default_Seraphina.png` — V3 card with a character book;
- `default/content/Eldoria.json` — character book/world info example;
- `default/content/presets/openai/Default.json` — ST OpenAI preset;
- ST source files for prompt/world-info semantics.

Future compatibility tests should copy small fixtures into a test directory rather than depending on `.ref/` at runtime.

## Compatibility roadmap

| Milestone | Compatibility work                                                                            |
| --------- | --------------------------------------------------------------------------------------------- |
| M1        | World Info scanner/editor, Prompt Manager, preset import/export, editing/branching, tokenizer |
| 0.2.0 MVP | Regex scripts, card editing/export, multiple personas, ST data import, Windows desktop shell  |
| M2        | Group chats, summary memory, Quick Replies subset, TTS, image generation, CharX               |
| M3        | Full STscript, Quick Replies, getContext/event bus, extension sandbox, compatibility matrix   |
| M4        | Desktop signing, auto-updater, file associations, macOS/Linux packaging; no new ST semantics  |
| M5        | Compatibility polish, i18n, release hardening                                                 |

## Contributing compatibility fixes

1. Compare against the reference implementation in `.ref/SillyTavern`.
2. Add a fixture-based test for the behaviour.
3. Preserve unknown fields and exact field names.
4. Update this page, [DATA-FORMATS.md](DATA-FORMATS.md) and `CHANGELOG.md`.
5. If code is adapted, update `NOTICE` and [REUSE.md](REUSE.md) under the AGPL/GPL terms.
