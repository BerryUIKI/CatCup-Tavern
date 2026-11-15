import { type DistillAnalysis, errorMessage, type ProviderConfig } from '@catcup/shared';

import { getAdapter } from '../providers/index.js';
import type { PromptMessage } from '../providers/types.js';
import { extractJson } from './analyze.js';

/**
 * Merge the per-chunk analyses into one cast and one set of facts.
 *
 * Clustering is done here, in plain code, not by the model: exact names and
 * aliases cost nothing to compare, and a per-pair model request would cost more
 * than the outline pass it is meant to save. The model is asked exactly one
 * question — "are any of these the same entity?" — over the handful of pairs
 * that string comparison cannot settle.
 */

/** One entity as the merge sees it, before it becomes a draft. */
export interface Cluster {
    name: string;
    aliases: string[];
    description: string;
    personality: string;
    /** Verbatim quotes, in source order. */
    evidence: string[];
    facts: string[];
    /** How many chunks mentioned it. */
    mentions: number;
    /** The section of its first mention, which the review sheet groups on. */
    chapter: string;
    kind: 'character' | 'place';
}

/** A fact, before it is attached to an entity. */
export interface RawFact {
    subject: string;
    content: string;
    keys: string[];
    chapter: string;
}

/**
 * Fold a name for comparison: case, punctuation, whitespace and a leading
 * article all vary between mentions of the same person.
 */
export function normalizeName(name: string): string {
    return name
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .replace(/^(the|a|an|a |an )\s+/u, '')
        .trim();
}

/** Bounded edit distance: enough to catch a typo, not enough to merge strangers. */
export function editDistance(left: string, right: string, limit = 3): number {
    if (Math.abs(left.length - right.length) > limit) {
        return limit + 1;
    }
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 1; i <= left.length; i += 1) {
        let diagonal = previous[0] ?? 0;
        previous[0] = i;
        for (let j = 1; j <= right.length; j += 1) {
            const above = previous[j] ?? 0;
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            previous[j] = Math.min((previous[j] ?? 0) + 1, (previous[j - 1] ?? 0) + 1, diagonal + cost);
            diagonal = above;
        }
    }
    return previous[right.length] ?? limit + 1;
}

/**
 * How much of the shorter text the other one repeats.
 *
 * Containment rather than a symmetric score, because the case that matters is
 * a chunk overlap: the same fact comes back with a sentence added, and its
 * token count grows while every token of the first is still there. A symmetric
 * score calls that a partial match and keeps both copies. Very short texts are
 * excluded, since two three-word sentences always look alike.
 */
export function similarity(left: string, right: string): number {
    const tokens = (text: string) =>
        new Set(
            normalizeName(text)
                .split(' ')
                .filter((token) => token.length > 2),
        );
    const a = tokens(left);
    const b = tokens(right);
    if (a.size < 3 || b.size < 3) {
        return 0;
    }
    let shared = 0;
    for (const token of a) {
        if (b.has(token)) {
            shared += 1;
        }
    }
    return shared / Math.min(a.size, b.size);
}

interface Observation {
    name: string;
    aliases: string[];
    description: string;
    personality: string;
    evidence: string;
    chapter: string;
    kind: 'character' | 'place';
    index: number;
}

/** Flatten the analyses into one ordered observation list. */
function observationsOf(analyses: readonly (DistillAnalysis | null)[], chapters: readonly string[]): Observation[] {
    const observations: Observation[] = [];
    analyses.forEach((analysis, chunk) => {
        const chapter = chapters[chunk] ?? 'Unfiled';
        for (const character of analysis?.characters ?? []) {
            observations.push({ ...character, chapter, kind: 'character', index: observations.length });
        }
        for (const place of analysis?.places ?? []) {
            observations.push({ ...place, personality: '', chapter, kind: 'place', index: observations.length });
        }
    });
    return observations;
}

/**
 * Group observations whose names or aliases settle the matter.
 *
 * A union-find over a normalized name → observation index map: one pass, and
 * two entities that only turn out equal when their aliases are compared still
 * end up in the same cluster.
 */
function clusterByString(observations: readonly Observation[]): { clusters: number[][]; keys: string[] } {
    const parent = observations.map((_, index) => index);
    const find = (index: number): number => {
        let root = index;
        while (parent[root] !== root) {
            root = parent[root] ?? root;
        }
        return root;
    };
    const union = (left: number, right: number) => {
        const a = find(left);
        const b = find(right);
        if (a !== b) {
            parent[Math.max(a, b)] = Math.min(a, b);
        }
    };

    const byName = new Map<string, number>();
    for (const observation of observations) {
        for (const name of [observation.name, ...observation.aliases]) {
            const key = normalizeName(name);
            if (!key) {
                continue;
            }
            const existing = byName.get(key);
            if (existing === undefined) {
                byName.set(key, observation.index);
            } else {
                union(existing, observation.index);
            }
        }
    }

    const groups = new Map<number, number[]>();
    for (const observation of observations) {
        const root = find(observation.index);
        groups.set(root, [...(groups.get(root) ?? []), observation.index]);
    }

    return {
        clusters: [...groups.values()],
        keys: [...byName.keys()],
    };
}

/**
 * Candidate near-miss pairs the model is asked about.
 *
 * Only names that share a distinctive token or sit within a small edit distance
 * qualify, and only across different clusters. A book with no such pairs — the
 * common case — asks nothing.
 */
export function nearMissPairs(clusters: readonly Cluster[]): Array<[number, number]> {
    const pairs: Array<[number, number]> = [];
    for (let left = 0; left < clusters.length; left += 1) {
        for (let right = left + 1; right < clusters.length; right += 1) {
            const a = clusters[left];
            const b = clusters[right];
            if (!a || !b) {
                continue;
            }
            if (a.kind !== b.kind) {
                continue;
            }
            const aName = normalizeName(a.name);
            const bName = normalizeName(b.name);
            const aTokens = aName.split(' ');
            const bTokens = new Set(bName.split(' '));
            const shared = aTokens.some((token) => token.length > 3 && bTokens.has(token));

            if (shared || editDistance(aName, bName) <= 2) {
                pairs.push([left, right]);
            }
        }
    }
    // One batched question, so the list is capped at what fits a small reply.
    return pairs.slice(0, 40);
}

/**
 * Ask the model which candidate pairs are the same entity.
 *
 * One request with the whole list, not one per pair. A failed request leaves
 * the clusters as they are: an unmerged duplicate is a row a person can merge
 * by hand, while a wrong merge silently loses a character.
 */
export async function resolveNearMisses(
    pairs: readonly [number, number][],
    clusters: readonly Cluster[],
    provider: ProviderConfig,
    apiKey: string | undefined,
    model: string,
    signal: AbortSignal,
): Promise<Array<[number, number]>> {
    if (pairs.length === 0) {
        return [];
    }

    const listed = pairs
        .map(([left, right]) => {
            const a = clusters[left];
            const b = clusters[right];
            return `- ${a?.name} [${a?.aliases.join(', ') ?? ''}] || ${b?.name} [${b?.aliases.join(', ') ?? ''}]`;
        })
        .join('\n');

    const messages: PromptMessage[] = [
        {
            role: 'system',
            content: [
                'You judge whether two names from a work of fiction refer to the same entity.',
                'Two names are the same entity when one is a title, epithet, nickname or spelling of the other.',
                'Two people who merely share a surname are not the same entity.',
                'Reply with a JSON array of the 1-based line numbers that are the same entity, e.g. [1,4].',
                'Reply with [] if none of them are.',
            ].join('\n'),
        },
        { role: 'user', content: listed },
    ];

    const adapter = getAdapter(provider);
    let raw = '';
    try {
        for await (const chunk of adapter.streamChat(provider, apiKey, {
            model,
            messages,
            temperature: 0,
            topP: 1,
            maxTokens: 500,
            signal,
        })) {
            if (chunk.type === 'text') {
                raw += chunk.text;
            }
        }
    } catch (error) {
        if (signal.aborted) {
            throw error;
        }
        console.warn('[distill] Could not resolve near-miss names:', errorMessage(error));
        return [];
    }

    const parsed = extractJson(raw);
    if (!Array.isArray(parsed)) {
        return [];
    }

    return parsed
        .map((value) => Number(value))
        .filter((line) => Number.isInteger(line) && line >= 1 && line <= pairs.length)
        .map((line) => pairs[line - 1])
        .filter((pair): pair is [number, number] => Boolean(pair));
}

/** Turn observations into clusters, strongest name first. */
function buildClusters(observations: readonly Observation[], groups: readonly number[][]): Cluster[] {
    const clusters: Array<Cluster | null> = groups.map((group) => {
        const rows = group
            .map((index) => observations[index])
            .filter((row): row is Observation => Boolean(row))
            .sort((a, b) => a.index - b.index);
        const first = rows[0];
        if (!first) {
            return null;
        }

        const aliases = new Set<string>();
        for (const row of rows) {
            for (const alias of [row.name, ...row.aliases]) {
                if (normalizeName(alias) !== normalizeName(first.name)) {
                    aliases.add(alias);
                }
            }
        }

        // The longest description wins: a model that saw a character once
        // tends to say less than one that saw them in a whole chapter.
        const description =
            rows
                .map((row) => row.description)
                .filter(Boolean)
                .sort((a, b) => b.length - a.length)[0] ?? '';
        const personality =
            rows
                .map((row) => row.personality)
                .filter(Boolean)
                .sort((a, b) => b.length - a.length)[0] ?? '';

        return {
            name: first.name,
            aliases: [...aliases],
            description,
            personality,
            evidence: rows.map((row) => row.evidence).filter(Boolean),
            facts: [],
            mentions: rows.length,
            chapter: first.chapter,
            kind: first.kind,
        } satisfies Cluster;
    });

    return clusters.filter((cluster): cluster is Cluster => cluster !== null);
}

/**
 * Attach each fact to the cluster whose name or alias it names, de-duplicated.
 *
 * A subject with no cluster of its own still deserves one: a model that wrote
 * "The pass is snowed in" as a fact without listing the pass as a place has
 * still found something worth keeping, and dropping it would lose lore for no
 * reason a person could see.
 */
function attachFacts(clusters: Cluster[], facts: readonly RawFact[]): void {
    const byName = new Map<string, Cluster>();
    for (const cluster of clusters) {
        for (const name of [cluster.name, ...cluster.aliases]) {
            byName.set(normalizeName(name), cluster);
        }
    }

    for (const fact of facts) {
        const key = normalizeName(fact.subject);
        if (!key) {
            continue;
        }

        let target = byName.get(key);
        if (!target) {
            target = {
                name: fact.subject,
                aliases: [],
                description: '',
                personality: '',
                evidence: [],
                facts: [],
                mentions: 1,
                chapter: fact.chapter,
                kind: 'place',
            };
            clusters.push(target);
            byName.set(key, target);
        }

        const duplicate = target.facts.some((existing) => similarity(existing, fact.content) > 0.8);
        if (!duplicate) {
            target.facts.push(fact.content);
        }
    }
}

export interface MergeInput {
    analyses: readonly (DistillAnalysis | null)[];
    /** The section title each analysis covered, in order. */
    chapters: readonly string[];
    provider: ProviderConfig;
    apiKey: string | undefined;
    model: string;
    signal: AbortSignal;
}

/** Merge every chunk's analysis into one set of entities. */
export async function mergeAnalyses(input: MergeInput): Promise<Cluster[]> {
    const observations = observationsOf(input.analyses, input.chapters);

    const facts: RawFact[] = [];
    input.analyses.forEach((analysis, chunk) => {
        for (const fact of analysis?.facts ?? []) {
            facts.push({ ...fact, chapter: input.chapters[chunk] ?? 'Unfiled' });
        }
    });

    const { clusters: groups } = clusterByString(observations);
    const clusters = buildClusters(observations, groups);

    const pairs = nearMissPairs(clusters);
    if (pairs.length > 0) {
        const same = await resolveNearMisses(pairs, clusters, input.provider, input.apiKey, input.model, input.signal);
        // Fold the later cluster into the earlier one, then drop the husk. The
        // pair list is a small fraction of the cluster list, so this stays cheap.
        for (const [left, right] of same) {
            const target = clusters[left];
            const absorbed = clusters[right];
            if (!target || !absorbed || target === absorbed) {
                continue;
            }
            target.aliases = [...new Set([...target.aliases, absorbed.name, ...absorbed.aliases])];
            target.evidence.push(...absorbed.evidence);
            target.facts.push(...absorbed.facts);
            target.mentions += absorbed.mentions;
            absorbed.mentions = 0;
        }
    }

    const kept = clusters.filter((cluster) => cluster.mentions > 0);
    attachFacts(kept, facts);

    // A place nobody described is a name with nothing behind it.
    return kept.filter(
        (cluster) => cluster.description.length > 0 || cluster.facts.length > 0 || cluster.kind === 'character',
    );
}
