# RFC 0002 — Distil world info and characters from a book

- **Issue:** [#77](https://github.com/BerryUIKI/CatCup-Tavern/issues/77)
- **Status:** Proposed — awaiting review
- **Touches:** `apps/server/src/routes/`, a new `apps/server/src/distill/`, `apps/web/src/components/`, `docs/API.md`, `docs/DATA-FORMATS.md`

## The problem

The only ways into CatCup today are a character card or a hand-written world info entry. To roleplay inside a novel, a person has to read it, decide what matters, and type every entry by hand — often hundreds of them, each with `keys`, `content`, `comment` and a scan position.

The material is also too big for one request: a 300-page novel is on the order of 200k–500k tokens, and even with a million-token window the output — dozens of entries and several cards — would not fit in one reply, and one malformed JSON would lose the whole run.

## What it produces

Given a text file, the run produces a **draft** that nobody has written anywhere yet:

- **World info entries** in SillyTavern's schema: `keys`, `keysecondary`, `content`, `comment`, `position`, `order`, `constant`, `selective`, `case_sensitive`, plus `extensions` for CatCup's own provenance (`source: { chapter, offset }`).
- **Character drafts** with `name`, `description`, `personality`, `scenario`, `first_mes`, `mes_example` and `tags`, written in the card shape the library already imports.
- **A review sheet** listing both, grouped by chapter, with everything unticked by default except confidence-high entries.

Nothing is written to `data/` until the person accepts the review.

## The pipeline

```
upload/reference a file
   → parse (txt/md/epub) into ordered sections
   → chunk to a budget
   → per chunk: one analysis request, returns JSON (characters, places, facts, aliases)
   → merge: cluster entities by name+alias across chunks
   → per entity: one outline request over the merged mentions, or the raw mentions if cheap
   → review sheet (editable) → accept → write worlds/<id>.json and characters/<id>.json
```

### 1. Parse

| Format  | How                                                                                    |
| ------- | -------------------------------------------------------------------------------------- |
| `.txt`  | Read as UTF-8; split on blank-line runs, then chapter heading heuristics (`Chapter N`) |
| `.md`   | Split on `#`/`##` headings; a heading becomes the section title                        |
| `.epub` | Read `OEBPS/content.opf` for the spine order, then each XHTML file's visible text      |

`.epub` needs a reader. The project already uses a ZIP reader for CharX and `.catcup`, so the spine is unpacked with it and each XHTML document's text is extracted; no new dependency. EPUBs with DRM are refused with a message saying so.

Output: `Section[] = { title, index, text }`, with the source file described in one `book` record so an entry can point back at it.

### 2. Chunk

Each request carries as many whole sections as fit the **distillation budget**, not the chat budget: the provider's model context size minus the response allowance, minus a margin. A section longer than one chunk is split on paragraph boundaries with an overlap of one paragraph, and the overlap is discarded from the extracted facts after the merge so a fact is not counted twice.

The budget comes from the model the person picks for the run (see _Which model_ below), so a 1M-context model spends far fewer requests than a 32k one.

### 3. Analyse, in parallel

One request per chunk. The prompt asks for strict JSON only:

```json
{
    "characters": [
        { "name": "Mira", "aliases": ["the innkeeper"], "description": "…", "personality": "…", "evidence": "…" }
    ],
    "places": [{ "name": "The Cat's Cup", "aliases": ["the tavern"], "description": "…" }],
    "facts": [{ "subject": "The Cat's Cup", "content": "…", "keys": ["tavern", "cat's cup"], "importance": "high" }]
}
```

Requests run concurrently, capped the way the workflow runner caps agents (a small fixed pool), and each request is cancellable. A chunk that returns malformed JSON is retried once with a repair instruction; a second failure marks the chunk **incomplete** rather than failing the run — the review sheet says which chapters were skipped, so a person can re-run only those.

Progress is streamed, because a 300-page book is minutes of work, not seconds.

### 4. Merge

Entities are clustered by normalised name and alias: exact match first, then case/whitespace folding, then a **cheap second model pass** over only the near-miss names (edit distance, or a shared distinctive token) to decide "is _the innkeeper_ Mira?" That pass is one small request with a list of candidate pairs, not a per-pair request.

Facts attached to a merged entity are de-duplicated by content similarity (token overlap) and kept in source order.

### 5. Outline

For each entity worth keeping — a character with a real role, or a place/faction mentioned more than once — one request over its merged evidence produces the final text:

- a character card field set, or
- a world info entry: `content` written as the entry body, `keys` chosen for how people would mention it in play, `comment` as a short title, `constant: false` unless the story is set there throughout.

Entities mentioned once in passing are offered as **low-confidence** and unticked in the review.

### 6. Review and write

The sheet shows every entry with its evidence and its chapter range, grouped by chapter. Editing is inline, the same text fields the world info editor uses. **Accept** writes:

- `data/worlds/<book title>.json` in the existing world info shape, so it opens in SillyTavern and in the existing editor;
- `data/characters/<name>.json` for each accepted character, through the same import path the library uses, so a card is a card;
- optionally links the book to the accepted characters with `extensions.world`, which **Import lore** already sets.

The run is recorded at `data/distill/<runId>.json` with the book's digest, the chunk map, the model used and what was accepted, so a re-run of the same book with a better model can be diffed rather than repeated blind.

## Which model

Distillation needs a strong, long-context model, and is exactly the kind of job a person wants on a different model from their roleplay. It therefore reuses the model list from #76:

- a **Distill model** setting (Settings → Providers), defaulting to the active provider's default model;
- the run may name any model the active provider serves, and records which it used;
- a different provider is not offered, because the pipeline is one provider's problem; switching provider is one click away in the footer.

Cost is shown before the run starts: `chunks × estimated prompt tokens` and a rough price if the provider reports one. The count comes from the tokenizer already used for budgeting, so an OpenAI model and an Anthropic model predict their own numbers.

## Interface

Entry point: **Import → From a book** in the library, next to **Import from SillyTavern**.

The flow is three steps in one dialog:

1. **Choose** — drop or pick a file; show its size, sections found and estimated requests.
2. **Run** — a progress list, one row per chunk, with the model named, a cancel button and a running count of entries found so far.
3. **Review** — the sheet, with per-chapter groups, checkboxes, inline editing and _Accept selected_.

The dialog is a `Modal` with the same focus and Escape rules as the rest; the run is server-side, so closing the tab does not kill it, and reopening the dialog reattaches to the running job.

## Security and safety

- The uploaded text is untrusted input. It is only ever sent to the configured provider as data inside a clearly delimited block, and the instructions are re-stated after it, so text that says "ignore the above" is treated as story text.
- Upload size is capped (proposal: 20 MB, a limit at least as generous as any novel) and the parser refuses anything it cannot read, naming the file.
- No book text is written to disk beyond what the person accepts; the chunk map in the run record holds offsets, not text.
- The run costs the person's tokens and is cancellable at any point; a cancelled run writes nothing.

## What this deliberately leaves out of the first slice

- **Section-only import with no model call.** A `txt`/`md` file becomes one world info book with an entry per heading — no analysis, no keys beyond the heading, no cards. This is small, deterministic, and useful on its own; it can ship first while the model pipeline is built.
- **Incremental re-distillation** of one chapter added later.
- **Images and audio** from an EPUB.
- **Automatic linking** to an existing library entry when a run produces "Mira" and a Mira card already exists — for now it creates a new card and says so.

## Risks

| Risk                                                   | Impact                         | Mitigation                                                              |
| ------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------- |
| Model returns malformed JSON                           | Lost chunk                     | One repair retry, then mark the chunk incomplete and say so             |
| Entity merging is wrong ("Bram" and "Bram Wyrd" split) | Duplicate entries              | Near-miss pass plus inline merge in the review sheet                    |
| Long run costs more than expected                      | Surprise bill                  | Estimate before starting, show it, cancel any time                      |
| Prompt injection from the book                         | Wrong output, not a breach     | Delimited data block, instructions after it, output validated as JSON   |
| A copyrighted novel ends up in a shared folder         | Distribution problem, not ours | The file is the user's; nothing is uploaded anywhere but their provider |
| EPUB parsing edge cases                                | Some books refused             | Say which file failed and why; `.txt` and `.md` always work             |

## Effort

| Step                                                   | Rough size |
| ------------------------------------------------------ | ---------- |
| Parsers (txt/md/epub), chunker, tokenizer budgeting    | 1–2 days   |
| Analysis and outline prompts, JSON validation, retries | 2 days     |
| Merge pass, de-duplication, near-miss resolution       | 1–2 days   |
| Job registry, SSE progress, cancel, run record         | 1–2 days   |
| Review UI, inline edit, accept-to-world-and-characters | 2–3 days   |
| Docs, tests, fixtures for each format                  | 1 day      |

## Open questions for review

1. **Ship the no-model slice first?** It is a day's work, it makes `.txt`/`.md` useful immediately, and it gives the review sheet a test bed. The proposal is yes.
2. **Entries or one big book per chapter?** Proposal is one book for the whole novel, with `comment` carrying the chapter. A book per chapter is easier to review but clutters the world info list.
3. **How much of the outline should be a second model pass?** The proposal does one pass per entity; a cheaper alternative is to write entries straight from the merge and let the review sheet be the editing surface.
4. **Should the run be resumable after a browser close?** It keeps running server-side; whether reopening must show history from the last run is a nice-to-have the proposal leaves out.
