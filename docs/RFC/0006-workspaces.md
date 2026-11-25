# RFC 0006 — Workspaces: writing, authoring and the developer panel

- **Issue:** [#170](https://github.com/BerryUIKI/CatCup-Tavern/issues/170)
- **Status:** Proposed 2026-11-24
- **Touches:** `apps/server/src/manuscript/`, `apps/server/src/routes/`, `apps/server/src/storage/`, `packages/shared/src/schemas/`, `apps/web/src/components/`, `apps/web/src/store/`, `docs/API.md`, `docs/DATA-FORMATS.md`, `docs/LIMITATIONS.md`, `docs/MILESTONES.md`, `CHANGELOG.md`

## The problem

RFC 0005 gives a conversation three modes. This RFC covers the three **workspaces** — the places you go to make something rather than to be somewhere.

They are a different layer, and conflating them with the modes is the mistake this document exists to prevent. A mode is a property of a conversation. A workspace is a property of the app: you do not "switch a chat into Writing mode"; you open the manuscript and work on it while conversations sit untouched.

They are also **downstream**. Writing produces a novel from conversations that already happened. Authoring produces a card. The developer panel watches a plugin run. Each presupposes something that does not exist yet, which is why the milestone order puts them after the engine they consume.

| Workspace     | Consumes                  | Produces                       |
| ------------- | ------------------------- | ------------------------------ |
| **Writing**   | conversations, game saves | a manuscript (Markdown / EPUB) |
| **Authoring** | a world, a plugin         | a character card               |
| **Developer** | a plugin run              | nothing — it is a window       |

## 1. Writing

### What it does

Turns what happened into something readable. Two shapes, both real needs, chosen per run:

| Shape             | Input                           | Output                                                                             |
| ----------------- | ------------------------------- | ---------------------------------------------------------------------------------- |
| **Whole rewrite** | The selected range, as raw text | Chapters with pacing, description and connective tissue the conversation never had |
| **Scene polish**  | One scene at a time, in order   | The same events, in the same order, with the same dialogue, only written better    |

Whole rewrite is the "make a novel out of this" button. Scene polish is the "keep what I wrote, fix the prose" button. They differ only in the instruction and the default chapter granularity, so they share one pipeline.

### The pipeline

The existing distillation pipeline is the model, and this deliberately mirrors it:

1. **Choose a source** — one chat, several chats, or a whole game save's chats, with a message range.
2. **Segment** — chapters and scenes. Reuses the section splitter from book distillation so a chapter boundary means the same thing on both sides of the app.
3. **Generate** — one request per scene (polish) or per chapter (rewrite), streamed, with a cancel that writes nothing.
4. **Review sheet** — every scene appears as a row: generated text, source messages it covers, token cost, include/exclude. Scenes can be regenerated individually, merged, split, reordered, and edited by hand.
5. **Accept** — writes the manuscript. Nothing is stored before this step.

The review sheet is the pattern RFC 0002 already uses for a distilled book, with the same promise: nothing reaches disk until it is accepted.

### Where it lives

`data/profiles/<profile>/manuscripts/<id>/`:

```
manuscript.json      title, sources, shape, status, chapter index
scenes/<n>.md        accepted prose, one file per scene
draft.json           the working run, while unreviewed
```

Accepted prose is Markdown, so export is a concatenation. Two exports:

- **Markdown**, chapter headings included.
- **EPUB**, built with the same `fflate` ZIP machinery the CharX and skill exports already use. No new dependency.

### Why not a WYSIWYG editor

Because the review sheet already is the editor, and a rich text editor is a large component that would not improve the output. A scene is edited as Markdown in a textarea, exactly as a message is edited today. If someone wants a richer editor they can export and use one.

### Open questions

1. **Does a manuscript own its sources, or reference them?** Referencing keeps a re-run cheap and the data small; owning means a manuscript survives deleting the chat. Leaning reference with a warning on delete, matching how a bookmark behaves in ST.
2. **Can a manuscript span a game save?** It should — the interesting story is the whole run, not one partner's chat — which is why the source picker is written in terms of the save from the start.
3. **Is there a per-scene style instruction?** One global instruction plus a per-scene override keeps the sheet usable; per-scene-only would make a 40-scene book tedious.

## 2. Authoring

### The gap this closes first

CatCup cannot create a character from nothing. `CharacterEditor` renders only once a card exists (`characterId === null` renders the dialog empty), and the server has no `POST /api/characters` — only `bulk`, `import`, `import-path` and `sample`. Every card in the app arrived from a file.

That is the smallest and most concrete missing piece in this whole design, and it blocks authoring entirely: you cannot draft a card in the app and you cannot start one from a template.

### Scope

- **Blank card creation.** A minimal V2 card at `characters/<name>.png` (a generated placeholder avatar) or JSON, opening straight into the editor. This is the acceptance criterion that unblocks everything else here.
- **Templates.** A card can start from a saved shape — the fields, not the content — so a cast shares a structure.
- **Card lorebook editing.** Today a card's embedded book can only be copied out with **Import lore**, one way. Authoring needs to edit the book in place, on the same screen as the card fields, with the same editor the World Info library uses.
- **Character assets.** A card can carry expressions, backgrounds and audio (the CharX assets that are already stored but never displayed). Shown in the editor, so an author can see what the package will contain.
- **Plugin authoring.** RFC 0005's format is JSON in a ZIP. Authoring means a form over that JSON plus a media drop area, written into a package the app then installs. The review sheet pattern applies: see what the pack contains before installing it.

### Why this is not an IDE

An authoring screen that can express everything the format can is a development tool, and development tools belong in the developer panel. Authoring covers the common path: a card, a cast, a small pack. A pack that needs more than the form offers is edited on disk, and the developer panel tells you when your file does not load.

### Open questions

1. **Does a new card get a placeholder avatar or none?** None leaves the library with a gap; a generated placeholder makes it findable. Leaning a deterministic generated avatar, as an empty state rather than a picture.
2. **Is a template a file or a saved card?** A file is portable and shippable in a pack; a saved card is one click. Leaning file, since templates want to travel with a world.
3. **Does the plugin form write the ZIP, or does it write a folder the installer packages?** A folder is easier to edit and diff; a ZIP is what ships. Leaning folder while authoring, packaged on install and on export.

## 3. The developer panel

### What it is

A window into a run — not an editor. Three tabs:

| Tab        | Shows                                                                                              |
| ---------- | -------------------------------------------------------------------------------------------------- |
| **Prompt** | The assembled prompt, per-slot token counts, world info trace. This exists: the context inspector. |
| **Tools**  | Every action block proposed this turn, every validation result, every effect applied, in order     |
| **State**  | The game state before and after a turn, as a diff                                                  |

The prompt tab is the existing Context inspector, unchanged. The other two are new, and are only meaningful once RFC 0005 exists — which is why the panel comes after the engine, not with it.

### Why a separate tab rather than a log file

Because the two failures a plugin developer hits are "my tool was rejected and I do not know why" and "my state key did not change". Both are per-turn questions, not per-run questions, and both are answered by putting the turn on screen beside the reply.

### Retention

A single run's tool trace is kept for the current session only. Nothing is written to disk: a trace contains the model's reasoning about the player's state, and storing it would create a second, unmanaged copy of the conversation.

### Open questions

1. **Is the panel always available, or behind a per-profile developer switch?** Always available is simpler; a switch keeps it out of a normal person's way. Leaning always available with an entry in the Tools menu, since the cost of a stray click is low and discoverability is the point.
2. **Does the state tab show every change or only the final diff?** Every change is what debugging needs, and the effect list is short.

## Relationships

- **RFC 0005** — game mode and the plugin host. Writing consumes game saves; the developer panel is written for its plugins; plugin authoring writes its format.
- **RFC 0003** — the director, shipped in #151. It is Story mode; RFC 0005 adds the Game switch beside it.
- **RFC 0002** — book distillation, whose review sheet, section splitter and ZIP export are reused by writing and authoring.
- **RFC 0001** — profiles. A manuscript is profile-scoped, like every other piece of library content.

## Acceptance criteria

### Writing

- [ ] A chat can be selected as a source, segmented, generated, reviewed and accepted, with nothing written before acceptance.
- [ ] Both shapes work: one produces reordered, chaptered prose and the other produces a polish of each scene in order.
- [ ] A scene can be regenerated alone without re-running the rest.
- [ ] A run can be cancelled at any point and writes nothing.
- [ ] An accepted manuscript exports as Markdown and as EPUB that opens in a reader.

### Authoring

- [ ] A blank character card can be created in the app and appears in the library immediately.
- [ ] A card's embedded lorebook can be edited in place, and the edited book re-exports inside the card.
- [ ] A plugin pack can be authored from the form, installed, and runs.
- [ ] A malformed pack is refused with the offending field named.

### Developer panel

- [ ] The Tools tab shows every proposed action, its validation result and its effect, in order.
- [ ] The State tab shows the before/after diff for the turn.
- [ ] A rejected action is visible with the reason, and the reply is unaffected.
- [ ] Nothing from the trace is written to disk.

### Docs

- [ ] `docs/API.md`, `docs/DATA-FORMATS.md` (the manuscript folders), `docs/LIMITATIONS.md`, `docs/MILESTONES.md` and `CHANGELOG.md` are updated with each workspace.
