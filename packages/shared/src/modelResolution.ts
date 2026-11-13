import type { ProviderConfig } from './schemas/provider.js';

/** Where a request's model came from, for the header and for tests. */
export type ModelResolutionSource = 'character' | 'default' | 'first' | 'fallback';

export interface ResolvedModel {
    /** The model id a request sends. Empty when the provider serves none. */
    model: string;
    source: ModelResolutionSource;
    /** The model the character asked for, when it asked for one. */
    requested?: string;
}

/**
 * Settle which model a request uses.
 *
 * The order is the character's own choice, then the provider's default, then
 * the first model the provider lists. A character asking for a model the
 * provider does not serve falls through to the provider's default and is
 * reported as `fallback`, so the interface can say what happened instead of
 * silently pretending the choice was honoured.
 */
export function resolveModel(provider: ProviderConfig, characterModel?: string | null): ResolvedModel {
    const requested = characterModel?.trim() ?? '';
    const listed = provider.models;

    if (requested && listed.includes(requested)) {
        return { model: requested, source: 'character', requested };
    }

    const fallback = provider.defaultModel || listed[0] || '';
    if (requested) {
        return { model: fallback, source: 'fallback', requested };
    }
    if (provider.defaultModel) {
        return { model: provider.defaultModel, source: 'default' };
    }
    return { model: fallback, source: 'first' };
}
