/**
 * Measure what aliases and the lexical pass actually add to recall.
 *
 * #127 says its result is the measurement that decides whether the embedding
 * layer (#128) is worth building. This is that measurement, with no provider
 * and no cost: it loads a book and a chat paragraph, runs the real scanner
 * three ways, and reports how many entries each way reached.
 *
 *   pnpm --filter @catcup/server recall <book.json> <chat.txt> [--aliases <aliases.json>]
 *
 * `book.json` is a world info file as CatCup stores it. `chat.txt` is the
 * paragraph a person would type. `aliases.json` is a `<book>.aliases.json`
 * sidecar; when it is omitted the tool looks for one beside the book. Nothing
 * is generated — the point is to measure what a sidecar you already have adds.
 *
 * The three runs:
 *
 *   keys only          the book's own keywords
 *   keys + aliases     the same book with its sidecar applied
 *   + lexical          aliases, plus the BM25 pass at the shipped defaults
 *
 * Read the result as: if `keys + aliases` closes most of the gap between
 * `keys only` and `+ lexical`, embeddings would be paying for coverage that
 * aliases already give.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { applyAliases, parseWorldInfoBook } from '../src/worldinfo/loader.js';
import { DEFAULT_WORLD_INFO_SETTINGS, scanWorldInfo } from '../src/worldinfo/scanner.js';
import type { ScanEntry } from '../src/worldinfo/types.js';

interface AliasFile {
    entries?: Record<string, { aliases?: string[] }>;
}

async function readJson<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(file, 'utf8')) as T;
}

/** The entries the scan will see, parsed exactly as the loader parses them. */
function entriesOf(book: unknown): ScanEntry[] {
    return parseWorldInfoBook('measure', book);
}

/** Run the real scanner over one paragraph and count what fired. */
function measure(entries: ScanEntry[], text: string, lexicalMatch: boolean) {
    const result = scanWorldInfo({
        entries,
        chat: [{ text }],
        maxContext: 8192,
        settings: { ...DEFAULT_WORLD_INFO_SETTINGS, lexicalMatch },
    });

    // The trace, not `activated`: a trace line records *why* an entry fired,
    // and the `lexical` reason is exactly what this measurement is about.
    const fired = result.trace.filter((line) => line.activated && line.loop === 1);

    return {
        activated: result.activated.length,
        lexical: fired.filter((line) => line.reason === 'lexical').length,
    };
}

async function main(): Promise<void> {
    // `pnpm run` forwards a bare `--` on Windows rather than swallowing it, so
    // the separator is dropped here instead of being taken for a path.
    const argv = process.argv.slice(2).filter((value) => value !== '--');
    const bookPath = argv[0];
    const chatPath = argv[1];
    if (!bookPath || !chatPath) {
        console.error('Usage: pnpm --filter @catcup/server recall <book.json> <chat.txt> [--aliases <file>]');
        process.exitCode = 2;
        return;
    }

    const aliasFlag = argv.indexOf('--aliases');
    const aliasPath = aliasFlag >= 0 ? argv[aliasFlag + 1] : bookPath.replace(/\.json$/i, '.aliases.json');

    const book = await readJson<unknown>(bookPath);
    const text = (await readFile(chatPath, 'utf8')).trim();
    const aliasFile = await readJson<AliasFile>(aliasPath).catch(() => ({ entries: {} }));

    const plain = entriesOf(book);
    // `applyAliases` takes the sidecar's own shape, so the file is passed
    // through rather than reimplemented — a second normalization could disagree
    // with the loader, and then the number would not be the app's number.
    const aliased = applyAliases(entriesOf(book), (aliasFile.entries ?? {}) as never);

    const aliasCount = aliased.reduce((sum, entry) => sum + entry.autoKeys.length, 0);
    const records = Object.keys(aliasFile.entries ?? {}).length;

    const runs = [
        ['keys only', measure(plain, text, false)],
        ['keys + aliases', measure(aliased, text, false)],
        ['+ lexical', measure(aliased, text, true)],
    ] as const;

    console.log(`\nBook:    ${path.basename(bookPath)}  (${plain.length} entries)`);
    console.log(`Chat:    ${path.basename(chatPath)}  (${text.length} characters)`);
    console.log(`Aliases: ${aliasCount === 0 ? 'none' : `${aliasCount} across ${records} entries`}\n`);

    const width = Math.max(...runs.map(([label]) => label.length));
    for (const [label, stats] of runs) {
        const extra = stats.lexical > 0 ? `  (${stats.lexical} typed \`lexical\`)` : '';
        console.log(`  ${label.padEnd(width)}  ${String(stats.activated).padStart(3)} activated${extra}`);
    }

    const [keys, withAliases, withLexical] = runs.map(([, stats]) => stats.activated);
    const gap = withLexical - keys;
    console.log('');
    if (gap <= 0) {
        console.log('The lexical pass reached nothing this paragraph added, so there is no gap to attribute.');
        return;
    }
    const covered = withAliases - keys;
    console.log(
        `Aliases added ${covered} of the ${gap} entries the lexical pass reached ` +
            `(${Math.round((covered / gap) * 100)}% of the gap).`,
    );
    if (covered >= gap) {
        console.log('Aliases covered the whole gap: embeddings would be paying twice for this paragraph.');
    }
}

await main();
