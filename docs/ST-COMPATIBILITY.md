# SillyTavern compatibility

CatCup Tavern aims to be a compatible **client**, not a byte-for-byte reimplementation of SillyTavern. Compatibility is delivered in layers. This page records what works today, what is partial, and what is planned.

> Status snapshot: **M0 complete** (2026-11-09). M1 is the core compatibility milestone. See [MILESTONES.md](MILESTONES.md).

## Compatibility layers

| Layer                | Scope                                                     | Status                                                                               |
| -------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **L1 data**          | Character cards, chats, world info, presets               | Partial: cards and chats work; world info loads and scans; presets have schemas only |
| **L2 semantics**     | Prompt semantics, macros, STscript, Quick Replies, regex  | Partial: basic prompt/macros/swipes; STscript and extensions not yet                 |
| **L3 extension API** | `SillyTavern.getContext()`, event bus, extension settings | Planned for M3                                                                       |
| **L4 UI extensions** | Extensions that manipulate ST's DOM/jQuery                | Planned for M3, highest risk; not promised for v1                                    |

## Data compatibility matrix

| Feature                            | Status             | Notes                                                                |
| ---------------------------------- | ------------------ | -------------------------------------------------------------------- |
| Character Card V2 PNG (`chara`)    | ✅ Read            | `ccv3` wins when both exist                                          |
| Character Card V3 PNG (`ccv3`)     | ✅ Read            | Assets are preserved but not processed                               |
| Character JSON V2/V3 wrapper       | ✅ Read            | Unknown fields preserved                                             |
| Legacy flat character JSON         | ✅ Read            | Normalized into the V3 data shape                                    |
| Character card write/export        | ❌ Planned         | M2                                                                   |
| CharX (`.charx`) import/export     | ❌ Planned         | M2                                                                   |
| Character book (embedded lorebook) | 🟡 Parsed          | Scanner and UI planned for M1                                        |
| Character editing                  | ❌ Planned         | M2                                                                   |
| Chat JSONL (ST header + messages)  | ✅ Read/write      | Header `user_name` / `character_name` use `"unused"`                 |
| Chat swipes                        | ✅ Yes             | Regenerate creates a swipe; selecting a swipe is supported           |
| Chat branches/checkpoints          | ❌ Planned         | M1                                                                   |
| Group chats                        | ❌ Planned         | M2                                                                   |
| World Info JSON schema             | ✅ Schema          | Field names and defaults match ST                                    |
| World Info loader                  | ✅ Read            | Wrapped `{ entries }` and bare uid maps; decorators split            |
| World Info scanner (core)          | ✅ Implemented     | Keys, depth, logic, probability, budget; not wired to generation yet |
| World Info recursion/groups/timing | ❌ Planned         | Next M1 slice                                                        |
| ST OpenAI preset schema            | ✅ Schema          | Import/export planned for M1                                         |
| Themes                             | ❌ Not implemented | Dark tavern theme only                                               |
| Personas                           | 🟡 Single persona  | Name + description; multiple personas planned later                  |
| Multi-user directories             | ❌ Not supported   | Single-user `data/`                                                  |

## Semantic compatibility

| Feature                                                            | Status             | Notes                                                                                           |
| ------------------------------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------- |
| Character sheet prompt (description/personality/scenario/examples) | ✅ Basic           | Server-side prompt builder                                                                      |
| Character `system_prompt` override                                 | ✅ Yes             | Used when non-empty                                                                             |
| Post-history instructions                                          | ✅ Yes             | Appended after history                                                                          |
| Core macros (`{{char}}`, `{{user}}`, ...)                          | 🟡 Partial         | `char`, `user`, `persona`, `description`, `personality`, `scenario`, `time`, `date`, `original` |
| Full ST macro engine                                               | ❌ Planned         | M3                                                                                              |
| Prompt Manager ordering/injection                                  | ❌ Planned         | M1                                                                                              |
| Author's note                                                      | ❌ Planned         | M1                                                                                              |
| World Info scanning (core)                                         | 🟡 Scanner only    | Keys, logic, depth, probability, budget; not injected into prompts yet                          |
| World Info recursion/groups/injection                              | ❌ Planned         | M1                                                                                              |
| Context budget                                                     | 🟡 Approximate     | Character-based estimate; real tokenizer planned for M1                                         |
| Message editing                                                    | 🟡 API only        | PATCH exists; inline UI planned for M1                                                          |
| Regenerate/swipe                                                   | ✅ Yes             | Swipe selection via API and UI                                                                  |
| Continue generation                                                | 🟡 API only        | Server action exists; UI control planned for M1                                                 |
| Branch from message                                                | ❌ Planned         | M1                                                                                              |
| Alternate greetings                                                | 🟡 API only        | `greetingIndex` on chat creation; UI selection planned                                          |
| Chat rename/delete in UI                                           | 🟡 Partial         | Delete API + new chat UI; rename/delete controls planned                                        |
| Group chat                                                         | ❌ Planned         | M2                                                                                              |
| Summary memory                                                     | ❌ Planned         | M2                                                                                              |
| Regex scripts                                                      | ❌ Planned         | M2                                                                                              |
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

World info files load from `data/worlds/` and the M1 scanner can evaluate them, but the result is not injected into generation yet, so copying a book in does not change replies. Presets are not wired in at all. M1 adds the prompt-manager integration, the editor and import/export.

## Known deviations

- **`send_date` format:** CatCup writes ISO 8601 strings; ST writes humanized strings. Both are treated as opaque strings by the readers.
- **Card file naming:** CatCup names the saved file after the card's display name; ST often keeps the uploaded file name. IDs therefore follow the display name.
- **Chat folder naming:** Character name first, character ID fallback. This differs slightly from ST's single-folder rule but makes imported folders more tolerant.
- **Prompt construction:** The M0 builder is intentionally small and does not reproduce ST's full Prompt Manager; replies may differ until M1.
- **Anthropic start marker:** If a prompt starts with an assistant message, CatCup inserts a `[Start of chat]` user message for the Messages API.
- **Unknown macros:** Unrecognized `{{macros}}` are left untouched rather than expanded.
- **World info injection:** the scanner exists, but nothing consumes its result yet, so lorebook keys do not affect replies.
- **Presets:** schemas exist, but the runtime does not use them yet.
- **Extension compatibility:** None yet. L4 is explicitly a long-term, bounded goal.

## Testing compatibility

The local `.ref/SillyTavern` checkout (gitignored) is the reference for fixtures:

- `default/content/default_Seraphina.png` — V3 card with a character book;
- `default/content/Eldoria.json` — character book/world info example;
- `default/content/presets/openai/Default.json` — ST OpenAI preset;
- ST source files for prompt/world-info semantics.

Future compatibility tests should copy small fixtures into a test directory rather than depending on `.ref/` at runtime.

## Compatibility roadmap

| Milestone | Compatibility work                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------------------- |
| M1        | World Info scanner/editor, Prompt Manager, preset import/export, editing/branching, tokenizer               |
| M2        | Group chats, summary memory, regex, Quick Replies subset, TTS, image generation, card editing/export, CharX |
| M3        | Full STscript, Quick Replies, getContext/event bus, extension sandbox, compatibility matrix                 |
| M4        | Desktop packaging; no new ST semantics                                                                      |
| M5        | Compatibility polish, i18n, release hardening                                                               |

## Contributing compatibility fixes

1. Compare against the reference implementation in `.ref/SillyTavern`.
2. Add a fixture-based test for the behaviour.
3. Preserve unknown fields and exact field names.
4. Update this page, [DATA-FORMATS.md](DATA-FORMATS.md) and `CHANGELOG.md`.
5. If code is adapted, update `NOTICE` and [REUSE.md](REUSE.md) under the AGPL/GPL terms.
