import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound } from '../http/errors.js';
import { getSettings, updateSettings } from '../storage/settings.js';
import { createWorld, deleteWorld, listWorlds, readWorld } from '../storage/worlds.js';

const idParams = z.object({ id: z.string().min(1).max(200) });

const importSchema = z.object({
    fileName: z.string().max(200).optional(),
    book: z.record(z.string(), z.unknown()),
});

export async function registerWorldRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/worlds', async () => ({ worlds: await listWorlds() }));

    app.get('/api/worlds/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const world = await readWorld(id);
        if (!world) {
            throw notFound('World info book not found');
        }
        return { world };
    });

    app.post('/api/worlds/import', async (request, reply) => {
        const body = importSchema.parse(request.body ?? {});
        const world = await createWorld(body);
        reply.code(201);
        return { world };
    });

    app.get('/api/worlds/:id/export', async (request, reply) => {
        const { id } = idParams.parse(request.params);
        const world = await readWorld(id);
        if (!world) {
            throw notFound('World info book not found');
        }

        const fileName = `${id.replace(/[^\w.-]+/g, '_')}.json`;
        reply
            .header('Content-Type', 'application/json; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${fileName}"`);
        return `${JSON.stringify(world.book, null, 4)}\n`;
    });

    app.delete('/api/worlds/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const removed = await deleteWorld(id);

        // A dangling id would make every chat log a missing-book failure.
        const settings = await getSettings();
        if (settings.worldInfo.globalBooks.includes(id)) {
            await updateSettings({
                worldInfo: { globalBooks: settings.worldInfo.globalBooks.filter((book) => book !== id) },
            });
        }

        return { ok: removed };
    });
}
