---

name: novel-to-catcup
description: Distil a novel, script or any long text into CatCup Tavern importable files — one character card per character, one world info book, plus image prompts for each card's portrait — and walk the user through generating or supplying those portraits. Use when the user gives a book, fanfic, transcript or worldbuilding document and wants roleplay material out of it, or asks to turn a text into cards / world books / a playable cast.
version: 1.0.0
---

# Novel → CatCup import pack

Turn a long text into a pack of SillyTavern-shaped files that CatCup imports as-is, then help the
user give each card a portrait.

**The central rule: a card describes the character the AI plays.** If the user wants to _play_ a
character from the text, that is a **persona**, not a card — see [step 6](#6-if-the-user-wants-to-play-someone).
Getting this backwards is the most common mistake with this workflow.

Deliverable:

```
<pack>/
├── characters/<Name>.json     one V2 card per character
├── worlds/<Book>.json         one world info book, entries keyed by uid
├── persona-<Name>.md          persona text, one per playable protagonist
├── portraits/prompts.md       one image prompt per card
└── README.md                  import commands, table of contents, content notes
```

## 0. Before writing anything

Read the source. If it is long, read it in parts and take notes — you are looking for _recurring
entities_, not plot summary.

Then decide these four things, and say them to the user in one short paragraph:

| Decision           | How to settle it                                                                                                                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Language**       | Cards follow the source's language. CatCup is English-first for _UI copy_, but card content is whatever the work is written in. A Chinese novel gets Chinese cards.                       |
| **Cast**           | Characters named more than a handful of times, plus anyone the reader would expect to meet. Epithet-only characters ("老大") get the epithet as `name` and the fuller form in `nickname`. |
| **Age & content**  | Record each character's age from the text. **Any character who is a minor in the source gets a non-sexual card, and this is not negotiable** — see [content limits](#content-limits).     |
| **Persona target** | Which character, if any, the user wants to _play_. Ask if the request mentions playing a role.                                                                                            |

Create the pack folder somewhere inside the session's folder — `distill/<slug>/` — never in `data/`.
`data/` is gitignored runtime state, and a pack under it is invisible to the user and to git.

## 1. One card per character

Write V2 cards: `{ "spec": "chara_card_v2", "spec_version": "2.0", "data": { … } }`. CatCup's
parser accepts the V2 wrapper, the V3 wrapper, a bare `{ data: … }` object and a legacy flat card,
but V2 is what the app writes back, so it round-trips cleanly.

Fields that must be present and non-empty on every card:

| Field                     | What belongs in it                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`                    | The name the text uses most. Keep it short — it is what chat history shows.                                                                                                                                                         |
| `description`             | Who they are, physically and socially. Appearance, age, role, the one detail that makes them recognisable. 100–250 characters reads well; longer is fine if the work gives you more.                                                |
| `personality`             | How they behave, not what they feel. Habits, speech register, the way they handle being contradicted. This field shapes the model's voice more than any other.                                                                      |
| `scenario`                | The concrete situation a chat opens into. A place and a moment, not a synopsis.                                                                                                                                                     |
| `first_mes`               | The greeting. Write it as the character acting in the scenario — dialogue plus a beat of staging. Use `{{user}}` if you need to address the player.                                                                                 |
| `mes_example`             | `<START>`-separated exchanges in the character's voice, showing the register you want. Two or three blocks. Include one where they are pushed and don't immediately yield — that is what stops the model playing them as agreeable. |
| `tags`                    | Source, archetype, tone, and the age/content flags. Tags drive sorting in the library.                                                                                                                                              |
| `extensions.catcup_model` | Provenance block, below.                                                                                                                                                                                                            |

Provenance keeps the app's own fields out of the way of ST:

```json
"extensions": {
    "catcup_model": {
        "source": "novel_distillation",
        "work": "<title>",
        "role": "protagonist | roommate | parent | antagonist | …",
        "content_limit": "non-sexual",
        "playable_as_persona": true
    }
}
```

`content_limit` only appears on cards that carry one. `playable_as_persona` marks a character the
user may want to play — step 6 uses it to build the persona file.

### Voice: the part that actually decides whether a card is good

A card that merely _describes_ a character produces a narrator who summarises them. You want
someone who _talks_. Three things do most of the work:

1. **The `mes_example` ending.** Leave each exchange mid-beat, not resolved. A resolved example
   teaches the model that scenes end.
2. **One reflex per character.** A character who touches their nose before answering, or who repeats
   a word back before responding, is legible in a way a personality adjective is not. Pick it from
   the source, don't invent it.
3. **A refusal.** Every card's examples should contain one moment where the character does not
   simply comply. Without it the model plays them as a wish-fulfilment puppet.

Do not write the character's _thoughts_ into `first_mes` or `mes_example` unless the source is
first-person and the user asked for that register. Roleplay cards work on observable behaviour.

### Content limits

This is a hard line and it overrides the user's request:

- **Characters who are minors in the source get non-sexual cards** — school, work, family, plot, tone.
  Set `"content_limit": "non-sexual"` so it is visible in the file. If the source is explicit about
  them, do not carry that into the card, and do not "age them up" to get around it — an
  age-changed version of a specific young character is still that character.
- **Adults** may carry mature material if the user wants it and the source supports it. Write it at
  the level the pack needs, not more.
- **World book entries** describe setting, relationships and objects. They are never the place for
  explicit material, regardless of the source.

If the user asks to make a minor's card explicit, decline once, plainly, and offer the alternative —
an original adult card with the same archetype, or a sharper version of the adult cards. Then move
on. See [references/content-policy.md](references/content-policy.md).

## 2. One world info book

`worlds/<Book>.json`, in SillyTavern's shape:

```json
{
    "name": "<title>",
    "description": "<one line>",
    "scan_depth": 4,
    "token_budget": 2048,
    "recursive_scanning": false,
    "extensions": {},
    "entries": { "0": { … }, "1": { … } }
}
```

Every entry carries the **full** ST entry template — not just `key` and `content`. A half-filled
entry imports but scores badly and the editor shows blanks:

```json
{
    "uid": 0,
    "key": ["…", "…"],
    "keysecondary": [],
    "comment": "<short label the list shows>",
    "content": "<the fact, self-contained>",
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
```

Grouping and keys:

- **One entry per person, place, object or standing relationship.** Not per scene, not per chapter.
- `key` holds every name a player might type: full name, nickname, epithet, rank. 3–8 keys.
- `comment` is a human label — `"<Name> · 概要"`, `"地点 · 鱼市"` — because the world info list
  shows `comment` and nothing else.
- `content` must stand alone. Write it as if the reader has not read the book.
- `constant: true` for exactly one entry: the protagonist's overview, so the model always knows who
  it is playing with. Everything else stays `false`.
- `position: 0` (before character) for most; `1` (after character) for tone/setting material.
- Provenance goes in `extensions`: `{ "catcup_model": { "source": "novel_distillation", "work": "<title>", "chapter": "…" } }`.

Ten to thirty entries is the useful range for a novel. More than that rarely improves play and costs
context every turn.

## 3. Write the pack README

`README.md` in the pack folder, covering:

- The file tree.
- **Import commands** — see step 5.
- **The two ways to play**: AI plays the cast (open a card) vs. user plays someone (persona).
- **A table of the cast**, one row each.
- **Content notes** naming which card, if any, is limited and why.

## 4. Portraits: prompts first, generation second

CatCup can draft an image prompt from a chat (`POST /api/images/draft`) and, on newer builds, from the
card itself (`POST /api/images/draft-portrait`, which reads `description` and `personality` and needs
no chat and no image backend). Neither is the point of this step: a _pack_ wants one consistent set of
prompts across the whole cast, in one file the user can edit, not one dialog at a time.

Two consequences for this workflow:

1. Always write the portrait prompts yourself, into `portraits/prompts.md`. If the app is new enough
   to have `draft-portrait`, mention it as a per-card alternative; do not send the user to
   "Draft from chat" for a card that has no history.
2. Ask the user whether they have an image backend before assuming generation. Both draft routes work
   without one — drafting is a chat-model call, so a prompt is always obtainable. If they have no
   backend, the prompt list _is_ the deliverable; they can paste it into anything.

Write prompts in this shape, one block per card:

```markdown
## <Name>

**Prompt**

> 1girl, short curly black hair, round glasses, …, upper body, looking at viewer, <style tags>

**Negative**

> lowres, bad anatomy, bad hands, text, watermark

**Notes**

> What to keep if the backend mangles it — the glasses, the posture, the palette.
```

Derive every visual tag from the card's `description`. Keep the prompt under ~75 tokens before style
tags; longer prompts dilute. Use the work's own period and setting for wardrobe.

For a **full-body / portrait orientation**, say so: `portrait`, `upper body` or `cowboy shot`, and a
square 512×512 or 832×1216 for a card avatar.

See [references/catcup-import.md](references/catcup-import.md) for every route and its field rules.

### If they do have a backend

The pipeline in CatCup is: **generate → save to gallery → promote or attach**. There is no
"generate an avatar" call — the picture and the card data are one file, so a portrait has to be a PNG.

- `POST /api/images/generate` with `{ "characterId": "…", "prompt": "…" }` writes to the gallery and
  returns `{ image: { file, url, … } }`.
- On a build with `POST /api/images/portrait`, `{ "characterId", "file" }` promotes that gallery
  image to the card's picture. A non-PNG is refused (`IMAGE_PORTRAIT_FORMAT`) — **generate PNG
  output**; a JSON card becomes a PNG card and the JSON file is deleted; a previous picture is not
  kept.
- Without that route, `GET /api/characters/:id/avatar` serves the card file itself, so a **JSON card
  has no avatar**, and `PATCH /api/characters/:id` has no image field either.

So on a build without the portrait route, a generated image becomes a card portrait only by being
**embedded into a PNG card**:

```bash
node .claude/skills/novel-to-catcup/scripts/embed-portrait.mjs card.json portrait.png out-card.png
```

That script stamps `chara` and `ccv3` `tEXt` chunks exactly as CatCup writes them, so the result
imports as a PNG card with its metadata and its avatar in one file. It was checked byte-identical
against the app's own `writePngCard`; to re-check after a card-writer change:

```bash
pnpm --filter @catcup/server build   # in a CatCup checkout
CATCUP_REPO=/path/to/CatCup-Tavern \
  node .claude/skills/novel-to-catcup/scripts/verify-embed.mjs card.json portrait.png
```

Re-importing the PNG adds a new card rather than replacing the JSON one (imports get a ` (2)` suffix
on a name collision), so tell the user to delete the JSON card first if they want a clean library.

Offer to run the generation yourself only if the settings show an enabled backend; otherwise hand
over `prompts.md`.

## 5. Verify, then hand over the import commands

Before reporting done, run the pack validator (paths are relative to this skill's folder):

```bash
node .claude/skills/novel-to-catcup/scripts/validate-pack.mjs <pack-dir>
```

It checks every card has the required non-empty fields and a V2/V3 spec, and every world entry has a
unique numeric `uid`, a non-empty `key` array, non-empty `content`, and the full ST template. Exit code
1 means it found problems; fix them and rerun. Do not report the pack as finished while it fails.

Then give the user the commands. CatCup's import endpoints are multipart and take several files per
request:

```bash
curl -F "files=@distill/<slug>/characters/<Name>.json" \
     -F "files=@distill/<slug>/characters/<Other>.json" \
     http://localhost:8000/api/characters/import
```

The world book is **not** multipart — it is a JSON body, and the book id comes from `fileName` or from
the book's own `name`:

```bash
jq -n --slurpfile book "distill/<slug>/worlds/<Book>.json" \
      '{ fileName: "<Book>", book: $book[0] }' |
curl -X POST -H "Content-Type: application/json" -d @- \
     http://localhost:8000/api/worlds/import
```

`POST /api/worlds/import` expects `{ fileName?, book: <the world info object> }`. Some CatCup pages
describe the old multipart shape — the route is the authority.

**Importing a world book does not enable it.** Say so, and give the enable call:

```bash
curl -X PATCH -H "Content-Type: application/json" \
     -d '{"worldInfo":{"globalBooks":["<Book>"]}}' \
     http://localhost:8000/api/settings
```

Mention the UI path too — Library → Import, and Settings → World Info — because most users will use
the browser.

## 6. If the user wants to play someone

A persona is how the model refers to the player. What it can carry depends on the build:

- **Older builds:** `name` and `description` only — no personality, no lorebook, no avatar.
- **Newer builds:** `personality`, `scenario` and `mesExample` as well, joined into the one persona
  slot as labelled paragraphs, with the examples read as _the player's_ turns. Those builds also
  have `POST /api/personas/from-card` (`{ characterId, scope? }`) behind a **Play as this
  character** button in the library, which copies a card into a persona — `description`,
  `personality`, `scenario` and example messages — leaving `first_mes` behind on purpose, because a
  card's opening line belongs to the assistant and a persona carrying it makes the model greet
  itself. The persona is a copy; editing it never touches the card.

Either way, write `persona-<Name>.md` by hand. The button is a per-card convenience that copies the
card's own third-person description; a pack wants a persona in the character's **first person** voice,
which is what a player actually needs. Mention the button when the app has it, then hand over the file.

Write `persona-<Name>.md`:

```markdown
# Playing <Name>

## Where to paste

Settings → Persona → New persona

- **Name**: `<Name>`
- **Description**: the block below

## Description

<first-person paragraph: who I am, how I sound, what I do when pressed>

## With several personas

<table of name → when to pick it>

## Notes

- The description is sent every turn — keep it short.
- No avatars, no attached lorebook.
- If this build's personas carry `mesExample`, those lines are read as **my** turns: write `{{user}}:`
  as what I say, never as the character's reply.
- CatCup has no "reply as me" (impersonation), so the user types their own turns.
```

The paragraph should carry the same _reflex_ you gave the card (step 1) and one thing the character
is bad at, so the model has something to push against.

Then explain the two modes:

| Mode                   | Setup                                                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AI plays the cast**  | Open a card. Whoever's card is open is who the AI plays.                                                                                                                                           |
| **User plays someone** | Open a _different_ character's card, then switch the chat's persona to the one you wrote — the selector in the chat header, stored as `chat_metadata.persona_id` so it travels with the chat file. |

And for a scene with everyone present: build a **group chat** from the cards. Group generation swaps a
different member in per turn, and history lines from other speakers get a `Name:` prefix, so the cast
stays distinguishable. The group chat header pins a persona the same way.

## 7. Report

State, in this order:

1. Where the pack is, and how many cards / entries / prompts it has.
2. The validator's result, verbatim if it failed.
3. Which card (if any) is content-limited and why.
4. The import commands.
5. Whether portraits are prompts-only or generated.

Do not claim the files were imported — you wrote files, the user imports them.

## Related

- [references/card-writing.md](references/card-writing.md) — voice, register, and what to leave out.
- [references/catcup-import.md](references/catcup-import.md) — every import route and its field rules.
- [references/content-policy.md](references/content-policy.md) — the age and explicitness lines.
- Canonical formats live in the CatCup repo's `docs/DATA-FORMATS.md`; the import contracts in
  `docs/API.md`. Where this skill and those pages disagree, the route code wins — say so if the user
  hits a mismatch rather than silently working around it.

## Three ways to get a pack, and when each is right

They are complementary, not alternative implementations. If the user already has one, do not talk
them into another.

| Path                               | What it is                                                                                                                                | When it fits                                                                            |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **This skill**                     | Static files in the repo plus three scripts. Runs in any checkout, needs no server, no provider and no build.                             | The user has the source, or wants portraits, personas and a validated pack in one pass. |
| **`GET /api/distill/skill`**       | The app serves a generated, **prompt-only** skill as a ZIP, built from the runtime's own prompt constants, with a drift test. No scripts. | The user runs CatCup and wants the current prompts to hand to an assistant elsewhere.   |
| **In-app distillation** (RFC 0002) | **Distil from a book** in the app, against a configured model, with a review sheet.                                                       | The user wants it done inside CatCup, fast, and is happy with what a model extracts.    |

All three end in the same thing: ordinary V2 cards and an ordinary world info book. Say which one you
used, and do not describe them as equivalents — the prompt-only export and this skill drift
independently, and the in-app run produces what a model extracts rather than what a writer shapes.
