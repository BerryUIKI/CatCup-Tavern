# @catcup/compat-st

One place for the code CatCup adapted from another tavern client, so the
attribution is a directory rather than a header you have to grep for.

## What it buys

Before this package existed, the provenance was scattered: 22 files through
`apps/server/src` and `packages/shared/src`, each with a header and nothing
tying them together. Now it is one list, and it cannot drift as files are added.

It is **not** a licence boundary. `apps/server` imports this package and is
built with it, so the result is one program; a directory layout is invisible to a
copyright analysis. `docs/REUSE-ISOLATION.md` records what is genuinely adapted,
why, and the plan for replacing it with code written from the specifications.

## What is here

- **Cards** — PNG `tEXt` chunk parse and write, card normalisation, the
  favourite flag, read and written to the Character Card V2/V3 specification.
- **World info** — entry parsing and hashing, key matching, timed effects, the
  scanner, the prompt builder. The scanner is the substantial one: recursion
  states, inclusion groups, the budget latch.
- **Prompt** — the default definition list, history shaping, message collection,
  the tokenizer's model map.

## What is deliberately not here

Anything that reaches back into the app. The loader's file I/O, prompt assembly,
the memory service and the key-splitting helpers all stayed where they were —
the first three because they need storage, providers or the app's own modules,
and the last because the browser needs it too and pulling this package into the
web bundle would drag Node code with it.

A package that imports its own consumer is not a boundary.

## Formats and behaviour are different things

Most of this reads and writes the **tavern data formats** — cards, chats, world
info — a shared standard that every client in the ecosystem implements. Those
files owe their shape to a specification, not to anyone's source.

A smaller set follows one client's _behaviour_ — the scanner's pass order, the
prompt collection's merge rules — which is a choice rather than a standard.
Those are the files `docs/REUSE-ISOLATION.md` tracks for replacement.

## Licence

AGPL-3.0-only, like the rest of the project — CatCup's own choice, and the same
choice most of the tavern ecosystem has made. See `NOTICE` at the repository root
for the attributions.
