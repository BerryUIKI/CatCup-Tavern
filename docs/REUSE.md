# Code reuse assessment: SillyTavern × RisuAI

> Assessed: 2026-11-09
> References: SillyTavern `1.19.0` (`.ref/SillyTavern`), RisuAI `2026.10.295` (`.ref/RisuAI`)
>
> Scope and status live in [MILESTONES.md](MILESTONES.md); runtime compatibility is tracked in [ST-COMPATIBILITY.md](ST-COMPATIBILITY.md). This page records licensing and reuse.

## 0. License conclusion

| Project     | License  | Relationship                                                                                               |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| SillyTavern | AGPL-3.0 | May be adapted; this project stays AGPL-3.0                                                                |
| RisuAI      | GPL-3.0  | May be combined into an AGPL-3.0 project (GNU AGPLv3 §13); the combined work is distributed under AGPL-3.0 |

Requirements:

1. Keep `LICENSE` (AGPL-3.0 text), `NOTICE`, and copyright headers in adapted source files.
2. Note the origin and modification in files that are derived from either project.
3. When the software is used over a network by others, provide the corresponding source.
4. Do not use ST/RisuAI code in a closed-source distribution.

## 1. Overall conclusion

- **SillyTavern = compatibility and semantics.** Data formats, character cards, chat JSONL, world info, prompt semantics, STscript and the extension API surface.
- **RisuAI = modern TypeScript implementation reference.** Provider request layer, streaming parsers, character import, Tauri packaging, LAN password service, plugin sandbox.
- **Neither UI is directly reusable.** ST is jQuery/vanilla; RisuAI is Svelte; this project is React. Borrow interaction and visual lessons only.
- **The core cannot be copied verbatim.** ST's `openai.js`, `world-info.js`, `PromptManager.js` and `slash-commands.js` are tightly coupled to DOM/global state and must be ported into pure TypeScript modules.

## 2. Direct reuse / small adaptation

| Source | File                                          | Size       | Purpose                                                                 | Approach                                                        |
| ------ | --------------------------------------------- | ---------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| ST     | `src/character-card-parser.js`                | 98 lines   | PNG `tEXt` card read/write                                              | Ported to `apps/server/src/cards/`; attribution retained        |
| ST     | `src/png/encode.js`                           | 68 lines   | PNG chunk re-encoding                                                   | To reuse for card export in M2 (MIT origin; keep original note) |
| ST     | `src/charx.js`                                | 399 lines  | CharX (ZIP + v3 card + assets)                                          | M2 port                                                         |
| ST     | `src/prompt-converters.js`                    | 1451 lines | Claude/Google/Mistral message conversion                                | Port as needed per provider                                     |
| ST     | `src/endpoints/backends/chat-completions.js`  | 2995 lines | Provider parameter matrix, SSE forwarding, reasoning/tool-call handling | Use as a parameter/edge-case reference; rewrite per provider    |
| ST     | `src/endpoints/backends/text-completions.js`  | 646 lines  | Kobold/Ooba text completion                                             | Later, if needed                                                |
| ST     | `public/scripts/extensions/regex/engine.js`   | small      | Regex script engine                                                     | M2 port to pure TS                                              |
| ST     | `public/scripts/extensions/quick-reply/`      | medium     | Quick Replies model and commands                                        | M2 subset; M3 full                                              |
| ST     | `public/scripts/tokenizers.js`                | 1231 lines | Tokenizer/model mapping                                                 | Reference mapping; wire `tiktoken`/web tokenizer                |
| RisuAI | `src/ts/pngChunk.ts`                          | 324 lines  | Alternative PNG chunk implementation                                    | Cross-check; do not add a duplicate dependency                  |
| RisuAI | `src/ts/process/request/anthropic.ts`         | 1218 lines | Anthropic request/stream details                                        | Reference, especially thinking/tool use                         |
| RisuAI | `src/ts/process/request/google.ts`            | 1306 lines | Gemini/Vertex request details                                           | Reference for future providers                                  |
| RisuAI | `src/ts/process/request/openAI/requests.ts`   | large      | OpenAI requests, Responses API, parameter compatibility                 | Reference implementation                                        |
| RisuAI | `src/ts/characterCards.ts`                    | 2075 lines | JSON/CharX/Risu import/export                                           | Reference for M2 card formats                                   |
| RisuAI | `src/ts/plugins/` + `plugins.md`              | medium     | iframe sandbox plugin API, SafeDOM                                      | Reference for the M3 extension host                             |
| RisuAI | `server/node/server.cjs`                      | large      | LAN password, sessions, rate limiting, WS proxy                         | Security design reference (we use scrypt + HMAC cookies)        |
| RisuAI | `src-tauri/tauri.conf.json` + `capabilities/` | config     | Tauri 2 packaging, updater, file associations                           | M4 reference                                                    |
| RisuAI | `src/lang/*.ts`                               | large      | Terminology and localization reference                                  | Do not copy copy; localization is deferred                      |

## 3. Port / rewrite (logic reference only)

| Source | File                                                   | Size                   | Why                                                                                      |
| ------ | ------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------- |
| ST     | `public/scripts/openai.js`                             | 7396 lines             | Prompt construction, message collection, token budgeting; DOM/global coupling            |
| ST     | `public/scripts/world-info.js`                         | 6408 lines             | World info scanning, recursion, position injection, sticky/cooldown; algorithms portable |
| ST     | `public/scripts/PromptManager.js`                      | 2144 lines             | Prompt entries, ordering, injection position/depth                                       |
| ST     | `public/scripts/slash-commands.js` + `slash-commands/` | 7122 lines + utilities | STscript parser/executor; depends on Chevrotain and ST context                           |
| ST     | `public/scripts/chats.js` / `group-chats.js`           | 2422 / 2491 lines      | Chat slices, branching, group chats; data format compatible, logic rewritten             |
| ST     | `public/scripts/st-context.js`                         | 311 lines              | Extension API surface; specification for the compatibility layer                         |
| ST     | `public/scripts/extensions.js`                         | 2324 lines             | Extension loading, events, settings; M3 reference                                        |
| RisuAI | `src/ts/process/lorebook.svelte.ts`                    | 771 lines              | Lorebook logic; Svelte state coupling                                                    |
| RisuAI | `src/ts/process/index.svelte.ts`                       | large                  | Chat processing pipeline, groups, multiple generations                                   |
| RisuAI | `src/ts/process/memory/*`                              | multiple               | Hypa/Supa memory and context strategies                                                  |
| RisuAI | `src/ts/process/tts.ts` / `stableDiff.ts`              | medium                 | TTS/image generation integrations                                                        |
| RisuAI | `src/ts/storage/database.svelte.ts`                    | 2603 lines             | Data model reference; we use server-side files                                           |

## 4. Explicitly not reused

| Item                                          | Reason                                                              |
| --------------------------------------------- | ------------------------------------------------------------------- |
| ST frontend `public/` DOM/jQuery UI           | This project uses React; direct reuse would pollute the state model |
| ST multi-user account system (`src/users.js`) | v1 is single-user + password                                        |
| RisuAI Svelte components and stores           | Different framework                                                 |
| RisuAI OPFS/localForage/Tauri FS storage      | Data lives on the server, not in the browser                        |
| RisuAI `.risum` / `.risup` runtime            | Possible import formats later, not core formats                     |
| ST Electron shell                             | Tauri was chosen                                                    |

## 5. Practical boundaries of ST extension compatibility

ST extensions fall into three groups:

1. **Pure STscript / Quick Replies / regex / prompt injection** — implementable in layers; M1–M3.
2. **Extensions calling `SillyTavern.getContext()` and `eventSource`** — need a compatibility layer. `st-context.js` exposes ~100 APIs; M3 implements by usage frequency.
3. **UI extensions that manipulate ST's DOM/jQuery directly** — require a sandboxed iframe or a replica of ST's DOM. This is L4, the highest-risk goal, and is not promised for v1.

Conclusion: **"ST extension/STscript compatibility" is delivered in layers L1→L4.** Nail data formats, STscript and Quick Replies first; host UI extensions in a sandbox.

## 6. Process for adding reused code

1. Locate the original in `.ref/` and record its path, version and line numbers.
2. Convert to TypeScript and remove DOM/Svelte/global-state dependencies.
3. Add a file header:

   ```ts
   // Derived from SillyTavern (AGPL-3.0)
   // https://github.com/SillyTavern/SillyTavern/blob/<commit>/<path>
   ```

4. Update this table and `NOTICE`.
5. For RisuAI, state the GPL-3.0 origin and the AGPLv3 §13 combination.

## 7. Reuse already landed

| Location                                   | Source                                                 | Notes                                                            |
| ------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `apps/server/src/cards/parse.ts`           | ST `src/character-card-parser.js` + PNG chunk handling | PNG `tEXt` reading, v2/v3 precedence; card writing arrives in M2 |
| `packages/shared/src/schemas/character.ts` | ST Character Card V2/V3 spec                           | Field names and `character_book` structure                       |
| `packages/shared/src/schemas/chat.ts`      | ST chat JSONL                                          | Header + message fields                                          |
| `packages/shared/src/schemas/worldinfo.ts` | ST World Info JSON                                     | Entry field set, positions, logic and role constants             |
| `apps/server/src/worldinfo/matching.ts`    | ST `public/scripts/world-info.js`                      | Key matching, regex keys, decorator parsing                      |
| `apps/server/src/worldinfo/loader.ts`      | ST `public/scripts/world-info.js`                      | Book shape handling and entry normalization                      |
| `apps/server/src/worldinfo/scanner.ts`     | ST `public/scripts/world-info.js`                      | `checkWorldInfo` core: selection, probability, budget, positions |
| `packages/shared/src/schemas/preset.ts`    | ST OpenAI preset                                       | Preset fields, `prompts` / `prompt_order`                        |

## 8. Related documentation

- [Milestones](MILESTONES.md)
- [SillyTavern compatibility](ST-COMPATIBILITY.md)
- [Data formats](DATA-FORMATS.md)
- [Documentation index](README.md)
- [NOTICE](../NOTICE)
