# HTTP API

The server exposes a same-origin REST API under `/api` plus one SSE endpoint for generation. In development Vite proxies `/api` to `http://127.0.0.1:8000`; in production Fastify serves the SPA and API from the same port.

- All request and response bodies are JSON unless noted.
- Authentication is a session cookie (`catcup_session`) set by `POST /api/auth/login`.
- All endpoints except the public list below require that cookie.
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

| Code                  | HTTP      | Meaning                                                |
| --------------------- | --------- | ------------------------------------------------------ |
| `VALIDATION`          | 400       | Zod validation failed                                  |
| `BAD_REQUEST`         | 400       | Invalid input or state                                 |
| `UNAUTHORIZED`        | 401       | Missing or expired session                             |
| `INVALID_PASSWORD`    | 401       | Wrong login password                                   |
| `NEEDS_SETUP`         | 401 / 409 | No password has been configured yet                    |
| `FORBIDDEN`           | 403       | Origin mismatch or remote first-run setup              |
| `NOT_FOUND`           | 404       | Character, chat, message, provider or avatar not found |
| `ALREADY_INITIALIZED` | 409       | Setup attempted after a password exists                |
| `PAYLOAD_TOO_LARGE`   | 413       | Upload or request body too large                       |
| `PROVIDER_ERROR`      | 502       | Upstream provider request failed                       |
| —                     | 500       | Unhandled server error                                 |

## Auth

### `GET /api/auth/status`

```json
{ "needsSetup": false, "authenticated": true }
```

### `POST /api/auth/setup`

First-run only. The request must originate from loopback unless `CATCUP_ALLOW_REMOTE_SETUP=true`.

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

## Health

### `GET /api/health`

```json
{ "ok": true, "version": "0.1.0", "needsSetup": false }
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
            "spec": "v3",
            "hasCharacterBook": true,
            "updatedAt": 1794220000000,
            "avatarUrl": "/api/characters/Seraphina/avatar?v=1794220000000"
        }
    ]
}
```

`spec` is `v2`, `v3` or `legacy`. The list is sorted by display name.

### `GET /api/characters/:id`

Returns `{ "character": CharacterDetail }`, where `CharacterDetail` is the summary plus:

- `card`: normalized character card data (V2/V3 field names);
- `rawCard`: the original parsed JSON.

### `GET /api/characters/:id/avatar`

Returns `image/png` for PNG cards. JSON-only cards have no avatar and return `404`. Responses are sent with `Cache-Control: private, max-age=300`; the list URL includes a version query.

### `POST /api/characters/import`

`multipart/form-data` with one or more file parts. Field names are ignored; every file part is processed.

- Accepted: `.png` (character card with `tEXt` metadata) and `.json`.
- Limits: 20 MB per file, 50 files per request.
- The saved file is named after the character card name, with a numeric suffix on collision.

Response:

```json
{
    "imported": [CharacterSummary],
    "errors": [{ "fileName": "broken.png", "message": "PNG does not contain character metadata" }]
}
```

Partial success is normal: imported cards are saved, failed cards are reported in `errors`.

### `DELETE /api/characters/:id`

Deletes the card file. Chats are not deleted automatically. Response: `{ "ok": true }`.

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

Rename a chat. Chats are files, so this moves the file and returns the chat under its new id.

```json
{ "name": "The forest glade" }
```

Response: `{ "chat": ChatDetail }`. A name that is already in use gets a numeric suffix instead of overwriting the other chat; the returned `chatId` is the one actually used.

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
        "budget": { "exceeded": false, "tokenCounts": { "main": 24 }, "total": 3117 }
    }
}
```

`trace` has one line per candidate entry explaining whether it activated and why, which is what makes a missing or unexpected lorebook hit debuggable.

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
        "persona": { "name": "You", "description": "" },
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
        }
    }
}
```

`ProviderPublic` includes `hasKey` instead of the API key. `language` is reserved for future i18n. `worldInfo.globalBooks` lists world info book ids (file names without `.json`) scanned for every chat; a character's own book, from the card's `extensions.world`, is added automatically. `authorNote.position` is `0` in prompt, `1` in chat, `2` before prompt; `authorNote.role` is `0` system, `1` user, `2` assistant.

### `PATCH /api/settings`

Partial update. All fields are optional:

```json
{
    "activeProviderId": "provider-uuid",
    "generation": { "temperature": 0.9, "maxTokens": 4096 },
    "persona": { "name": "Alex", "description": "A curious traveler." },
    "ui": { "theme": "tavern-dark" },
    "worldInfo": { "globalBooks": ["eldoria"], "recursive": true },
    "authorNote": { "enabled": true, "prompt": "Stay in character.", "interval": 2 }
}
```

`activeProviderId` must reference an existing provider. Provider configuration is managed through the provider endpoints, not this patch. Response: `{ "settings": SettingsResponse }`.

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

### `DELETE /api/providers/:id`

Removes the provider and its stored key. Response: `{ "ok": true }`.

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

Returns `{ "world": { "id": "...", "book": { ... } } }` with the stored body.

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

### `GET /api/presets/:id/export`

Returns the stored body as a JSON download with `Content-Disposition: attachment`.

### `DELETE /api/presets/:id`

Removes the file. If the preset was active, `activePresetId` is cleared so generation falls back to the built-in defaults. Response: `{ "ok": true }`.

## Notes and limits

- Request bodies are limited to 25 MB; uploads to 20 MB per file and 50 files.
- Setup is limited to 5 attempts per minute; login to 10 attempts per minute.
- The API is not versioned yet. Clients should tolerate additive fields.
- Static SPA files are public; the API is protected. Do not expose the API without the password.
- See [SECURITY.md](SECURITY.md) for the full auth and secret model and [PROVIDERS.md](PROVIDERS.md) for adapter details.
