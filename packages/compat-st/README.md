# @catcup/compat-st

The parts of CatCup that were **ported from SillyTavern**, in one place.

## What this is for

Before this package existed, the derivation was a fact you had to grep for: 22
files scattered through `apps/server/src` and `packages/shared/src`, each with a
`Derived from SillyTavern` header. Now it is a directory.

That is the whole benefit, and it is worth being precise about what it is not:

**This package does not change what AGPL-3.0 covers.** `apps/server` imports it
and is built with it, so the result is one program. Moving files is invisible to
a copyright analysis. What changed is auditability — `docs/REUSE-ISOLATION.md`
explains the difference and what a genuine licence boundary would require.

## What is here

- **Card handling** — PNG `tEXt` chunk parse and write, card normalisation, the
  favourite flag. Ported from SillyTavern's `src/character-card-parser.js` and
  `src/png/`.
- **World info** — the entry hash, key matching, timed effects, the scanner, the
  entry-access helpers, the prompt builder. The scanner is the substantial one:
  recursion states, inclusion groups, the budget latch.
- **Prompt** — the definition list, history shaping, message collection, the
  tokenizer's model map.
- **Pure parsing** — `parse.ts`, the functions that turn a stored book into scan
  entries. The file I/O stays in `apps/server/src/worldinfo/loader.ts`, which
  re-exports these so import sites did not have to change.

## What is deliberately not here

Anything that reaches back into the app. The loader's file I/O, prompt assembly,
the memory service and the key-splitting helpers all stayed where they were —
the first three because they need storage, providers or the app's own modules,
and the last because the browser needs it too and pulling this package into the
web bundle would drag Node code with it.

A package that imports its own consumer is not a boundary.

## Compatibility is with the format

Most of this reads and writes the tavern data formats — cards, chats, world
info — and those are a de-facto standard, not anyone's expression. Where a file
follows SillyTavern's _behaviour_ rather than its format, the header says which
file it came from. `docs/REUSE-ISOLATION.md` explains why that distinction is
the one that matters.

## Licence

AGPL-3.0-only, as the rest of the project. See `NOTICE` at the repository root.
