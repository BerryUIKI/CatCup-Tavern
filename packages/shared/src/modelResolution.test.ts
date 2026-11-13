import { describe, expect, it } from 'vitest';

import { resolveModel } from './modelResolution.js';
import type { ProviderConfig } from './schemas/provider.js';

function provider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
    return {
        id: 'p',
        kind: 'custom',
        name: 'Endpoint',
        baseUrl: 'http://127.0.0.1:1/v1',
        models: ['flash', 'pro'],
        defaultModel: 'flash',
        enabled: true,
        headers: {},
        ...overrides,
    };
}

describe('resolveModel', () => {
    it("uses the character's own model when the provider serves it", () => {
        expect(resolveModel(provider(), 'pro')).toEqual({ model: 'pro', source: 'character', requested: 'pro' });
    });

    it('uses the provider default when the character names none', () => {
        expect(resolveModel(provider())).toEqual({ model: 'flash', source: 'default' });
        expect(resolveModel(provider(), '')).toEqual({ model: 'flash', source: 'default' });
        expect(resolveModel(provider(), '   ')).toEqual({ model: 'flash', source: 'default' });
        expect(resolveModel(provider(), null)).toEqual({ model: 'flash', source: 'default' });
    });

    it('falls back to the default and says so when the model is not served', () => {
        expect(resolveModel(provider(), 'glm-5.3')).toEqual({
            model: 'flash',
            source: 'fallback',
            requested: 'glm-5.3',
        });
    });

    it('falls back to the first listed model when the provider has no default', () => {
        const bare = provider({ defaultModel: '' });
        expect(resolveModel(bare)).toEqual({ model: 'flash', source: 'first' });
        expect(resolveModel(bare, 'missing')).toEqual({ model: 'flash', source: 'fallback', requested: 'missing' });
    });

    it('resolves to nothing when the provider serves no models', () => {
        expect(resolveModel(provider({ models: [], defaultModel: '' }))).toEqual({ model: '', source: 'first' });
        expect(resolveModel(provider({ models: [], defaultModel: '' }), 'pro')).toEqual({
            model: '',
            source: 'fallback',
            requested: 'pro',
        });
    });

    it('trims the character model before comparing', () => {
        expect(resolveModel(provider(), '  pro  ')?.source).toBe('character');
    });
});
