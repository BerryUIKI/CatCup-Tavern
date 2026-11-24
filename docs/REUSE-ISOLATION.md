# Separating the derived code: evaluation and plan

Written 2026-11-23. Supersedes the earlier assessment of the same name.

## What this is for, and what it is not

**This is about code, not terms.** CatCup is AGPL-3.0-only today and nothing here
changes that. The work is to stop the codebase depending on another project's
source — the licence is a separate decision, made later if ever, and this
document does not take a position on it beyond one point:

> **Keeping the option open is itself a reason to do this.** A tree that contains
> another author's expression cannot be relicensed by its own copyright holder
> without that author's permission. A tree that does not can be, whenever the
> project wants. Whether it ever does is a question for then.

So the goal is **independence of authorship**:

> Every file in this repository should be one that CatCup wrote, not one it
> carried over. A file implementing a published format qualifies. A file that
> still needs a "Derived from SillyTavern" header does not.

Two goods come out of it, and they are worth naming apart:

1. **The headers expire.** A provenance line is a truthful label on adapted code,
   and it stays exactly as long as that is true. The point of the rewrite is that
   the label goes away because the code underneath became CatCup's — never
   because the label became inconvenient.
2. **The code becomes ours to change.** An adapted file has to be understood
   through someone else's design decisions: the scanner, the prompt assembly, the
   memory schedule. Independence is being able to change those because the
   product needs it, rather than matching a reference implementation because that
   is the safe move. For a project still shipping milestones, this is the
   everyday benefit — long before any licence question comes up.

**And the limit of it:** removing a header from code that is still someone else's
would be a false claim, which is worse than the label. Until a file is genuinely
rewritten it keeps its header. Phase 3 is what makes headers disappear by earning
it; phases 0–2 make the inventory honest enough to know what phase 3 has to
touch.

## What is actually in the tree

The inventory is less tidy than it looks, and that is the first finding — and it
was resolved in phase 0, which is why the table below now reads differently from
the one this document opened with.

`docs/REUSE.md` §7 listed **48 files, 9,948 lines**, as coming from another client
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

The buckets, counted from the table after phases 0 and 1:

| Bucket            | What it is                                                                                                                                                                                       | Files | Lines    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | -------- |
| **A. Format**     | A published specification, implemented: the six schemas, card parse and write, card PNG, the favourite flag.                                                                                     | 10    | 1,206    |
| **B. Behaviour**  | Code written by reading another client's source: the scanner, key matching, timed effects, world info parsing, prompt assembly, prompt history, memory scheduling, and the adapters around them. | 37    | 8,745    |
| **C. Expression** | Text and data that is neither a format nor an algorithm. **Rewritten in phase 2**, except the Claude vocabulary (1.7 MB), which is the one item left.                                            | —     | inside B |

Bucket C overlaps B rather than sitting beside it: the text lived inside
`prompt-definitions.ts` and `memory.ts`, which also contain ordinary code. It was
separated because it had a different fix and a different priority, and phase 2
is that fix — the strings are CatCup's now. What remains of C is the vocabulary.

`packages/compat-st/src/keywords.ts` was a duplicate of the `@catcup/shared` copy
that nothing imported. It was deleted in phase 0. `worldinfo/loader.ts` dropped
out of the count in phase 1: it is CatCup's file I/O now, not adapted code.

### The finding that changes the order of work

**The highest-risk content was a handful of short sentences, not the 1,034-line
scanner.**

Copyright protects _expression_; a short creative instruction is exactly what it
protects, while an algorithm sits much closer to the idea/expression line. The
scanner is an algorithm. What was not, before phase 2 rewrote it:

| Where                                     | What                                                     |
| ----------------------------------------- | -------------------------------------------------------- |
| `compat-st/src/prompt-definitions.ts`     | The Main Prompt, Enhance Definitions, and the two nudges |
| `shared/src/memory.ts`                    | Both summarize instructions                              |
| `shared/src/schemas/images.ts`            | The two drafting instructions                            |
| `apps/server/src/routes/groupGenerate.ts` | The group-chat opening line                              |

That is four files, which is why phase 2 existed and why it was worth doing
before the scanner was touched.

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

If the day ever comes when a clean-room claim matters, the only route is a person
who has not read the ported files, working from `docs/` alone. That is a
different project budget. Everything below makes that cheaper, and none of it
substitutes for it. For this project as it stands, the practical reason to do the
work is the first one above: code you can change without checking what someone
else did.

## The plan

Five phases, ordered by value per hour. Each one is independently mergeable and
gated by the existing test suite. None of them touches the licence, which stays
AGPL-3.0 unless the project later decides otherwise.

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

### Phase 1 — re-sort the format bucket — **done**

Bucket A started at 860 lines across six schema files, because the schemas were
written from the specification to begin with. The work was to find what belonged
in A and was filed under B by mistake.

Result: **10 files, 1,206 lines.** Card parsing, card writing, card PNG handling
and the favourite flag are format implementations — the wrapper shape, the
`tEXt` chunks, the PNG container and `extensions.fav` all come from
specifications, and the first versions were marked derived only because they
were written by reading a reference implementation of those formats.

Three judgements went the other way, and they are the useful part:

- **`parse.ts` stays adapted.** The `{ entries }` wrapper and uid resolution are
  the format, but the hash payload — which fields, in which order — is only
  written down in another client's source. The header now says exactly that
  split rather than claiming the whole file.
- **`worldinfo/characterBook.ts` stays adapted.** The field mapping between a
  card's book and a world info entry is ordinary, but what an _absent_ field
  means in the converted entry follows another client's defaults. Under the
  yardstick below, that is behaviour.
- **`worldinfo/loader.ts` loses its header.** It keeps file I/O and re-exports
  the parsers from `compat-st`; the adapted code moved out in the package split,
  so the header was describing a file that no longer contains it.

One header was also wrong in the other direction and is gone:
`distill/sections.ts` claimed "SillyTavern conventions for chapter headings" for
a file it never appears in `REUSE.md`, whose regular expressions are CatCup's own
and whose conventions are just how novels are written.

**Risk realised:** the judgement is genuinely close on `parse.ts` and
`characterBook.ts`, and the first pass got both wrong by being generous. The
rule that settled it: a header may only be dropped when the behaviour it encodes
is written down in a specification. "We happen to match them" is not the test;
"the document says so" is.

### Phase 2 — write CatCup's own instruction text — **done**

Bucket C was larger than this document first said. Five files carried strings
copied from another client, not three:

| File                                      | What was rewritten                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `compat-st/src/prompt-definitions.ts`     | The Main Prompt and Enhance Definitions strings, and the continue-nudge and impersonation templates |
| `shared/src/memory.ts`                    | Both summarize instructions, the append-only one included                                           |
| `shared/src/schemas/images.ts`            | The draft-from-chat instruction and the portrait instruction                                        |
| `apps/server/src/routes/groupGenerate.ts` | The group-chat opening line                                                                         |

The identifiers, the order, the marker flags and the stored field names are
untouched: those are the preset format, and a preset carrying its own text still
wins over every default. What changed is only the wording a fresh install starts
with.

Two judgement calls, both recorded because the next person will want to argue
with them:

- **`[Start a new Chat]` and `[Example Chat]` were left alone.** They are labels,
  not instruction — a model does not need help understanding a bracketed marker,
  and nothing about them is anyone's expression.
- **The image prompt prefix and negative prompt were left alone.** They are a
  comma-separated list of artefact names the models are trained on
  (`lowres`, `bad anatomy`, `worst quality`), which is closer to a vocabulary
  than to prose.

**Visible change:** a fresh install, or a preset that never set these fields,
reads slightly different instructions. Any preset that stored its own text is
unaffected, which is most of them.

**Not done here:** the impersonation and continue nudges live in
`prompt-definitions.ts`, which keeps its adapted header, because the identifier
list and the marker flags beside them are still the reference client's. The
header now says which half is which.

**Buys:** the highest-expression-risk content in the repository is gone. It is
also defensible on product grounds — those defaults were another client's voice,
and should never have been the last thing left unchecked.

### Phase 3 — rewrite the behaviour (the real work) — complete

Bucket B, about 9,050 lines across 40 files. It is done one module at a time, in
this order:

| #   | Module                                             | Lines  | Status                                        |
| --- | -------------------------------------------------- | ------ | --------------------------------------------- |
| 1   | `compat-st/src/matching.ts`                        | 97     | **done** — key matching and decorators        |
| 2   | `compat-st/src/prompt.ts` + `shared/src/macros.ts` | 176    | **done** — prompt buckets and macro expansion |
| 3   | `compat-st/src/timedEffects.ts`                    | 268    | **done** — sticky, cooldown, delay, hand-off  |
| 4   | `memory/{summary,service,inject}`                  | 714    | **done** — scheduling, request, injection     |
| 5   | `compat-st/src/scanner.ts`                         | 1,034  | **done** — the scan pipeline                  |
| 6   | `apps/server/src/prompt/assemble.ts`               | 786    | **done** — the nine assembly phases           |
| 7   | the adapters — images, TTS, quick replies, CharX   | ~2,400 | **done** — see the note below                 |
| 8   | `packages/shared/src/regex.ts`                     | 230    | **done** — the regex engine                   |

Phase 3 is complete: no file in the tree carries a `Derived from` or `Adapted
from` header any more. The remaining files `docs/REUSE.md` lists are either
implementations of a published format (bucket A) or written against a documented
HTTP API, and they say so in their own headers.

Three things the last batch taught, recorded because they are the kind of fact
that only shows up when a rewrite is attempted:

- **`scanner.ts` needed its tests first, and the tests were wrong the first
  time.** Six assertions were written against the existing behaviour before the
  rewrite; five of them described what the reader expected rather than what the
  code did, and each failure was a real fact about the scan — a rewind rule that
  drops a sticky record, a group of one that is not a decision, a `0` total
  weight that picks the first member instead of failing open, a multi-group entry
  that never locks a group because its `group` field is the whole CSV. The
  rewrite then dropped a state transition (a `minActivations` pass handing off to
  recursion) that only those assertions caught.
- **The scanner's own tests depended on an unseeded `Math.random`.** Two of the
  new assertions decided an inclusion group by weighted draw, so they passed or
  failed at random until the roll was seeded. An existing test in the same file
  had the same flaw and had been passing by luck.
- **`parse.ts` was safe to rewrite only because the hash payload is documented.**
  Its old header said the key order was "this client's"; `docs/DATA-FORMATS.md`
  records the payload exactly, which is what turns it from borrowed code into an
  implemented format. The distinction is the whole method: a header comes off
  when the behaviour underneath is written down in a specification, not when
  matching the reference happens to be convenient.

Two rules keep it honest:

- **Each module lands on its own.** Nothing here has to be done in one change,
  and a half-rewritten bucket is still a larger claim than the one today.
- **`docs/ST-COMPATIBILITY.md` is the acceptance bar.** A rewrite that diverges
  from the reference behaviour is either a bug or a new row in the known
  deviations table — never neither.

**Buys:** the behaviour claim, which is the one the whole exercise is about.

### Phase 4 — the two items that outlive the rest

Neither of these is a licence question. Both are about what the tree still
carries after everything that can be rewritten has been.

- **`claude.json`.** Keep it, or drop it and accept the estimate. Keeping it
  costs nothing today and is a 1.7 MB attribution; dropping it makes token
  budgets measurably worse. Recommend keeping until something actually blocks on
  it, and recording that decision here rather than rediscovering it.
- **Bucket B's residual claim.** After phase 3 the honest header on a rewritten
  module is different from either extreme: not "derived", because it was not
  copied, and not "no history", because it was written from behaviour a suite
  pins and that suite was written against the port. Something like "written for
  CatCup against the documented behaviour" is the true statement, and `NOTICE`
  should say it in those words.

### After phase 3

What is left is an ordinary software project: formats implemented from
specifications, behaviour that CatCup chose and is free to change, one third-party
vocabulary, and no file that belongs to somebody else.

The licence at that point is a decision the project can make on its merits rather
than one inherited from its own files: staying on AGPL-3.0 is a perfectly good
answer, and it is the default. Changing it becomes possible because the tree would
no longer contain another author's expression — not because anything in this plan
asks for it.

### An alternative that does not work: make the package optional

The obvious shortcut is to make `compat-st` a distributable package that the app
loads at runtime, and treat it as therefore separate. It is worth recording why
that does not hold, because it is the first idea anyone has.

A package that is **required to run** is a dependency, not a boundary. The
application would still be built against it, would still fail without it, and
would still be distributed with it.

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

## What this plan does not buy

- **It does not produce a clean-room claim.** See the caveat above. Anyone who
  needs one needs a different process, not a smaller diff.
- **It does not make any file's header go away before the code is CatCup's.**
  Removing a provenance line from code that is still adapted would be a false
  claim, which is worse than the label.

## Decisions this needs

1. **`claude.json`: keep or drop?** Recommend keep.
2. **When.** Phases 0–2 are a low-risk few days that can be done whenever. Phase 3
   competes with every feature in `docs/MILESTONES.md` and should be scheduled as
   its own milestone, not slipped in.
3. **Names.** Two artefacts name the other client directly: the package
   `@catcup/compat-st` and `docs/ST-COMPATIBILITY.md`. Both are honest — the
   package really is adapted code, and the document really is a compatibility
   table — but both read as though CatCup is a satellite of one product rather
   than a client in a shared ecosystem. Renaming them is mechanical
   (`compat-st` → `@catcup/tavern-compat` touches 30 import sites; the document
   rename is a link sweep) and is worth doing at the same time as phase 0, when
   the files are being re-read anyway. Recommend yes, and not before.

## The one-line summary

`docs/REUSE.md` lists 48 files and about 9,900 lines as adapted or
format-implementing. Phase 0 made the list accurate, phase 1 moved ten files into
the format column, and phase 2 replaced the instruction text with CatCup's own
wording. What remains is phase 3: 37 files, about 8,700 lines, and the only part
of this that removes a header by earning it.
