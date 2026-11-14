# RFC 0001 — Switchable profiles (scoped data with a shared layer)

- **Issue:** [#78](https://github.com/BerryUIKI/CatCup-Tavern/issues/78)
- **Status:** Accepted 2026-11-14 — the decisions on the review questions are in §13, and §14 lists the acceptance criteria
- **Supersedes:** the first draft, which shared characters, chats, world info and presets across every profile. That draft was wrong for the reason §2 explains.

## 1. The problem

There is one `data/` tree and one `settings.json`. Everything is global: the character library, the world info books, the presets, the regex rules, the personas, the chat history. The only switchable things are the active provider and a chat's persona.

Someone running a **novel** campaign and a **murder-mystery** campaign has two casts, two lorebooks, two ways of prompting, and wants to keep them apart without maintaining two data folders by hand.

## 2. Why "share the content, swap the config" fails

The first draft proposed a settings bundle over one shared library. That reads well until the two campaigns are concrete:

| Situation                                                             | What sharing does                                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Both casts have a character named **Mira**                            | A character id is its file name, so the second Mira overwrites the first. One library cannot hold both. |
| The novel needs markdown cleanup, the mystery does not                | Regex rules are global, so every rule applies to every campaign.                                        |
| The mystery preset edits its prompt order                             | Prompt order is stored inside the preset file, so editing it in one campaign changes it in the other.   |
| The novel's lorebook has a "Cat's Cup" entry, the mystery has another | A book is a file name; `extensions.world` on a card points at it by that name. Same name, same file.    |
| Browsing the library                                                  | Eighteen characters from two unrelated casts, interleaved.                                              |

These are not edge cases: they are the normal state of two campaigns that are not the same story. **Content has to be scoped to the campaign**, and so does anything that behaves like content — regex rules, prompt order, quick reply sets, personas.

What genuinely belongs to the _machine_ rather than the _campaign_ is the endpoint: the base URL, the API key, and which models that endpoint serves. Entering those twice is pure friction.

## 3. The model

**A profile owns a data scope.** A profile sees its own scope first and, optionally, a shared scope. Providers and keys are global.

```
Global (one, shared by the machine)
  ├── provider configurations + models + default model
  ├── API keys                       (secrets.json)
  ├── the profile index              (settings.json)
  └── auth                           (auth.json)

Per profile (isolated)
  ├── characters  + character assets
  ├── chats and groups
  ├── world info books
  ├── presets
  ├── quick reply sets
  ├── regex rules
  ├── personas
  ├── generated images
  └── everything configuration-shaped: active provider + model, sampling,
      memory, Author's Note, TTS, image generation, theme, bar order

Shared scope (optional, one per install)
  └── any of the "per profile" item kinds above that you mark as shared
```

A profile is therefore a **world**: its own cast, its own lorebooks, its own way of prompting. The machine keeps one address book.

### Why providers are global and the active one is not

The provider list is what this machine can talk to: one endpoint serving twenty-one models, one Ollama on localhost. Re-entering that per profile buys nothing and risks the same key being stored under two ids.

Which provider is **active**, and which model a profile prefers, are per profile — that is the "how this campaign is run" part. Two profiles can point at the same endpoint with different models without duplicating the endpoint or the key.

## 4. The shared layer

The review raised a fair point: some things really are common. A house style preset, a "my character" persona, a reusable OC. The shared scope exists for exactly those, and it is **opt-in per item**, not a blanket mode.

### How items move between scopes

Every item the library can show — character, book, preset, quick reply set, regex rule, persona — has one owner scope. The shared scope is a real folder, not a flag on a shared folder, so the file layout stays honest and backup-friendly.

- **New items** are created in the profile's own scope. A single checkbox on the create dialog, _Reusable in every profile_, creates it in the shared scope instead. It is off by default; it is not a property you discover later.
- **Moving an item to shared** is an explicit action on the item's menu, with a confirmation that names every profile it becomes visible in. It physically moves the file.
- **Taking a shared item into a profile** copies it, so the profile can edit its own version without touching the shared original.

### Resolution when both scopes have the same id

The profile's own item wins, and the library labels the shadowed shared copy so it is not a mystery. A chat belongs to the profile it was written in, so it always resolves against that profile's scope and then shared — never against another profile.

This is the one place the design spends complexity, because the alternative is an id collision that silently serves the wrong character.

### The cost of the shared layer

It is the second slice, not the first. The first slice is full isolation with a global provider list; the shared scope is added once the isolation is solid. A profile that never uses the shared scope never sees it: the checkbox stays off and the folder stays empty.

## 5. On disk

```
data/
  settings.json                 →  { version: 2, activeProfileId, profiles: [{ id, name, description }] }
  secrets.json                  →  unchanged, global
  auth.json                     →  unchanged, global
  shared/                       →  empty until something is marked reusable
    characters/  worlds/  presets/  quickreplies/  regex.json  personas.json
  profiles/
    <profileId>/
      settings.json             →  today's AppSettings (sampling, memory, TTS, provider choice…)
      characters/
      character-assets/
      chats/
      groups/
      group chats/
      worlds/
      presets/
      quickreplies/
      personas.json
      regex.json
      user/images/
```

Provider configurations move from the per-profile `settings.json` to **one global list**. `AppSettings` keeps `activeProviderId` and a preferred model, which is what a profile actually needs.

## 6. Migration

The first start with the new code is the only moment the tree changes shape, so it is a transaction:

1. If `data/profiles/` exists, this is a v2 tree and nothing happens.
2. A **dry run** lists every folder and file that would move and the total size, and refuses if the disk does not have room for the copy.
3. Everything content-shaped moves into `data/profiles/default/`. On Windows and Linux a move within one volume is a rename, so this is a metadata operation, not a copy of gigabytes.
4. Provider configurations are lifted out into the global list; keys stay in `secrets.json`.
5. `data/settings.json` is rewritten as the index with one `Default` profile, and the pre-migration file is kept as `data/settings.json.v1-backup`.
6. Choosing a name for that first profile is offered at the end, so it is not stuck as "Default" forever.

Any failure before step 5 moves the folders back. Step 5 itself is one atomic write. The migration writes a `data/migration.log` line per step so a failed run can be diagnosed without guessing.

A **dry-run flag** (`CATCUP_MIGRATE_DRY_RUN=1`) prints the plan and exits, for a person who wants to see what will happen before it does.

## 7. Switching

`PUT /api/profiles/active`.

The active profile is a process-wide value, because the server is single-user. To keep it honest:

- **The switch waits for in-flight work.** If `activeGenerations` is non-empty, the endpoint answers `409 PROFILE_BUSY` and the client says _Finish or stop the current reply first._ This is the cheapest correct answer: no request can straddle two profiles, and a person is rarely mid-reply when they switch worlds.
- Short writes (a settings save, a chat rename) hold the existing file lock; the switch takes the same lock before swapping, so a write that started under profile A completes under profile A.
- Nothing restarts. Providers, presets and paths are read per request, so the next request already sees the new profile.

## 8. Endpoints

| Method | Path                        | Purpose                                                                                     |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/api/profiles`             | List profiles and archived profiles with id, name, description, what each owns and its size |
| POST   | `/api/profiles`             | Create one, optionally copying an existing profile's _configuration_ (never content)        |
| PATCH  | `/api/profiles/:id`         | Rename or describe                                                                          |
| PUT    | `/api/profiles/active`      | Switch; `409 PROFILE_BUSY` while a generation runs                                          |
| POST   | `/api/profiles/:id/archive` | Move a profile's scope to `archive/<id>/` and drop it from the index; never the active one  |
| POST   | `/api/profiles/:id/restore` | Move an archived profile back and re-add the index entry                                    |
| DELETE | `/api/profiles/:id`         | Permanently delete an **archived** profile's folder; refuses a live, active or last one     |

Archiving is the default removal — see §13.3. It moves `profiles/<id>/` to `archive/<id>/`, which is a rename within one volume, and the switcher no longer lists it. Permanent deletion only applies to an archived profile and says the folder name and that it cannot be undone.

The archive confirmation counts what goes with the profile — how many characters, chats, books and presets — so nobody archives the wrong campaign. Shared items are never touched by either action.

## 9. Interface

**Footer.** The library footer becomes a two-line control: the **profile** on top (name + a chevron, opening a menu of profiles and _Manage profiles…_), and the **active provider** beneath it, as it is today. The provider is switched more often; the profile is the bigger switch, so it sits above and reads as the label for everything below it.

**Settings → Profiles** (group _Model_, beside Providers). Each row shows the profile name, what it owns, and its size on disk. Actions: Rename, Duplicate configuration, Make active, **Archive**. An archived profile is listed under a collapsed _Archived_ group with **Restore** and **Delete permanently**. Creating a profile asks _Start empty_ or _Copy configuration from “<current>”_ — never content, because copying a cast is what the shared layer and card import are for.

**Shared items** carry a quiet badge in the library and the world info list, and their row menu offers _Copy into this profile_. The badge is a word plus an icon, not a colour alone (`DESIGN.md`).

**A switch** toasts "Switched to _Novel_." and the library, chat and settings refetch. Nothing is lost; nothing else moves.

## 10. What this deliberately leaves out

- **Per-profile providers.** Rejected: it duplicates keys and buys nothing. If one profile must use a different endpoint, that endpoint is a second provider in the global list.
- **Profile import/export.** Blocked on the same question as before: a profile's provider choice is useless without keys, and keys do not leave the server.
- **Copying content between profiles in bulk.** Card import, world info import and preset import already do this. A "copy my whole cast" button is a later convenience, and the shared layer covers the common case.
- **Per-profile appearance beyond the theme name.** `ui.theme` is bundled; a second palette is its own piece of work.

## 11. Risks

| Risk                                                                            | Impact                       | Mitigation                                                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Migration moves thousands of files                                              | A failed install             | Dry run, rename-only move, backup file, per-step log, move-back on error                                                 |
| A switch during a reply writes into the wrong profile                           | Corrupt chat                 | `409 PROFILE_BUSY` until generations drain; the switch holds the file lock                                               |
| Two profiles both have a "Mira"                                                 | Wrong card                   | Expected and fine — scopes keep them apart. Only the shared layer can shadow, and it is labelled                         |
| Shared item edited from one profile                                             | Surprise elsewhere           | Shared items are why _copy into this profile_ exists; the edit dialog says an item is shared                             |
| A person forgets which profile they are in                                      | Writing into the wrong world | The footer names it, the switch toasts it, and the title bar carries it                                                  |
| Removing the active profile by accident                                         | Lost campaign                | Archiving is the default and refuses the active and the last profile; permanent deletion only applies to an archived one |
| Provider list is global, active provider per profile — confusing which is which | Support questions            | The footer shows both, and Settings → Providers marks the profile's active one                                           |

## 12. Effort

| Step                                                                     | Rough size |
| ------------------------------------------------------------------------ | ---------- |
| Profile index, scoped paths, migration with dry run and move-back        | 2–3 days   |
| Storage functions take a scope; settings split; provider list lifted out | 2 days     |
| `GET/POST/PATCH/PUT/DELETE` endpoints, busy guard, tests                 | 1–2 days   |
| Footer switcher, Settings → Profiles section, shared badge               | 2 days     |
| Shared layer: move/copy actions, shadow labelling, create checkbox       | 1–2 days   |
| Migration and backwards-compat tests, docs, changelog                    | 1 day      |

## 13. Decisions

The review accepted the scoped model and asked for a recommendation on the four questions left open. These are the decisions; the reasoning is kept so a later change can argue against it rather than rediscover it.

### 13.1 The shared layer ships in the second slice

**Decision: second slice.** The first slice is full isolation plus the global provider list.

Isolation is what fixes the problem that prompted the revision — two campaigns that collide. The shared layer is a convenience for the smaller set of things that really are common, and building it at the same time roughly doubles the surface that has to be right before anything ships.

The first slice is designed so the second can land without reshaping it:

- Every storage function takes a scope, not a hard-coded path, from day one — even though only one scope exists at first.
- Item ids are already unique within a scope, so a shared scope is just a second one.
- Nothing in `settings.json` names a shared item, so adding the folder changes no stored format.

If the shared layer is never built, nothing about the first slice is wasted.

### 13.2 Shared items are shown inline, behind a badge, with a filter

**Decision: visible by default, labelled, and filterable.**

Hiding shared items until a _Show shared_ box is ticked has one bad failure: a person marks a preset reusable in one profile, switches, and sees nothing — the feature looks broken rather than quiet. Visible-but-labelled is self-explanatory: the badge says _Shared_, and the eye learns what it means once.

The library already has a filters row (favorites, tags, sort). A **Scope** filter joins it — _This profile_ / _Shared_ / _All_, defaulting to _All_ — so hiding them is still one click, and the choice is remembered per profile like the other library filters.

A shared item in a different profile's directory is not shown at all. A profile only ever sees its own items plus the shared scope, never another profile's — that is the isolation guarantee, and no filter may break it.

### 13.3 Deleting a profile archives it

**Decision: archive by default; deleting is a second, explicit action.**

A campaign is weeks of writing. A mis-click that permanently removes it is the kind of failure a person does not forgive, and the confirmation dialog that lists "3 characters, 14 chats, 2 books" is read at a glance and then dismissed.

- **Archive** (the default action) moves `profiles/<id>/` to `archive/<id>/` and drops the entry from the profile index. Nothing is lost, nothing is loaded, and the folder no longer appears in the switcher.
- **Restore** moves it back and re-adds the index entry.
- **Delete permanently** exists on an archived profile, with a confirmation that names the folder and says it cannot be undone. It only ever applies to an archived profile, never to a live one, so the destructive path is always two deliberate steps.

Archiving is cheap: within one volume the move is a rename, exactly like the migration.

The trade-off accepted here: an archived profile still occupies disk, so a person who prunes many will want a size column — the Settings → Profiles list shows size for active and archived profiles alike, and the About section shows the total.

### 13.4 A profile pins a model as well as a provider

**Decision: yes.**

It is one field beside `activeProviderId`, and it is the whole point of having more than one profile on a machine that serves twenty-one models: "Novel" on the long-context model, "Mystery" on the cheap one.

The order stays the one #76 established, with the profile slot inserted where it belongs:

1. The **character's** model, when the active provider serves it.
2. The **profile's** preferred model, when the active provider serves it.
3. The provider's **default** model.
4. The first model the provider lists.

A profile model the active provider does not serve is skipped, not an error — the same rule a character's choice already follows. The chat header's fallback marker covers this case identically, naming what was requested and what was used.

This keeps every existing guarantee: a character can always override, a fallback is always visible, and nothing about #76's per-character choice changes.

## 14. What "accepted" means

The scope in §1–13 is ready to be cut into PRs. The milestones document gains the feature with these acceptance criteria:

- [ ] A second profile can hold a character with the same name as one in the first, and both open correctly.
- [ ] A regex rule, preset, quick reply set and persona created in one profile is absent from the other.
- [ ] Switching profiles while a reply is streaming is refused and the reply completes in the profile it started in.
- [ ] A v1 data folder migrates with `CATCUP_MIGRATE_DRY_RUN=1` reporting the same plan the real run performs, and a failed run leaves the tree unchanged.
- [ ] A profile can be archived and restored without losing a chat.
- [ ] A profile's preferred model is used when the character names none, and skipped with the visible fallback marker when the active provider does not serve it.

The shared layer's criteria are written when its slice starts; §13.1 names what the first slice must keep open for it.
