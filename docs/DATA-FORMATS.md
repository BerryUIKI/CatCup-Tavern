# Data formats

CatCup Tavern stores everything as files under `data/`. The goal is to stay close enough to SillyTavern that a user can migrate cards and chats without a conversion tool. This page documents the formats the app reads and writes, and the parts that are still planned.

> Compatibility status is summarized in [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md). If you change a schema, update this page and the shared Zod schemas together.

## Directory layout

```text
data/
├── characters/
│   ├── Seraphina.png
│   └── Custom.json
├── chats/
│   └── Seraphina/
│       └── Seraphina - 2026-11-09_18-42-29.jsonl
├── worlds/                    # World Info JSON (reserved; scanner planned for M1)
├── presets/                   # ST OpenAI presets (reserved; import planned for M1)
├── settings.json
├── secrets.json               # server-only; never returned by the API
└── auth.json                  # server-only
```

The root is `./data` by default and can be changed with `CATCUP_DATA_DIR`. `data/` is gitignored.

### Identity rules

| Object    | ID                                 | Notes                                                                                         |
| --------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Character | File name without `.png` / `.json` | `Seraphina.png` → `Seraphina`; URL-encode in API paths                                        |
| Avatar    | `/api/characters/<id>/avatar`      | PNG cards only; cache-busted by `?v=<mtime>`                                                  |
| Chat      | JSONL file name without `.jsonl`   | The chat folder is the sanitized character name, with the character ID accepted as a fallback |
| Message   | Zero-based array index             | The JSONL header is not a message                                                             |

## Character cards

### PNG cards

Character metadata is stored in PNG `tEXt` chunks:

| Chunk key | Content                               |
| --------- | ------------------------------------- |
| `chara`   | Base64-encoded Character Card V2 JSON |
| `ccv3`    | Base64-encoded Character Card V3 JSON |

`ccv3` takes precedence over `chara`, matching SillyTavern. A PNG without either chunk is rejected during import.

The avatar is the PNG itself. Card import is read-only today; writing edited metadata back into a PNG is planned for M2.

### JSON cards

Accepted forms:

1. V2 wrapper:

```json
{
    "spec": "chara_card_v2",
    "spec_version": "2.0",
    "data": {
        "name": "Seraphina",
        "description": "A guardian of the forest.",
        "first_mes": "Welcome, traveler."
    }
}
```

2. V3 wrapper (same shape, `spec: "chara_card_v3"`).
3. A wrapper with a `data` object but no `spec` marker.
4. A legacy flat card with fields such as `name`, `description` and `first_mes` at the root.

### Normalized card fields

The server normalizes every card into the V3 data shape. Unknown fields are preserved via passthrough parsing. The fields the app understands:

| Field                                          | Type       | Notes                                            |
| ---------------------------------------------- | ---------- | ------------------------------------------------ |
| `name`                                         | string     | Display name; defaults to `Unnamed` if absent    |
| `nickname`                                     | string?    | Optional display nickname                        |
| `description`                                  | string     | Character sheet                                  |
| `personality`                                  | string     | Character sheet                                  |
| `scenario`                                     | string     | Character sheet                                  |
| `first_mes`                                    | string     | First greeting; used when creating a chat        |
| `mes_example`                                  | string     | Example dialogue                                 |
| `creator_notes`                                | string     | Metadata                                         |
| `creator_notes_multilingual`                   | record?    | Metadata                                         |
| `system_prompt`                                | string     | Overrides the default main prompt when non-empty |
| `post_history_instructions`                    | string     | Appended after history                           |
| `alternate_greetings`                          | string[]   | Used by `greetingIndex > 0`                      |
| `group_only_greetings`                         | string[]   | Parsed; group chats are planned                  |
| `character_book`                               | object?    | Embedded lorebook; scanner planned               |
| `tags`                                         | string[]   | Sidebar search/display                           |
| `creator`                                      | string     | Sidebar display                                  |
| `character_version`                            | string     | Metadata                                         |
| `extensions`                                   | record     | Free-form; preserved                             |
| `assets`                                       | unknown[]? | V3 assets; preserved                             |
| `source`, `creation_date`, `modification_date` | optional   | Preserved                                        |

Character book entries use V2 character-book fields such as `keys`, `secondary_keys`, `content`, `enabled`, `insertion_order`, `case_sensitive`, `selective`, `constant`, `position` and `extensions`. See `packages/shared/src/schemas/character.ts`.

### Import limits

- `.png` and `.json` only; `.charx` is not supported yet.
- 20 MB per file, 50 files per request.
- The saved file name is the sanitized card name. Name collisions get ` (2)`, ` (3)`, and so on.

### Writing cards back

Editing a card rewrites its file in place. The image bytes are kept; only the metadata changes.

- **PNG.** Both `tEXt` chunks are written, as SillyTavern does: `chara` carries the card body and `ccv3` carries the same payload under the V3 spec. A reader that prefers V3 and one that only knows V2 therefore see the same character. Existing `chara`/`ccv3` chunks are replaced rather than duplicated, and every other chunk — `IHDR`, `IDAT`, and anything a tool added — is re-emitted byte for byte. The chunk CRCs are recomputed, so `png-chunks-extract` (and any other reader) validates the result.
- **JSON.** The body is written back pretty-printed.
- **Legacy flat cards** are promoted to a V2 wrapper on the way out: they have no `spec`, so they cannot be written back losslessly as-is. Everything else in the object is kept.
- **The file name never changes.** It is the character id that chats, avatars and world info already point at; renaming a character changes only the card's `name`. Re-import the card if you want the file renamed.

Export uses the same body builder, so an exported card re-imports with every field — including `extensions` and the character book — intact.

## Chat JSONL

Chats use SillyTavern's JSON Lines format. The file begins with a header object, followed by one message object per line.

### Header

```json
{ "chat_metadata": {}, "user_name": "unused", "character_name": "unused" }
```

SillyTavern uses `"unused"` for these fields; CatCup keeps the same convention. Unknown `chat_metadata` fields are preserved.

CatCup writes one field of its own into `chat_metadata`: `persona_id`, the persona a chat is pinned to. Keeping it in the header rather than a side file means the choice travels with the chat when the JSONL is copied or exported, and SillyTavern ignores the field it does not know.

### Message

```json
{
    "name": "Seraphina",
    "is_user": false,
    "send_date": "2026-11-09T10:42:29.884Z",
    "mes": "Welcome, traveler.",
    "extra": {}
}
```

| Field       | Type     | Notes                                                                                 |
| ----------- | -------- | ------------------------------------------------------------------------------------- |
| `name`      | string   | Display name of the speaker                                                           |
| `is_user`   | boolean  | User message when true                                                                |
| `is_system` | boolean? | System/note messages; skipped by the current prompt builder                           |
| `send_date` | string?  | ISO 8601 from CatCup; ST writes humanized strings; both are treated as opaque strings |
| `mes`       | string   | Message text                                                                          |
| `extra`     | object?  | Metadata; unknown keys preserved                                                      |

### `extra` fields written by CatCup

| Field          | Type       | Meaning                                                                            |
| -------------- | ---------- | ---------------------------------------------------------------------------------- |
| `api`          | string     | Provider kind used for generation (`openai`, `anthropic`, `ollama`, `custom`, ...) |
| `model`        | string     | Model ID                                                                           |
| `reasoning`    | string     | Reasoning/thinking text returned by the provider                                   |
| `gen_started`  | ISO string | Generation start time                                                              |
| `gen_finished` | ISO string | Generation finish time                                                             |
| `stopped`      | boolean    | Partial reply saved after stop/disconnect                                          |
| `swipes`       | string[]   | Alternative assistant replies                                                      |
| `swipe_id`     | number     | Zero-based selected swipe index                                                    |
| `swipe_info`   | unknown[]  | Per-swipe metadata objects                                                         |

### Swipes

A regenerated assistant message keeps all variants:

```json
{
    "name": "Seraphina",
    "is_user": false,
    "mes": "The newest variant.",
    "extra": {
        "swipes": ["The first variant.", "The newest variant."],
        "swipe_id": 1,
        "swipe_info": [
            { "send_date": "...", "extra": { "model": "..." } },
            { "send_date": "...", "extra": { "model": "..." } }
        ]
    }
}
```

`PATCH /api/chats/:characterId/:chatId/messages/:index` with `{ "swipeId": n }` selects a variant without regenerating.

### File naming and folder rules

- Folder: sanitized character **name** (e.g. `chats/Seraphina/`), with the sanitized character **id** accepted as a read fallback.
- Default chat title: `<character name> - YYYY-MM-DD_HH-mm-ss`.
- File extension: `.jsonl`.
- Writes are atomic (whole-file rewrite) and serialized per chat file.
- Deleting a message rewrites the file; indexes shift after deletion.

### Preservation rules

- Unknown message and `extra` fields survive read/write.
- The header is always rewritten in the ST shape even if the input lacked one (a synthesized header is used).
- Malformed JSONL lines are skipped and logged; the rest of the chat remains readable.
- Back up chats before bulk manual edits.

## World Info

World info files live in `data/worlds/` as JSON objects with an `entries` map keyed by uid:

```json
{
    "entries": {
        "0": {
            "uid": 0,
            "key": ["eldoria", "forest"],
            "keysecondary": [],
            "comment": "Eldoria",
            "content": "Eldoria is the forest around the glade.",
            "constant": false,
            "selective": true,
            "selectiveLogic": 0,
            "order": 100,
            "position": 0,
            "disable": false,
            "group": "",
            "groupWeight": 100,
            "sticky": 0,
            "cooldown": 0,
            "delay": 0,
            "probability": 100,
            "depth": 4,
            "useProbability": true,
            "role": null,
            "vectorized": false,
            "excludeRecursion": false,
            "preventRecursion": false,
            "delayUntilRecursion": false,
            "scanDepth": null,
            "caseSensitive": null,
            "matchWholeWords": null,
            "useGroupScoring": null,
            "automationId": ""
        }
    }
}
```

Position constants used by SillyTavern: `0` before character, `1` after character, `2` author's note top, `3` author's note bottom, `4` at depth, `5` example messages top, `6` example messages bottom, `7` outlet. The numbering is persisted in files and must not be renumbered.

Secondary-key logic (`selectiveLogic`): `0` AND ANY, `1` NOT ALL, `2` NOT ANY, `3` AND ALL.

### Loading rules

`apps/server/src/worldinfo/loader.ts` reads a book from either shape:

- the wrapped `{ "entries": { "0": {...} } }` form shown above;
- a bare `uid -> entry` map, which older exports produce.

For each entry:

- `uid` comes from the entry, or from the record key when the entry has none. It is the identity used by `id = <book>.<uid>`.
- Unknown fields survive on the entry object; the raw file is kept separately so an export can round-trip what the schema does not model.
- `null` is accepted wherever SillyTavern writes it: `sticky`, `cooldown`, `delay`, `group`, `groupWeight`, `triggers` and the key lists. It means "unset" and falls back to the SillyTavern default, so an entry saved by the ST editor is never dropped.
- Leading `@@` decorator lines are split off `content` into `decorators`. Only `@@activate` and `@@dont_activate` are recognised; a line that does not start with `@@` ends the decorator block.
- `hash` is computed over the raw entry as SillyTavern does, so timed-effect records in an imported chat still match.
- Records that do not validate as entries are skipped rather than failing the whole book.

### Scan status

`apps/server/src/worldinfo/scanner.ts` now covers SillyTavern's full evaluation pipeline:

- activation: constant, `@@activate` / `@@dont_activate`, primary and secondary keys with all four `selectiveLogic` modes, `scanDepth`, `caseSensitive`, `matchWholeWords`, `/regex/flags` keys, generation-type `triggers`, and character name/tag filters;
- recursion: the `NONE` / `INITIAL` / `RECURSION` / `MIN_ACTIVATIONS` state machine, `recursive`, `maxRecursionSteps`, `minActivations` with its depth skew, `excludeRecursion`, `preventRecursion` and `delayUntilRecursion` levels;
- inclusion groups: `group`, `groupOverride`, `groupWeight`, `useGroupScoring`;
- timed effects: `sticky`, `cooldown` and the stateless `delay`;
- budgeting: the cumulative token budget with `ignoreBudget` and the one-way overflow latch;
- output buckets: before/after character, author's note top/bottom, at-depth, example messages, and outlets.

Every entry produces one trace line per scan explaining the outcome and the pass it happened in.

### Editing rules

`apps/server/src/worldinfo/entries.ts` holds the write path. It follows the SillyTavern editor:

- **Identity.** uids are resolved exactly as the loader resolves them, so a patch always targets the entry the scanner read. New entries take the lowest free uid rather than a new maximum, so a deleted uid is reused — `nextFreeUid` scans for the first gap up to 1,000,000.
- **Creation.** A new entry is `{ uid, ...newWorldInfoEntryTemplate }`: `key: []`, `order: 100`, `position: 0`, `depth: 4`, `probability: 100`, `selective: true`, `groupWeight: 100`, `role: 0`, `delayUntilRecursion: 0`, and `null` for `scanDepth`, `caseSensitive`, `matchWholeWords`, `useGroupScoring`, `sticky`, `cooldown` and `delay`. No `displayIndex` is written; SillyTavern leaves it out too and falls back to the uid when sorting.
- **Patching.** A patch is merged into the entry as stored, never substituted for it. `extensions`, `vectorized`, unknown keys and anything the editor does not expose survive a save. Key lists are trimmed and empty keys dropped. `uid`, `displayIndex` and `vectorized` are not patchable: the first two belong to the server, the third to SillyTavern's vectorization extension.
- **Deleting.** Only the entry record is removed. SillyTavern does not renumber `displayIndex` on delete and neither do we, so gaps stay until the list is reordered.
- **Duplicating.** The clone keeps the source's `displayIndex`, as SillyTavern's does, so it sorts next to the original and the tie is broken by `order` descending and then uid.
- **Ordering.** The editor lists entries by `displayIndex`, falling back to uid, then `order` descending and uid ascending. Reordering assigns contiguous `displayIndex` values in the order given. SillyTavern's editor defaults to a Priority sort instead and only offers dragging in Custom sort; this editor always uses the Custom order because it exposes explicit reorder buttons.

An explicit `null` and a missing field are not always the same thing. SillyTavern's entry template supplies `selective: true` when the field is absent, and its editor pushes `order: null` through `Number()`, which makes it `0`; only a missing `order` falls back to `100`. Both distinctions are kept.

### Timed effects in the chat header

`sticky` and `cooldown` are persisted per chat in the JSONL header, inside `chat_metadata`, using SillyTavern's exact shape:

```json
{
    "chat_metadata": {
        "timedWorldInfo": {
            "sticky": { "eldoria.12": { "hash": 3374029573716508, "start": 42, "end": 45, "protected": false } },
            "cooldown": { "eldoria.12": { "hash": 3374029573716508, "start": 45, "end": 50, "protected": true } }
        }
    }
}
```

- The record key is `<book>.<uid>`; `book` is the file name without `.json`.
- `start` and `end` are absolute counts of non-system chat messages, not message ids or timestamps. An effect applies while `start < length < end`.
- `hash` is SillyTavern's `getStringHash` over the raw entry with decorators stripped. It changes whenever the entry changes, which is how an edited entry stops matching its old record.
- `protected` is set only on the cooldown spawned when a sticky effect expires, so the hand-off survives a regenerate.
- `delay` is never persisted: it is recomputed from the entry on every scan as "the chat has fewer than N messages".

Because the clock is the non-system message count, a scan must receive the full conversation. Passing a context-trimmed history would expire effects early.

## Presets

ST OpenAI presets live in `data/presets/` (or a SillyTavern `openai-presets/` folder) as JSON. The fields the shared schema understands include:

- sampling: `temperature`, `frequency_penalty`, `presence_penalty`, `top_p`, `top_k`, `openai_max_context`, `openai_max_tokens`, `stream_openai`;
- model: `openai_model`;
- assembly strings: `wi_format`, `scenario_format`, `personality_format`, `new_chat_prompt`, `new_example_chat_prompt`, `continue_nudge_prompt`, `impersonation_prompt`, `send_if_empty`, `squash_system_messages`, `names_behavior`, `continue_prefill`, `pin_examples`;
- prompt entries: `prompts[]` with `identifier`, `name`, `system_prompt`, `role`, `content`, `marker`, `injection_position`, `injection_depth`, `injection_order`, `injection_trigger`, `forbid_overrides`, `extension`, `position`;
- ordering: `prompt_order[]` with `character_id` and `order[]` (`identifier`, `enabled`).

Three details are load-bearing for a lossless round trip:

- `system_prompt` is `true` on SillyTavern's built-ins and markers, `false` on user prompts, and **absent** on merged literals. The schema keeps it optional rather than defaulting it, because the three cases behave differently.
- `enabled` belongs to the order entry, not the prompt definition. A missing `enabled` means disabled; a prompt-level `enabled` is ignored.
- `injection_position` is `0` for the prompt order and `1` for in-chat injection at `injection_depth`.

### Default order

SillyTavern's default order, used when a preset does not provide one:

```text
main, worldInfoBefore, personaDescription, charDescription, charPersonality,
scenario, enhanceDefinitions (disabled), nsfw, worldInfoAfter,
dialogueExamples, chatHistory, jailbreak
```

### Assembly status

`apps/server/src/prompt/` implements the Prompt Manager model and execution: sanitizing the order, resolving markers, merging the fixed system prompts, applying character-card overrides for `main` and `jailbreak`, placing prompts in their order slots, inserting in-chat depth injections, and trimming history against the token budget.

Presets are imported, exported and activated through the API. While a preset is active it supplies the prompt list, the order, `wi_format`/`personality_format`/`scenario_format`, the chat and example separators, the continue nudge, `squash_system_messages` and the sampling parameters. Fields the preset omits fall back to the app's generation settings, and with no preset active the built-in SillyTavern defaults are used.

The preset body is stored exactly as sent, so unknown SillyTavern fields survive an export/import round trip.

## Regex scripts

Stored in `data/regex.json` as one ordered array:

```json
{
    "scripts": [
        {
            "id": "0d1f...",
            "scriptName": "Strip OOC",
            "findRegex": "/\\(OOC:.*?\\)/gs",
            "replaceString": "",
            "trimStrings": [],
            "placement": [2],
            "disabled": false,
            "markdownOnly": false,
            "promptOnly": false,
            "runOnEdit": false,
            "substituteRegex": 0,
            "minDepth": null,
            "maxDepth": null
        }
    ]
}
```

The field names are SillyTavern's `RegexScriptData` verbatim, and unknown fields are preserved on read. In SillyTavern these live in `extension_settings.regex`; here they are their own file because a script list has an order that matters and a settings blob does not preserve it as clearly.

Placements: `1` user input, `2` AI output, `3` slash commands, `5` world info, `6` reasoning. `0` is a retired markdown-display slot and `4` a retired `sendAs` slot; both are accepted so old files round-trip.

The three-way gate is SillyTavern's:

- `markdownOnly` scripts run only when the chat view renders a message;
- `promptOnly` scripts run only when a prompt is assembled;
- scripts with neither run at the source — when a message, greeting or reasoning text is stored — because the stored text is what the prompt and the view both read afterwards.

One consequence catches people out: world info is assembled with the prompt flag set, so a `WORLD_INFO` script must also set `promptOnly`, exactly as in SillyTavern. A plain script with only the world-info placement never runs.

## Internal files (not SillyTavern formats)

### `settings.json`

```json
{
    "version": 1,
    "activeProviderId": "provider-uuid",
    "providers": [
        {
            "id": "provider-uuid",
            "kind": "openai",
            "name": "OpenAI",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-5",
            "enabled": true,
            "headers": {}
        }
    ],
    "generation": { "temperature": 1, "topP": 1, "maxTokens": 2048, "contextSize": 32768, "stream": true },
    "personas": [{ "id": "default", "name": "You", "description": "" }],
    "activePersonaId": "default",
    "ui": { "language": "en", "theme": "tavern-dark" }
}
```

No API keys are stored here.

### `secrets.json`

A map of provider ID to API key. It is read only by the server, written with mode `0600` on POSIX, and never included in an API response. Do not copy it into bug reports.

### `auth.json`

Contains the password hash, a session-signing secret and a creation timestamp. The hash format is `scrypt$N$r$p$salt$hash` with the parameters in the string. Stop the server, delete this file and restart to force a new first-run setup; this also invalidates all sessions.

## Migrating from SillyTavern

**Import from SillyTavern**, in the character library, copies an installation in one step. Point it at the ST user folder — the one containing `characters/`, `chats/` and `worlds/`. A scan runs first and shows what was found; nothing is written until you confirm.

- **Imported:** character cards, chats, world info books and OpenAI presets.
- **Matched by name:** a chat folder is attached to the character whose card name or id matches it. A chat whose character is not in the same import is reported and skipped rather than attached to the wrong person.
- **Not imported:** group chats, backgrounds, themes, and SillyTavern's own `settings.json` — that file holds its personas, regex scripts and UI settings in shapes this app does not use yet.
- **Repeat imports add copies.** Names get numeric suffixes; nothing is overwritten. To start clean, back up `data/` and remove the folders you want replaced first.

Copying by hand works too: with the server stopped, copy `characters/`, `chats/`, `worlds/` and `presets/` into `data/`. The naming rules are the same, and unknown fields are preserved either way.

## Backup, restore and upgrades

- Back up the whole `data/` directory, including `settings.json`, `secrets.json` and `auth.json`.
- `secrets.json` contains credentials; protect the backup like a password store.
- Stop the server before copying to avoid reading a chat mid-write.
- There are no automatic data migrations yet. Back up before upgrading; unknown fields are preserved on read/write, but schema changes may still require manual adjustment.
