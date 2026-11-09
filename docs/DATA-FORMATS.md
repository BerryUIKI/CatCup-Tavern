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

Position constants used by SillyTavern: `0` before character, `1` after character, `2` author's note top, `3` author's note bottom, `4` at depth.

**Status:** the schema is implemented in `packages/shared/src/schemas/worldinfo.ts`, but the scanner, editor and import/export flow arrive in M1. Until then, files in `data/worlds/` are not used by generation.

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
