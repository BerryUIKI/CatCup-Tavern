# Isolating the derived code: what it buys, and what it cannot

Written 2026-11-23, before any code moves.

## First, the thing that does not change

**Moving files does not change what the licence covers.** AGPL-3.0 reaches a
single program; a `packages/compat-st/` that `apps/` imports and builds with is
still one program. Directory layout is invisible to a copyright analysis.

What _would_ change it is making the derived code genuinely optional — an
application that runs, with honest reduced behaviour, when the compat package is
absent. That is a real architectural property, not a rename, and it is the only
version of "isolation" that has legal weight.

So this document separates two things that are easy to conflate:

|                          | What it is                                                                       | What it buys                                                              |
| ------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Provenance isolation** | Derived code lives in one package with one README, one notice, one list of files | Auditability, a clear boundary, and the precondition for anything further |
| **Optional isolation**   | The app runs without that package                                                | A different licence picture, and only then                                |

Provenance isolation is cheap and worth doing on its own. Optional isolation is
a much larger question and is scoped at the end.

## What is actually derived

24 files, about **5,200 lines**, each carrying a `Derived from SillyTavern`
header. They are not evenly weighted:

### The part that cannot be treated as ordinary porting

Three items resist a simple "rewrite it and drop the header" answer, and they
resist it for three different reasons:

1. **`worldinfo/hash.ts` (29 lines)** — `getStringHash` must be byte-identical to
   SillyTavern's cyrb53 over the same payload, because an imported chat's
   `timedWorldInfo` records are keyed by it. But this is a **format** obligation,
   not a behaviour one: the hash is part of how a chat file stores its own state,
   and any client that wants to read that file must compute the same value. The
   _algorithm_ is MIT (cyrb53, bryc). Implementing the format is free.
2. **`assets/tokenizers/claude.json` (1.7 MB)** — copied from SillyTavern's
   `src/tokenizers/claude.json`, already recorded in `NOTICE`. Anthropic ships no
   tokenizer, so there is no upstream to take it from instead. This one is a
   copied file, not a port, and the header is accurate.
3. **`worldinfo/scanner.ts` (1,027 lines)** — the whole scanning semantics:
   recursion state machine, inclusion-group weights, timed effects, budget
   latch. **This is the one where the derived claim is doing real work**, because
   it is _behaviour_ rather than format — "the order these passes run in" is one
   implementation's choice, not a standard. An independent implementation is
   possible, since `docs/` documents the rules; what is in the tree today was
   written by reading their source, and that is what the header records.

### The part that is ordinary porting

Everything else — PNG chunk handling, card parsing, regex engine, tokenizer
mapping, prompt assembly, prompt definitions, memory injection, chat history
shaping. Ported from ST with DOM/global state removed. Substantial, but a
competent reimplementation from the documented behaviour would be a rewrite
rather than a copy, because the behaviour is written down in `docs/`.

### Dependency shape

The derived files form a tight cluster with few edges out:

```
worldinfo/  ← scanner, loader, entries, matching, timedEffects, prompt, characterBook, hash
prompt/     ← assemble, definitions, history, messages, tokenizer
memory/     ← inject, summary, service
cards/      ← parse, write, png, favorite
shared/     ← regex, keywords, memory
```

Six non-test files outside the cluster import into it:

```
routes/generate.ts · routes/groupGenerate.ts · routes/context.ts
storage/worlds.ts · prompt/worldInfoTurn.ts · memory/… (inside)
```

That is small enough that a package boundary is a real refactor rather than a
fantasy: move the cluster into `packages/compat-st`, keep the six import sites
pointing at the package, and the app compiles unchanged.

## What provenance isolation looks like

**Proposed shape**

```
packages/compat-st/
  README.md          what this is, what is derived, from which file and version
  NOTICE             the AGPL notice, moved rather than copied
  src/…              the 24 files, headers intact
```

- `@catcup/compat-st` becomes a workspace package.
- `apps/server` depends on it; the six import sites change their specifier and
  nothing else.
- `docs/REUSE.md` gains a line saying where the code actually lives, and
  `NOTICE` moves its "Portions derived from" section there while the root keeps
  a pointer.
- **No behaviour change.** The gates that prove this are the existing tests,
  which are extensive for exactly this area.

**What it does not do.** It does not make the built app any less AGPL. It does
not change what a person who receives the installer may do. It makes the
boundary legible, which is the honest version of the ask.

**Cost.** A mechanical move plus import rewrites, an afternoon, with the caveat
that moving files invalidates every path in `docs/` that names them — so the
docs sweep is most of the work.

## What optional isolation would take

If the goal is ever "ship a build without AGPL code", this is what stands
between here and there:

1. **World info scanning has no substitute.** Without `scanner.ts` the app has
   `constant` entries and nothing else. A build without it is a different
   product, not a reduced one.
2. **The Claude tokenizer asset** cannot be replaced; the alternative is an
   estimate, which the tokenizer already falls back to when the vocabulary is
   missing. That one _is_ survivable.
3. **`getStringHash`** could be swapped for a different hash only by giving up
   timed-effect compatibility with imported chats — a visible, documented
   regression.
4. **Everything else** is portable by a rewrite, but a rewrite that produces the
   same behaviour is a rewrite in the legal sense only if it was done without
   the source, which for a project that has already read it is a claim nobody
   can make honestly.

So optional isolation is really "build a second, lesser engine", and the honest
answer is that it is not worth doing unless the licence is actually blocking
something — a sale, a customer's legal review — and in that case the cheaper
route is usually a CLA and dual licensing rather than an engine replacement.

## Compatibility is with the format, not with one client

The project's rule is that **data formats** are non-negotiable: a card, a chat
JSONL, a world info book and a preset must round-trip through any tavern client.
That is compatibility with a de-facto standard, and a standard is not anyone's
expression — implementing it independently carries no licence obligation. The
target is the tavern ecosystem, not one implementation of it.

**Runtime behaviour is a separate question.** "How the scanner orders its
recursion passes" is not a format; it is one implementation's choice. Following
it closely is a compatibility convenience, and where the current code follows it
because it was ported, the derivation is real and the header says so. Where a
module merely reads and writes a documented format, the header is the wrong
label — it is written against a specification.

That distinction is what makes this isolation worth doing: it separates "we
implement the tavern data standard" from "we ported this implementation's
algorithm", and only the second is what the licence claim is about. The move
does not relabel anything — the headers stay until each file is genuinely
reimplemented — but it puts a boundary around the ones that are.

## Recommendation

1. **Do the provenance move now.** It is the ask, it is cheap, and it is a
   precondition for any later decision.
2. **Say plainly in `docs/REUSE.md` what it does and does not change**, so the
   next person does not read the new directory as a licence change.
3. **Leave optional isolation as a recorded option**, not a plan. It becomes a
   plan only when someone names the thing it unblocks.
