/**
 * The parts of CatCup that were ported from SillyTavern.
 *
 * This package exists so the derived code has one boundary instead of being
 * scattered through `apps/server/src`. It does **not** change what AGPL-3.0
 * covers: the app imports this package and is built with it, which makes it one
 * program. What it buys is that the derivation is a fact you can look up rather
 * than a header you have to grep for.
 *
 * Everything here reads and writes the tavern data formats — cards, chats,
 * world info — and those are a standard, not an implementation. Where a file is
 * derived from SillyTavern's *behaviour* rather than its file format, the header
 * says which file it came from; `docs/REUSE-ISOLATION.md` explains the
 * difference and why it matters.
 *
 * What is deliberately **not** here: anything that reaches back into the app.
 * The loader's file I/O, prompt assembly's app-side inputs and the memory
 * service all stayed where they were, because a package that imports its
 * consumer is not a boundary.
 *
 * See `NOTICE` for the licence terms of the derived portions.
 */

/**
 * The key-splitting rule is derived from SillyTavern, and lives in
 * `@catcup/shared` because the browser needs it too — duplicating a 60-line
 * parser to keep the names tidy would be worse than the untidiness. Re-exported
 * here so `docs/REUSE.md` can point at one place for what is derived.
 */
export { isValidRegex, splitKeywordsAndRegexes } from '@catcup/shared';
export * from './card-favorite.js';
export * from './card-parse.js';
export * from './card-png.js';
export * from './card-write.js';
export * from './hash.js';
export * from './matching.js';
export * from './parse.js';
export * from './prompt.js';
export * from './prompt-definitions.js';
export * from './prompt-history.js';
export * from './prompt-messages.js';
export * from './prompt-tokenizer.js';
export * from './scanner.js';
export * from './timedEffects.js';
export * from './worldinfo-types.js';
