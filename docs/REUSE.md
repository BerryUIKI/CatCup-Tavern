# Attribution and code reuse

> Assessed 2026-11-09, reframed 2026-11-23.
> References: SillyTavern `1.19.0` (`.ref/SillyTavern`), RisuAI `2026.10.295` (`.ref/RisuAI`)
>
> Scope and status live in [MILESTONES.md](MILESTONES.md); runtime compatibility is tracked in [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md). This page records where the adapted code came from.
> [REUSE-ISOLATION.md](REUSE-ISOLATION.md) sorts it into what implements a format and what reproduces behaviour, and plans the replacement of the second.

## The two things being tracked here

**Formats.** Character cards, chat JSONL, world info books and prompt presets are the tavern
ecosystem's shared data standard. CatCup implements it so a library moves between clients without a
conversion tool. Implementing a published format is not adaptation and carries no attribution
obligation; the files that do it say which specification they follow.

**Adapted code.** A smaller set of files was written by reading another client's source rather than
working from a format. Those keep a header naming the upstream file until the code underneath is
CatCup's own, and they are what this page lists. `docs/REUSE-ISOLATION.md` splits them by what they
actually are — format implementations versus one client's behavioural choices — and records the plan
for rewriting the second group.

**The licence is not in question.** CatCup is AGPL-3.0-only by choice and stays there. This page
exists so a reader can see where each file came from, not to prepare a change of terms.

## Where the adapted code lives

**`packages/compat-st`** holds most of it. Its README says what is in it and what is deliberately
not.

That package is a home for the attribution, **not a licence boundary**. The app imports it and is
built with it, which makes it one program. Nothing about what a recipient of the built app may do
changes because of a directory. What it buys is a list that cannot drift as files are added.

Listing a file in the table below is not an admission that the app depends on another client — only
that this particular file was written by reading one. `docs/REUSE-ISOLATION.md` records which of
them could honestly be re-expressed as "written against the specification".

## 0. License position

CatCup is **AGPL-3.0-only**. That is the project's current choice, not an accident of what the code
was built from: the ecosystem it belongs to is mostly AGPL-3.0, and its content library is built for
clients that are.

Two things are worth being clear about, now and later:

| Fact                                                     | Consequence                                        |
| -------------------------------------------------------- | -------------------------------------------------- |
| The data formats are a shared standard, implemented here | No obligation attaches to reading and writing them |
| The adapted files are a shrinking, itemised list         | The project knows exactly what it owes and to whom |

The licence is not a decision this page is working towards. It is the project's
current choice, and `docs/REUSE-ISOLATION.md` records the plan for the code —
which is what would keep a later change of terms in the project's own hands
rather than anyone else's.

Requirements that do follow from the adapted files:

1. Keep `LICENSE` (AGPL-3.0 text), `NOTICE`, and copyright headers in adapted source files.
2. Note the origin and modification in files adapted from another project.
3. When the software is used over a network by others, provide the corresponding source.
4. Do not use adapted code in a closed-source distribution.

## 1. Overall conclusion

- **Formats = compatibility.** Data formats, character cards, chat JSONL, world info, prompt semantics, STscript and the extension API surface are what CatCup aligns with, because users move data between clients.
- **RisuAI = modern TypeScript implementation reference.** Provider request layer, streaming parsers, character import, Tauri packaging, LAN password service, plugin sandbox.
- **Neither UI is directly reusable.** The reference clients are jQuery/vanilla and Svelte; this project is React. Borrow interaction and visual lessons only.
- **Their core cannot be lifted wholesale.** `openai.js`, `world-info.js`, `PromptManager.js` and `slash-commands.js` are tightly coupled to DOM/global state and anything taken from them had to be rewritten into pure TypeScript.

## 2. Where code was taken from a reference client

| Source | File                                          | Size       | What CatCup has                                                                                                       |
| ------ | --------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------- |
| ST     | `src/character-card-parser.js`                | 98 lines   | Card read/write, now in `packages/compat-st/src/card-{parse,write}.ts`                                                |
| ST     | `src/png/encode.js`                           | 68 lines   | PNG chunk re-encoding in `packages/compat-st/src/card-png.ts` (MIT origin; note kept)                                 |
| ST     | `src/charx.js`                                | 399 lines  | CharX ZIP + v3 card + assets adapted into `apps/server/src/cards/charx.ts`; CatCup keeps assets per character         |
| ST     | `src/prompt-converters.js`                    | 1451 lines | Not adopted; the provider adapters convert for themselves                                                             |
| ST     | `src/endpoints/backends/chat-completions.js`  | 2995 lines | Parameter and edge-case reference; each provider adapter is written against its own API                               |
| ST     | `src/endpoints/backends/text-completions.js`  | 646 lines  | Not adopted; text-completion backends are out of scope                                                                |
| ST     | `public/scripts/extensions/regex/engine.js`   | small      | `packages/shared/src/regex.ts`                                                                                        |
| ST     | `public/scripts/extensions/quick-reply/`      | medium     | Set format and command semantics in `packages/shared/src/schemas/quickreplies.ts`; parser and executor rewritten (§7) |
| ST     | `public/scripts/tokenizers.js`                | 1231 lines | `packages/compat-st/src/prompt-tokenizer.ts`; `tiktoken` and the Claude vocabulary do the counting                    |
| RisuAI | `src/ts/pngChunk.ts`                          | 324 lines  | Cross-checked only; no duplicate dependency added                                                                     |
| RisuAI | `src/ts/process/request/anthropic.ts`         | 1218 lines | Reference, especially thinking and tool use                                                                           |
| RisuAI | `src/ts/process/request/google.ts`            | 1306 lines | Reference for future providers                                                                                        |
| RisuAI | `src/ts/process/request/openAI/requests.ts`   | large      | Reference for parameter compatibility                                                                                 |
| RisuAI | `src/ts/characterCards.ts`                    | 2075 lines | CharX import/export implemented in M2                                                                                 |
| RisuAI | `src/ts/plugins/` + `plugins.md`              | medium     | Reference for the M3 extension host                                                                                   |
| RisuAI | `server/node/server.cjs`                      | large      | Security design reference (CatCup uses scrypt + HMAC cookies)                                                         |
| RisuAI | `src-tauri/tauri.conf.json` + `capabilities/` | config     | M4 reference                                                                                                          |
| RisuAI | `src/lang/*.ts`                               | large      | Terminology only; localization is deferred                                                                            |

## 3. Behaviour taken as a starting point

These were read and then re-expressed in TypeScript, because the originals are coupled to the DOM or
to global state. `docs/REUSE-ISOLATION.md` holds the plan for re-deriving them from the
specifications instead.

| Source | File                                                   | What was taken                                                            |
| ------ | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| ST     | `public/scripts/openai.js`                             | Prompt construction, message collection, token budgeting                  |
| ST     | `public/scripts/extensions/tts/`                       | Provider pipeline shape and text cleaning; the adapters are CatCup's own  |
| ST     | `public/scripts/world-info.js`                         | Scanning, recursion, position injection, sticky/cooldown                  |
| ST     | `public/scripts/PromptManager.js`                      | Prompt entries, ordering, injection position and depth                    |
| ST     | `public/scripts/slash-commands.js` + `slash-commands/` | Command split and quoting, for the Quick Replies subset                   |
| ST     | `public/scripts/chats.js` / `group-chats.js`           | Data format only; the logic is rewritten                                  |
| ST     | `public/scripts/st-context.js`                         | The extension API surface, as the target for the M3 compatibility layer   |
| ST     | `public/scripts/extensions.js`                         | Extension loading and events; M3 reference                                |
| RisuAI | `src/ts/process/lorebook.svelte.ts`                    | Read as a second opinion on lorebook semantics; CatCup implements its own |
| RisuAI | `src/ts/process/index.svelte.ts`                       | Chat pipeline reference                                                   |
| RisuAI | `src/ts/process/memory/*`                              | Memory strategies reference                                               |
| RisuAI | `src/ts/process/tts.ts` / `stableDiff.ts`              | Integration reference                                                     |
| RisuAI | `src/ts/storage/database.svelte.ts`                    | Data model reference; CatCup stores server-side files                     |

## 4. Explicitly not reused

| Item                                          | Reason                                                              |
| --------------------------------------------- | ------------------------------------------------------------------- |
| ST frontend `public/` DOM/jQuery UI           | This project uses React; direct reuse would pollute the state model |
| ST multi-user account system (`src/users.js`) | v1 is single-user + password                                        |
| RisuAI Svelte components and stores           | Different framework                                                 |
| RisuAI OPFS/localForage/Tauri FS storage      | Data lives on the server, not in the browser                        |
| RisuAI `.risum` / `.risup` runtime            | Possible import formats later, not core formats                     |
| ST Electron shell                             | Tauri was chosen                                                    |

## 5. Practical boundaries of the extension API

Extensions written for another client fall into three groups:

1. **Pure script / Quick Replies / regex / prompt injection** — implementable in layers; M1–M3.
2. **Extensions calling `getContext()` and the event bus** — need a compatibility layer. The reference `st-context.js` exposes ~100 APIs; M3 implements by usage frequency.
3. **UI extensions that manipulate the host's DOM/jQuery directly** — require a sandboxed iframe or a replica of that DOM. This is L4, the highest-risk goal, and is not promised for v1.

Conclusion: **extension compatibility is delivered in layers L1→L4.** Nail data formats, the script subset and Quick Replies first; host UI extensions in a sandbox.

## 6. Process for adding adapted code

1. Locate the original in `.ref/` and record its path, version and line numbers.
2. Prefer the specification: if the behaviour is documented, write against the document and skip steps 3–5. A format implementation needs no attribution.
3. Otherwise, convert to TypeScript, remove DOM/Svelte/global-state dependencies, and add a header:

   ```ts
   // Adapted from <project> (<license>)
   // https://github.com/<project>/blob/<commit>/<path>
   ```

4. Put it in `packages/compat-st` unless it needs the app's own modules.
5. Update this table, `NOTICE`, and the classification in `docs/REUSE-ISOLATION.md`.

## 7. Where things live now

Every file here carries a header saying which of three things it is. **format**
means it implements a published specification and owes nothing to another
client's source. A dash means CatCup wrote it. Everything else was adapted from
another client, and the header names the upstream file.

| Location                                       | Basis                                                              | What it does                                                                  |
| ---------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `packages/compat-st/src/card-parse.ts`         | **format** — Character Card V2/V3 PNG                              | `tEXt` chunk reading, `ccv3` before `chara`                                   |
| `packages/compat-st/src/card-write.ts`         | **format** — Character Card V2/V3 PNG                              | Card write-back: `chara` + `ccv3` chunks, legacy promotion                    |
| `packages/compat-st/src/card-favorite.ts`      | **format** — card `extensions.fav`                                 | The favourite flag and the legacy string-`'true'` rule                        |
| `packages/compat-st/src/card-png.ts`           | **format** — PNG container                                         | Chunk serialization with CRC, and `tEXt` replacement                          |
| `apps/server/src/cards/charx.ts`               | RisuAI `src/ts/process/processzip.ts` + `src/ts/characterCards.ts` | CharX ZIP layout, `card.json` + `assets/**` and asset URIs                    |
| `apps/server/src/storage/characterAssets.ts`   | RisuAI `src/ts/process/processzip.ts`                              | Per-character asset storage and round-trip, with CatCup paths and caps        |
| `packages/shared/src/schemas/character.ts`     | **format** — Character Card V2/V3                                  | Field names and `character_book` structure                                    |
| `packages/shared/src/schemas/chat.ts`          | **format** — chat JSONL and `MediaAttachment`                      | Header and message fields, `extra.media` shape                                |
| `packages/shared/src/schemas/worldinfo.ts`     | **format** — World Info JSON                                       | Entry field set, positions, logic and role constants                          |
| `packages/shared/src/schemas/preset.ts`        | **format** — preset JSON                                           | Preset fields, `prompts` / `prompt_order`                                     |
| `packages/shared/src/schemas/regex.ts`         | **format** — regex script data                                     | Script field names, placements and substitution modes                         |
| `packages/shared/src/schemas/quickreplies.ts`  | **format** — Quick Replies v2 set                                  | Version 2 set and quick reply field names and defaults                        |
| `packages/compat-st/src/parse.ts`              | ST `public/scripts/world-info.js`                                  | Book shapes and uid resolution are the format; the hash payload is ST's       |
| `apps/server/src/worldinfo/loader.ts`          | —                                                                  | CatCup's file I/O; the parsing it used to hold now lives in `parse.ts`        |
| `packages/compat-st/src/hash.ts`               | cyrb53 by bryc (MIT)                                               | `getStringHash`, the timed-effect identity                                    |
| `packages/compat-st/src/matching.ts`           | —                                                                  | Key matching, regex keys and decorators, rewritten for CatCup                 |
| `packages/compat-st/src/scanner.ts`            | ST `public/scripts/world-info.js`                                  | Scan states, groups, budget, positions                                        |
| `packages/compat-st/src/timedEffects.ts`       | —                                                                  | Sticky, cooldown, delay and the hand-off, rewritten                           |
| `apps/server/src/worldinfo/entries.ts`         | ST `public/scripts/world-info.js`                                  | Entry template defaults, free-uid allocation, patch merge, order              |
| `apps/server/src/worldinfo/characterBook.ts`   | ST `public/scripts/world-info.js`                                  | `convertCharacterBook`: card lorebook to world info entries                   |
| `packages/shared/src/keywords.ts`              | ST `public/scripts/world-info.js`                                  | `splitKeywordsAndRegexes`; the `/pattern/flags` check delegates to `regex.ts` |
| `packages/compat-st/src/prompt.ts`             | —                                                                  | Prompt buckets, `wi_format` and Author's Note composition, rewritten          |
| `packages/compat-st/src/prompt-definitions.ts` | ST `PromptManager.js`                                              | Identifiers, order and markers from ST; the instruction text is CatCup's      |
| `apps/server/src/prompt/manager.ts`            | —                                                                  | Sanitize, order lookup and prompt collection                                  |
| `packages/compat-st/src/prompt-messages.ts`    | —                                                                  | Completion slots, budget and system-message squashing                         |
| `apps/server/src/prompt/assemble.ts`           | —                                                                  | Marker merge, card overrides, injection and population                        |
| `packages/compat-st/src/prompt-history.ts`     | —                                                                  | History conversion and example-dialogue parsing                               |
| `packages/shared/src/macros.ts`                | —                                                                  | The macro subset, rewritten for CatCup                                        |
| `packages/compat-st/src/prompt-tokenizer.ts`   | —                                                                  | Model to tiktoken-encoding mapping and the Claude counter                     |
| `apps/server/assets/tokenizers/claude.json`    | ST `src/tokenizers/claude.json`                                    | Claude byte-level BPE vocabulary, shipped verbatim                            |
| `packages/shared/src/regex.ts`                 | —                                                                  | Placement gate, replacement syntax, trim strings and the depth window         |
| `packages/shared/src/memory.ts`                | ST `public/scripts/extensions/memory/index.js`                     | Summary lookup on `extra.memory`; the default prompts are CatCup's            |
| `apps/server/src/memory/summary.ts`            | —                                                                  | Update schedule, transcript window and the summary request                    |
| `apps/server/src/memory/inject.ts`             | —                                                                  | Which summaries reach a prompt, and how they are formatted                    |
| `apps/server/src/memory/service.ts`            | —                                                                  | Summary lifecycle: the per-chat lock, the call, the write-back                |
| `packages/shared/src/quickReplies.ts`          | ST `public/scripts/slash-commands/SlashCommandParser.js`           | Command split, quoting, aliases and named-argument semantics                  |
| `apps/server/src/quickreplies/execute.ts`      | —                                                                  | The supported command subset and `/run` expansion                             |
| `apps/server/src/storage/quickReplies.ts`      | ST `src/endpoints/quick-replies.js`                                | One file per set, named after the set, with import and export                 |
| `packages/shared/src/schemas/tts.ts`           | —                                                                  | The text-to-speech settings model                                             |
| `packages/shared/src/tts.ts`                   | —                                                                  | Speech text preparation and chunking                                          |
| `apps/server/src/tts/openaiCompatible.ts`      | —                                                                  | `/audio/speech` request and format mapping                                    |
| `apps/web/src/hooks/useTts.ts`                 | ST `public/scripts/extensions/tts/system.js`                       | Browser voice selection and chunked utterances, rewritten for React           |
| `packages/shared/src/schemas/images.ts`        | —                                                                  | Image generation settings and request shapes                                  |
| `apps/server/src/images/automatic1111.ts`      | —                                                                  | `/sdapi/v1/txt2img` request body and seed read-back                           |
| `apps/server/src/images/comfyui.ts`            | ST `stable-diffusion.js` + `generateComfyImageCommon`              | `/prompt`, `/history` polling, `/view`, `/interrupt` and placeholders         |
| `apps/server/src/images/openaiCompatible.ts`   | —                                                                  | `/images/generations` body, size mapping and responses                        |
| `apps/server/src/images/prompt.ts`             | —                                                                  | Draft-from-chat instruction and comma-tag cleanup                             |
| `apps/server/src/storage/images.ts`            | ST `src/endpoints/images.js` + `saveBase64AsFile`                  | `user/images/<folder>` layout and base64 upload semantics                     |

## 8. Related documentation

- [Isolation plan](REUSE-ISOLATION.md) — which files are format and which are behaviour, and the work to remove the second
- [Milestones](MILESTONES.md)
- [Tavern compatibility](ST-COMPATIBILITY.md)
- [Data formats](DATA-FORMATS.md)
- [Documentation index](README.md)
- [NOTICE](../NOTICE)
