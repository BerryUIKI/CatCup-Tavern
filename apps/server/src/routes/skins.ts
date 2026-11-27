import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, notFound } from '../http/errors.js';
import { getSkin, installSkin, listSkins, removeSkin } from '../storage/skins.js';

const idParams = z.object({ id: z.string().min(1).max(160) });

/**
 * Installed skins.
 *
 * The server stores and returns a manifest; it does not decide what a skin
 * looks like. Validation is `skinManifestSchema`, the same schema the client
 * uses, so the two cannot disagree about what a skin is — and the client's
 * review sheet shows exactly what this route will accept.
 */
export async function registerSkinRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/skins', async () => ({ skins: await listSkins() }));

    app.get('/api/skins/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const skin = await getSkin(id);
        if (!skin) {
            throw notFound();
        }
        return { skin };
    });

    app.put('/api/skins/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const body = request.body as { manifest?: unknown } | undefined;
        const manifest = body?.manifest;
        if (!manifest || typeof manifest !== 'object') {
            throw badRequest('A skin is installed from its manifest');
        }
        // The id in the URL and the id in the manifest have to agree, or a
        // request could write one skin's values under another's name and the
        // selection would silently point at the wrong file.
        const parsed = await installSkin(manifest);
        if (parsed.id !== id) {
            throw badRequest('The manifest id does not match the id it was sent as');
        }
        return { skin: parsed };
    });

    app.delete('/api/skins/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        return { removed: await removeSkin(id) };
    });
}
