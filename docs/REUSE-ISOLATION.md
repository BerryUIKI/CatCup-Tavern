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

The inventory is less tidy than it looks, and that is the first finding — and it
was resolved in phase 0, which is why the table below now reads differently from
the one this document opened with.

`docs/REUSE.md` §7 lists **48 files, 9,948 lines**, as coming from another client
or implementing one of its formats. When phase 0 began, their provenance was
recorded three different ways:

| How the provenance was recorded                          | Files | Lines |
| -------------------------------------------------------- | ----- | ----- |
| A `// Derived from …` / `// Adapted from …` line header  | 22    | 4,995 |
| A mention inside a doc comment only                      | 4     | 457   |
| Nothing in the file; the REUSE.md table was the only one | 22    | 4,496 |

That last row was the problem: **a header grep undercounted the real figure by
about 4,500 lines**, so any number quoted from headers — including the 5,300
lines this document's first revision quoted — was too low. Phase 0 closed it.
Every one of the 48 now carries a line header that states what is true of that
file: the specification it implements, or the upstream file it was adapted from.

The buckets, counted from the table:

| Bucket            | What it is                                                                                                                                                                                 | Files | Lines    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | -------- |
| **A. Format**     | A published specification, implemented. The six schema files — card, chat, world info, preset, regex, quick replies.                                                                       | 6     | 860      |
| **B. Behaviour**  | Code written by reading another client's source: the scanner, key matching, timed effects, card parsing, prompt assembly, prompt history, memory scheduling, and the adapters around them. | 42    | 9,088    |
| **C. Expression** | Text and data that is neither a format nor an algorithm: two default prompt strings, one summarize instruction, and the Claude vocabulary (1.7 MB).                                        | —     | inside B |

Bucket C overlaps B rather than sitting beside it: the prompt strings live inside
`prompt-definitions.ts` and `memory.ts`, which also contain ordinary code. It is
separated because it is the part with a different fix and a different priority.

`packages/compat-st/src/keywords.ts` was a duplicate of the `@catcup/shared` copy
that nothing imported. It was deleted in phase 0.

### The finding that changes the order of work

**The highest-risk content is three short sentences, not the 1,034-line scanner.**

`prompt-definitions.ts` carries the Main Prompt and the Enhance Definitions
prompt verbatim. `shared/memory.ts` carries the memory extension's summarize
instruction. Copyright protects _expression_; a short creative instruction is
exactly what it protects. An algorithm, by contrast, sits much closer to the
idea/expression line — and the scanner is an algorithm.

The same logic removed one item from the "irreducible" list entirely, and that
one is already done. `hash.ts` is cyrb53, published by bryc as MIT. The algorithm
was free to use; what made the file derived was that it had been copied out of
another project's utility module. Re-sourced from bryc's own repository in phase
0, it owes nothing to anyone but its author.

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

### Phase 0 — make the inventory true — **done**

- ~~Delete `packages/compat-st/src/keywords.ts`~~: it was a duplicate of the copy
  in `@catcup/shared` with nothing importing it. Gone.
- ~~Re-source `hash.ts` from cyrb53's own publication~~, credit bryc, drop the
  derived header. The algorithm was never the other project's; the file now cites
  bryc's own repository and says what about it CatCup depends on.
- ~~Give the files with no provenance comment one~~, per `CONTRIBUTING.md`'s rule
  — or, for the format implementations among them, a line saying which
  specification the file implements. All 48 files that `REUSE.md` lists now carry
  a header that states which of the two is true.

**Bought:** a baseline that is correct. The header count used to understate the
real figure by about 4,500 lines; it does not any more, and phase 1's scope is
now knowable.

One thing the sweep turned up: `card-parse.ts` and `card-favorite.ts` were already
implementing the card format and said "derived" because the first version was
written by reading a reference implementation of it. They are re-labelled rather
than rewritten, which is the same judgement phase 1 applies to the rest.

### Phase 1 — re-sort the format bucket (half a day)

Bucket A is small — 860 lines, six schema files — because the schemas were written
from the specification to begin with. So the work here is to find what belongs in
A and was filed under B by mistake. Two candidates are already settled: card
parsing and the favourite flag. The remaining ones are world info entry parsing,
PNG chunk handling and the sidecar-ish helpers around them.

Sorting them honestly has a disproportionate effect: it moves a few hundred lines
out of the column that needs rewriting, and it keeps `README.md` and `NOTICE`
accurate about which parts follow a standard.

**Risk:** low, but it needs care. Calling a file "format" is a claim of fact, and
the test is whether the behaviour it encodes is written down in a specification
or only in another client's source. §"Can bucket B actually be rewritten?" below
is the yardstick.

### Phase 2 — write CatCup's own default prompts (a day)

Bucket C's text: the Main Prompt and Enhance Definitions strings, and the memory
summarize instruction. Replace them with CatCup's own wording. This is a visible
behaviour change to a fresh install and a no-op for anyone with a saved preset,
because a preset stores the text.

**Buys:** removes the highest-expression-risk content in the repository. It is
also defensible on product grounds — those defaults are another client's voice,
and they should never have been the last thing left unchecked.

### Phase 3 — rewrite the behaviour (the real work)

Bucket B, 9,088 lines, or whatever phase 0 and phase 1 leave in it. Priority
order by size and by how much of the claim each carries:

1. `compat-st/src/scanner.ts` (1,034) — recursion states, inclusion groups, the
   budget latch.
2. `apps/server/src/prompt/assemble.ts` (786) — marker merge, card overrides,
   injection.
3. `compat-st/src/timedEffects.ts` (268), `memory/{service,summary}` (525),
   `compat-st/src/matching.ts` (97), `compat-st/src/prompt-{history,messages,
   tokenizer}.ts` and the rest.

This is weeks, not days, and it is the phase where "good enough" is easy to
accept prematurely. Two rules keep it honest:

- **Each module lands on its own.** Nothing here has to be done in one change,
  and a half-rewritten bucket is still a larger claim than the one today.
- **`docs/ST-COMPATIBILITY.md` is the acceptance bar.** A rewrite that diverges
  from the reference behaviour is either a bug or a new row in the known
  deviations table — never neither.

**Buys:** the behaviour claim, which is the one the whole exercise is about.

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
3. **When.** Phases 0–2 are a low-risk few days that can be done whenever. Phase 3
   competes with every feature in `docs/MILESTONES.md` and should be scheduled as
   its own milestone, not slipped in.
4. **Names.** Two artefacts name the other client directly: the package
   `@catcup/compat-st` and `docs/ST-COMPATIBILITY.md`. Both are honest — the
   package really is adapted code, and the document really is a compatibility
   table — but both read as though CatCup is a satellite of one product rather
   than a client in a shared ecosystem. Renaming them is mechanical
   (`compat-st` → `@catcup/tavern-compat` touches 30 import sites; the document
   rename is a link sweep) and is worth doing at the same time as phase 0, when
   the files are being re-read anyway. Recommend yes, and not before.

## The one-line summary

`docs/REUSE.md` lists 48 files and about 9,900 lines as adapted from another
client, and only 860 of them are already clean as format implementations. Nothing
here is urgent, nothing is blocking a release, and the phases are independent
enough that any of them can be picked up alone by whoever reads this next.
