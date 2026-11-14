import type { DistillBookEstimate, ProviderKind } from '@catcup/shared';

import { createTokenCounter } from '../prompt/tokenizer.js';
import { readBookSections } from '../storage/books.js';
import { getActiveProvider, getSettings } from '../storage/settings.js';
import { chunkBook, chunkBudget } from './chunk.js';

/** A counter for the model a run would use, or a byte estimate when no provider is set up. */
function counterFor(kind: ProviderKind | null, model: string) {
    return kind
        ? createTokenCounter(kind, model)
        : { count: (text: string) => Math.ceil(text.length / 3.6), source: 'estimate' as const, label: 'estimate' };
}

/**
 * What a run of a book would cost, before it starts.
 *
 * The count comes from the same tokenizer the prompt budget uses and the same
 * chunker the run does, so the number a person reads is the number of requests
 * they are about to spend — not an approximation of one.
 */
export async function estimateBook(bookId: string): Promise<DistillBookEstimate> {
    const [sections, settings, provider] = await Promise.all([
        readBookSections(bookId),
        getSettings(),
        getActiveProvider(),
    ]);

    const counter = counterFor(provider?.kind ?? null, settings.profilePreferredModel || provider?.defaultModel || '');
    const chunks = chunkBook(sections, counter.count, chunkBudget(settings.generation.contextSize));

    return {
        chunks: chunks.length,
        promptTokens: counter.count(chunks.map((chunk) => chunk.text).join('\n')),
    };
}
