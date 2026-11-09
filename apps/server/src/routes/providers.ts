import { providerInputSchema } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { HttpError, notFound } from '../http/errors.js';
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
