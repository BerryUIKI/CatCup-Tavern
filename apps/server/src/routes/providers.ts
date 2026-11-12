import { DEFAULT_BASE_URLS, type ProviderConfig, providerDraftTestSchema, providerInputSchema } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, HttpError, notFound } from '../http/errors.js';
import { getAdapter } from '../providers/index.js';
import {
    createProvider,
    deleteProvider,
    getProvider,
    getProviderSecret,
    getPublicProviders,
    updateProvider,
} from '../storage/settings.js';

const idParamsSchema = z.object({
    id: z.string().min(1).max(200),
});

const testBodySchema = z.object({
    apiKey: z.string().max(2000).optional(),
});

function providerError(error: unknown): HttpError {
    return new HttpError(502, error instanceof Error ? error.message : 'Provider request failed', 'PROVIDER_ERROR');
}

/** A normalized http(s) base URL, or null when the value is not one. */
function normalizedBaseUrl(value: string): string | null {
    try {
        const url = new URL(value);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return null;
        }
        return url.toString().replace(/\/+$/, '');
    } catch {
        return null;
    }
}

export async function registerProviderRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/providers', async () => ({
        providers: await getPublicProviders(),
    }));

    app.post('/api/providers', async (request) => {
        const input = providerInputSchema.parse(request.body ?? {});
        return { provider: await createProvider(input) };
    });

    app.patch('/api/providers/:id', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const input = providerInputSchema.parse(request.body ?? {});
        try {
            return { provider: await updateProvider(id, input) };
        } catch (error) {
            if (error instanceof Error && error.message === 'Provider not found') {
                throw notFound('Provider not found');
            }
            throw error;
        }
    });

    app.delete('/api/providers/:id', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        try {
            await deleteProvider(id);
            return { ok: true };
        } catch (error) {
            if (error instanceof Error && error.message === 'Provider not found') {
                throw notFound('Provider not found');
            }
            throw error;
        }
    });

    app.post('/api/providers/test', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request) => {
        const input = providerDraftTestSchema.parse(request.body ?? {});
        const baseUrl = input.provider.baseUrl || DEFAULT_BASE_URLS[input.provider.kind] || '';
        const draftUrl = normalizedBaseUrl(baseUrl);
        if (!draftUrl) {
            throw badRequest('The base URL must be an http(s) URL.', 'INVALID_BASE_URL');
        }

        let saved: Awaited<ReturnType<typeof getProvider>> = null;
        if (input.savedProviderId) {
            saved = await getProvider(input.savedProviderId);
            if (!saved) {
                throw notFound('Provider not found');
            }
        }

        let apiKey = input.apiKey;
        if (apiKey === undefined && saved) {
            const savedUrl = normalizedBaseUrl(saved.baseUrl || DEFAULT_BASE_URLS[saved.kind] || '');
            if (saved.kind !== input.provider.kind || savedUrl !== draftUrl) {
                throw badRequest('Enter the API key to test a different endpoint.', 'PROVIDER_KEY_REUSE');
            }
            apiKey = await getProviderSecret(saved.id);
        }

        const config: ProviderConfig = {
            id: input.savedProviderId ?? 'draft',
            kind: input.provider.kind,
            name: input.provider.name,
            baseUrl,
            model: input.provider.model,
            enabled: input.provider.enabled,
            headers: input.provider.headers,
        };

        const result = await getAdapter(config).test(config, apiKey);
        return { result };
    });

    app.post('/api/providers/:id/test', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const body = testBodySchema.parse(request.body ?? {});
        const provider = await getProvider(id);
        if (!provider) {
            throw notFound('Provider not found');
        }

        const apiKey = body.apiKey !== undefined ? body.apiKey : await getProviderSecret(id);
        const result = await getAdapter(provider).test(provider, apiKey);
        return { result };
    });

    app.get('/api/providers/:id/models', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const provider = await getProvider(id);
        if (!provider) {
            throw notFound('Provider not found');
        }

        const apiKey = await getProviderSecret(id);
        try {
            const models = await getAdapter(provider).listModels(provider, apiKey);
            return { models };
        } catch (error) {
            throw providerError(error);
        }
    });
}
