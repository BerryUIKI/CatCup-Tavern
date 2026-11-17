/**
 * Tokenization for the lexical index.
 *
 * The scanner's own matching is literal substring search, which cannot see two
 * spellings of one concept and cannot rank one hit above another. BM25 needs
 * terms, so this module produces them without a native dependency: `Intl.
 * Segmenter` supplies word boundaries for every script V8 ships dictionaries
 * for, and CJK text additionally emits character bigrams because word
 * segmentation is the weakest link in exactly those languages.
 *
 * Nothing here is exposed to the model. Tokens only reach the BM25 index.
 */

/**
 * Scripts written without spaces. A segmented "word" in these languages is a
 * guess, so bigrams run alongside it as a safety net.
 */
const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/;

/** A CJK or Hangul syllable, one code point. */
const CJK_CHAR = /[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;

/**
 * Terms that carry no retrieval signal. Deliberately short: an aggressive list
 * hurts short documents, and a lorebook entry is one short document. Only
 * function words that appear in nearly every sentence are removed.
 */
const STOPWORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'but',
    'by',
    'for',
    'from',
    'has',
    'have',
    'he',
    'her',
    'his',
    'i',
    'in',
    'is',
    'it',
    'its',
    'of',
    'on',
    'or',
    'she',
    'that',
    'the',
    'their',
    'them',
    'they',
    'this',
    'to',
    'was',
    'were',
    'will',
    'with',
    'you',
    'your',
    // CJK function words. `Intl.Segmenter` returns these as standalone words.
    'の',
    'は',
    'を',
    'が',
    'に',
    'で',
    'と',
    'も',
    'て',
    'た',
    'だ',
    'し',
    '的',
    '了',
    '在',
    '是',
    '和',
    '也',
    '就',
    '都',
    '而',
    '被',
    '把',
    '着',
    '过',
]);

export interface TokenizeOptions {
    /**
     * Emit character bigrams for CJK runs in addition to segmented words.
     * Defaults to true. Turning it off makes the index smaller and the query
     * faster at the cost of matching a compound term only as a whole.
     */
    cjkBigrams?: boolean;
    /** Drop stopwords. Defaults to true. */
    stopwords?: boolean;
    /** Keep one-character tokens. Defaults to CJK-only. */
    singleChars?: boolean;
}

/** A maximal run of CJK characters in the source text. */
const CJK_RUN = /[぀-ヿ㐀-䶿一-鿿豈-鿿豈-﫿가-힯]+/gu;

/**
 * Tokenize one string into index terms.
 *
 * Latin text is lowercased and segmented on word boundaries. CJK runs are
 * segmented the same way, and then the raw runs additionally contribute
 * overlapping character bigrams.
 *
 * The bigrams come from the *source run*, not from each segmented word, and
 * that distinction is the whole point: the segmenter is the weakest link in
 * exactly the languages it has dictionaries for. It reads 查理曼骑士团 as
 * 查理 + 曼 + 骑士 + 团, so a bigram computed per word could never produce
 * 里曼 or 曼骑 — the two terms that bridge its mistake. Computed over the run,
 * they are there, and a query spelled as one compound finds the entry again.
 */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
    const cjkBigrams = options.cjkBigrams ?? true;
    const dropStopwords = options.stopwords ?? true;
    const keepSingle = options.singleChars ?? true;

    if (!text) {
        return [];
    }

    const terms: string[] = [];
    const seen = new Set<string>();

    const push = (term: string): void => {
        if (seen.has(term)) {
            return;
        }
        seen.add(term);
        terms.push(term);
    };

    for (const word of segmentWords(text)) {
        const term = word.toLowerCase();
        if (!term) {
            continue;
        }

        const isCjk = CJK.test(term);
        if (term.length === 1 && !isCjk && !keepSingle) {
            continue;
        }
        if (dropStopwords && STOPWORDS.has(term)) {
            continue;
        }

        push(term);
    }

    if (cjkBigrams) {
        for (const run of text.match(CJK_RUN) ?? []) {
            for (let index = 0; index < run.length - 1; index += 1) {
                const bigram = run.slice(index, index + 2);
                if (dropStopwords && STOPWORDS.has(bigram)) {
                    continue;
                }
                push(bigram);
            }
        }
    }

    return terms;
}

/**
 * Word boundaries via `Intl.Segmenter`.
 *
 * The segmenter is created once. Its constructor is not free and the server
 * tokenizes on every edit, every import and every chat turn.
 */
const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'word' });

function segmentWords(text: string): string[] {
    const words: string[] = [];
    for (const part of WORD_SEGMENTER.segment(text)) {
        if (part.isWordLike) {
            words.push(part.segment);
        }
    }
    return words;
}

/**
 * Tokenize a query.
 *
 * Queries are short and every term matters, so stopwords are kept: "the keep"
 * should be able to match. The index still drops them, which makes an indexed
 * term unsearchable — acceptable, because a stopword alone is not a query.
 */
export function tokenizeQuery(text: string): string[] {
    return tokenize(text, { stopwords: false });
}

/** Whether a string contains any CJK character. */
export function hasCjk(text: string): boolean {
    return CJK_CHAR.test(text);
}
