# CatCup import surfaces

Everything the pack produces must land through these routes. Field names are from the current
`docs/API.md`; check there before assuming a field exists.

## Characters

### `POST /api/characters/import`

`multipart/form-data`; every file part is processed, field names ignored.

- Accepted: `.png` (card with `tEXt` chunks), `.json` (V2/V3 wrapper, bare `{ data }`, or legacy
  flat), `.charx` (RisuAI ZIP) and `.catcup` (the same container under CatCup's own extension).
- 20 MB per file, 50 files per request.
- **The saved file is named after `data.name`**, sanitized, with ` (2)`, ` (3)` on collision. So
  re-importing a revised card does not overwrite — it adds a copy. Delete the old one first, or
  expect duplicates.
- A PNG card keeps its image; a JSON card has no avatar. `GET /api/characters/:id/avatar` serves the
  card file itself and 404s for JSON cards.
- Response: `{ "imported": CharacterSummary[], "errors": [{ fileName, message }] }`. Partial success
  is normal — read `errors`.

### `POST /api/characters/import-path`

Desktop only; the shell calls it when a card file is opened from Explorer. `{ "path": "…" }`, same
three-plus-`.catcup` extensions, same response shape with at most one entry. A web or LAN server does
not register the route and answers `404`, not `400` — so do not suggest it to a browser user.

### `PATCH /api/characters/:id`

Merge-edit. Editable: `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example`,
`creator_notes`, `system_prompt`, `post_history_instructions`, `alternate_greetings`, `tags`,
`creator`, `character_version`, `nickname`, `group_only_greetings`.

Anything else → `400 VALIDATION`. **There is no image field.** The editable set is the fastest way to
fix a card without re-importing.

### `GET /api/characters/:id/export?format=png|json|charx`

`png` needs a PNG card; `json` promotes a flat card to V2; `charx` packages a V3 `card.json` plus the
stored assets and, for a PNG card, the image as the icon.

## World info

### `POST /api/worlds/import`

A **JSON body**, not multipart — unlike the character import:

```json
{ "fileName": "eldoria", "book": { "entries": { "0": { "uid": 0, "key": […], "content": "…", … } } } }
```

`fileName` is optional; the stored id comes from it, then the book's own `name`, with a numeric suffix
on collision. Response `201`: `{ "world": WorldDetail }`. `scope: "shared"` (newer builds) creates the
book reusable in every profile.

A bare `uid -> entry` map is accepted in place of `{ entries: … }`. `null` is tolerated where ST writes
`null` (`sticky`, `cooldown`, `group`, …) and means "unset". Entries that fail validation are
**skipped** rather than failing the book, so a malformed entry shows up as a missing entry, not an
error.

**Importing does not enable the book.** Two steps:

```bash
curl -X PATCH -H "Content-Type: application/json" \
     -d '{"worldInfo":{"globalBooks":["<BookId>"]}}' \
     http://localhost:8000/api/settings
```

The book id is the stored id from above. A character can also carry its own book via
`extensions.world` (that is what Library → Import lore sets), which scans for that character without
enabling it globally — but the pack's shared book is better as a global book.

### Alternative: embed the book in each card

`data.character_book` (V2) is imported as the card's own lorebook. Do not use this for a shared cast
book: it would duplicate the entries into every card.

## Images

CatCup's pipeline is **generate → gallery → attach to a message**, plus a portrait promotion that
writes a gallery image back into the card. A card's picture and its data are one file, so a portrait
has to be a PNG.

| Route                             | Purpose                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/images/test`           | Probe the configured backend                                                  |
| `POST /api/images/draft`          | Ask the chat model for a prompt from recent messages                          |
| `POST /api/images/draft-portrait` | Ask the chat model for a prompt from a **card**, no chat needed               |
| `POST /api/images/generate`       | Generate into the gallery: `{ characterId, prompt }` or `{ groupId, prompt }` |
| `POST /api/images/portrait`       | Promote a gallery PNG to the character's picture                              |
| `POST /api/images/attach`         | Append an image to a chat as an ST media message                              |
| `GET /api/images?characterId=…`   | List the gallery                                                              |
| `GET /api/images/:folder/:file`   | Serve one                                                                     |

Both draft routes are chat-model calls and need **no image backend** — neither checks
`imageGeneration.enabled`. Only `generate` needs one, and with it disabled that route answers
`400 IMAGE_DISABLED`. So a user with no Stable Diffusion install can still get prompts from the app.

`/draft` reads chat history and never the card, so a fresh card with no chat has nothing to draft
from; `/draft-portrait` takes `{ characterId }` and reads the card itself. On an app that has only
`/draft`, write the prompt yourself.

### From generated image to card portrait

Two routes, depending on what the app offers:

1. `POST /api/images/portrait` with `{ characterId, file }` promotes a gallery image directly:
   - **The file must be a PNG** — otherwise `400 IMAGE_PORTRAIT_FORMAT`. A card stores its data in
     PNG `tEXt` chunks, so a JPEG or WebP cannot hold it. Tell the user to generate PNG output, not a
     web-friendly format.
   - A **JSON card becomes a PNG card**, then the JSON file is **deleted** — the id resolves to one
     file, and keeping both would let two files claim it. Card text fields are unchanged.
   - An existing picture on a PNG card is overwritten, and the previous image is **not** kept.

2. On an app without that route, `scripts/embed-portrait.mjs` does the same thing offline: it writes
   the card into the PNG's `chara` and `ccv3` chunks, so the result imports as a PNG card with its
   metadata and its image in one file. This also works in a checkout with no server running.

Either way, keep the source `card.json` around; the PNG carries the same metadata and can be exported
back to JSON.

### Personas from a card

`POST /api/personas/from-card` with `{ characterId, scope? }` builds a persona from the card:
`description`, `personality`, `scenario` and example messages. `first_mes` is deliberately **not**
copied — the opening line is the assistant's, and a persona carrying it makes the model greet itself.

The persona's `mesExample` is parsed as **the player's** turns, so its lines are `{{user}}:` — write
them as what _you_ say, not what the character says back.

## Settings that matter to a pack

`PATCH /api/settings` accepts partial objects. Relevant keys:

- `worldInfo.globalBooks`: string array of book ids that scan in every chat.
- `personas` / `activePersonaId`: the persona list. `persona` (singular) is a validation error.
- `imageGeneration`: `enabled`, `backend`, `baseUrl`, `model`, plus sampler settings.

## Profiles and scope

A profile is a data scope: its own characters, chats, world info, personas, images and configuration
are separate from every other profile. Both import routes therefore land in the **active profile**
unless asked for `shared`, which makes the item visible in every profile:

- `POST /api/characters/import?scope=shared`
- `{ "scope": "shared" }` in the `/api/worlds/import` body

**Personas live in `settings.json`, not as files per item**, and `GET /api/settings` returns the merged
list with a `scope` on each entry. Writing the profile's list always starts from the profile's own
entries, so a shared persona never gets copied into a profile. A whole cast pack is usually
profile-scoped; a protagonist persona the user plays everywhere may belong in `shared`.

Switching profiles answers `409 PROFILE_BUSY` while a generation is running.

## Reading the app's state when the user asks

- `GET /api/characters`: what is already in the library, so a pack does not duplicate it.
- `GET /api/worlds`: existing books.
- `GET /api/settings`: personas, world books, image backend. Never contains API keys — the client
  only ever sees `hasKey`.

All of these need the session cookie from login; a `curl` against a password-protected instance
returns `401` until the cookie is present. `GET /api/settings` returns `{ "settings": … }`, and
`PATCH /api/settings` takes the patch body directly.

The test suite's helper for a logged-in client is under `apps/server/src/testHelpers/`; for a manual
`curl`, log in once and reuse the cookie jar:

```bash
curl -c cookies.txt -X POST -H "Content-Type: application/json" \
     -d '{"password":"…"}' http://localhost:8000/api/auth/login
curl -b cookies.txt http://localhost:8000/api/characters
```
