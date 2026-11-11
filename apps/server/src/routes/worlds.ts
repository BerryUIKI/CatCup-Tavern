import { worldInfoEntryPatchSchema } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound } from '../http/errors.js';
import { getSettings, updateSettings } from '../storage/settings.js';
import {
    createWorld,
    createWorldEntry,
    deleteWorld,
    deleteWorldEntry,
    duplicateWorldEntry,
    listWorlds,
    readWorld,
    reorderWorldEntries,
    updateWorldEntry,
    type WorldEntryResult,
} from '../storage/worlds.js';

const idParams = z.object({ id: z.string().min(1).max(200) });
const entryParams = idParams.extend({ uid: z.coerce.number().int().min(0) });

const importSchema = z.object({
    fileName: z.string().max(200).optional(),
    book: z.record(z.string(), z.unknown()),
});

const reorderSchema = z.object({
    uids: z.array(z.number().int().min(0)).max(100_000),
});

function unwrap(result: WorldEntryResult) {
    if (result.status === 'missing-book') {
        throw notFound('World info book not found');
    }
    if (result.status === 'missing-entry') {
        throw notFound('World info entry not found');
    }
    return result.uid === undefined ? { world: result.world } : { world: result.world, uid: result.uid };
}

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

    app.post('/api/worlds/:id/entries', async (request, reply) => {
        const { id } = idParams.parse(request.params);
        reply.code(201);
        return unwrap(await createWorldEntry(id));
    });

    app.post('/api/worlds/:id/entries/:uid/duplicate', async (request, reply) => {
        const { id, uid } = entryParams.parse(request.params);
        reply.code(201);
        return unwrap(await duplicateWorldEntry(id, uid));
    });

    app.put('/api/worlds/:id/entries/order', async (request) => {
        const { id } = idParams.parse(request.params);
        const { uids } = reorderSchema.parse(request.body ?? {});
        return unwrap(await reorderWorldEntries(id, uids));
    });

    app.patch('/api/worlds/:id/entries/:uid', async (request) => {
        const { id, uid } = entryParams.parse(request.params);
        const patch = worldInfoEntryPatchSchema.parse(request.body ?? {});
        return unwrap(await updateWorldEntry(id, uid, patch));
    });

    app.delete('/api/worlds/:id/entries/:uid', async (request) => {
        const { id, uid } = entryParams.parse(request.params);
        return unwrap(await deleteWorldEntry(id, uid));
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
