import { type DistillCharacterDraft, type DistillEntryDraft, errorMessage, type ProviderConfig } from '@catcup/shared';

import { getAdapter } from '../providers/index.js';
import type { PromptMessage } from '../providers/types.js';
import { extractJson } from './analyze.js';
import type { Cluster } from './merge.js';
import { characterOutlineMessages, placeOutlineMessages } from './prompts.js';

/**
 * Turn merged entities into drafts.
 *
 * Mention count decides how much a single entity is worth spending on. An
 * entity the book returns to repeatedly earns one request that writes it up
 * properly; one mentioned in passing is written straight from the merge,
 * marked low confidence and left unticked. That split is roughly half the
 * requests of a per-entity pass, and it spends the model's attention where a
 * person would.
 */

/** At or above this many mentions, an entity gets its own request. */
export const OUTLINE_THRESHOLD = 2;

/** How many outline requests run at once. */
const CONCURRENCY = 4;

/** Keys one outlined entry may carry. Beyond this the scanner matches too much. */
const MAX_KEYS = 6;

export interface OutlineInput {
    provider: ProviderConfig;
    apiKey: string | undefined;
    model: string;
    signal: AbortSignal;
}

/** A short, quoted body of evidence for one entity, bounded for the prompt. */
function evidenceOf(cluster: Cluster): string {
    return cluster.evidence
        .filter(Boolean)
        .slice(0, 8)
        .map((quote) => `- ${quote.trim().slice(0, 400)}`)
        .join('\n');
}

function characterPrompt(cluster: Cluster): PromptMessage[] {
    return characterOutlineMessages({
        name: cluster.name,
        aliases: cluster.aliases.length > 0 ? `Also known as: ${cluster.aliases.join(', ')}` : '',
        description: cluster.description ? `What the text says: ${cluster.description}` : '',
        facts: cluster.facts.length > 0 ? `Facts:\n${cluster.facts.map((fact) => `- ${fact}`).join('\n')}` : '',
        evidence: evidenceOf(cluster),
    });
}

function placePrompt(cluster: Cluster): PromptMessage[] {
    return placeOutlineMessages({
        kind: cluster.kind === 'place' ? 'Place' : 'Subject',
        name: cluster.name,
        aliases: cluster.aliases.length > 0 ? `Also known as: ${cluster.aliases.join(', ')}` : '',
        description: cluster.description ? `What the text says: ${cluster.description}` : '',
        facts: cluster.facts.length > 0 ? `Facts:\n${cluster.facts.map((fact) => `- ${fact}`).join('\n')}` : '',
        evidence: evidenceOf(cluster),
    });
}

/** Drain one request into text. The adapters only stream. */
async function complete(input: OutlineInput, messages: PromptMessage[], maxTokens: number): Promise<string> {
    const adapter = getAdapter(input.provider);
    let text = '';
    for await (const chunk of adapter.streamChat(input.provider, input.apiKey, {
        model: input.model,
        messages,
        temperature: 0.6,
        topP: 1,
        maxTokens,
        signal: input.signal,
    })) {
        if (chunk.type === 'text') {
            text += chunk.text;
        }
    }
    return text;
}

function stringOf(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value.trim() : fallback;
}

function stringListOf(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** The keys a written-up place should carry, cleaned and bounded. */
function keysOf(value: unknown, cluster: Cluster): string[] {
    const keys = stringListOf(value)
        .map((key) => key.trim().toLowerCase())
        .filter((key) => key.length > 1 && key.length <= 60);

    const withName = [cluster.name.toLowerCase(), ...keys];
    return [...new Set(withName)].slice(0, MAX_KEYS);
}

function evidenceLine(cluster: Cluster): string {
    return cluster.evidence[0]?.trim().slice(0, 240) ?? '';
}

/**
 * Write one entity up from its merged evidence.
 *
 * A failed request falls back to the merge's own text rather than dropping the
 * entity: the draft is a starting point a person edits, and a row with thin
 * text they can improve beats a row that is not there at all.
 */
async function outlineCluster(
    cluster: Cluster,
    input: OutlineInput,
): Promise<DistillEntryDraft | DistillCharacterDraft> {
    const character = cluster.kind === 'character';

    try {
        const raw = await complete(
            input,
            character ? characterPrompt(cluster) : placePrompt(cluster),
            character ? 2000 : 1200,
        );
        const parsed = extractJson(raw);

        if (parsed && typeof parsed === 'object') {
            const body = parsed as Record<string, unknown>;
            if (character) {
                return {
                    name: stringOf(body.name, cluster.name),
                    aliases: cluster.aliases,
                    description: stringOf(body.description, cluster.description),
                    personality: stringOf(body.personality, cluster.personality),
                    scenario: stringOf(body.scenario),
                    first_mes: stringOf(body.first_mes),
                    mes_example: stringOf(body.mes_example),
                    tags: stringListOf(body.tags),
                    mentions: cluster.mentions,
                    confidence: 'high',
                    evidence: evidenceLine(cluster),
                    accepted: true,
                } satisfies DistillCharacterDraft;
            }
            return {
                key: keysOf(body.keys, cluster),
                keysecondary: [],
                comment: stringOf(body.comment, cluster.name),
                content: stringOf(body.content, cluster.description || cluster.facts.join(' ')),
                constant: false,
                position: 0,
                chapter: cluster.chapter,
                mentions: cluster.mentions,
                confidence: 'high',
                evidence: evidenceLine(cluster),
                accepted: true,
            } satisfies DistillEntryDraft;
        }
    } catch (error) {
        if (input.signal.aborted) {
            throw error;
        }
        console.warn(`[distill] Could not write up "${cluster.name}":`, errorMessage(error));
    }

    return fromMerge(cluster);
}

/** Write an entity up from the merge alone, marked low confidence. */
function fromMerge(cluster: Cluster): DistillEntryDraft | DistillCharacterDraft {
    if (cluster.kind === 'character') {
        return {
            name: cluster.name,
            aliases: cluster.aliases,
            description: cluster.description || cluster.facts.join(' '),
            personality: cluster.personality,
            scenario: '',
            first_mes: '',
            mes_example: '',
            tags: [],
            mentions: cluster.mentions,
            confidence: 'low',
            evidence: evidenceLine(cluster),
            accepted: false,
        };
    }

    return {
        key: keysOf([], cluster),
        keysecondary: [],
        comment: cluster.name,
        content: cluster.description || cluster.facts.join(' '),
        constant: false,
        position: 0,
        chapter: cluster.chapter,
        mentions: cluster.mentions,
        confidence: 'low',
        evidence: evidenceLine(cluster),
        accepted: false,
    };
}

/** Run tasks with a fixed pool, preserving result order. */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;

    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            const item = items[index];
            if (item !== undefined) {
                results[index] = await task(item, index);
            }
        }
    });

    await Promise.all(workers);
    return results;
}

/**
 * Write up every cluster worth keeping.
 *
 * Results keep the merge's order, so a book's chapters stay in reading order in
 * the review sheet regardless of which request finished first.
 */
export async function outlineClusters(
    clusters: readonly Cluster[],
    input: OutlineInput,
    onProgress?: (done: number, total: number) => void,
): Promise<{ entries: DistillEntryDraft[]; characters: DistillCharacterDraft[] }> {
    const worth = clusters.filter((cluster) => cluster.kind === 'character' || cluster.mentions >= 1);
    const heavy = worth.filter((cluster) => cluster.mentions >= OUTLINE_THRESHOLD);
    const light = worth.filter((cluster) => cluster.mentions < OUTLINE_THRESHOLD);
    const total = worth.length;
    let done = 0;

    const advance = () => {
        done += 1;
        onProgress?.(done, total);
    };

    // A passing mention is written from the merge without spending a request.
    const lightDrafts = light.map((cluster) => fromMerge(cluster));

    const heavyDrafts = await mapWithConcurrency(heavy, CONCURRENCY, async (cluster) => {
        if (input.signal.aborted) {
            throw new Error('stopped');
        }
        const draft = await outlineCluster(cluster, input);
        advance();
        return draft;
    });

    for (const _ of lightDrafts) {
        advance();
    }

    // Restore the merge's order: heavy and light were split by mention count,
    // and a book reads in the order its entities first appear. `indexOf` is
    // safe because each cluster object appears in exactly one of the two lists.
    const drafts = worth.map((cluster) => {
        const at = heavy.indexOf(cluster);
        return at >= 0 ? heavyDrafts[at] : lightDrafts[light.indexOf(cluster)];
    });

    return {
        entries: drafts.filter((draft): draft is DistillEntryDraft => Boolean(draft) && !('name' in draft)),
        characters: drafts.filter((draft): draft is DistillCharacterDraft => Boolean(draft) && 'name' in draft),
    };
}
