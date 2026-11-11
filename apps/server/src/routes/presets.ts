import { promptEntrySchema, promptOrderSchema } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound } from '../http/errors.js';
import { createPreset, deletePreset, listPresets, readPreset, updatePreset } from '../storage/presets.js';
import { getSettings, updateSettings } from '../storage/settings.js';

const idParams = z.object({ id: z.string().min(1).max(200) });

const importSchema = z.object({
    fileName: z.string().max(200).optional(),
    preset: z.record(z.string(), z.unknown()),
});

const patchSchema = z.object({
    prompts: z.array(promptEntrySchema).optional(),
    prompt_order: z.array(promptOrderSchema).optional(),
});

export async function registerPresetRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/presets', async () => ({ presets: await listPresets() }));

    app.get('/api/presets/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const preset = await readPreset(id);
        if (!preset) {
            throw notFound('Preset not found');
        }
        return { preset };
    });

    app.post('/api/presets/import', async (request, reply) => {
        const body = importSchema.parse(request.body ?? {});
        const preset = await createPreset(body);
        reply.code(201);
        return { preset };
    });

    app.patch('/api/presets/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const body = patchSchema.parse(request.body ?? {});

        const existing = await readPreset(id);
        if (!existing) {
            throw notFound('Preset not found');
        }

        return {
            preset: await updatePreset(id, {
                prompts: body.prompts,
                prompt_order: body.prompt_order,
            }),
        };
    });

    app.get('/api/presets/:id/export', async (request, reply) => {
        const { id } = idParams.parse(request.params);
        const preset = await readPreset(id);
        if (!preset) {
            throw notFound('Preset not found');
        }

        const fileName = `${id.replace(/[^\w.-]+/g, '_')}.json`;
        reply
            .header('Content-Type', 'application/json; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${fileName}"`);
        return `${JSON.stringify(preset.preset, null, 4)}\n`;
    });

    app.delete('/api/presets/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const removed = await deletePreset(id);

        // Leaving a dangling id would silently fall back to the defaults.
        const settings = await getSettings();
        if (settings.activePresetId === id) {
            await updateSettings({ activePresetId: null });
        }

        return { ok: removed };
    });
}
