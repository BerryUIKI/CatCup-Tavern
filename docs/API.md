# HTTP API

The server exposes a same-origin REST API under `/api` plus two SSE endpoints for generation, `POST /api/generate` and `POST /api/groups/:groupId/chats/:chatId/generate`. In development Vite proxies `/api` to `http://127.0.0.1:8000`; in production Fastify serves the SPA and API from the same port.

- All request and response bodies are JSON unless noted.
- Authentication is a session cookie (`catcup_session`) set by `POST /api/auth/login`.
- All endpoints except the public list below require that cookie. A desktop install with no password runs in an open session and answers without one; see `GET /api/auth/status`.
- IDs (`characterId`, `chatId`) are URL-encoded path segments. Character IDs are file names without the extension; chat IDs are JSONL file names without `.jsonl`.

Public endpoints:

- `GET /api/health`
- `GET /api/auth/status`
- `POST /api/auth/setup`
- `POST /api/auth/login`
- `POST /api/auth/logout`

Mutating API requests (`POST`, `PATCH`, `DELETE`, `PUT`) are rejected with `403` when an `Origin` header is present and does not match the request `Host`. Non-browser clients that omit `Origin` are allowed.

## Errors

Error responses use:

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE" }
```

Common codes:

| Code                    | HTTP      | Meaning                                                    |
| ----------------------- | --------- | ---------------------------------------------------------- |
| `VALIDATION`            | 400       | Zod validation failed                                      |
| `BAD_REQUEST`           | 400       | Invalid input or state                                     |
| `UNAUTHORIZED`          | 401       | Missing or expired session                                 |
| `INVALID_PASSWORD`      | 401       | Wrong login password                                       |
| `NEEDS_SETUP`           | 401 / 409 | No password has been configured yet                        |
| `FORBIDDEN`             | 403       | Origin mismatch or remote first-run setup                  |
| `NOT_FOUND`             | 404       | Character, chat, message, provider or avatar not found     |
| `CONFLICT`              | 409       | A quick reply set name is already taken                    |
| `ALREADY_INITIALIZED`   | 409       | Setup attempted after a password exists                    |
| `TTS_DISABLED`          | 400       | Text to speech is switched off                             |
| `TTS_KEY_MISSING`       | 400       | The OpenAI TTS endpoint has no key                         |
| `TTS_CONFIG`            | 400       | TTS base URL or model is missing                           |
| `TTS_SYSTEM_BACKEND`    | 400       | The browser TTS backend cannot be called on the server     |
| `TTS_FAILED`            | 502       | The speech provider request failed                         |
| `IMAGE_DISABLED`        | 400       | Image generation is switched off                           |
| `IMAGE_KEY_MISSING`     | 400       | The OpenAI image endpoint has no key                       |
| `IMAGE_CONFIG`          | 400       | Image base URL, model or ComfyUI workflow is invalid       |
| `IMAGE_PROMPT_EMPTY`    | 400       | There are no messages to draft a prompt from               |
| `IMAGE_PATH`            | 400       | Invalid gallery folder or file name                        |
| `IMAGE_SCOPE`           | 400       | Neither a character nor a group was provided               |
| `IMAGE_FAILED`          | 502       | The image provider request failed                          |
| `IMAGE_PROMPT_FAILED`   | 400 / 502 | The chat model could not draft an image prompt             |
| `CHARACTER_READ_FAILED` | 500       | A card write succeeded but the card could not be read back |
| `SUMMARY_FAILED`        | 502       | The summary request failed or returned no text             |
| `PAYLOAD_TOO_LARGE`     | 413       | Upload or request body too large                           |
| `PROVIDER_DISABLED`     | 400       | The active provider reference is disabled                  |
| `PROVIDER_KEY_REUSE`    | 400       | A draft test changed the endpoint without a key            |
| `INVALID_BASE_URL`      | 400       | A provider base URL is not http or https                   |
| `PROVIDER_ERROR`        | 502       | Upstream provider request failed                           |
| —                       | 500       | Unhandled server error                                     |

## Auth

### `GET /api/auth/status`

```json
{ "needsSetup": false, "authenticated": true, "openSession": false }
```

`openSession` is true only in a desktop install with no password: the API answers without a session and `needsSetup` stays false so the SPA opens directly.

### `POST /api/auth/setup`

First-run only. The request must originate from loopback unless `CATCUP_ALLOW_REMOTE_SETUP=true`. Never needed in desktop mode, where an install with no password is already open.

```json
{ "password": "at-least-8-characters" }
```

Response: `{ "ok": true }` and a session cookie. The server stores a scrypt hash; the password is never written in plaintext.

### `POST /api/auth/login`

```json
{ "password": "..." }
```

Response: `{ "ok": true }` and a session cookie. Rate limit: 10 attempts per minute per client.

### `POST /api/auth/logout`

Clears the cookie. Response: `{ "ok": true }`.

### `PUT /api/auth/password`

Desktop mode only; web and LAN answer `403 FORBIDDEN`. Sets or replaces the password, or removes it to return the app to open mode. Changing or removing an existing password requires `currentPassword`.

```json
{ "password": "at-least-8-characters", "currentPassword": "only-when-one-exists" }
```

```json
{ "password": "" }
```

Response: `{ "ok": true, "openSession": false }` (or `true` after removal). Rate limit: 10 attempts per minute per client.

## Health

### `GET /api/health`

```json
{ "ok": true, "version": "0.3.0", "needsSetup": false }
```

## Characters

### `GET /api/characters`

```json
{
    "characters": [
        {
            "id": "Seraphina",
            "fileName": "Seraphina.png",
            "format": "png",
            "name": "Seraphina",
            "creator": "example",
            "tags": ["fantasy"],
            "fav": false,
            "spec": "v3",
            "hasCharacterBook": true,
            "createdAt": 1794000000000,
            "updatedAt": 1794220000000,
            "avatarUrl": "/api/characters/Seraphina/avatar?v=1794220000000"
        }
    ]
}
```

`spec` is `v2`, `v3` or `legacy`. `fav` is SillyTavern's `data.extensions.fav` flag. `createdAt` comes from the card's `creation_date` (seconds), a root `create_date`, or the file's birth time, in that order. The server returns the list sorted by display name; the library applies its own sort and filters locally.

### `GET /api/characters/:id`

Returns `{ "character": CharacterDetail }`, where `CharacterDetail` is the summary plus:

- `card`: normalized character card data (V2/V3 field names);
- `rawCard`: the original parsed JSON.

### `GET /api/characters/:id/avatar`

Returns `image/png` for PNG cards. JSON-only cards have no avatar and return `404`. Responses are sent with `Cache-Control: private, max-age=300`; the list URL includes a version query.

### `POST /api/characters/import`

`multipart/form-data` with one or more file parts. Field names are ignored; every file part is processed.

- Accepted: `.png` (character card with `tEXt` metadata), `.json`, and `.charx` (a RisuAI ZIP package).
- Limits: 20 MB per uploaded file, 50 files per request. A `.charx` archive is capped at 200 entries, 25 MB per entry and 60 MB after extraction; only `assets/**` entries are kept.
- A CharX card with a PNG icon is stored as a PNG card; without one it is stored as JSON. Every safe `assets/**` file is written under `data/character-assets/<character id>/`.
- The saved file is named after the character card name, with a numeric suffix on collision.

Response:

```json
{
    "imported": [CharacterSummary],
    "errors": [{ "fileName": "broken.png", "message": "PNG does not contain character metadata" }]
}
```

Partial success is normal: imported cards are saved, failed cards are reported in `errors`.

### `PATCH /api/characters/:id`

Merge edits into the stored card.

```json
{
    "name": "Seraphina the Herbalist",
    "description": "A calm herbalist who guards the glade.",
    "tags": ["fantasy", "healer"],
    "alternate_greetings": ["Hello again, traveler."]
}
```

- Editable: `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`, `creator_notes`, `system_prompt`, `post_history_instructions`, `alternate_greetings`, `tags`, `creator`, `character_version`, `nickname`, `group_only_greetings`.
- Unknown fields are rejected with `400 VALIDATION`. Everything not listed — `extensions`, the character book, V3 assets — is preserved.
- The file keeps its name: the id is what chats, avatars and world info reference. Only the card's own `name` changes.
- A PNG card is re-encoded with both `chara` and `ccv3` chunks rewritten, so a V3 reader and a V2-only reader see the same character.
- A card with no creation date gets `data.creation_date` (Unix seconds) on its first write, so the library's creation sort survives later atomic file writes.

Response: `{ "character": CharacterDetail }`.

### `PATCH /api/characters/:id/favorite`

```json
{ "favorite": true }
```

Sets SillyTavern's `data.extensions.fav` flag. The body is strict: `favorite` must be a boolean and unknown keys are rejected with `400 VALIDATION`. Response: `{ "character": CharacterDetail }`; `404` when the card does not exist, and `500 CHARACTER_READ_FAILED` when the write succeeded but the card could not be parsed back. Setting the flag to its current value does not write the file. CatCup keeps the flag in its own PNG, JSON and CharX exports; SillyTavern clears favorites when it exports or imports a card.

### `POST /api/characters/bulk`

Applies one library action to up to 500 characters.

```json
{ "action": "add-tags", "ids": ["Seraphina", "Mira"], "tags": ["fantasy", "cozy"] }
```

- `action` is `favorite`, `unfavorite`, `add-tags`, `remove-tags` or `delete`.
- `ids` is 1–500 character ids; `.png`/`.json` suffixes and duplicates are normalized away. Ids with slashes or `..` are rejected with `400 VALIDATION`.
- `tags` is required for the tag actions (1–50 tags of 1–200 characters) and rejected otherwise. Tags cannot contain commas; matching is case- and whitespace-insensitive, and existing tag spelling is preserved.
- `favorite` and tag actions support partial success and return updated summaries. `delete` removes the card file and `data/character-assets/<id>/`, keeps chat files on disk, and reports deleted ids.

Response:

```json
{
    "characters": [CharacterSummary],
    "deleted": ["Mira"],
    "errors": [{ "id": "Nobody", "message": "Character not found" }]
}
```

A redundant tag action that would not change a card does not write it.

### `GET /api/characters/:id/export`

`?format=png` (default) downloads the stored image with its metadata intact; `?format=json` downloads the card body, promoting a legacy flat card to a V2 wrapper so the result is a valid card on its own; `?format=charx` downloads a ZIP with a V3 `card.json`, the stored `assets/**` files and — for a PNG card — the image as the icon asset. A package without a PNG icon has no icon entry. Risu `module.risum` bundles are not written.

- `404` when the character does not exist.
- `400` when `format=png` is asked for a JSON-only card, which has no image.

### `DELETE /api/characters/:id`

Deletes the card file. Chats are not deleted automatically. Response: `{ "ok": true }`.

### `POST /api/characters/sample`

Adds the bundled sample character, so a fresh install has someone to talk to. Response: `{ "character": CharacterDetail, "created": boolean }` — running it twice returns the copy that is already there with `created: false` instead of making a second one.

## Chats

Chat IDs are JSONL file names without `.jsonl`. Message indexes are zero-based and do not include the header line.

### `GET /api/characters/:characterId/chats`

```json
{
    "chats": [
        {
            "id": "Seraphina - 2026-11-09_18-42-29",
            "title": "Seraphina - 2026-11-09_18-42-29",
            "updatedAt": 1794220000000,
            "messageCount": 3
        }
    ]
}
```

Sorted newest first.

### `POST /api/characters/:characterId/chats`

```json
{ "name": "Optional chat title", "greetingIndex": 0 }
```

- `name` is optional; the default is `<character name> - <timestamp>`.
- `greetingIndex` is optional. `0` or omitted uses `first_mes`; `1..n` uses `alternate_greetings[n-1]`.

Response: `{ "chat": ChatDetail }`. `ChatDetail` contains `characterId`, `chatId`, `header` and `messages`.

The first message carries every non-empty greeting as a swipe, as SillyTavern does, so the chat opens on `greetingIndex` and can switch later with the normal swipe controls.

### `POST /api/chats/:characterId/:chatId/greeting`

```json
{ "greetingIndex": 2 }
```

Replaces the opening message with another greeting from the card and rewrites its `extra.swipes` from the card, which also upgrades a chat created before greetings were stored as swipes. The rest of the conversation is untouched. Returns 400 when that greeting is empty or missing.

Response: `{ "chat": ChatDetail }`.

### `GET /api/chats/:characterId/:chatId`

Returns `{ "chat": ChatDetail }`.

```json
{
    "chat": {
        "characterId": "Seraphina",
        "chatId": "Seraphina - 2026-11-09_18-42-29",
        "header": {
            "chat_metadata": {},
            "user_name": "unused",
            "character_name": "unused"
        },
        "messages": [
            {
                "name": "Seraphina",
                "is_user": false,
                "send_date": "2026-11-09T10:42:29.884Z",
                "mes": "Welcome, traveler.",
                "extra": {}
            }
        ]
    }
}
```

### `PATCH /api/chats/:characterId/:chatId`

Rename a chat, pin it to a persona, or both.

```json
{ "name": "The forest glade" }
```

```json
{ "personaId": "persona-uuid" }
```

- `name` moves the chat file and returns the chat under its new id. A name that is already in use gets a numeric suffix instead of overwriting the other chat; the returned `chatId` is the one actually used.
- `personaId` stores `persona_id` in the chat's `chat_metadata`, which is what makes the choice travel with the chat file. `null` removes the pin, so the chat follows the account default again.
- Sending neither is a `400`.

Response: `{ "chat": ChatDetail }`.

### `POST /api/chats/:characterId/:chatId/branch`

Copy the conversation up to and including `index` into a new chat.

```json
{ "index": 4, "name": "Optional branch name" }
```

- `index` is zero-based and does not include the header line.
- The header, including `chat_metadata`, is copied as SillyTavern does for bookmarks. Timed world info records that no longer fit are dropped by the scanner's rewind rule on the branch's first scan.
- `name` defaults to `<source chatId> (branch)`.
- Response: `{ "chat": ChatDetail }` for the new chat.

### `GET /api/chats/:characterId/:chatId/context`

Rebuild the prompt for a chat without generating. This is the context inspector's data source.

The world info scan runs against a **deep clone** of `chat_metadata`, so timed effects are evaluated faithfully but never written back.

```json
{
    "context": {
        "messages": [{ "role": "system", "content": "..." }],
        "worldInfo": {
            "books": ["eldoria"],
            "activated": [
                {
                    "id": "eldoria.0",
                    "world": "eldoria",
                    "uid": 0,
                    "comment": "eldoria",
                    "reason": "primary-key",
                    "loop": 1
                }
            ],
            "trace": [
                {
                    "loop": 1,
                    "world": "eldoria",
                    "uid": 0,
                    "comment": "eldoria",
                    "activated": true,
                    "reason": "primary-key",
                    "detail": "eldoria"
                }
            ],
            "before": ["..."],
            "after": [],
            "authorNoteTop": [],
            "authorNoteBottom": [],
            "atDepth": [],
            "examples": [],
            "outlets": {},
            "budget": { "limit": 8192, "used": 214, "overflowed": false },
            "loops": 1
        },
        "memory": {
            "value": "Seraphina met Alex at the old gate.",
            "index": 3,
            "tokens": 14,
            "injection": "[Summary: Seraphina met Alex at the old gate.]",
            "position": 0,
            "role": 0,
            "depth": 2
        },
        "budget": {
            "exceeded": false,
            "tokenCounts": { "main": 24 },
            "total": 3117,
            "counter": "o200k_base",
            "counterSource": "tiktoken"
        }
    }
}
```

`trace` has one line per candidate entry explaining whether it activated and why, which is what makes a missing or unexpected lorebook hit debuggable.

`budget.counter` names the tokenizer used for every count in the response — `o200k_base`, `cl100k_base`, `p50k_base`, `r50k_base`, `claude`, or an `estimate (...)` label. `counterSource` says whether that is a real vocabulary (`tiktoken`, `claude`) or the character-based fallback (`estimate`). Both come from the active provider's kind and model, so switching the provider changes the numbers.

`memory` is the summary in effect for the chat, or `null`. `index` is the message whose `extra.memory` holds it, `tokens` is the token cost of the injected text (`0` when the position is `-1`), and `injection` is the text after the template and macros are expanded. `position` follows the Memory settings: `-1` not injected, `0` after the main prompt, `1` in chat at `depth`, `2` before the main prompt; `role` is `0` system, `1` user, `2` assistant.

### `POST /api/chats/:characterId/:chatId/summarize`

Runs one summary now, even when automatic updates are off, and stores it on the last message it covered. Response:

```json
{
    "summary": { "value": "Seraphina met Alex at the old gate.", "index": 3 },
    "messages": 4
}
```

When there is nothing new to summarize, `summary` is `null` and `reason` explains why. The request covers the messages after the latest summary and always excludes the newest message, as SillyTavern's raw summary builder does.

### `PUT /api/chats/:characterId/:chatId/memory`

```json
{ "text": "A summary written by hand." }
```

Stores the text on the latest summary's message, or on the message before the newest when the chat has none. Response: `{ "summary": { "value": "...", "index": 3 } }`.

### `DELETE /api/chats/:characterId/:chatId/memory`

Removes the latest summary. Response: `{ "summary": SummaryRecord | null }`, where a non-null value is an older summary that is now in effect (SillyTavern's Restore behaviour).

### `PATCH /api/chats/:characterId/:chatId/messages/:index`

Edit the text or select a swipe. Send one of:

```json
{ "message": "Edited text" }
```

```json
{ "swipeId": 1 }
```

When `swipeId` is present it takes precedence. The swipe is read from `message.extra.swipes`; `message.mes` becomes the selected swipe and `extra.swipe_id` is updated.

Response: `{ "message": ChatMessage }`.

### `DELETE /api/chats/:characterId/:chatId/messages/:index`

Deletes one message and returns the full updated chat: `{ "chat": ChatDetail }`.

### `DELETE /api/chats/:characterId/:chatId`

Deletes the chat file. Response: `{ "ok": true }`.

## Groups

Group chats use SillyTavern's storage shape: metadata in `data/groups/<id>.json` and messages in `data/group chats/<chatId>.jsonl`. `members` and `disabled_members` hold character avatar file names, but a request may identify a member by either its id or its file name; the stored value is always the file name.

A `GroupView` is the stored group object plus two fields the client needs: `memberDetails` (`fileName`, `name`, `id`, `avatarUrl`, `description`, `personality`, `scenario`, with `id: null` when the card is gone) and `updatedAt` (group file mtime in milliseconds). Stored fields include `id`, `name`, `members`, `avatar_url`, `allow_self_responses`, `activation_strategy`, `generation_mode`, `disabled_members`, `fav`, `chat_id`, `chats`, `auto_mode_delay`, `generation_mode_join_prefix` and `generation_mode_join_suffix`.

Group generation picks one member per request and builds the prompt from that member's card (SillyTavern's swap generation mode). History messages whose name is not the user persona are prefixed with that name — assistant, narrator and send-as messages alike — the group nudge is appended after the history, and a reply that starts speaking for another member is trimmed before it is stored.

### `GET /api/groups`

Lists every group, newest first: `{ "groups": GroupView[] }`.

### `POST /api/groups`

```json
{
    "name": "The Cup",
    "members": ["Seraphina.png", "Mira.json"],
    "activation_strategy": 0,
    "generation_mode": 0,
    "auto_mode_delay": 5
}
```

`members` is required and must resolve to character cards. When `name` is omitted it becomes `Group: <member names>`. The new group has no chat yet. Response `201`: `{ "group": GroupView }`.

### `GET /api/groups/:groupId`

Response: `{ "group": GroupView }`.

### `PATCH /api/groups/:groupId`

Accepts any of `name`, `members`, `avatar_url`, `allow_self_responses`, `activation_strategy`, `generation_mode`, `disabled_members`, `fav`, `auto_mode_delay`, `generation_mode_join_prefix` and `generation_mode_join_suffix`. Membership changes remove disabled names that are no longer members. Response: `{ "group": GroupView }`.

### `DELETE /api/groups/:groupId`

Deletes the group file and every chat listed in it. Response: `{ "ok": true }`.

### `GET /api/groups/:groupId/chats`

Lists the chats the group file references, most recently modified first: `{ "chats": ChatSummary[] }`. A listed chat whose file is missing is skipped.

### `POST /api/groups/:groupId/chats`

```json
{ "name": "first night" }
```

Starts a chat and makes it the group's `chat_id`. The chat is seeded with one greeting per member, in member order and muted members included, as SillyTavern does; each greeting keeps the member's alternate greetings as swipes. Without a name, the file is named like SillyTavern's group chats (`2026-11-11@08h14m52s123ms`). Response `201`: `{ "chat": GroupChatDetail, "group": GroupView }`.

### `GET /api/groups/:groupId/chats/:chatId`

Response: `{ "chat": GroupChatDetail }`, where `GroupChatDetail` is the usual chat header and messages plus `groupId` and `chatId`.

### `PATCH /api/groups/:groupId/chats/:chatId`

```json
{ "name": "renamed", "personaId": "default", "current": true }
```

All fields are optional. `name` moves the chat file and updates `chats` and, when needed, `chat_id`. `personaId` pins the chat to a persona; `null` removes the pin. `current: true` records the chat as the group's `chat_id`, the field SillyTavern uses to reopen the last chat. Response: `{ "chat": GroupChatDetail, "group": GroupView }`.

### `DELETE /api/groups/:groupId/chats/:chatId`

Deletes the chat file and its entry in the group. When it was the current chat, `chat_id` moves to the newest remaining chat or becomes empty. Response: `{ "ok": true, "group": GroupView }`.

### `POST /api/groups/:groupId/chats/:chatId/generate`

Starts a group reply and returns the same SSE stream as `POST /api/generate`. The server appends the user message, chooses the speaker, builds the prompt and persists the reply.

```json
{
    "action": "send",
    "message": "What is cooking?",
    "speaker": "Bram.json"
}
```

`action` is `send`, `regenerate`, `continue` or `trigger`. `speaker` selects the member in manual groups and acts as an override for the other strategies; it accepts a member file name, id or name. Without it, manual groups fall back to the first enabled member. `trigger` asks for a fresh reply without a user message: it uses the last chat message as the activation text, keeps the last speaker from answering again (unless the group allows self-responses), and honours `speaker`; a forced member may be muted. The `start` event carries the chosen member:

```json
{
    "type": "start",
    "generationId": "…",
    "speaker": {
        "id": "Bram",
        "fileName": "Bram.json",
        "name": "Bram",
        "avatarUrl": "/api/characters/Bram/avatar?v=…"
    }
}
```

Selection follows the group's `activation_strategy`: **natural** uses a name mention, otherwise the member after the last speaker; **list** rotates; **pooled** prefers a member who has not spoken since the user's last message; **manual** uses the request's `speaker`. Regenerate and continue stay on the message's current speaker. The reply is stored with `name`, `original_avatar`, `force_avatar` and a numeric `extra.gen_id`, and a new reply is emitted by `done`.

### `PATCH /api/groups/:groupId/chats/:chatId/messages/:index`

Same contract as the single-character message edit: `{ "message": "..." }` or `{ "swipeId": n }`. Macros expand against the speaking member (`original_avatar` first, then a name match), and regex source scripts with `runOnEdit` run. Response: `{ "message": ChatMessage }`.

### `DELETE /api/groups/:groupId/chats/:chatId/messages/:index`

Deletes one message. Response: `{ "chat": GroupChatDetail }`.

### `POST /api/groups/:groupId/chats/:chatId/summarize`

Same contract as the single-character summarize endpoint. The summarize prompt expands against the most recent speaker's card and the group roster, and the transcript keeps each member's name.

### `PUT /api/groups/:groupId/chats/:chatId/memory`

Stores an edited summary. Same body and response as the single-character endpoint.

### `DELETE /api/groups/:groupId/chats/:chatId/memory`

Removes the latest group-chat summary, falling back to an older one when present.

## Generation

### `POST /api/generate`

Starts a generation and returns an SSE stream. The server persists the assistant message before emitting `done`.

```json
{
    "characterId": "Seraphina",
    "chatId": "Seraphina - 2026-11-09_18-42-29",
    "action": "send",
    "message": "I'm feeling better, thank you. What is this place?"
}
```

| Action       | Behaviour                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `send`       | Appends the user message, then generates an assistant reply. `message` is required.                                                                                                                       |
| `regenerate` | Removes the last assistant message from the prompt and generates a new variant. If a previous assistant message exists, the new text is stored as a swipe; otherwise a new assistant message is appended. |
| `continue`   | Requires the last message to be an assistant message. Generated text is appended to that message.                                                                                                         |
| `trigger`    | Generates a new assistant reply without a user message. This is the action behind a Quick Reply `/trigger`. `message` is ignored.                                                                         |

SSE events:

```text
event: start
data: {"type":"start","generationId":"<uuid>"}

event: token
data: {"type":"token","text":"..."}

event: reasoning
data: {"type":"reasoning","text":"..."}

event: done
data: {"type":"done","message":{...ChatMessage...},"usage":{"promptTokens":123,"completionTokens":45}}

event: error
data: {"type":"error","message":"..."}
```

- A `: ping` comment is sent every 15 seconds.
- `reasoning` is emitted only when the provider returns reasoning content.
- `usage` is omitted when the provider does not report token counts.
- If the client disconnects or calls the stop endpoint, the server aborts the upstream request and saves the partial text with `extra.stopped = true` when possible.
- If the upstream fails after some text was produced, the partial text is saved and an `error` event is sent.
- The client should use `fetch` + `ReadableStream` rather than `EventSource`, because the request is a POST with a session cookie.

### `POST /api/generate/:id/stop`

Aborts a running generation by its `generationId`.

```json
{ "ok": true }
```

`{ "ok": false }` means the generation already finished or the ID is unknown.

## Import

### `POST /api/import/sillytavern`

Copy an existing SillyTavern installation into this one.

```json
{ "path": "/home/me/SillyTavern/data/default-user", "dryRun": true }
```

- `path` is an **absolute** path on the machine running CatCup. A relative path, a missing path or a directory with no SillyTavern data is a `400` with a message saying which.
- `dryRun: true` returns `{ "plan": { characters, chats, worlds, presets, sources, errors } }` and writes nothing. `sources` lists the folders that contributed files.
- Without `dryRun` it copies, returning `{ "result": { imported: { characters, chats, worlds, presets }, errors, skippedChats } }`.

What is read: `characters/`, `chats/<character>/*.jsonl`, `worlds/`, and OpenAI presets from `openai presets/`, `presets/openai/` or `public/presets/openai/`. Chats are attached to a character by matching the folder name against the imported card's name or id; a chat whose character is not in the same import is reported in `skippedChats` rather than guessed at. Files over 20 MB and kinds beyond 500 files are skipped, with an error per file.

Importing is additive: running it twice adds copies with numeric suffixes instead of overwriting.

Group chats, backgrounds, themes and SillyTavern's own settings are not imported.

## Settings

### `GET /api/settings`

```json
{
    "settings": {
        "version": 1,
        "activeProviderId": "provider-uuid",
        "activePresetId": null,
        "providers": [ProviderPublic],
        "generation": {
            "temperature": 1,
            "topP": 1,
            "maxTokens": 2048,
            "contextSize": 32768,
            "stream": true
        },
        "personas": [{ "id": "default", "name": "You", "description": "" }],
        "activePersonaId": "default",
        "ui": { "language": "en", "theme": "tavern-dark" },
        "worldInfo": {
            "globalBooks": [],
            "depth": 2,
            "budgetPercent": 25,
            "budgetCap": 0,
            "caseSensitive": false,
            "matchWholeWords": false,
            "useGroupScoring": false,
            "recursive": false,
            "minActivations": 0,
            "minActivationsDepthMax": 0,
            "maxRecursionSteps": 0
        },
        "authorNote": {
            "enabled": false,
            "prompt": "",
            "interval": 1,
            "position": 1,
            "depth": 4,
            "role": 0,
            "scan": false
        },
        "memory": {
            "enabled": false,
            "prompt": "Ignore previous instructions. Summarize … Limit the summary to {{words}} words or less. …",
            "template": "[Summary: {{summary}}]",
            "position": 0,
            "role": 0,
            "depth": 2,
            "scan": false,
            "promptWords": 200,
            "promptInterval": 10,
            "promptForceWords": 0,
            "maxMessages": 0,
            "responseLength": 0
        },
        "quickReplies": {
            "enabled": true,
            "setList": [{ "set": "Combat", "isVisible": true }]
        },
        "tts": {
            "enabled": false,
            "backend": "system",
            "baseUrl": "https://api.openai.com/v1",
            "model": "tts-1",
            "voice": "",
            "format": "mp3",
            "speed": 1,
            "instructions": "",
            "rate": 1,
            "pitch": 1,
            "autoplay": true,
            "narratorVoice": "",
            "characterVoices": {},
            "skipCodeBlocks": true,
            "stripTags": true,
            "stripAsterisks": true
        },
        "imageGeneration": {
            "enabled": false,
            "backend": "automatic1111",
            "baseUrl": "http://127.0.0.1:7860",
            "model": "",
            "width": 512,
            "height": 512,
            "steps": 20,
            "cfgScale": 7,
            "sampler": "DDIM",
            "scheduler": "normal",
            "seed": -1,
            "comfyWorkflow": "{ \"3\": { \"class_type\": \"KSampler\", \"inputs\": { \"seed\": \"%seed%\", … } }, … }",
            "promptPrefix": "best quality, absurdres, aesthetic,",
            "negativePrompt": "lowres, bad anatomy, bad hands, …",
            "promptTemplate": "Ignore previous instructions. …",
            "contextMessages": 10
        },
        "ttsHasKey": false,
        "imageHasKey": false
    }
}
```

`ProviderPublic` includes `hasKey` instead of the API key. `language` is reserved for future i18n. `worldInfo.globalBooks` lists world info book ids (file names without `.json`) scanned for every chat; a character's own book, from the card's `extensions.world`, is added automatically. `authorNote.position` is `0` in prompt, `1` in chat, `2` before prompt; `authorNote.role` is `0` system, `1` user, `2` assistant. `personas` is the list a user can speak as and `activePersonaId` picks the default for chats that do not pin one; files written before the list existed are migrated on read, carrying the old single persona over under the id `default`.

`memory.enabled` turns automatic updates on; a stored summary is injected whenever `memory.position` is not `-1`, even with automatic updates off, and the Memory panel can always create or edit one. `position` is `-1` not injected, `0` after the main prompt, `1` in chat at `depth`, `2` before the main prompt; `role` is `0` system, `1` user, `2` assistant. `prompt` is the summarize instruction (`{{words}}` becomes `promptWords`; normal macros also expand). `promptInterval` and `promptForceWords` are the two update triggers, and `0` disables either. `maxMessages` caps one summary request (`0` uses the context budget), and `responseLength` overrides the summary's token limit (`0` uses the generation setting). `scan` adds the summary to the world info scan.

`quickReplies.enabled` shows the quick reply bar above the message box. `setList` is the bar's order; each `set` is a set's name and `isVisible` hides its buttons without removing it. A chat can add its own links in `chat_metadata.quickReply`, in SillyTavern's shape; those are read but have no editor yet.

`tts.enabled` is the master switch for play buttons and autoplay. `backend` is `system` (browser speech synthesis) or `openai-compatible` (a server-side `/audio/speech` call). `baseUrl`, `model`, `voice`, `format`, `speed` and `instructions` configure the remote backend; `rate` and `pitch` configure the browser one. `voice` is the default; empty uses the backend default (alloy for OpenAI, the browser voice for system). `characterVoices` maps a character id to a voice, and `narratorVoice` overrides the default for narrator notes. The three `skip`/`strip` flags control text cleaning. `ttsHasKey` reports whether a TTS key is stored; the key itself is never returned.

`imageGeneration.enabled` is the master switch for the chat buttons and the gallery. `backend` is `automatic1111` (a local A1111/Forge `/sdapi/v1/txt2img` call), `comfyui` (an API-format workflow posted to `/prompt`) or `openai-compatible` (any `/images/generations` endpoint). `baseUrl` is the A1111/ComfyUI root or the OpenAI-style API root. `model` is required by OpenAI-style endpoints, is the checkpoint file name substituted for ComfyUI's `%model%`, and is only a label for A1111. `width`/`height`, `steps`, `cfgScale`, `sampler` and `seed` map to the backend request; `seed` of `-1` asks for a random seed. `scheduler` is the ComfyUI KSampler scheduler and is ignored by the other two. `comfyWorkflow` is the ComfyUI graph in API format; its `%prompt%`, `%negative_prompt%`, `%seed%`, `%width%`, `%height%`, `%steps%`, `%scale%`, `%sampler%`, `%scheduler%` and `%model%` placeholders are filled before the graph is posted, with numeric placeholders becoming JSON numbers. A workflow containing `nodes` and `links` arrays (interface format) is rejected with `400 IMAGE_CONFIG`. `promptPrefix` and `negativePrompt` are added to every generation, and `promptTemplate` instructs the chat model when drafting from chat, over the last `contextMessages` messages. `imageHasKey` reports whether an image key is stored; the key is never returned. For ComfyUI an optional key is sent as HTTP Basic auth.

### `PATCH /api/settings`

Partial update. All fields are optional:

```json
{
    "activeProviderId": "provider-uuid",
    "generation": { "temperature": 0.9, "maxTokens": 4096 },
    "personas": [{ "id": "default", "name": "Alex", "description": "A curious traveler." }],
    "activePersonaId": "default",
    "ui": { "theme": "tavern-dark" },
    "worldInfo": { "globalBooks": ["eldoria"], "recursive": true },
    "authorNote": { "enabled": true, "prompt": "Stay in character.", "interval": 2 },
    "memory": { "enabled": true, "promptInterval": 8, "position": 1, "depth": 2 },
    "quickReplies": { "enabled": true, "setList": [{ "set": "Combat", "isVisible": true }] },
    "tts": { "enabled": true, "backend": "openai-compatible", "voice": "nova" },
    "imageGeneration": { "enabled": true, "backend": "automatic1111", "width": 768, "height": 512 },
    "ttsApiKey": "sk-…",
    "imageApiKey": "user:password"
}
```

`activeProviderId` must reference an existing, enabled provider. A missing id returns `404`; a disabled provider returns `400` with code `PROVIDER_DISABLED`. Provider configuration is managed through the provider endpoints, not this patch. Response: `{ "settings": SettingsResponse }`.

`ttsApiKey` is write-only. It is stored in `data/secrets.json` under the key `tts`; an empty string removes it. The response never includes it, only `ttsHasKey`. `imageApiKey` is the same for image generation, stored under `image` and reported as `imageHasKey`.

## Providers

### `GET /api/providers`

```json
{
    "providers": [
        {
            "id": "provider-uuid",
            "kind": "openai",
            "name": "OpenAI",
            "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-5",
            "enabled": true,
            "headers": {},
            "hasKey": false
        }
    ]
}
```

### `POST /api/providers`

```json
{
    "kind": "custom",
    "name": "Local OpenAI-compatible",
    "baseUrl": "http://127.0.0.1:8080/v1",
    "model": "example-model",
    "enabled": true,
    "headers": {},
    "apiKey": "optional"
}
```

`kind` is one of `openai`, `openrouter`, `anthropic`, `ollama`, `custom`. If `baseUrl` is empty, the kind's default is used. Response: `{ "provider": ProviderPublic }`. A supplied `apiKey` is stored in `data/secrets.json`; it is never returned.

### `PATCH /api/providers/:id`

Same body shape as `POST`. Omit `apiKey` to keep the existing key; send an empty string to clear it. Response: `{ "provider": ProviderPublic }`.

Disabling the active provider moves `activeProviderId` to the first other enabled provider, or to `null` when none is enabled. Enabling a provider while `activeProviderId` is `null` makes it active.

### `DELETE /api/providers/:id`

Removes the provider and its stored key. Deleting the active provider moves `activeProviderId` to the first remaining enabled provider, or to `null`. Response: `{ "ok": true }`.

### `POST /api/providers/test`

Tests an unsaved provider form without creating or changing a provider. This is what the **Test connection** and **Fetch models** buttons use.

```json
{
    "provider": {
        "kind": "custom",
        "name": "Local OpenAI-compatible",
        "baseUrl": "http://127.0.0.1:8080/v1",
        "model": "example-model",
        "enabled": true,
        "headers": {}
    },
    "savedProviderId": "optional-provider-id",
    "apiKey": "optional-test-key"
}
```

- `provider` uses the same fields as `POST /api/providers`, minus `apiKey`. An empty `baseUrl` falls back to the kind's default.
- `savedProviderId` is always validated when present; an unknown id returns `404`, even when `apiKey` is supplied.
- When `apiKey` is omitted and `savedProviderId` names an existing provider, the server reuses that provider's stored key only when the draft has the same `kind` and base URL (a trailing slash is ignored). Testing a different endpoint or kind returns `400` with code `PROVIDER_KEY_REUSE`; supply the key explicitly to test it. A supplied `apiKey` always wins, and an empty string tests without a key. The stored key never reaches the browser.
- The base URL must be `http` or `https`; other schemes return `400` with code `INVALID_BASE_URL`. The draft test is rate-limited to 30 requests per minute.
- An invalid body returns `400`.
- A failed connection returns HTTP `200` with `result.ok: false`; only request problems are 4xx.

```json
{
    "result": {
        "ok": true,
        "message": "Connected. 3 model(s) available",
        "models": [{ "id": "model-id", "name": "Model name" }]
    }
}
```

### `POST /api/providers/:id/test`

Optional body:

```json
{ "apiKey": "test-this-key-instead" }
```

If `apiKey` is omitted, the saved key is used. The adapter calls the provider's model-list endpoint and returns:

```json
{
    "result": {
        "ok": true,
        "message": "Connected. 3 model(s) available",
        "models": [{ "id": "model-id", "name": "Model name" }]
    }
}
```

A failed test returns `ok: false` with the provider's error message; it does not throw a 5xx by itself.

### `GET /api/providers/:id/models`

Returns `{ "models": [{ "id": "...", "name": "..." }] }`. Provider failures return `502` with `code: "PROVIDER_ERROR"`.

## World info

Books stored in `data/worlds/`. The file body is kept verbatim, so unknown SillyTavern fields survive an export/import round trip.

### `GET /api/worlds`

```json
{ "worlds": [{ "id": "eldoria", "name": "eldoria", "entryCount": 4, "updatedAt": 1794295677503 }] }
```

### `GET /api/worlds/:id`

Returns `{ "world": WorldDetail }` with the stored body plus a normalized entry list for the editor:

```json
{
    "world": {
        "id": "eldoria",
        "book": { "entries": {} },
        "entries": [
            {
                "uid": 0,
                "key": ["eldoria", "forest"],
                "comment": "Eldoria",
                "content": "Eldoria is the forest around the glade.",
                "position": 0,
                "order": 100,
                "displayIndex": 0
            }
        ]
    }
}
```

`entries` is the entry list every entry mutation returns, so a client never has to merge by hand. Fields missing from the file are filled with SillyTavern's defaults, `content` is the stored text with decorators intact, and the list is in editor order: `displayIndex` (falling back to `uid`), then `order` descending, then `uid`.

### `POST /api/worlds/:id/entries`

Appends a blank entry built from SillyTavern's `newWorldInfoEntryTemplate`. The uid is the lowest one the book is not using, so the uid of a deleted entry is reused.

Response: `201` with `{ "world": WorldDetail, "uid": 3 }`.

### `POST /api/worlds/:id/entries/:uid/duplicate`

Copies an entry under a free uid. The copy keeps the source `displayIndex`, matching SillyTavern, so it sorts beside the original.

Response: `201` with `{ "world": WorldDetail, "uid": 4 }`.

### `PATCH /api/worlds/:id/entries/:uid`

Merge fields into one entry.

```json
{
    "comment": "Shadowfang",
    "key": ["shadowfang", "/beast|monster/i"],
    "content": "Shadowfangs are corrupted beasts.",
    "position": 4,
    "depth": 2,
    "role": 1,
    "probability": 80
}
```

- Every field is optional. Unknown fields are rejected with `400 VALIDATION`, so a typo cannot silently write junk.
- The patch is merged into the entry as stored: `extensions`, `vectorized` and any field the editor does not expose survive.
- `key`, `keysecondary` and `triggers` are trimmed and empty entries dropped; `/pattern/flags` keys are stored verbatim and interpreted by the scanner.
- `uid`, `displayIndex` and `vectorized` are not patchable.

Response: `{ "world": WorldDetail, "uid": 3 }`. `404` means the book or the entry does not exist.

### `PUT /api/worlds/:id/entries/order`

Assigns `displayIndex` values in the order given, which is how the entry list reorders.

```json
{ "uids": [2, 0, 1] }
```

Response: `{ "world": WorldDetail }`. Uids that are not in the book are skipped.

### `DELETE /api/worlds/:id/entries/:uid`

Removes one entry. `displayIndex` values are not renumbered, so gaps remain until the list is reordered — SillyTavern behaves the same way.

Response: `{ "world": WorldDetail }`.

### `POST /api/worlds/import`

```json
{ "fileName": "eldoria.json", "book": { "entries": {} } }
```

- `fileName` is optional; the stored id comes from it, then `world`, with a numeric suffix on collision.
- Response: `201` with `{ "world": WorldDetail }`.

Importing does not enable the book; add its id to `worldInfo.globalBooks` through `PATCH /api/settings`.

### `GET /api/worlds/:id/export`

Returns the stored body as a JSON download.

### `DELETE /api/worlds/:id`

Removes the file and drops the id from `worldInfo.globalBooks` if it was enabled. Response: `{ "ok": true }`.

## Presets

SillyTavern OpenAI presets stored in `data/presets/`. A preset owns the prompt list, its order, the assembly formats and the sampling parameters; `activePresetId` in settings selects one. With no preset active, generation uses the built-in SillyTavern defaults.

### `GET /api/presets`

```json
{ "presets": [{ "id": "Default", "name": "Default", "updatedAt": 1794296904863, "promptCount": 12 }] }
```

`id` is the file name without `.json`.

### `GET /api/presets/:id`

Returns `{ "preset": { "id": "...", "preset": { ... } } }` where `preset.preset` is the stored body, unknown fields included.

### `POST /api/presets/import`

```json
{ "fileName": "Default.json", "preset": { "prompts": [], "prompt_order": [] } }
```

- `fileName` is optional. The stored id comes from it, then from the preset body's `name`, then `preset`; collisions get a numeric suffix.
- The body is stored as given, so a round trip keeps every field ST wrote.
- Response: `201` with `{ "preset": PresetDetail }`.

Importing does not activate the preset; send `PATCH /api/settings` with `{ "activePresetId": "<id>" }`.

### `PATCH /api/presets/:id`

Merge prompt fields into a stored preset. Everything else in the body is left alone, so the editor cannot clobber the sampling and behaviour fields it does not show.

```json
{
    "prompts": [{ "identifier": "main", "injection_position": 1, "injection_depth": 2 }],
    "prompt_order": [{ "character_id": 100001, "order": [{ "identifier": "main", "enabled": true }] }]
}
```

Response: `{ "preset": PresetDetail }`.

### `GET /api/presets/:id/export`

Returns the stored body as a JSON download with `Content-Disposition: attachment`.

### `DELETE /api/presets/:id`

Removes the file. If the preset was active, `activePresetId` is cleared so generation falls back to the built-in defaults. Response: `{ "ok": true }`.

## Regex scripts

Stored in `data/regex.json` as an ordered array, because order is behaviour: scripts run top to bottom and each sees the previous one's output.

### `GET /api/regex`

```json
{ "scripts": [{ "id": "uuid", "scriptName": "Strip OOC", "findRegex": "/\\(OOC:.*?\\)/gs", "placement": [2] }] }
```

### `POST /api/regex`

```json
{ "scriptName": "Strip OOC", "findRegex": "/\\(OOC:.*?\\)/gs", "replaceString": "", "placement": [2] }
```

The id is generated. Missing fields fall back to SillyTavern's defaults. Response: `201` with `{ "script": RegexScript }`.

### `PATCH /api/regex/:id`

Merge fields into a stored script. Unknown fields are rejected with `400 VALIDATION`. Response: `{ "script": RegexScript }`.

### `DELETE /api/regex/:id`

Response: `{ "ok": true }`, or `404` for an unknown id.

### `PUT /api/regex/order`

```json
{ "ids": ["uuid-b", "uuid-a"] }
```

Ids the payload omits keep their relative order after the listed ones. Response: `{ "scripts": [...] }`.

### `POST /api/regex/import`

```json
{ "data": { "scripts": [] }, "mode": "append" }
```

`data` accepts an array of scripts, `{ "scripts": [...] }`, a SillyTavern extension-settings backup (`{ "regex": [...] }`) or a single exported script. `mode` is `append` (default) or `replace`. Response: `201` with `{ "scripts": [...], "errors": ["Script 2: ..."] }`; one error per script that could not be read.

### `GET /api/regex/export`

Returns `{ "scripts": [...] }` as a JSON download.

### Where scripts apply

| Placement      | Value | Applied to                                                               |
| -------------- | ----- | ------------------------------------------------------------------------ |
| User input     | `1`   | The message the user sends, before it is stored                          |
| AI output      | `2`   | A generated reply and the greeting of a new chat, before they are stored |
| Slash commands | `3`   | Reserved; Quick Reply commands do not apply it yet                       |
| World info     | `5`   | An entry's content as it enters the prompt                               |
| Reasoning      | `6`   | Reasoning text, before it is stored                                      |

A script with neither `markdownOnly` nor `promptOnly` rewrites the stored text. `promptOnly` rewrites only the copy that goes into the prompt, `markdownOnly` only what the chat view renders. `minDepth` and `maxDepth` count back from the newest message, where `0` is the newest.

## Quick Replies

Sets use SillyTavern's version 2 format, one JSON file per set in `data/quickreplies/`. The API addresses a set by its file id; the set body's `name` is what the account set list and a chat's `chat_metadata.quickReply` links refer to. Unknown fields on a set or its quick replies are preserved.

### `GET /api/quick-replies`

```json
{ "sets": [{ "id": "Combat", "version": 2, "name": "Combat", "qrList": [], "idIndex": 0 }] }
```

Each set is the stored body plus `id`.

### `POST /api/quick-replies`

```json
{ "name": "Combat" }
```

Creates an empty set named `Combat`, stored as `Combat.json`. Response: `201` with `{ "set": QuickReplySetView }`; `409` when a set with that name (case-insensitive) or file id already exists.

### `PUT /api/quick-replies/:id`

Body is the full set (an `id` field is ignored):

```json
{
    "version": 2,
    "name": "Combat",
    "disableSend": false,
    "injectInput": false,
    "placeBeforeInput": false,
    "color": "transparent",
    "onlyBorderColor": false,
    "qrList": [{ "id": 1, "label": "Attack", "message": "/send I attack." }],
    "idIndex": 1
}
```

Renaming moves the file and rewrites the account set list; `idIndex` is raised to the highest quick reply id. Response: `{ "set": QuickReplySetView }`, `400` for an invalid body (including duplicate quick reply ids), `404` for an unknown id, `409` for a taken name.

### `DELETE /api/quick-replies/:id`

Deletes the file and removes the set from the account set list. Response: `{ "ok": true }`.

### `POST /api/quick-replies/import`

```json
{ "data": { "version": 2, "name": "Imported", "qrList": [] }, "name": "Optional new name" }
```

Accepts a version 2 set body or a single quick reply object (which becomes a one-button set named after its label). Response: `201` with `{ "set": QuickReplySetView }`, `400` when the payload is neither, `409` when the name is taken.

### `GET /api/quick-replies/:id/export`

Returns the stored set body without `id` as a JSON attachment.

### `POST /api/chats/:characterId/:chatId/quick-replies/execute`

### `POST /api/groups/:groupId/chats/:chatId/quick-replies/execute`

```json
{ "setId": "Combat", "qrId": 1 }
```

Runs one quick reply. The server parses and validates the whole script before it appends anything, then persists chat messages and returns what the client should do next:

```json
{
    "actions": [
        { "type": "toast", "message": "Quick reply sent.", "severity": "info" },
        { "type": "generate", "mode": "trigger", "speaker": "Bram.json" }
    ],
    "appended": [{ "name": "You", "is_user": true, "mes": "Hello from a quick reply." }]
}
```

Actions are, in order:

| Type       | Fields                                                   | Meaning                                                                 |
| ---------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| `input`    | `text`, `submit`, `inject`, `placeBefore`                | Put macro-expanded text in the message box, optionally sending it       |
| `toast`    | `message`, `title?`, `severity`                          | Show a notification (`/echo`)                                           |
| `generate` | `mode` (`trigger`, `continue`, `regenerate`), `speaker?` | Call the generation endpoint with that action and optional group member |

`appended` lists the messages already written to the chat. A plain-text reply is an `input` action; `/send` and `/sys` only append; `/trigger`, `/continue` and `/regenerate` return a `generate` action.

#### Supported script subset

A quick reply message that does not start with `/` is plain text. Otherwise it is a `|`-separated command list; double quotes protect pipes and spaces, and `\|` escapes a pipe.

| Command             | Aliases                | Behaviour                                                                                                                        |
| ------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/send <text>`      |                        | Appends a user message without generating. `name="..."` overrides the display name.                                              |
| `/sys <text>`       | `/nar`                 | Appends a narrator message (`extra.type: "narrator"`), which the prompt sends as a system turn. `name="..."` overrides "System". |
| `/echo <text>`      |                        | Shows a toast. `title="..."` and `severity=info\|success\|warning\|error` are supported.                                         |
| `/trigger [member]` |                        | Asks for a reply without a user message. In a group, `member` is a name or 0-based index.                                        |
| `/continue`         | `/cont`                | Continues the latest reply.                                                                                                      |
| `/regenerate`       | `/regen`               | Regenerates the latest reply.                                                                                                    |
| `/run <label>`      | `/call`, `/exec`, `/:` | Runs another quick reply by label from an active set, or as `Set.Label` for any set.                                             |

`/trigger`, `/continue`, `/regenerate` and a plain-text reply must be the last step: the subset does not await a generation mid-script. Named arguments are command-scoped: `name` on `/send` and `/sys`, `title` and `severity` on `/echo`, and `await`, `return`, `compact` or `raw` only where the command defines them. Those ST arguments are accepted and ignored; `at` and `args` are rejected with `400`, as is any argument a command does not declare. A set's `disableSend` pastes the whole reply into the message box instead of running it; `injectInput` and `placeBeforeInput` apply when text is inserted.

## Text to speech

The browser backend (`tts.backend = "system"`) speaks through `speechSynthesis` and makes no server request. The OpenAI-compatible backend calls the configured `/audio/speech` endpoint with the stored key; the browser receives audio bytes and never sees the key.

### `POST /api/tts/speak`

```json
{ "text": "The lantern flickers.", "voice": "nova" }
```

`voice` is optional; without it the default voice from settings is used. The body is limited to 4000 characters, so the web client splits longer messages into chunks and plays them in order. Response: the provider's audio bytes, with its `Content-Type` and `Cache-Control: no-store`.

Errors: `400 TTS_DISABLED` when text to speech is off, `400 TTS_SYSTEM_BACKEND` when the browser backend is selected, `400 TTS_KEY_MISSING` when `baseUrl` is an `api.openai.com` host and no key is stored, `400 TTS_CONFIG` when the base URL or model is empty, and `502 TTS_FAILED` when the upstream request fails or returns empty or JSON audio.

Audio is generated on demand and is not written to the data directory.

## Image generation

Image generation runs on the server. The browser sends a prompt and receives the stored image's metadata; the provider only sees the chat when the user asks for a prompt to be drafted. The key is write-only in `data/secrets.json` under `image`, and `imageHasKey` reports whether one exists. A gallery folder is the sanitized character name for a single chat or the group id for a group chat.

### `POST /api/images/draft`

Asks the active chat provider for an image prompt from the recent conversation.

```json
{ "characterId": "Aria", "chatId": "2026-11-12", "messageIndex": 12 }
```

`characterId` and `groupId` are mutually exclusive; `chatId` is required. `messageIndex` includes history up to and including that message; without it the whole chat is used. Response: `{ "prompt": "a moonlit tavern, two travelers, warm light" }`. The result is cleaned to a comma-separated tag list; the request is limited to `imageGeneration.contextMessages` messages.

Errors: `400 IMAGE_DISABLED`, `400 IMAGE_PROMPT_EMPTY` when there are no messages, and `502 IMAGE_PROMPT_FAILED` when the chat provider fails or returns nothing usable.

### `POST /api/images/generate`

```json
{ "characterId": "Aria", "prompt": "a knight in a candle-lit tavern" }
```

`characterId` or `groupId` picks the gallery folder; the server resolves the character's sanitized display name or the group id. The configured `promptPrefix` is added before the prompt. The image is written to `data/user/images/<folder>/<file>.<ext>` with a `<file>.json` sidecar holding the prompt, negative prompt, backend, model, dimensions, seed and creation time.

For `backend: "comfyui"` the server fills the placeholders in `comfyWorkflow`, posts `{ "prompt": <graph>, "client_id": "<uuid>" }` to `<baseUrl>/prompt`, polls `<baseUrl>/history/<prompt_id>` every 500 ms, and downloads the first output image from `<baseUrl>/view`. The job gets five minutes; if the browser disconnects or the job times out, the server posts `<baseUrl>/interrupt` for the job it queued. A graph rejected at validation returns the offending node and value from `node_errors`; a failed node's `execution_error` traceback is included in the `502` message.

Response:

```json
{
    "image": {
        "folder": "Aria",
        "file": "image-1762900000000-a1b2c3d4.png",
        "url": "user/images/Aria/image-1762900000000-a1b2c3d4.png",
        "prompt": "best quality, a knight in a candle-lit tavern",
        "negativePrompt": "lowres, blurry",
        "backend": "automatic1111",
        "model": "",
        "width": 512,
        "height": 512,
        "seed": 4242,
        "createdAt": "2026-11-12T05:00:00.000Z"
    }
}
```

Errors: `400 IMAGE_DISABLED`, `400 IMAGE_KEY_MISSING` when an `api.openai.com` endpoint has no key, `400 IMAGE_CONFIG` for an invalid base URL, a missing OpenAI model or an invalid/unusable ComfyUI workflow, and `502 IMAGE_FAILED` when the provider fails. A `url` response from an OpenAI-compatible endpoint is downloaded server-side with the same 25 MB cap.

### `POST /api/images/attach`

Posts a generated image into the chat as a SillyTavern media message.

```json
{ "characterId": "Aria", "chatId": "2026-11-12", "file": "image-….png", "prompt": "a knight" }
```

The new message has `mes` `[<name> sends a picture that contains: <prompt>].` and `extra.media` with `{ url: "user/images/<folder>/<file>", type: "image", title, negative, generation_type: -1, source: "generated" }`, plus `media_index: 0`, `media_display: "gallery"` and `inline_image: false`. The group route appends to the group chat file. Response: `{ "message": ChatMessage }`.

### `POST /api/images/test`

Checks the saved backend without generating an image. A1111 calls `GET /sdapi/v1/options`; ComfyUI calls `GET /system_stats`; an OpenAI-compatible backend calls `GET /models` (advisory — a server can generate images without that route). Response `{ "ok": true }` or `502 IMAGE_FAILED`.

### `GET /api/images?characterId=<id>` or `?groupId=<id>`

Lists the character's or group's gallery, newest first. Response: `{ "images": [GeneratedImage] }`. A missing gallery returns an empty list; an invalid character or group id returns `400 IMAGE_PATH`.

### `GET /api/images/:folder/:file`

Returns the image bytes with the correct `Content-Type`, `Cache-Control: private, max-age=3600` and `X-Content-Type-Options: nosniff`. Authentication is required. Only PNG, JPEG and WebP files are accepted.

### `DELETE /api/images/:folder/:file`

Deletes the image and its sidecar. Messages that already reference it keep the reference. Response: `{ "ok": true }`; `404` when the image does not exist.

## Notes and limits

- Request bodies are limited to 25 MB; uploads to 20 MB per file and 50 files.
- Setup is limited to 5 attempts per minute; login to 10 attempts per minute.
- The API is not versioned yet. Clients should tolerate additive fields.
- Static SPA files are public; the API is protected. Do not expose the API without the password.
- See [SECURITY.md](SECURITY.md) for the full auth and secret model and [PROVIDERS.md](PROVIDERS.md) for adapter details.
