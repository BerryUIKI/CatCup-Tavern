# RFC 0005 — Game mode: three modes on the front, a declarative plugin host behind it

- **Issue:** [#169](https://github.com/BerryUIKI/CatCup-Tavern/issues/169)
- **Status:** Proposed 2026-11-24
- **Touches:** `packages/shared/src/schemas/`, `apps/server/src/game/`, `apps/server/src/routes/`, `apps/server/src/storage/`, `apps/server/src/app.ts`, `apps/web/src/components/`, `apps/web/src/store/`, `docs/API.md`, `docs/DATA-FORMATS.md`, `docs/LIMITATIONS.md`, `docs/MILESTONES.md`, `docs/SECURITY.md`, `CHANGELOG.md`

## The problem

CatCup can hold a conversation. It cannot run a game.

Everything the app knows how to do with a reply is "the model writes a message, the person writes one back". There is no way to say what is true in the world beyond the text of the conversation, nothing that persists as progress rather than as history, and no third surface beside the chat. A character card can describe a strict tutor beautifully; when she says "hold that pose for five minutes", nothing happens on screen.

This RFC is the design for closing that gap: three modes on the front, and a plugin host behind them that third-party games — including a full commercial-scale one — can be installed into.

## What the reference game is made of

Recovered from a crawl of a mature browser game of this shape (`data/*.json`, its design notes, its partner documentation). Used here for structure only; see "Content policy".

| Subsystem                                      | Size                          | Shape                                                                                                  |
| ---------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| Degrees → Courses → Classes → Tasks → Variants | 16 / 29 / 116 / 531 / 5 kinds | Pure data; prerequisites and tiers gate progression                                                    |
| Task types                                     | 8                             | instant, duration, timed, metronome, beat-track, obedience, step-counter, composite                    |
| Punishments                                    | 101                           | Same task shape, one task each, dismissible for a currency                                             |
| Clubs                                          | 25                            | Perks that multiply rewards, grant items or play audio                                                 |
| Items                                          | 205                           | Slots, types, locations, stats, dress-up art                                                           |
| AI partners                                    | 7                             | 13 prompt sections, an injected per-turn state block, 29 tools, a 0–6 mood scale, TTS voices, mood art |
| Progress                                       | —                             | Currency, per-entity grades, a weekday schedule, attendance, achievements                              |
| Media                                          | —                             | 1,419 images, 238 audio files, layered wardrobe art, affirmations, media feeds                         |
| Hardware                                       | —                             | Intimate-device bridges, each behind its own tool                                                      |

Two things about that table matter more than its length.

**The AI is optional and thin.** The partner's job is: read a state line, talk in character, and call one of 29 tools. The tool list is the product — the reference's own help page warns that a partner written without the tool block "talks a good game and nothing happens on screen". The curriculum, currency and schedule all work with no model at all.

**The state is small.** Mood, a handful of session fields, a currency counter, a completion set. Everything heavy is content and media.

## What CatCup has today

Verified against this checkout.

| Reference subsystem               | CatCup                                                                                                                | Verdict     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------- |
| Partner persona and voice         | Cards with four text fields, `extensions.depth_prompt` injected at depth, per-character TTS voice                     | **Reuse**   |
| Partner remembers                 | Rolling summary in `extra.memory`, `{{summary}}`                                                                      | **Reuse**   |
| Buttons that do something         | Quick Replies: `/send`, `/sys`, `/echo`, `/trigger`, `/continue`, `/regenerate`, `/run`                               | Reuse       |
| Mood, timers, penalising, devices | Nothing — no tool calling on any adapter, no directive that renders a countdown                                       | **Missing** |
| Curriculum, currency, grades      | Nothing — no server or SPA code mentions any of them                                                                  | **Missing** |
| Task runner and minigames         | Nothing                                                                                                               | **Missing** |
| Inventory, wardrobe, dress-up     | Nothing                                                                                                               | **Missing** |
| Media library                     | TTS synthesises speech; generated images are served from `data/user/images/`; card assets are stored but never served | **Missing** |
| Third-party content               | None — no plugin loader, registry or manifest                                                                         | **Missing** |
| Second surface                    | The main pane is `selectedGroup ? GroupChatView : ChatView`; everything else is a dialog                              | **Missing** |

## The model: three modes on the front, two switches behind

The three modes the person sees are real, but they are not the same kind of thing, and pretending otherwise would produce three parallel generation paths.

| Mode      | Anchored to                    | What it adds                                                                                      |
| --------- | ------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Chat**  | one chat                       | nothing — the baseline                                                                            |
| **Story** | one chat                       | a director: who is on stage, what the scene is, and a short list of choices — **shipped in #151** |
| **Game**  | a saved game under the profile | a plugin: rules, state, tasks, progress — and chats that live inside the save                     |

Behind that, two independent switches:

```ts
// chat_metadata, both absent on every existing chat
director?: DirectorConfig      // present → this chat is Story
game?: { gameId: string }      // present → this chat belongs to a game
```

They compose. A chat with both is a game with a plot. A game with no chat in it at all is simply a game — the curriculum and the task runner work with no conversation involved.

**Why they are not one switch.** They constrain different things, and their failure modes are orthogonal:

- The director constrains **text**. It decides what should happen next. When the model drifts, the story weakens — the app still works.
- The plugin constrains **state**. It decides what is true. When the model drifts, the game breaks — it claims a reward that was never granted.

So Story is a prompt-layer concern that degrades gracefully, and Game is a state-layer concern that needs an authority chain. Building them as one mechanism would mean either the game loses its authority or the story gains machinery it does not need.

**Why Game is anchored to a save, not a chat.** Currency, inventory, attendance and unlocks are shared across every conversation that belongs to that game. Stored on a chat, two chats in the same game would each have their own copy. The save is the unit; a chat inside it holds only `gameId`.

## Why a declarative plugin host

A plugin could carry code. It should not.

The decisive argument is the surface area, not the effort. A JavaScript plugin needs a sandbox, a CSP that the app currently does not set (`tauri.conf.json` has `"csp": null`), an RPC bridge, a permission model, and a security review process — for content that is, by its nature, untrusted third-party input. That is a real attack surface added to an app that runs on a loopback server holding the person's entire chat history.

The reference game's 29 tools are **primitives**: set a mood, start a timer, pick at random, add a punishment, deduct a currency, play a file, show a picture. None of them needs arbitrary code. A plugin can declare which primitives it uses and what shape their arguments take, and the host executes them.

What a declarative plugin buys:

- **No sandbox, no CSP change.** The host is the only code that runs.
- **Server-side execution.** State mutation happens where persistence and file locking already are.
- **Reviewable packages.** A plugin is JSON and media; it can be diffed and audited before it is installed.
- **One code path.** The built-in director is itself a plugin, so a first-party feature and a third-party pack load through the same loader, surface and debugger.

What it costs: no custom UI logic. That is handled by the view types below, and the escape hatch for genuine arbitrary UI is the SillyTavern extension sandbox in M3, which is a separate system for a separate purpose.

## The plugin format

A plugin is a ZIP with a manifest and its content. `.catcupgame` is the extension; the container is the same one `.catcup` and `.charx` already use, so the existing ZIP reader and its entry limits apply unchanged.

```
my-game.catcupgame
├─ manifest.json
├─ state.json           state keys, types and defaults
├─ tools.json           the primitives this plugin uses
├─ views.json           which host views to render, and with what content
├─ content/*.json       entities (classes, courses, punishments, items, clubs…)
└─ media/
   ├─ images/…
   └─ audio/…
```

```jsonc
// manifest.json
{
    "format": "catcup.game",
    "formatVersion": 1, // the host's compatibility promise is on this number
    "id": "example-course-pack",
    "name": "Example Course Pack",
    "version": "1.0.0",
    "namespace": "ex", // every state key and content id is prefixed with this
    "engine": { "min": "0.4.0" }, // the host refuses a plugin that needs a newer engine
    "state": "state.json",
    "tools": "tools.json",
    "views": "views.json",
    "content": ["content/classes.json", "content/courses.json"],
    "media": "media/index.json"
}
```

Three rules make the format safe to promise compatibility for:

1. **`formatVersion` is the contract.** A host reads every version it has ever published. New optional fields are minor; anything that changes meaning is a new version, and old ones keep working.
2. **`engine.min` is checked on install.** A plugin that needs a newer host is refused with the host's version named, rather than failing mysteriously later.
3. **Everything is namespaced.** State keys and content ids carry the plugin's namespace, so two plugins cannot collide and a state write cannot reach another plugin's data.

Unknown fields are preserved everywhere, as they are for cards and presets.

### Tools

A tool is a declaration, not code. The model sees the declaration; the host executes the effect.

```jsonc
// tools.json
{
    "start_timer": {
        "description": "Put a countdown on screen. Use for anything the player must do for a set time.",
        "params": {
            "seconds": { "type": "integer", "min": 5, "max": 3600 },
            "reason": { "type": "string", "max": 200 }
        },
        "required": ["seconds"],
        "effect": { "kind": "directive", "directive": "timer" }
    },
    "add_credits": {
        "description": "Award or deduct credits.",
        "params": { "amount": { "type": "integer", "min": -1000, "max": 1000 } },
        "required": ["amount"],
        "effect": { "kind": "state", "key": "credits", "op": "add", "by": "$amount" }
    },
    "pick_one": {
        "description": "Choose one option at random. The result is final.",
        "params": { "options": { "type": "string" } },
        "required": ["options"],
        "effect": { "kind": "random", "from": "$options", "separator": ";" }
    }
}
```

The effect kinds that cover the reference game's whole tool surface:

| Kind        | What it does                                                               |
| ----------- | -------------------------------------------------------------------------- |
| `state`     | Add, set or toggle a namespaced state key, optionally clamped              |
| `list`      | Append to or remove from a namespaced list (goals, punishments, inventory) |
| `directive` | Emit a UI directive: a countdown, a picture, an audio clip, a feed         |
| `random`    | Pick from a list server-side; the result is final and shown                |
| `dismiss`   | End the running task, with a cost                                          |

A tool that wants to do something the effects cannot express is a missing effect, not a reason to allow code.

### Views

The host owns the rendering. A plugin says which view to use and where its content comes from.

```jsonc
// views.json
{
    "main": {
        "type": "entity_list",
        "title": "Classes",
        "source": "content/classes.json",
        "groupBy": "tier",
        "detail": "class-detail"
    },
    "class-detail": {
        "type": "entity_detail",
        "media": "image",
        "taskRunner": "task-runner"
    },
    "task-runner": { "type": "task_runner" },
    "today": { "type": "schedule", "source": "content/classes.json" },
    "progress": { "type": "progress", "grades": ["class", "course", "degree"] }
}
```

The host provides nine view types, chosen so that the reference game's ~30 screens map onto them with no plugin code:

| View type       | Covers                                                                     |
| --------------- | -------------------------------------------------------------------------- |
| `entity_list`   | Courses, classes, punishments, clubs, inventory, achievements              |
| `entity_detail` | One entity: description, media, prerequisites, actions                     |
| `task_runner`   | The six task kinds below                                                   |
| `schedule`      | A weekday grid and attendance, computed on read from completion timestamps |
| `progress`      | Currency, grades per level, completion                                     |
| `gallery`       | A media grid with a lightbox                                               |
| `wardrobe`      | Layered images composed from declared slots                                |
| `meter`         | Live state gauges (mood, arousal, whatever the plugin declares)            |
| `feed`          | A scrolling media feed with a duration                                     |

Task kinds the runner implements: `instant`, `duration`, `timed`, `sequence` (a list of spoken or written steps the person confirms one by one), `rhythm` (metronome and beat-track unified — audio plus timed highlights), and `counter`. A `composite` task is a task that references other tasks and runs them in order; it needs no new renderer.

**The runner is the one place where the host must do real work of its own**: `rhythm` needs audio that stays in sync with highlights, and `sequence` needs an audio queue with per-step confirmation. Both are host components written once, not plugin code.

### Media

The plugin carries its own assets; the host serves them read-only.

- `media/index.json` declares every asset by id, type and path. The loader validates the index against the archive at install, so a missing file is reported at install rather than mid-task.
- A read-only route serves `media/**` from one plugin, resolving paths inside that plugin's folder only — the same rule `resolveInside` already applies to the data directory.
- The host does not interpret content. It knows an asset is `image`, `audio` or `font`.
- Nothing is copied out of the plugin folder, and nothing is written into it.

This is what makes a large reference-scale pack possible without putting a single byte of its art in this repository.

## State and saves

A game save is a profile-scoped directory. A profile can hold many, which is what makes "a different pack" and "start over" ordinary actions rather than destructive ones.

```
data/profiles/<profile>/games/<gameId>/
├─ game.json              plugin id, version, display name, created
├─ state.json             current state, namespaced
└─ saves/
   ├─ 0001-manual-<label>.json
   ├─ 0002-auto-<reason>.json
   └─ …
```

Each save is a **full state copy**, not a diff. Game state is small — kilobytes — and a copy is simpler to write, simpler to inspect and immune to a corrupted chain. A save also records an optional chat anchor:

```jsonc
{
    "id": "0002",
    "kind": "auto",
    "reason": "task-completed",
    "at": "2026-11-24T21:05:00.000Z",
    "label": "Finished Anal Basics 1",
    "state": {
        /* full snapshot, namespaced */
    },
    "anchor": { "chatId": "…", "messageIndex": 42 } // optional
}
```

**Checkpoints, not every step.** Saves land when something worth returning to happened: a task completed, an entity unlocked, a story beat reached, or a manual save. The scheduler is not involved — a checkpoint is written by the same request that changed the state.

**A ring with a floor.** Automatic saves keep the most recent N (default 10) and evict the oldest. Manual saves are never evicted. N is a per-save setting, so a heavy player can raise it.

### Rolling back

Two behaviours, both supported, because both needs are real:

| Mode               | What moves back                                      | Use                                   |
| ------------------ | ---------------------------------------------------- | ------------------------------------- |
| **State only**     | `state.json` only; the chat is untouched             | Correcting an error in the game layer |
| **State and chat** | `state.json`, and the chat is branched from `anchor` | Undoing a decision you regret         |

The second is cheap because branching already exists: `branchChat` copies a conversation up to an index into a new chat. Rolling back to a save with an anchor branches from `anchor.messageIndex` and points the save at the branch. The original chat is never truncated, so a rollback is itself reversible.

A save without an anchor can only roll back its state; the UI says so rather than silently doing less than asked.

## How a tool call is produced without tool calling

No adapter in CatCup sends `tools`, and adding that is a large piece of provider work across six dialects. It is also not needed for this design.

The model emits a **line-oriented sentinel block**. This is not a new invention: the director shipped exactly this for choices in #151 (`apps/server/src/director/choices.ts`), including the truncation-tolerance rule this section needs, so the parser's guarantees are already proven in this codebase:

```
她垂下眼睛。「十次，五分钟。现在。」

<<<ACTION>>>
start_timer seconds=300 reason=撑住
add_credits amount=5
<<<END>>>
```

This is chosen for the reason the shipped parser states: a streamed reply truncates. Every complete line before the cut is still a valid action; an empty or malformed block means "no actions this turn" and never an exception. JSON would lose the whole block to one unbalanced quote.

The order of operations matters and is fixed:

1. The server strips the block from the text that gets stored and shown.
2. Each line is validated against the plugin's tool declarations — unknown name, missing required parameter, value out of range, all rejected by name.
3. Only then are effects applied, in order, in one state write.
4. One rejected line rejects the block, and the reply is stored unchanged with no actions. A half-applied turn is worse than an ignored one.
5. A rejected block is surfaced to the debugger, never to the conversation.

Native tool calling remains a worthwhile future capability — it improves reliability and unlocks M3 — but it is not on this design's critical path, and a plugin written today keeps working when it arrives.

## The modes on screen

Navigation stays one level deep, as it is now:

| Where       | What                                                          |
| ----------- | ------------------------------------------------------------- |
| Sidebar     | **Characters**, **Groups**, **Games**                         |
| Chat header | A **Chat / Story** toggle; the director's panel opens from it |
| Game view   | The plugin's declared views, its chats, and its save controls |

The three modes are visible as three ways in — a character, a group, or a game — plus the story toggle on any conversation. That is the front end the design promises without inventing a global mode switch that would have to be reset when you move between them.

## Content policy

The engine is CatCup's. Content is not.

This repository is AGPL-3.0-only: anything committed here is licensed to everyone, permanently. Therefore:

- **No third-party game content in this repository** — no entity text, no art, no audio, no prompts. A pack is a file the person installs, and the licence boundary falls on the pack, not on the repo.
- **Fixtures in the repository are authored for the tests.** A minimal synthetic course pack, written here, is the only content CI ever sees.
- **The reference crawl is a design source, not a distribution channel.** Its structure — the entity shape, the task/variant model, the parameter convention, the mood scale — is reimplemented. Its text and art are not copied into any commit.

A person who is licensed to redistribute a given pack can install it; what they do with it afterwards is outside this repository's licence.

## What this is not

- **Not a script engine.** No plugin runtime, no `eval`, no sandbox. M3's SillyTavern extension host is a separate system.
- **Not a device bridge.** Intimate-device integrations are out of scope. They are hardware with a physical-failure story the app would have to own.
- **Not a change to existing chats.** A chat with no `director` and no `game` key produces the same prompt and the same file after a reply as it does today. A test asserts it.

## Open questions

1. **Does the story toggle belong in the header or on the chat's creation?** Header keeps it discoverable and reversible; a creation choice keeps the header clean. Leaning header, since a story is something a conversation becomes.
2. **Can a game own more than one chat?** The design allows it (`gameId` is on the chat). Whether the UI exposes "another conversation in this game" — a chat per partner, say — is a product question, and cheap either way.
3. **Does the director ship as a built-in plugin or stay as host code?** Settled by events: Layer 1 shipped as host code in `apps/server/src/director/` (#151) before this RFC existed, so the director is host code and this RFC does not move it. The consequence is that Story mode and a game plugin are two mechanisms, not one — which is acceptable, because they were already two switches, and it removes the plugin format's compatibility promise from a feature that has already shipped.
4. **How does a plugin get a view the host does not have?** Today the answer is "it doesn't". That is the right answer until a real pack needs otherwise, at which point the correct move is a new host view type, not plugin code.
5. **Where do plugin packages live?** Installed under the profile, so a save's plugin version is stable. Whether the shared layer (RFC 0001) may hold a pack every profile sees is worth settling when the first person wants it.

## Acceptance criteria

### Plugin host

- [ ] A `.catcupgame` package installs, lists, and uninstalls from the app.
- [ ] `formatVersion` and `engine.min` are checked on install; an incompatible pack is refused with both versions named.
- [ ] Every media id in `media/index.json` is verified present at install, and a missing one fails the install rather than the first task.
- [ ] `media/**` is served read-only from one plugin's folder, and a path escaping that folder is rejected.
- [ ] Two plugins declaring the same entity id or state key both work, because both are namespaced.
- [ ] An unknown manifest field survives a re-read.

### Game state

- [ ] A game save creates, loads, and survives a restart.
- [ ] A profile holds several saves, and a profile switch shows only that profile's games.
- [ ] An automatic checkpoint is written by the request that completed a task, with no scheduler involved.
- [ ] Automatic saves evict oldest-first past the cap; manual saves are never evicted.
- [ ] Rolling back "state only" leaves the chat byte-identical.
- [ ] Rolling back "state and chat" branches the chat from the anchor and leaves the original intact.

### Tools and state

- [ ] An action block is stripped from stored and displayed text.
- [ ] All five effect kinds apply in order in one state write.
- [ ] An unknown tool, a missing required parameter, or an out-of-range value rejects the whole block; the reply is stored unchanged and no state changes.
- [ ] A truncated block applies the complete lines before the cut.
- [ ] The debugger shows every proposed action, every rejection and every state change for a turn.

### Views

- [ ] All nine view types render declared content with no plugin code.
- [ ] The task runner completes `instant`, `duration`, `timed`, `sequence`, `rhythm` and `counter`, and a `composite` runs its children in order.
- [ ] A dismissed task is recorded as dismissed, not completed, and its cost is applied.

### Modes

- [ ] A chat with no `director` and no `game` key produces the same prompt and the same file as today.
- [ ] A chat can be a story, a game chat, or both, and each combination behaves as described.
- [ ] A game with no chat in it still runs the curriculum and the task runner with no provider configured.

### Docs

- [ ] `docs/API.md`, `docs/DATA-FORMATS.md` (the `game` metadata key, `data/games/` and the package format), `docs/LIMITATIONS.md`, `docs/MILESTONES.md`, `docs/SECURITY.md` and `CHANGELOG.md` are updated in the same change.
