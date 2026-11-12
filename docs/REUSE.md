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

| Source | File                                          | Size       | Purpose                                                                 | Approach                                                                                                            |
| ------ | --------------------------------------------- | ---------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| ST     | `src/character-card-parser.js`                | 98 lines   | PNG `tEXt` card read/write                                              | Ported to `apps/server/src/cards/`; attribution retained                                                            |
| ST     | `src/png/encode.js`                           | 68 lines   | PNG chunk re-encoding                                                   | Ported to `apps/server/src/cards/png.ts` (MIT origin; note kept)                                                    |
| ST     | `src/charx.js`                                | 399 lines  | CharX (ZIP + v3 card + assets)                                          | M2 port                                                                                                             |
| ST     | `src/prompt-converters.js`                    | 1451 lines | Claude/Google/Mistral message conversion                                | Port as needed per provider                                                                                         |
| ST     | `src/endpoints/backends/chat-completions.js`  | 2995 lines | Provider parameter matrix, SSE forwarding, reasoning/tool-call handling | Use as a parameter/edge-case reference; rewrite per provider                                                        |
| ST     | `src/endpoints/backends/text-completions.js`  | 646 lines  | Kobold/Ooba text completion                                             | Later, if needed                                                                                                    |
| ST     | `public/scripts/extensions/regex/engine.js`   | small      | Regex script engine                                                     | Ported to `packages/shared/src/regex.ts`                                                                            |
| ST     | `public/scripts/extensions/quick-reply/`      | medium     | Quick Replies model and commands                                        | Set format and command semantics ported into CatCup modules; parser and executor rewritten (§7); M2 subset, M3 full |
| ST     | `public/scripts/tokenizers.js`                | 1231 lines | Tokenizer/model mapping                                                 | Ported to `apps/server/src/prompt/tokenizer.ts`; `tiktoken` and the Claude vocabulary do the counting               |
| RisuAI | `src/ts/pngChunk.ts`                          | 324 lines  | Alternative PNG chunk implementation                                    | Cross-check; do not add a duplicate dependency                                                                      |
| RisuAI | `src/ts/process/request/anthropic.ts`         | 1218 lines | Anthropic request/stream details                                        | Reference, especially thinking/tool use                                                                             |
| RisuAI | `src/ts/process/request/google.ts`            | 1306 lines | Gemini/Vertex request details                                           | Reference for future providers                                                                                      |
| RisuAI | `src/ts/process/request/openAI/requests.ts`   | large      | OpenAI requests, Responses API, parameter compatibility                 | Reference implementation                                                                                            |
| RisuAI | `src/ts/characterCards.ts`                    | 2075 lines | JSON/CharX/Risu import/export                                           | Reference for M2 card formats                                                                                       |
| RisuAI | `src/ts/plugins/` + `plugins.md`              | medium     | iframe sandbox plugin API, SafeDOM                                      | Reference for the M3 extension host                                                                                 |
| RisuAI | `server/node/server.cjs`                      | large      | LAN password, sessions, rate limiting, WS proxy                         | Security design reference (we use scrypt + HMAC cookies)                                                            |
| RisuAI | `src-tauri/tauri.conf.json` + `capabilities/` | config     | Tauri 2 packaging, updater, file associations                           | M4 reference                                                                                                        |
| RisuAI | `src/lang/*.ts`                               | large      | Terminology and localization reference                                  | Do not copy copy; localization is deferred                                                                          |

## 3. Port / rewrite (logic reference only)

| Source | File                                                   | Size                   | Why                                                                                      |
| ------ | ------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------- |
| ST     | `public/scripts/openai.js`                             | 7396 lines             | Prompt construction, message collection, token budgeting; DOM/global coupling            |
| ST     | `public/scripts/extensions/tts/`                       | ~11.8k lines           | Provider pipeline, browser speech synthesis, voice maps, text cleaning                   |
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

| Location                                      | Source                                                                            | Notes                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `apps/server/src/cards/parse.ts`              | ST `src/character-card-parser.js` + PNG chunk handling                            | PNG `tEXt` reading and v2/v3 precedence                                           |
| `apps/server/src/cards/write.ts`              | ST `src/character-card-parser.js`                                                 | Card write-back: `chara` + `ccv3` chunks, legacy promotion                        |
| `apps/server/src/cards/png.ts`                | ST `src/png/encode.js`                                                            | PNG chunk serialization and text-chunk replacement                                |
| `packages/shared/src/schemas/character.ts`    | ST Character Card V2/V3 spec                                                      | Field names and `character_book` structure                                        |
| `packages/shared/src/schemas/chat.ts`         | ST chat JSONL                                                                     | Header + message fields                                                           |
| `packages/shared/src/schemas/worldinfo.ts`    | ST World Info JSON                                                                | Entry field set, positions, logic and role constants                              |
| `apps/server/src/worldinfo/matching.ts`       | ST `public/scripts/world-info.js`                                                 | Key matching, regex keys, decorator parsing                                       |
| `apps/server/src/worldinfo/hash.ts`           | ST `public/scripts/utils.js`                                                      | `getStringHash` (cyrb53) for timed-effect identity                                |
| `apps/server/src/worldinfo/loader.ts`         | ST `public/scripts/world-info.js`                                                 | Book shape handling, entry normalization and hashing                              |
| `apps/server/src/worldinfo/scanner.ts`        | ST `public/scripts/world-info.js`                                                 | Full `checkWorldInfo`: scan states, groups, budget, positions                     |
| `apps/server/src/worldinfo/timedEffects.ts`   | ST `public/scripts/world-info.js`                                                 | `WorldInfoTimedEffects`: sticky, cooldown, delay, hand-off                        |
| `apps/server/src/worldinfo/entries.ts`        | ST `public/scripts/world-info.js`                                                 | Entry template defaults, free-uid allocation, patch merge, order                  |
| `apps/server/src/worldinfo/characterBook.ts`  | ST `public/scripts/world-info.js`                                                 | `convertCharacterBook`: card lorebook to world info entries                       |
| `packages/shared/src/keywords.ts`             | ST `public/scripts/world-info.js`                                                 | `splitKeywordsAndRegexes` and `/pattern/flags` validation                         |
| `apps/server/src/worldinfo/prompt.ts`         | ST `world-info.js` + `openai.js`                                                  | Prompt buckets, `wi_format`, Author's Note composition                            |
| `apps/server/src/prompt/definitions.ts`       | ST `PromptManager.js`                                                             | Default prompt definitions, order and identifiers                                 |
| `apps/server/src/prompt/manager.ts`           | ST `PromptManager.js`                                                             | Sanitize, order lookup and prompt collection                                      |
| `apps/server/src/prompt/messages.ts`          | ST `openai.js`                                                                    | `ChatCompletion` slots, budget and system-message squashing                       |
| `apps/server/src/prompt/assemble.ts`          | ST `openai.js`                                                                    | Marker merge, card overrides, injection and population                            |
| `apps/server/src/prompt/history.ts`           | ST `openai.js`                                                                    | History conversion and example-dialogue parsing                                   |
| `packages/shared/src/macros.ts`               | ST `macros.js`                                                                    | Macro subset used by the built-in prompts and message display                     |
| `apps/server/src/prompt/tokenizer.ts`         | ST `public/scripts/tokenizers.js` + `src/endpoints/tokenizers.js`                 | Model to tiktoken-encoding mapping, the byte estimate and Claude counting         |
| `apps/server/assets/tokenizers/claude.json`   | ST `src/tokenizers/claude.json`                                                   | Claude byte-level BPE vocabulary, shipped verbatim                                |
| `packages/shared/src/regex.ts`                | ST `public/scripts/extensions/regex/engine.js`                                    | Placement gate, replacement syntax, trim strings and the depth window             |
| `packages/shared/src/schemas/regex.ts`        | ST `public/scripts/char-data.js` (`RegexScriptData`)                              | Script field names, placements and substitution modes                             |
| `packages/shared/src/schemas/preset.ts`       | ST OpenAI preset                                                                  | Preset fields, `prompts` / `prompt_order`                                         |
| `packages/shared/src/memory.ts`               | ST `public/scripts/extensions/memory/index.js`                                    | Latest-summary lookup on `extra.memory`                                           |
| `apps/server/src/memory/summary.ts`           | ST `public/scripts/extensions/memory/index.js`                                    | Update schedule, transcript window, raw summary prompt                            |
| `apps/server/src/memory/inject.ts`            | ST `public/scripts/extensions/memory/index.js`                                    | Injection template and position formatting                                        |
| `apps/server/src/memory/service.ts`           | ST `public/scripts/extensions/memory/index.js`                                    | Summary request lifecycle and storage                                             |
| `packages/shared/src/schemas/quickreplies.ts` | ST `public/scripts/extensions/quick-reply/src/QuickReplySet.js` + `QuickReply.js` | Version 2 set and quick reply field names and defaults                            |
| `packages/shared/src/quickReplies.ts`         | ST `public/scripts/slash-commands/SlashCommandParser.js`                          | Command split, quoting, aliases and named-argument semantics for the subset       |
| `apps/server/src/quickreplies/execute.ts`     | ST `public/scripts/slash-commands.js` + quick-reply `QuickReplySet.js`            | `/send`, `/sys`, `/echo`, `/trigger` and `/run` behaviour, rewritten server-side  |
| `apps/server/src/storage/quickReplies.ts`     | ST `src/endpoints/quick-replies.js`                                               | One file per set, named after the set, with import and export                     |
| `packages/shared/src/schemas/tts.ts`          | ST `public/scripts/extensions/tts/index.js`                                       | A smaller TTS settings model; field names are CatCup's                            |
| `packages/shared/src/tts.ts`                  | ST `public/scripts/extensions/tts/index.js`                                       | Own text cleaner and chunker; ST's pipeline is longer                             |
| `apps/server/src/tts/openaiCompatible.ts`     | ST `public/scripts/extensions/tts/openai.js` + OpenAI speech API                  | Request shape and error handling, rewritten server-side                           |
| `apps/web/src/hooks/useTts.ts`                | ST `public/scripts/extensions/tts/system.js`                                      | Browser voice selection and chunked utterances, rewritten for React               |
| `packages/shared/src/schemas/images.ts`       | ST `public/scripts/extensions/stable-diffusion/index.js`                          | Smaller image settings model, ST's default negative prompt and prompt-prefix idea |
| `apps/server/src/images/automatic1111.ts`     | ST `src/endpoints/stable-diffusion.js` + `stable-diffusion/index.js`              | `/sdapi/v1/txt2img` request shape and seed extraction, rewritten server-side      |
| `apps/server/src/images/openaiCompatible.ts`  | ST `stable-diffusion/index.js` (`generateOpenAiImage`)                            | `/images/generations` body, size mapping and base64/URL response handling         |
| `apps/server/src/images/prompt.ts`            | ST `stable-diffusion/index.js` (`processReply`, `generationMode.NOW`)             | Draft-from-chat instruction and comma-tag cleanup, Unicode-tolerant rewrite       |
| `apps/server/src/storage/images.ts`           | ST `src/endpoints/images.js` + `saveBase64AsFile`                                 | `user/images/<folder>` layout and base64 upload semantics                         |
| `packages/shared/src/schemas/chat.ts`         | ST `MediaAttachment` / `MEDIA_SOURCE` / `MEDIA_DISPLAY`                           | `extra.media` chat attachment shape and constants                                 |

## 8. Related documentation

- [Milestones](MILESTONES.md)
- [SillyTavern compatibility](ST-COMPATIBILITY.md)
- [Data formats](DATA-FORMATS.md)
- [Documentation index](README.md)
- [NOTICE](../NOTICE)
