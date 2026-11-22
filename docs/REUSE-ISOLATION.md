# Separating the derived code: evaluation and plan

Written 2026-11-23. Supersedes the earlier assessment of the same name.

## The goal, stated as a property of the tree

The project reads and writes the tavern data formats — character cards, chat
JSONL, world info, presets. Those are a **de-facto standard**: a dozen unrelated
clients implement them, and implementing a published format carries no obligation
to anyone. That is the part this project can claim outright.

A small part of the tree is different. It carries a second author's _expression_
rather than a format: prose that was copied, and algorithms that were read and
then reproduced line by line. That part is what has to shrink.

So the target is a property of the source tree, not of a licence file:

> **Every file in this repository is either written for CatCup or implements a
> published format. Nothing is a copy of another client's expression.**

Reach that and the licence question becomes a free choice rather than something
the tree decides. Do not reach it, and no amount of packaging changes what the
tree is.

**A dominant fact, and the reason this is tractable:** of 427 commits, 420 are one
author's. There is no contributor whose agreement would have to be sought before
anything here is relicensed. The only thing standing between this project and any
licence it wants is the derived column below.

## What is actually in the tree

30 files carry a provenance comment or are listed in `REUSE.md` as coming from
another client. About 6,200 lines in total, not counting the 1.7 MB vocabulary.
They are not one problem: three buckets, and the third is not the one intuition
points at.

| Bucket            | What it is                                                                                                                                                  | Files | Lines        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------ |
| **A. Format**     | Reads and writes a published format. Card parse/write/PNG, world info parse and entry shape, the card and quick-reply schemas, chapter-heading conventions. | 14    | 1,924        |
| **B. Behaviour**  | One implementation's _choices_: the scanner, key matching, timed effects, prompt assembly, prompt history, memory scheduling.                               | 14    | 3,985        |
| **C. Expression** | Text and data that is neither a format nor an algorithm: two default prompt strings, one summarize instruction, and the Claude vocabulary.                  | 2     | 325 + 1.7 MB |

Plus one dead file: `packages/compat-st/src/keywords.ts`, a duplicate of the
`@catcup/shared` copy that nothing imports. It is deleted in phase 0 rather than
counted.

A file that is genuinely both a format and behaviour is counted where its header
puts it. `docs/REUSE.md` §7 is the authority for which file is which; this table
is a summary of it.

### The finding that changes the order of work

**The highest-risk content is three short sentences, not the 1,034-line scanner.**

`prompt-definitions.ts` carries the Main Prompt and the Enhance Definitions
prompt verbatim. `shared/memory.ts` carries the memory extension's summarize
instruction. Copyright protects _expression_; a short creative instruction is
exactly what it protects. An algorithm, by contrast, sits much closer to the
idea/expression line — and the scanner is an algorithm.

The same logic removes one item from the "irreducible" list entirely.
`hash.ts` is cyrb53, published by bryc as MIT. The algorithm is free to use; what
makes the file derived today is that it was copied out of another project's
utility module. Taking cyrb53 from its own source, with its own credit, leaves
nothing derived in those 29 lines. Its header already says as much.

### What genuinely resists

Two things, and only two:

1. **`claude.json`, the Claude tokenizer vocabulary (1.7 MB).** Anthropic ships
   no tokenizer, so there is no upstream to take it from. Whatever its provenance
   chain, it is not this project's, and it is not a format. The tokenizer already
   falls back to a byte estimate when the file is absent — so the app _runs_
   without it, badly. This is a product decision, not a rewrite.
2. **The behaviour in bucket B that was reproduced by reading the code.** More
   below, because it is the part no refactor can finish.

## Can bucket B actually be rewritten?

Yes, with one honest caveat.

The rules _are_ documented — `docs/DATA-FORMATS.md`, `docs/ST-COMPATIBILITY.md`
— and the 91 test files pin the behaviour of every one of these modules. A
reimplementation written against those documents and gated on those tests is a
real, achievable piece of work.

What it is **not** is a clean-room rewrite, and pretending otherwise would be the
one thing that damages this project's position. The test suite was itself written
by reading the ported code. A rewrite that must pass it will converge on the same
expression. So:

- **Achievable claim:** "written from the format documentation and a behaviour
  suite, not transcribed."
- **Not achievable by refactoring:** "never read the source."

If the day ever comes when a clean-room claim matters — a sale, a customer's
legal review — the only route is a person who has not read the ported files,
working from `docs/` alone. That is a different project budget. Everything below
makes that cheaper, and none of it substitutes for it.

## The plan

Five phases, ordered by value per hour. Each one is independently mergeable and
gated by the existing test suite.

### Phase 0 — make the inventory true (an hour)

- Delete `packages/compat-st/src/keywords.ts`: a duplicate of the copy in
  `@catcup/shared` with nothing importing it.
- Re-source `hash.ts` from cyrb53's own publication, credit bryc, drop the
  derived header. The algorithm was never the other project's.
- Add the missing headers to `apps/server/src/prompt/manager.ts` and
  `packages/shared/src/macros.ts`, both listed in `REUSE.md` as ports but
  carrying no provenance line.

**Buys:** the inventory can be trusted as a baseline. Everything after it is
measured against a number that is correct.

### Phase 1 — close the format bucket (a day)

Bucket A, 1,924 lines. These implement published formats, so the work is mostly
_re-labelling_: a header that says "implements the Character Card V3
specification" instead of "derived from …", with the spec URL. Where a function
was genuinely transcribed rather than written against the spec, rewrite that
function — the tests decide which ones those are, and there will be few.

**Buys:** the largest reduction per hour spent. It also corrects a factual error
in `README.md` and `NOTICE`, both of which currently say the _formats_ follow
another client's licence. They follow a standard.

**Risk:** low. The round-trip tests are exactly the right gate.

### Phase 2 — write CatCup's own default prompts (a day)

Bucket C's text: the Main Prompt and Enhance Definitions strings, and the memory
summarize instruction. Replace them with CatCup's own wording. This is a visible
behaviour change to a fresh install and a no-op for anyone with a saved preset,
because a preset stores the text.

**Buys:** removes the highest-expression-risk content in the repository. It is
also defensible on product grounds — those defaults are another client's voice,
and they should never have been the last thing left unchecked.

### Phase 3 — rewrite the behaviour (the real work)

Bucket B, 3,985 lines. Priority order by size and by how much of the claim each
carries:

1. `scanner.ts` (1,034) — recursion states, inclusion groups, the budget latch.
2. `prompt/assemble.ts` (786) — marker merge, card overrides, injection.
3. `timedEffects.ts` (268), `memory/{service,summary}` (525), `matching.ts` (97),
   `prompt/{history,messages,tokenizer}` and the rest.

Written against `docs/` and gated by the existing tests. Each module lands on its
own; nothing here has to be done in one change.

**Buys:** the behaviour claim, which is the one the whole exercise is about.

**Cost:** weeks, not days, and it is the phase where "good enough" is easy to
accept prematurely. `docs/ST-COMPATIBILITY.md` is the acceptance bar: a rewrite
that diverges is either a bug or an entry in that table, never neither.

### Phase 4 — decide the two irreducible items

- **`claude.json`.** Keep it, or drop it and accept the estimate. Keeping it
  costs nothing today and is a 1.7 MB attribution; dropping it makes token
  budgets measurably worse. Recommend keeping until something actually blocks on
  it, and recording that decision here rather than rediscovering it.
- **Bucket B's residual claim.** After phase 3, the honest statement is "written
  from documentation and a behaviour suite". Record it in `NOTICE` in those
  words. That is a smaller, more accurate claim than today's, and it is the true
  one.

### Phase 5 — the licence question, last

Once phases 0–3 are done, the derived column is A: nothing, B: a reduced claim,
C: one data file. At that point the choice is open and costs nothing to make:

- **Stay AGPL-3.0.** The ecosystem norm, and compatibility with a library of
  AGPL-hosted content is a real argument for it.
- **Dual-licence or relicense.** Possible now in a way it is not today, because
  the tree no longer contains another author's expression.

Making that call before phase 3 would be deciding on a tree that does not exist
yet.

### An alternative that does not work: make the package optional

The obvious shortcut is to make `compat-st` a distributable package that the app
loads at runtime, and argue the build is therefore not one program. It is worth
recording why that does not hold, because it is the first idea anyone has.

A package that is **required to run** is a dependency, not a boundary. The
application would still be built against it, would still fail without it, and
would still be distributed with it. Nothing about the combined work changes.

A package that is **genuinely optional** — the app starts and behaves sensibly
without it — is a real architectural property, and it is the only shape of this
idea with anything behind it. So: could CatCup run without `compat-st`?

| Capability         | If the package is absent                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| Card import/export | Gone. This is the product's reason to exist — cards are how content arrives.                    |
| World info         | `constant` entries only: no key matching, no recursion, no budget. Books become close to inert. |
| Prompt assembly    | Gone; there is no second implementation of the message collection.                              |
| Token counting     | An estimate, which already exists as a fallback. **Survivable.**                                |

So a build without the package is not a reduced CatCup, it is a different and
worse product that cannot open a character card. That is not a boundary worth
paying for, and it is why the plan is _rewrite the contents_ rather than _cut the
package out_: phases 0–3 shrink what the package owes to anyone, and phase 3 is
what would eventually leave nothing in it but format implementations — which any
distribution may carry anyway.

## What this plan does not buy

- **It does not make the built app any less AGPL while bucket B is ported.** No
  directory layout, package boundary or build configuration changes that. Only
  phase 3 does.
- **It does not produce a clean-room claim.** See the caveat above. Anyone who
  needs one needs a different process, not a smaller diff.
- **It is not legal advice.** The engineering position is in this document; a
  lawyer confirms it before anything ships under a different licence.

## Decisions this needs

1. **Is the goal a smaller adapted column, or a different licence?** The plan
   above is the same either way through phase 3, and the answer only decides
   whether phases 4–5 happen. Recommend: do 0–3 for their own sake, then decide.
2. **`claude.json`: keep or drop?** Recommend keep.
3. **When.** Phases 0–2 are three days of work with a low risk profile and can be
   done whenever. Phase 3 competes with every feature in `docs/MILESTONES.md` and
   should be scheduled as its own milestone, not slipped in.
4. **Names.** Two artefacts name the other client directly: the package
   `@catcup/compat-st` and `docs/ST-COMPATIBILITY.md`. Both are honest — the
   package really is adapted code, and the document really is a compatibility
   table — but both read as though CatCup is a satellite of one product rather
   than a client in a shared ecosystem. Renaming them is mechanical
   (`compat-st` → `@catcup/tavern-compat` touches 30 import sites; the document
   rename is a link sweep) and is worth doing at the same time as phase 1, when
   the files are being re-read anyway. Recommend yes, and not before.

## The one-line summary

The tree is 30 files and about 6,200 lines away from containing nothing adapted,
and phase 1 — the cheapest phase, at roughly a day — closes just under a third of
it. Nothing here is urgent, nothing here is blocking a release, and the plan is
written so it can be picked up a phase at a time by anyone who reads it.
