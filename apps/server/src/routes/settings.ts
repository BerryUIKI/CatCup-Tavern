import type { SettingsPatch } from '@catcup/shared';
import { settingsPatchSchema } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';

import { getSettingsResponse, updateSettings } from '../storage/settings.js';

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/settings', async () => ({
        settings: await getSettingsResponse(),
    }));

    app.patch('/api/settings', async (request) => {
        const patch = settingsPatchSchema.parse(request.body ?? {}) as SettingsPatch;
        await updateSettings(patch);
        return { settings: await getSettingsResponse() };
    });
}
