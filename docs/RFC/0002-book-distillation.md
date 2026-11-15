# RFC 0002 — Distil world info and characters from a book

- **Issue:** [#77](https://github.com/BerryUIKI/CatCup-Tavern/issues/77)
- **Status:** Accepted 2026-11-14 — implementation in progress
- **Touches:** `apps/server/src/distill/`, `apps/server/src/routes/distill.ts`, `apps/server/src/storage/books.ts`, `apps/web/src/components/`, `docs/API.md`, `docs/DATA-FORMATS.md`

## Decisions taken in review (2026-11-14)

Seven questions were open when this was proposed. They are settled, and the body below is written against the answers rather than restating the question.

| Question                                    | Decision                                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One book for the novel, or one per chapter? | **One book.** Chapters go in `comment`, so the world info list stays readable.                                                                                                                                |
| Does every entity get an outline request?   | **No.** Enough mentions gets its own request; a passing mention is written straight from the merge, marked low confidence and left unticked. Roughly halves the request count.                                |
| Does reopening the dialog show history?     | **No.** The run record on disk is enough; reopening reattaches only to a run that is still running.                                                                                                           |
| Ship the no-model slice first?              | **No.** The complete pipeline ships, but as three PR slices — parse, sections mode, model mode — so each is reviewable on its own. Sections-only stays _a mode of the same pipeline_, not a separate feature. |
| Is the uploaded file kept?                  | **Yes**, at `books/<id>/source.<ext>`. A run can be repeated in place with a better model, and a failed run needs no re-upload. This replaces the "no book text is written to disk" line below.               |
| Can a person merge two entities by hand?    | **Yes.** The review sheet merges a row into a target: contents concatenate, aliases union, evidence merges in source order.                                                                                   |
| Is there a new "distill model" setting?     | **No.** `profilePreferredModel` already exists; the run request carries its own model and the choice is not persisted.                                                                                        |

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

Requests run concurrently in a small fixed pool (4), and each request is cancellable. A chunk that returns malformed JSON is retried once with a repair instruction; a second failure marks the chunk **incomplete** rather than failing the run — the review sheet says which chapters were skipped, so a person can re-run only those.

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

Distillation needs a strong, long-context model, and is exactly the kind of job a person wants on a different model from their roleplay. It therefore picks from the model list that already exists:

- the run request may name any model the active provider serves, defaulting to the one `resolveModel` settles on for this profile;
- the choice is shown in the dialog and **not persisted** — there is no second model setting to keep in step with the first;
- a different provider is not offered, because the pipeline is one provider's problem; switching provider is one click away in the footer.

Cost is shown before the run starts: `chunks × estimated prompt tokens`, from the tokenizer already used for budgeting, so an OpenAI model and an Anthropic model predict their own numbers.

## Interface

Entry point: **Import → From a book** in the library, next to **Import from SillyTavern**.

The flow is three steps in one dialog:

1. **Choose** — drop or pick a file; show its size, sections found and estimated requests.
2. **Run** — a progress list, one row per chunk, with the model named, a cancel button and a running count of entries found so far.
3. **Review** — the sheet, with per-chapter groups, checkboxes, inline editing and _Accept selected_.

The dialog is a `Modal` with the same focus and Escape rules as the rest; the run is server-side, so closing the tab does not kill it, and reopening the dialog reattaches to the running job.

## Security and safety

- The uploaded text is untrusted input. It is only ever sent to the configured provider as data inside a clearly delimited block, and the instructions are re-stated after it, so text that says "ignore the above" is treated as story text.
- Upload size is capped at 20 MB — already the server's multipart limit — and the parser refuses anything it cannot read, naming the file.
- The book lives in the profile that uploaded it, beside a record that holds titles and sizes only. It is never sent anywhere but the configured provider, and it is deleted with the profile or with `DELETE /api/distill/books/:id`.
- The chunk map in the run record holds offsets, not text.
- The run costs the person's tokens and is cancellable at any point; a cancelled run writes nothing to `worlds/` or `characters/`.

## What this deliberately leaves out of the first slice

- **Incremental re-distillation** of one chapter added later.
- **Images and audio** from an EPUB.
- **Automatic linking** to an existing library entry when a run produces "Mira" and a Mira card already exists — for now it creates a new card and says so.

(The "sections-only import with no model call" item that used to head this list is no longer out of scope: it is `mode: 'sections'`, part of the same pipeline.)

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

## How it shipped

Three PR slices, each independently reviewable and CI-green:

1. **Parse and store** — `packages/shared/src/schemas/distill.ts`, `apps/server/src/distill/{sections,parse,chunk,estimate}.ts`, `apps/server/src/storage/books.ts`, `apps/server/src/routes/distill.ts`. A book can be uploaded, listed, read back and deleted. `books/` and `distill/` join `SCOPED_DIRECTORIES`, so they are created, migrated and archived with the profile for free.
2. **Sections mode** — the run engine without a model call, its SSE events, the dialog and the review sheet, and the accept path. This is the slice that makes the feature usable end to end.
3. **Model mode** — analyze, merge, outline, chunk progress, manual merge.

Progress and cancellation reuse the shapes already in the server: the SSE writer in `apps/server/src/sse.ts`, and a registry beside `activeGenerations`. A distill run is deliberately **not** aborted when its socket closes — minutes of work must survive a tab close — so it is stopped only through its endpoint, and the profile switch guard (`PROFILE_BUSY`) covers a run in flight.

## Decisions this RFC records for later

- **Chunking uses the configured context size**, not the model's real one: `ModelInfo` is `{ id, name }` and carries no context length. A model with a 1M window is therefore chunked at the profile's 32k default. This is the honest limitation of not having per-model metadata, and it is correct but wasteful rather than wrong.
- **Entities are clustered in-process, not in the model**, except for one batched near-miss request. A per-pair request would cost more than the outline pass it is meant to save.
