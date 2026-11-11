# Glossary

Terms used in CatCup Tavern, SillyTavern compatibility work and the surrounding ecosystem.

## Character and chat

**Character card** — The portable definition of a character: name, description, personality, scenario, greetings, example dialogue and optional lorebook. CatCup reads PNG-embedded and JSON cards.

**V2 / V3 card** — Character Card specification versions. V2 stores data under `data` with `chara` in PNG; V3 adds assets and other fields under `ccv3`. CatCup reads both and normalizes to the V3 data shape.

**`chara` / `ccv3`** — PNG `tEXt` chunk keys holding base64-encoded card JSON. `ccv3` takes precedence.

**Character book** — A lorebook embedded inside a character card. CatCup can copy it into the world info library and link it to the card with **Import lore**.

**Chat JSONL** — The SillyTavern chat format: one header line followed by one JSON message per line.

**Swipe** — An alternative assistant reply to the same conversation state. Swipes are stored in `extra.swipes`; `extra.swipe_id` selects one.

**Regenerate** — Ask the model for a new assistant reply and store it as a swipe.

**Branch / checkpoint** — A saved fork of a chat from an earlier message. Planned for M1.

**Persona** — The user's own name and description used in prompts. CatCup currently supports one persona.

**Author's note** — A prompt fragment injected near the end of the context. Planned for M1.

**Group chat** — Multiple characters in one conversation. Planned for M2.

## Lore and prompts

**World Info / lorebook** — A set of keyed entries injected into the prompt when their keys appear in recent chat. CatCup has the schema; the scanner/editor is planned for M1.

**Entry** — One World Info record: keys, content, order, position, depth, probability and related flags.

**Prompt Manager** — SillyTavern's ordered list of prompt segments with roles, injection positions/depths and enable flags. Planned for M1.

**Preset** — A saved set of sampling parameters and prompt entries/order, usually imported from SillyTavern's OpenAI preset JSON. Planned for M1.

**Macro** — A template token such as `{{char}}` or `{{user}}` replaced at prompt-build time.

**Context budget** — The maximum number of tokens sent to the model for a request, split between the prompt and the reply budget.

**Token** — A model's unit of text. CatCup currently uses an approximation; a model-aware tokenizer is planned for M1.

**Reasoning** — Provider-returned "thinking" content separate from the visible reply. CatCup streams it and stores it in `extra.reasoning`.

## Scripting and extensions

**STscript** — SillyTavern's slash-command scripting language. Planned for M3.

**Slash command** — A command such as `/send` or `/sys` executed by the STscript engine.

**Quick Reply** — A reusable button/command set, often STscript-backed. Planned for M2/M3.

**Regex script** — A SillyTavern extension that transforms text or prompts with regular expressions. Planned for M2.

**Extension** — A third-party ST plugin. L3 (API) and L4 (DOM) compatibility are planned for M3.

**`getContext()`** — SillyTavern's extension API surface, exposing characters, chats, generation, events and settings. CatCup plans a compatibility shim.

**Sandbox** — An isolated iframe/host boundary for running untrusted UI extensions.

## Runtime and infrastructure

**Provider** — A model backend: OpenAI-compatible, OpenRouter, Anthropic, Ollama or a custom endpoint.

**OpenAI-compatible** — A server implementing `/chat/completions` and usually `/models` with OpenAI's request/response shape.

**SSE (Server-Sent Events)** — The one-way streaming protocol used for generation events (`start`, `token`, `reasoning`, `done`, `error`).

**Tauri** — The Rust-based desktop shell planned for M4. The React SPA runs in a native window; a Node sidecar hosts the server.

**Sidecar** — The bundled Node server process started by the Tauri app.

**Single-user** — The current security model: one password, one shared set of characters/chats/settings, no per-user isolation.

**AGPL-3.0** — The project's license. Network use by others requires providing the corresponding source.

**SillyTavern (ST)** — The reference AI roleplay client whose data formats and interaction semantics CatCup follows.

**RisuAI** — A modern Svelte + Tauri AI client used as a reference for provider logic, character import and packaging.
