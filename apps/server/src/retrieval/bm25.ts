/**
 * BM25F over world info entries.
 *
 * SillyTavern decides activation with substring search: an entry either
 * contains a key or it does not, and nothing ranks one hit above another. That
 * is why a book with a thousand entries behaves like a book with a thousand
 * equal claims — the top of the budget is decided by authoring `order`, not by
 * relevance.
 *
 * BM25F adds two things the scanner cannot express, without a model call:
 *
 * 1. **Term weighting that varies by field.** An entry whose *keys* are about
 *    the query is a far better hit than one that merely mentions it in passing
 *    prose. Fields carry independent boosts.
 * 2. **Corpus statistics.** A term that appears in half the book says almost
 *    nothing; one that appears in two entries says a lot. IDF is why "north"
 *    stops drowning out a rare proper noun.
 *
 * Deliberately not included: any decision about *whether* an entry is allowed
 * to activate. Groups, timed effects, probability and the budget stay in the
 * scanner, in SillyTavern's order. BM25F only orders and surfaces candidates.
 */

import { type TokenizeOptions, tokenize } from './tokenize.js';

/** One searchable field of a document and how much it counts. */
export interface WeightedField {
    /** The field's text. Empty or blank fields are skipped. */
    text: string;
    /** Multiplier applied to the field's term frequencies. */
    boost: number;
}

/** One document to index. */
export interface Bm25Document {
    /** Stable identifier, handed back with each result. */
    id: string;
    fields: readonly WeightedField[];
}

export interface Bm25Options {
    /** Term-frequency saturation. `1.2`–`2.0`; higher lets repeats matter more. */
    k1?: number;
    /** Length normalization. `0` ignores length, `1` normalizes fully. */
    b?: number;
    /** Tokenizer overrides applied at build time. */
    tokenizeOptions?: TokenizeOptions;
}

export interface Bm25Hit {
    id: string;
    score: number;
}

/**
 * Field boosts for a world info entry.
 *
 * Keys dominate: they are the author's own statement of what the entry is
 * about, and matching one is the strongest signal the format offers. The
 * comment is a human-written title, so it ranks next. Content is the bulk of
 * the text and the weakest per-term signal, which is exactly why a plain
 * content-index would bury a five-word entry under a five-hundred-word one.
 */
export const ENTRY_FIELD_BOOSTS = {
    key: 3,
    comment: 1.5,
    content: 1,
} as const;

/**
 * Read-only BM25F index.
 *
 * Every per-document structure is a `Float64Array` or a flat array indexed by
 * document position, so a 10,000-entry book costs a few megabytes and a query
 * is a tight loop over typed arrays rather than a pass over object graphs.
 */
export class Bm25Index {
    /** Average weighted length, used for the `b` normalization. */
    private readonly avgLength: number;

    private constructor(
        private readonly ids: readonly string[],
        /** Term -> position in the postings arrays. */
        private readonly terms: ReadonlyMap<string, number>,
        /** For each term, the document positions containing it. */
        private readonly postings: readonly Int32Array[],
        /** For each term, the weighted term frequency per posting, same order. */
        private readonly frequencies: readonly Float64Array[],
        /** Weighted length of each document. */
        private readonly lengths: Float64Array,
        avgLength: number,
        private readonly options: Required<Pick<Bm25Options, 'k1' | 'b'>>,
    ) {
        this.avgLength = avgLength;
    }

    /** Number of indexed documents. */
    get size(): number {
        return this.ids.length;
    }

    /** Number of distinct terms. */
    get vocabularySize(): number {
        return this.terms.size;
    }

    /**
     * Build an index.
     *
     * Documents arrive in one batch because an IDF is only meaningful relative
     * to the whole collection. Building is the expensive half (about a second
     * for ten thousand entries), so callers cache the result per book revision
     * rather than rebuilding per turn.
     */
    static build(documents: readonly Bm25Document[], options: Bm25Options = {}): Bm25Index {
        const k1 = options.k1 ?? 1.5;
        const b = options.b ?? 0.75;

        const ids: string[] = [];
        const lengths = new Float64Array(documents.length);
        const termIndex = new Map<string, number>();
        const postingDocs: number[][] = [];
        const postingFreqs: number[][] = [];

        for (let docIndex = 0; docIndex < documents.length; docIndex += 1) {
            const document = documents[docIndex];
            if (!document) {
                continue;
            }
            ids.push(document.id);

            // Every field of one document must collapse into a single posting
            // per term before it reaches the postings list. Document frequency
            // counts documents, not fields: a term in a document's key and in
            // its content is still one document containing it. Pushing one
            // posting per field instead would make `df` exceed the corpus size,
            // drive the IDF negative, and silently drop every hit — which is
            // exactly what an early version of this code did.
            const weighted = new Map<string, number>();

            for (const field of document.fields) {
                if (!field.text || field.boost <= 0) {
                    continue;
                }
                const tokens = tokenize(field.text, options.tokenizeOptions);
                if (tokens.length === 0) {
                    continue;
                }

                lengths[docIndex] = (lengths[docIndex] ?? 0) + tokens.length * field.boost;

                for (const token of tokens) {
                    weighted.set(token, (weighted.get(token) ?? 0) + field.boost);
                }
            }

            for (const [term, frequency] of weighted) {
                let slot = termIndex.get(term);
                if (slot === undefined) {
                    slot = postingDocs.length;
                    termIndex.set(term, slot);
                    postingDocs.push([]);
                    postingFreqs.push([]);
                }
                const docs = postingDocs[slot];
                const freqs = postingFreqs[slot];
                if (!docs || !freqs) {
                    continue;
                }
                docs.push(docIndex);
                freqs.push(frequency);
            }
        }

        let totalLength = 0;
        for (let index = 0; index < ids.length; index += 1) {
            totalLength += lengths[index] ?? 0;
        }
        const avgLength = ids.length > 0 ? totalLength / ids.length : 0;

        return new Bm25Index(
            ids,
            termIndex,
            postingDocs.map((docs) => Int32Array.from(docs)),
            postingFreqs.map((freqs) => Float64Array.from(freqs)),
            lengths,
            avgLength,
            { k1, b },
        );
    }

    /**
     * Score every document against a query and return the best `limit`.
     *
     * Documents with no query term are omitted rather than returned with a zero
     * score, so the caller can treat the result as "did anything match".
     */
    query(text: string, limit = Number.POSITIVE_INFINITY): Bm25Hit[] {
        const terms = tokenize(text, { stopwords: false });
        if (terms.length === 0 || this.ids.length === 0) {
            return [];
        }

        const scores = new Float64Array(this.ids.length);
        const { k1, b } = this.options;
        const total = this.ids.length;

        // A repeated query term would otherwise count twice; a set is what the
        // IDF formula expects.
        for (const term of new Set(terms)) {
            const slot = this.terms.get(term);
            if (slot === undefined) {
                continue;
            }
            const docs = this.postings[slot];
            const freqs = this.frequencies[slot];
            if (!docs || !freqs) {
                continue;
            }

            const df = docs.length;
            // Plus-one smoothing keeps a term present in every document from
            // going negative, which would invert its contribution.
            const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));

            for (let index = 0; index < docs.length; index += 1) {
                const docIndex = docs[index];
                const frequency = freqs[index];
                if (docIndex === undefined || frequency === undefined) {
                    continue;
                }
                const length = this.lengths[docIndex] ?? 0;
                const norm = this.avgLength > 0 ? 1 - b + (b * length) / this.avgLength : 1;
                const denominator = frequency + k1 * norm;
                if (denominator <= 0) {
                    continue;
                }
                scores[docIndex] = (scores[docIndex] ?? 0) + (idf * frequency * (k1 + 1)) / denominator;
            }
        }

        const hits: Bm25Hit[] = [];
        for (let index = 0; index < scores.length; index += 1) {
            const score = scores[index] ?? 0;
            const id = this.ids[index];
            if (score > 0 && id !== undefined) {
                hits.push({ id, score });
            }
        }

        // Ties are broken by id so the output is stable across runs, which
        // matters because the caller may sample or truncate the list.
        hits.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));

        return Number.isFinite(limit) && hits.length > limit ? hits.slice(0, limit) : hits;
    }
}

/** Build the index from entries in one call. */
export function buildEntryIndex(
    entries: readonly { id: string; key: readonly string[]; comment: string; content: string }[],
    options: Bm25Options = {},
): Bm25Index {
    return Bm25Index.build(
        entries.map((entry) => ({
            id: entry.id,
            fields: [
                // Keys are joined rather than indexed as separate fields so the
                // boost applies once, and a key that is several words long is
                // still one phrase position in the document.
                { text: entry.key.join('\n'), boost: ENTRY_FIELD_BOOSTS.key },
                { text: entry.comment, boost: ENTRY_FIELD_BOOSTS.comment },
                { text: entry.content, boost: ENTRY_FIELD_BOOSTS.content },
            ],
        })),
        options,
    );
}
