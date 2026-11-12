import type { SettingsPatch } from '@catcup/shared';
import { settingsPatchSchema } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';

import { badRequest, notFound } from '../http/errors.js';
import { getSettingsResponse, updateSettings } from '../storage/settings.js';

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/settings', async () => ({
        settings: await getSettingsResponse(),
    }));

    app.patch('/api/settings', async (request) => {
        const patch = settingsPatchSchema.parse(request.body ?? {}) as SettingsPatch;
        try {
            await updateSettings(patch);
        } catch (error) {
            if (error instanceof Error && error.message === 'Provider not found') {
                throw notFound('Provider not found');
            }
            if (error instanceof Error && error.message === 'Provider is disabled') {
                throw badRequest('Provider is disabled', 'PROVIDER_DISABLED');
            }
            throw error;
        }
        return { settings: await getSettingsResponse() };
    });
}
