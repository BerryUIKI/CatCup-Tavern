import type { ProviderConfig } from './schemas/provider.js';

/** Where a request's model came from, for the header and for tests. */
export type ModelResolutionSource = 'character' | 'profile' | 'default' | 'first' | 'fallback';

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
 * The order is the character's own choice, then the **profile's** preferred
 * model, then the provider's default, then the first model the provider lists.
 *
 * A character asking for a model the provider does not serve does not fail: it
 * falls through to the profile or provider default and is reported as
 * `fallback` with the id it asked for, so the interface can say what happened
 * instead of silently pretending the choice was honoured. A profile preference
 * the provider does not serve is simply skipped — it is a machine-level hint,
 * not a per-character request, and the profile may point at a model another
 * profile's provider lacks.
 */
export function resolveModel(
    provider: ProviderConfig,
    characterModel?: string | null,
    profileModel?: string | null,
): ResolvedModel {
    const requested = characterModel?.trim() ?? '';
    const preferred = profileModel?.trim() ?? '';
    const listed = provider.models;

    if (requested && listed.includes(requested)) {
        return { model: requested, source: 'character', requested };
    }

    if (preferred && listed.includes(preferred)) {
        if (requested) {
            // The character asked for something unavailable; the profile's
            // choice answers, and the substitution is still reported.
            return { model: preferred, source: 'fallback', requested };
        }
        return { model: preferred, source: 'profile' };
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
