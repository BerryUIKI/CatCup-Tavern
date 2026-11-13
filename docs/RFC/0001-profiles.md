# RFC 0001 — Switchable profiles (settings bundles)

- **Issue:** [#78](https://github.com/BerryUIKI/CatCup-Tavern/issues/78)
- **Status:** Proposed — awaiting review
- **Touches:** `apps/server/src/storage/`, `apps/web/src/components/Sidebar.tsx`, `docs/DATA-FORMATS.md`, `docs/API.md`

## The problem

There is one `data/settings.json`. Everything a person configures lives in it: providers and the active one, the active preset, sampling, memory, personas, TTS, image generation and Quick Replies. The only things that can be switched today are the active provider (library footer) and the persona (a chat-level pin), and neither changes how the app behaves.

Someone with a fast local model for roleplay and a hosted model for long-context work has to re-enter settings every time they switch, which also means every device sees the same half-configured state.

## What a profile is, and is not

A profile is **a saved bundle of configuration**. It is not a second copy of the data.

| Bundled into a profile                 | Shared across every profile                          |
| -------------------------------------- | ---------------------------------------------------- |
| Providers and the active provider      | Characters and their cards                           |
| The active preset and its prompt order | Chats and groups                                     |
| Generation, memory, Author's Note      | World info books                                     |
| Personas and the active persona        | Presets, Quick Reply sets and regex scripts as files |
| Regex rules (as `regex.json` today)    | Generated images                                     |
| TTS and image generation settings      | World info and regex files themselves                |
| Theme                                  | API keys (`secrets.json`)                            |
| Quick Replies bar order                | Auth (`auth.json`)                                   |

The distinction that matters: a profile decides **how CatCup behaves**. The data is what it behaves **on**. Two profiles therefore share one character library — that is the point, a person should not maintain two copies of their characters to use two models.

**API keys stay in one `secrets.json`.** A profile names providers by id, so duplicating a provider into a second profile gets the same stored key without a second copy or a second entry in the encrypted file.

## Proposed shape

### On disk

```
data/
  settings.json              →  { version: 2, activeProfileId, profiles: [{ id, name, description }] }
  profiles/
    <profileId>/
      settings.json          →  today's AppSettings (version 1), minus personas ownership below
      regex.json             →  moved here
```

`data/settings.json` becomes a small **profile index**; each profile's own `settings.json` holds exactly the shape `AppSettings` has today. This is the least disruptive layout: `normalizeSettings()` keeps working on the per-profile file unchanged, and the migration is a copy plus a one-line index.

Presets, Quick Replies, world info and characters stay where they are, at the data root.

### Migration

On first start with the new code:

1. If `data/settings.json` already has `profiles`, it is a v2 file and nothing happens.
2. Otherwise the current file is written to `data/profiles/default/settings.json`, `data/regex.json` (if any) is moved beside it, personas stay in that file, and `data/settings.json` is replaced with `{ version: 2, activeProfileId: "default", profiles: [{ id: "default", name: "Default" }] }`.
3. The old file is kept as `data/settings.json.v1-backup` for one release, then dropped.

A failure at any step leaves the v1 file in place and the server refuses to start with a message naming the backup — never a half-migrated tree.

### Switching

`PUT /api/profiles/active` with `{ id }`. The server swaps the settings cache (`cachedSettings` and the profile path) and answers with the new `SettingsResponse`. No restart, no reload: settings are read per request on the server, so the next request already uses the new profile. The client refetches `GET /api/settings` and the UI re-renders; an in-flight generation finishes on the profile it started with, because its provider and preset were resolved when the request arrived.

The persona an open chat pins is stored on the chat's `chat_metadata`, which is not part of a profile — a chat keeps speaking as the persona it was written with, falling back to the new profile's default when that persona does not exist there. This is the same rule `resolvePersona` already applies for a deleted persona.

### Endpoints

| Method | Path                   | Purpose                                                                   |
| ------ | ---------------------- | ------------------------------------------------------------------------- |
| GET    | `/api/profiles`        | List profiles with id, name, description and a count of what each bundles |
| POST   | `/api/profiles`        | Create one, optionally copying an existing profile's settings             |
| PATCH  | `/api/profiles/:id`    | Rename or describe                                                        |
| PUT    | `/api/profiles/active` | Switch                                                                    |
| DELETE | `/api/profiles/:id`    | Delete a profile, refusing the last one and the active one                |

Deleting a profile deletes its `profiles/<id>/` folder and its `regex.json`. Characters, chats and world info are untouched, and the confirmation says so.

### Interface

Where the active-provider select sits in the library footer today, a **profile row** takes its place: name, a chevron, and the active provider beneath it as the second line, since the provider is what most people switch often. Choosing a profile opens the same small menu shape as the `ToolsMenu` added in stage B — one row per profile, a divider, then **Manage profiles…**, which opens a Settings section.

A new Settings section, **Profiles** (group _Model_, next to Providers), lists profiles with Rename, Duplicate, Delete, and **Make active**. Creating one asks _Start empty_ or _Copy “<current>”_.

The switch is instant and announces itself with a toast: "Switched to _Local_." Nothing else on screen moves, because characters and chats are shared.

## Copying a profile

**Duplicate** copies the profile's settings file verbatim but drops `activePresetId` when that preset does not exist for the new profile… except presets are shared, so it stays. It keeps the same persona ids, so a chat pinned to a persona still resolves. Nothing secret is copied, because nothing secret lives in a profile.

## What this deliberately leaves out

- **Per-profile data folders.** Tempting — "a whole second tavern" — but it forks the character library, doubles backup cost and makes the mental model harder. If it is ever wanted, it is a separate feature with its own confirmation.
- **Per-profile theme beyond a name.** `ui.theme` is stored and bundled, but CatCup ships one palette today (`DESIGN.md`). The switch carries the value; a second palette is its own piece of work.
- **Import/export of a profile.** Blocked on the same question as secrets: a profile's provider list is useless without keys, and keys must not leave the server in an export.

## Risks

| Risk                                                        | Impact                             | Mitigation                                                                                        |
| ----------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| Two servers on one data folder switch profiles concurrently | Lost settings write                | `settings.json` per profile keeps the existing file lock; the index is written under its own lock |
| A generation reads the profile mid-switch                   | A reply on the wrong model         | Provider and preset are resolved once at request start, as they are                               |
| Persona pinned by a chat missing in the new profile         | Chat speaks with the wrong persona | `resolvePersona` already falls back; the header shows the persona                                 |
| Migration leaves a half-written tree                        | Unusable install                   | Back up the v1 file first, migrate by copy, never delete the source until the index is written    |
| Profile sprawl                                              | Settings that drift out of sync    | Duplicate is one click; the Profiles section shows what each bundles                              |

## Effort

| Step                                                | Rough size |
| --------------------------------------------------- | ---------- |
| Profile index, storage split, migration, file locks | 1–2 days   |
| `GET/POST/PATCH/DELETE/active` endpoints and tests  | 1 day      |
| Footer switcher, Settings → Profiles section        | 1–2 days   |
| Docs, changelog, backwards-compat tests             | half a day |

## Open questions for review

1. **Is the split right?** The table above keeps regex and personas in the profile and world info and presets at the data root. The alternative is to move presets and Quick Reply sets into the profile too — more isolation, but a person would then re-import a preset for every new profile.
2. **Should the footer show the profile or the provider as the primary control?** The provider is switched more often; the profile is a bigger change. The proposal puts the profile on top because it is the rarer, more consequential switch.
3. **Keep the `settings.json.v1-backup` for one release, or forever?** One release is the proposal; keeping it is cheap but clutters the data folder.
