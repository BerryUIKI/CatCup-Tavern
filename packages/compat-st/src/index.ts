/**
 * The parts of CatCup adapted from SillyTavern.
 *
 * This package exists so the attribution lives in one boundary instead of being
 * scattered through `apps/server/src`. It is **not** a licence boundary: the app
 * imports this package and is built with it, which makes it one program.
 *
 * Two kinds of file live here, and the headers distinguish them. Most implement
 * the tavern data formats — cards, chats, world info — which are a shared
 * standard any client may implement, and owe their shape to a specification.
 * A smaller set follows SillyTavern's *behaviour* — the scanner's pass order,
 * the prompt collection's merge rules — which is one implementation's choice
 * rather than a standard. `docs/REUSE-ISOLATION.md` lists both, and is where the
 * plan for replacing the second set lives.
 *
 * What is deliberately **not** here: anything that reaches back into the app.
 * The loader's file I/O, prompt assembly's app-side inputs and the memory
 * service all stayed where they were, because a package that imports its
 * consumer is not a boundary.
 *
 * See `NOTICE` for the attribution terms.
 */

/**
 * The key-splitting rule is adapted from SillyTavern, and lives in
 * `@catcup/shared` because the browser needs it too — duplicating a 60-line
 * parser to keep the names tidy would be worse than the untidiness. Re-exported
 * here so `docs/REUSE.md` can point at one place for the attributions.
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
