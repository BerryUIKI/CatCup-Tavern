import { describe, expect, it } from 'vitest';

import { Bm25Index, buildEntryIndex, ENTRY_FIELD_BOOSTS } from './bm25.js';

function entry(id: string, key: string[], comment: string, content: string) {
    return { id, key, comment, content };
}

describe('Bm25Index', () => {
    it('returns nothing for an empty query', () => {
        const index = buildEntryIndex([entry('a', ['keep'], '', 'The northern keep.')]);

        expect(index.query('')).toEqual([]);
    });

    it('returns nothing when no term matches', () => {
        const index = buildEntryIndex([entry('a', ['keep'], '', 'The northern keep.')]);

        expect(index.query('dragon')).toEqual([]);
    });

    it('scores a document that contains the term', () => {
        const index = buildEntryIndex([
            entry('keep', ['northern keep'], 'The Keep', 'A fortress on the northern border.'),
            entry('dragon', ['dragon'], 'Dragons', 'Scaled beasts of the high peaks.'),
        ]);

        const hits = index.query('keep');

        expect(hits).toHaveLength(1);
        expect(hits[0]?.id).toBe('keep');
        expect(hits[0]?.score).toBeGreaterThan(0);
    });

    it('ranks a key match above a passing mention in content', () => {
        const index = buildEntryIndex([
            // The key names the concept.
            entry('keyed', ['northern keep'], 'Fortress', 'A fortress on the border.'),
            // The concept appears once in a long paragraph about something else.
            entry(
                'mentioned',
                ['trade routes'],
                'Caravans',
                `Caravans cross the passes each spring. ${'They carry salt and furs north. '.repeat(20)} Merchants speak of the northern keep as a waypoint.`,
            ),
        ]);

        const hits = index.query('northern keep');

        expect(hits.map((hit) => hit.id)).toEqual(['keyed', 'mentioned']);
        expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? 0);
    });

    it('down-weights a term that appears in every document', () => {
        const documents = [
            entry('a', ['dragon'], 'Dragons', 'A common word appears here.'),
            entry('b', ['griffin'], 'Griffins', 'A common word appears here too.'),
            entry('c', ['wyvern'], 'Wyverns', 'A common word appears here as well.'),
        ];
        const index = buildEntryIndex(documents);

        // "appears" occurs in all three and should contribute almost nothing;
        // "wyvern" occurs in one.
        const commonOnly = index.query('appears');
        const rareTerm = index.query('wyvern');

        expect(commonOnly).toHaveLength(3);
        expect(rareTerm).toHaveLength(1);
        expect(rareTerm[0]?.score ?? 0).toBeGreaterThan(commonOnly[0]?.score ?? 0);
    });

    it('counts a term once per document even when several fields carry it', () => {
        // Regression: postings were pushed per field rather than per document,
        // so a term in both `key` and `content` gave df = 2 x N. Document
        // frequency then exceeded the corpus size, the IDF went negative, and
        // every hit was silently dropped. The entry below repeats "shared" in
        // all three fields on purpose.
        const index = buildEntryIndex([
            entry('a', ['shared'], 'shared', 'A shared body.'),
            entry('b', ['shared'], 'shared', 'Another shared body.'),
        ]);

        const hits = index.query('shared');

        expect(hits).toHaveLength(2);
        expect(hits.every((hit) => hit.score > 0)).toBe(true);
    });

    it('scores a document by the sum of its field frequencies', () => {
        // The same term in two fields must outrank it in one, otherwise the
        // boosts do nothing.
        const index = buildEntryIndex([
            entry('both', ['harbour'], '', 'The harbour at dawn.'),
            entry('content-only', [], '', 'The harbour at dawn.'),
        ]);

        const hits = index.query('harbour');

        expect(hits.map((hit) => hit.id)).toEqual(['both', 'content-only']);
    });

    it('respects the limit', () => {
        const index = buildEntryIndex(
            Array.from({ length: 10 }, (_, i) => entry(`e${i}`, ['shared'], '', 'All about the shared topic.')),
        );

        expect(index.query('shared', 3)).toHaveLength(3);
    });

    it('breaks ties deterministically by id', () => {
        const index = buildEntryIndex([
            entry('zeta', ['shared'], '', 'Same text.'),
            entry('alpha', ['shared'], '', 'Same text.'),
        ]);

        expect(index.query('shared').map((hit) => hit.id)).toEqual(['alpha', 'zeta']);
    });

    it('exposes its size', () => {
        const index = buildEntryIndex([entry('a', ['x'], '', 'one'), entry('b', ['y'], '', 'two')]);

        expect(index.size).toBe(2);
        expect(index.vocabularySize).toBeGreaterThan(0);
    });

    it('handles an empty corpus', () => {
        const index = Bm25Index.build([]);

        expect(index.size).toBe(0);
        expect(index.query('anything')).toEqual([]);
    });

    it('handles an entry with no text at all', () => {
        const index = buildEntryIndex([entry('empty', [], '', '')]);

        expect(index.size).toBe(1);
        expect(index.query('anything')).toEqual([]);
    });

    it('matches Chinese through segmentation and bigrams', () => {
        const index = buildEntryIndex([
            entry('fortress', ['北方要塞'], '北境', '北方的军事要塞，驻扎着边防军。'),
            entry('river', ['南方河流'], '南境', '南方的河流与渡口。'),
        ]);

        const hits = index.query('北方要塞');

        expect(hits[0]?.id).toBe('fortress');
    });

    it('matches a Chinese compound whose parts the segmenter splits', () => {
        // The segmenter reads 查理 + 曼, so only bigrams connect this to the
        // query spelled as one run.
        const index = buildEntryIndex([entry('paladin', [], '骑士', '查理曼骑士团的旗帜在风中飘扬。')]);

        expect(index.query('查理曼骑士团').length).toBeGreaterThan(0);
    });

    it('matches a mixed English and Chinese query', () => {
        const index = buildEntryIndex([
            entry('mira', [], 'Mira', 'Mira 守卫着北方要塞 at dusk.'),
            entry('other', [], 'Other', 'Someone else entirely.'),
        ]);

        expect(index.query('Mira 要塞')[0]?.id).toBe('mira');
    });

    it('applies field boosts in a stable ratio', () => {
        // Also pins the exported constants, so a change to them is deliberate.
        expect(ENTRY_FIELD_BOOSTS.key).toBeGreaterThan(ENTRY_FIELD_BOOSTS.comment);
        expect(ENTRY_FIELD_BOOSTS.comment).toBeGreaterThan(ENTRY_FIELD_BOOSTS.content);
    });

    it('is unaffected by document order for equal documents', () => {
        const documents = [
            entry('first', ['topic'], '', 'Identical body text.'),
            entry('second', ['topic'], '', 'Identical body text.'),
        ];

        const forward = buildEntryIndex(documents).query('topic');
        const reversed = buildEntryIndex([...documents].reverse()).query('topic');

        expect(forward.map((hit) => hit.id)).toEqual(reversed.map((hit) => hit.id));
        expect(forward[0]?.score).toBeCloseTo(reversed[0]?.score ?? 0, 10);
    });
});
