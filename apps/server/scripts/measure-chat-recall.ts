/**
 * Measure what a lexical recall pass over a chat would actually have found.
 *
 * The append-only summary change (PR #137) stops a long chat losing its
 * *beginning*. It does nothing for the middle: a detail that fell out of the
 * summary chain and then out of the prompt window is still unreachable. A BM25
 * pass over the messages is the cheap candidate that would fix that, and this
 * script is the number that decides whether it earns its place.
 *
 *   pnpm --filter @catcup/server chat-recall <chat.jsonl> [--window 5] [--top 3]
 *
 * For each turn it reconstructs what the prompt would have seen — the window of
 * messages the budget keeps, *including* the turn being answered — asks a BM25
 * index built from every message what it would have surfaced, and counts the
 * hits that came from messages the window had already dropped.
 *
 * With no provider and no key, there is nothing to fail: the only inputs are the
 * chat file and the window size.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { Bm25Index } from '../src/retrieval/bm25.js';

/** One line of a SillyTavern chat file. */
export interface ChatLine {
    name?: string;
    is_user?: boolean;
    mes?: string;
    is_system?: boolean;
    extra?: { memory?: string };
}

export interface Turn {
    index: number;
    text: string;
}

export interface RecallCounts {
    examined: number;
    recoverable: number;
    hits: number;
    /** How many hits landed at rank 1, 2, 3, ... of the scored list. */
    byRank: number[];
}

/**
 * How far below the best hit a message may score and still count.
 *
 * Relative, not absolute, for the same reason the world info scanner's
 * `lexicalThreshold` is: a BM25 score has no meaning across corpora, so an
 * absolute cut would be arbitrary.
 */
export const FLOOR = 0.35;

async function readChat(file: string): Promise<ChatLine[]> {
    const raw = await readFile(file, 'utf8');
    const lines: ChatLine[] = [];

    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) {
            continue;
        }
        try {
            lines.push(JSON.parse(trimmed) as ChatLine);
        } catch {
            // A header line or a hand-edited row is skipped rather than failing
            // the run: a real chat file is not always clean, and one bad line
            // should not cost the measurement.
        }
    }

    return lines;
}

/**
 * The messages a person would read in the prompt, in order.
 *
 * `is_system` rows are skipped because the prompt skips them. The stored text is
 * used as-is, which is what the chat view shows; regex scripts and macro
 * expansion are deliberately not applied, because they need the card and the
 * preset and their effect on vocabulary is small beside the question asked.
 */
export function turnsOf(lines: readonly ChatLine[]): Turn[] {
    const turns: Turn[] = [];
    let index = 0;

    for (const line of lines) {
        if (line.is_system || typeof line.mes !== 'string' || !line.mes.trim()) {
            continue;
        }
        turns.push({ index, text: line.mes.trim() });
        index += 1;
    }

    return turns;
}

/** Build the index the measurement queries. One document per message. */
export function indexOf(turns: readonly Turn[]): Bm25Index {
    return Bm25Index.build(turns.map((turn) => ({ id: String(turn.index), fields: [{ text: turn.text, boost: 1 }] })));
}

/**
 * Walk the chat and count what a recall pass would have offered.
 *
 * Exported so a test can assert the window arithmetic without a file.
 *
 * `end` is the last message the prompt would carry: the turn being answered is
 * part of the query, because that is what the model sees and what a recall block
 * would be chosen against. Everything before `end - window + 1` is what the
 * prompt had already dropped, which is the only place a hit is interesting.
 *
 * A "recoverable" turn means retrieval would have *offered* something. It is not
 * a claim that what it offered was useful, which needs a person reading it —
 * treat the count as an upper bound.
 */
export function recallOver(turns: readonly Turn[], index: Bm25Index, window: number): RecallCounts {
    let recoverable = 0;
    let hits = 0;
    let examined = 0;
    const byRank = [0, 0, 0, 0, 0];

    for (let end = window; end < turns.length; end += 1) {
        examined += 1;
        const first = end - window + 1;
        const query = turns
            .slice(first, end + 1)
            .map((turn) => turn.text)
            .join('\n');

        const scored = index.query(query, turns.length);
        if (scored.length === 0) {
            continue;
        }

        const best = scored[0]?.score ?? 0;
        const floor = best * FLOOR;

        const recalled = scored
            .filter((hit) => hit.score >= floor)
            .map((hit) => Number.parseInt(hit.id, 10))
            // Only a message the window dropped is a recall; one still in the
            // prompt was going to be seen anyway.
            .filter((id) => id < first);

        if (recalled.length === 0) {
            continue;
        }

        recoverable += 1;
        hits += recalled.length;
        recalled.slice(0, byRank.length).forEach((_id, rank) => {
            byRank[rank] = (byRank[rank] ?? 0) + 1;
        });
    }

    return { examined, recoverable, hits, byRank };
}

function flagValue(argv: readonly string[], flag: string, fallback: number): number {
    const at = argv.indexOf(flag);
    if (at < 0) {
        return fallback;
    }
    const parsed = Number.parseInt(argv[at + 1] ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2).filter((value) => value !== '--');
    const chatPath = argv[0];
    if (!chatPath) {
        console.error('Usage: pnpm --filter @catcup/server chat-recall <chat.jsonl> [--window 5] [--top 3]');
        process.exitCode = 2;
        return;
    }

    const window = flagValue(argv, '--window', 5);
    const top = flagValue(argv, '--top', 3);
    const turns = turnsOf(await readChat(chatPath));

    if (turns.length <= window) {
        console.log(`\n${path.basename(chatPath)}: ${turns.length} messages — nothing has been dropped yet.`);
        return;
    }

    const { examined, recoverable, hits, byRank } = recallOver(turns, indexOf(turns), window);
    const pct = (value: number) => (examined > 0 ? `${Math.round((value / examined) * 100)}%` : '—');

    console.log(`\nChat:    ${path.basename(chatPath)}  (${turns.length} messages)`);
    console.log(`Window:  ${window} messages  ·  floor: ${FLOOR * 100}% of the best hit\n`);
    console.log(`  turns examined   ${examined}`);
    console.log(`  recoverable      ${recoverable}  (${pct(recoverable)} of turns)`);
    console.log(
        `  recalled hits    ${hits}${recoverable > 0 ? `  (${(hits / recoverable).toFixed(1)} per recoverable turn)` : ''}`,
    );
    console.log(`  in the top ${top}    ${byRank.slice(0, top).reduce((sum, value) => sum + value, 0)}`);

    console.log('');
    if (recoverable === 0) {
        console.log('Nothing the window dropped scored. Retrieval would have bought nothing on this chat.');
    } else {
        console.log('This is an upper bound: a hit scored, which is not the same as a hit being useful.');
        console.log(`Read the top-${top} messages of a few recoverable turns before deciding.`);
    }
}

// Run only as a script. A test imports the pure functions above, and an
// unguarded `await main()` would make the module unusable to it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await main();
}
