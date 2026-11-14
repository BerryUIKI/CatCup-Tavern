import { paragraphsOf, type Section } from './sections.js';

/**
 * Cut a book into requests.
 *
 * One request carries as many whole sections as fit the budget, so section
 * boundaries double as request boundaries wherever possible and the review
 * sheet's chapter groups line up with what one request saw. A section longer
 * than the budget is split on paragraph boundaries, which is the only case
 * where a request's title is not a chapter title.
 *
 * The overlap exists so a fact that straddles a split is not cut in half. The
 * merge stage drops the repeated paragraph, because otherwise every fact in it
 * would be counted twice.
 */

/** Room for the reply. A chunk asks for a JSON object of entries, not for prose. */
export const RESPONSE_ALLOWANCE = 4000;

/** Slack for the instructions, which are the same size for every chunk. */
const MARGIN = 2000;

/** Below this the instructions and a paragraph would not fit together. */
const MIN_BUDGET = 1500;

export interface Chunk {
    index: number;
    /** Section indices this chunk covers, in order. */
    sections: number[];
    /** The section title, or `<title> 1/3` for a continuation. */
    label: string;
    text: string;
    /** The paragraph repeated from the previous chunk, dropped during the merge. */
    overlap: string;
}

/** The prompt budget a book request may use, from the chat context size. */
export function chunkBudget(contextSize: number): number {
    return Math.max(MIN_BUDGET, contextSize - RESPONSE_ALLOWANCE - MARGIN);
}

type CountTokens = (text: string) => number;

/** Group whole sections into chunks that fit, splitting only when one cannot. */
export function chunkBook(sections: readonly Section[], countTokens: CountTokens, budget: number): Chunk[] {
    const chunks: Chunk[] = [];
    let pending: { sections: number[]; labels: string[]; text: string; tokens: number } | null = null;

    const flush = (): void => {
        if (!pending) {
            return;
        }
        chunks.push({
            index: chunks.length,
            sections: pending.sections,
            label: pending.labels.join(', '),
            text: pending.text,
            overlap: '',
        });
        pending = null;
    };

    for (const section of sections) {
        const tokens = countTokens(section.text) + countTokens(section.title);

        if (tokens > budget) {
            flush();
            chunks.push(...splitSection(section, countTokens, budget, chunks.length));
            continue;
        }

        if (pending && pending.tokens + tokens > budget) {
            flush();
        }
        if (!pending) {
            pending = { sections: [], labels: [], text: '', tokens: 0 };
        }
        pending.sections.push(section.index);
        pending.labels.push(section.title);
        pending.text = pending.text ? `${pending.text}\n\n${section.title}\n\n${section.text}` : section.text;
        pending.tokens += tokens;
    }
    flush();

    return chunks;
}

/**
 * Split one oversized section on paragraph boundaries.
 *
 * Each piece after the first opens with the previous piece's last paragraph
 * and records it as `overlap`, so the merge can subtract it rather than
 * counting its facts twice.
 */
function splitSection(section: Section, countTokens: CountTokens, budget: number, startIndex: number): Chunk[] {
    const paragraphs = paragraphsOf(section.text);
    const pieces: string[][] = [];
    let current: string[] = [];
    let tokens = 0;

    for (const paragraph of paragraphs) {
        const cost = countTokens(paragraph);
        if (current.length > 0 && tokens + cost > budget) {
            pieces.push(current);
            current = [];
            tokens = 0;
        }
        current.push(paragraph);
        tokens += cost;
    }
    if (current.length > 0) {
        pieces.push(current);
    }

    return pieces.map((piece, offset) => {
        const previous = offset > 0 ? pieces[offset - 1] : undefined;
        const overlap = previous?.[previous.length - 1] ?? '';
        const body = offset > 0 && overlap ? `${overlap}\n\n${piece.join('\n\n')}` : piece.join('\n\n');
        return {
            index: startIndex + offset,
            sections: [section.index],
            label: pieces.length > 1 ? `${section.title} ${offset + 1}/${pieces.length}` : section.title,
            text: body,
            overlap,
        };
    });
}
