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

## Chat JSONL

Chats use SillyTavern's JSON Lines format. The file begins with a header object, followed by one message object per line.

### Header

```json
{ "chat_metadata": {}, "user_name": "unused", "character_name": "unused" }
```

SillyTavern uses `"unused"` for these fields; CatCup keeps the same convention. Unknown `chat_metadata` fields are preserved.

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

**Not wired into generation yet.** `apps/server/src/prompt/builder.ts` still assembles prompts with the M0 pipeline, so files in `data/worlds/` do not change replies. The Prompt Manager slice consumes the scan result; the editor and import/export follow it.

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
- prompt entries: `prompts[]` with `identifier`, `name`, `system_prompt`, `role`, `content`, `injection_position`, `injection_depth`, `injection_order`, `forbid_overrides`, `marker`, `enabled`;
- ordering: `prompt_order[]` with `character_id` and `order[]` (`identifier`, `enabled`).

**Status:** the schema exists, but preset import/export and Prompt Manager execution arrive in M1. The current prompt builder uses the character's `system_prompt`, a character sheet, persona, history trimming and `post_history_instructions`.

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
    "persona": { "name": "You", "description": "" },
    "ui": { "language": "en", "theme": "tavern-dark" }
}
```

No API keys are stored here.

### `secrets.json`

A map of provider ID to API key. It is read only by the server, written with mode `0600` on POSIX, and never included in an API response. Do not copy it into bug reports.

### `auth.json`

Contains the password hash, a session-signing secret and a creation timestamp. The hash format is `scrypt$N$r$p$salt$hash` with the parameters in the string. Stop the server, delete this file and restart to force a new first-run setup; this also invalidates all sessions.

## Migrating from SillyTavern

1. Stop CatCup Tavern.
2. Copy ST's `characters/`, `chats/` and (once M1 lands) `worlds/` folders into `data/`. If ST uses a per-user directory such as `data/default-user/characters/`, copy the inner folders.
3. Start CatCup Tavern and verify cards and chats in the UI.
4. Presets are not imported yet (M1).
5. `.charx` and PNG card export are not supported yet.

Chat folders are matched by character name first and character ID second, so most ST chat folders work without renaming. Unknown fields in cards, chats and headers are preserved.

## Backup, restore and upgrades

- Back up the whole `data/` directory, including `settings.json`, `secrets.json` and `auth.json`.
- `secrets.json` contains credentials; protect the backup like a password store.
- Stop the server before copying to avoid reading a chat mid-write.
- There are no automatic data migrations yet. Back up before upgrading; unknown fields are preserved on read/write, but schema changes may still require manual adjustment.
