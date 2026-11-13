# RFC 0001 — Switchable profiles (scoped data with a shared layer)

- **Issue:** [#78](https://github.com/BerryUIKI/CatCup-Tavern/issues/78)
- **Status:** Proposed — revised after review
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

| Method | Path                   | Purpose                                                                              |
| ------ | ---------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/profiles`        | List profiles with id, name, description and a count of what each owns               |
| POST   | `/api/profiles`        | Create one, optionally copying an existing profile's _configuration_ (never content) |
| PATCH  | `/api/profiles/:id`    | Rename or describe                                                                   |
| PUT    | `/api/profiles/active` | Switch; `409 PROFILE_BUSY` while a generation runs                                   |
| DELETE | `/api/profiles/:id`    | Delete a profile and its scope, refusing the last one and the active one             |

Deleting a profile deletes its `profiles/<id>/` folder in full. The confirmation lists what goes with it — how many characters, chats, books and presets — so nobody deletes a campaign by accident. Shared items are never touched.

## 9. Interface

**Footer.** The library footer becomes a two-line control: the **profile** on top (name + a chevron, opening a menu of profiles and _Manage profiles…_), and the **active provider** beneath it, as it is today. The provider is switched more often; the profile is the bigger switch, so it sits above and reads as the label for everything below it.

**Settings → Profiles** (group _Model_, beside Providers). Each row shows the profile name, what it owns, and its size on disk. Actions: Rename, Duplicate configuration, Make active, Delete. Creating a profile asks _Start empty_ or _Copy configuration from “<current>”_ — never content, because copying a cast is what the shared layer and card import are for.

**Shared items** carry a quiet badge in the library and the world info list, and their row menu offers _Copy into this profile_. The badge is a word plus an icon, not a colour alone (`DESIGN.md`).

**A switch** toasts "Switched to _Novel_." and the library, chat and settings refetch. Nothing is lost; nothing else moves.

## 10. What this deliberately leaves out

- **Per-profile providers.** Rejected: it duplicates keys and buys nothing. If one profile must use a different endpoint, that endpoint is a second provider in the global list.
- **Profile import/export.** Blocked on the same question as before: a profile's provider choice is useless without keys, and keys do not leave the server.
- **Copying content between profiles in bulk.** Card import, world info import and preset import already do this. A "copy my whole cast" button is a later convenience, and the shared layer covers the common case.
- **Per-profile appearance beyond the theme name.** `ui.theme` is bundled; a second palette is its own piece of work.

## 11. Risks

| Risk                                                                            | Impact                       | Mitigation                                                                                       |
| ------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------ |
| Migration moves thousands of files                                              | A failed install             | Dry run, rename-only move, backup file, per-step log, move-back on error                         |
| A switch during a reply writes into the wrong profile                           | Corrupt chat                 | `409 PROFILE_BUSY` until generations drain; the switch holds the file lock                       |
| Two profiles both have a "Mira"                                                 | Wrong card                   | Expected and fine — scopes keep them apart. Only the shared layer can shadow, and it is labelled |
| Shared item edited from one profile                                             | Surprise elsewhere           | Shared items are why _copy into this profile_ exists; the edit dialog says an item is shared     |
| A person forgets which profile they are in                                      | Writing into the wrong world | The footer names it, the switch toasts it, and the title bar carries it                          |
| Deleting the active profile                                                     | Impossible by rule           | `DELETE` refuses the active and the last profile                                                 |
| Provider list is global, active provider per profile — confusing which is which | Support questions            | The footer shows both, and Settings → Providers marks the profile's active one                   |

## 12. Effort

| Step                                                                     | Rough size |
| ------------------------------------------------------------------------ | ---------- |
| Profile index, scoped paths, migration with dry run and move-back        | 2–3 days   |
| Storage functions take a scope; settings split; provider list lifted out | 2 days     |
| `GET/POST/PATCH/PUT/DELETE` endpoints, busy guard, tests                 | 1–2 days   |
| Footer switcher, Settings → Profiles section, shared badge               | 2 days     |
| Shared layer: move/copy actions, shadow labelling, create checkbox       | 1–2 days   |
| Migration and backwards-compat tests, docs, changelog                    | 1 day      |

## 13. Open questions for review

1. **Is the shared layer in scope for the first slice, or the second?** The proposal builds full isolation first and adds the shared scope next, because isolation is what fixes the two-campaign problem and the shared layer is a convenience. Building both at once is roughly 1–2 days longer.
2. **Should the shared scope be visible from the library's default view, or behind a filter?** The proposal shows shared items inline with a badge. The alternative hides them until _Show shared_ is ticked, which keeps a campaign library clean but hides a preset someone just made reusable.
3. **Does deleting a profile ever deserve an archive instead of a delete?** A campaign is a lot of writing. The proposal deletes with a confirmation that counts what goes; an archive (moved under `data/archive/`) is cheap to add and undoable.
4. **Should a profile be able to pin a _model_ as well as a provider?** #76 added a per-character model. A profile-level model would let "Novel" default to the long-context model and "Mystery" to the cheap one. The proposal says yes, because it is one field next to `activeProviderId`.
