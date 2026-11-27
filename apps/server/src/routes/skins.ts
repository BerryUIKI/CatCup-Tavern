import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, notFound } from '../http/errors.js';
import { looksLikeArchive, parsePack } from '../packs/catcup.js';
import { declaredAssetPaths, declaredFontFamilies, readSkinAsset } from '../storage/skinAssets.js';
import { getSkin, installSkin, listSkins, readSkinCssFile, removeSkin } from '../storage/skins.js';

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
    /**
     * Installed skins.
     *
     * `fonts` maps an archive path to the family the server declared for it.
     * The client needs that to turn a `tokens.font` path into a family name,
     * and it cannot work it out alone: the asset ids live in the media index,
     * which is only in the archive the server read. One map here is cheaper
     * than sending the whole index and rebuilding the same mapping twice.
     */
    app.get('/api/skins', async () => {
        const skins = await listSkins();
        return {
            skins: await Promise.all(
                skins.map(async (skin) => ({ ...skin, fonts: await declaredFontFamilies(skin.id) })),
            ),
        };
    });

    /**
     * The skin's checked stylesheet.
     *
     * Served rather than embedded in the manifest so the sheet is a document the
     * person can read and a browser can cache, and so the manifest stays
     * editable by hand. 404 when the skin ships none.
     */
    app.get('/api/skins/:id/css', async (request, reply) => {
        const { id } = idParams.parse(request.params);
        const css = await readSkinCssFile(id);
        if (css === null) {
            throw notFound();
        }
        return reply.type('text/css; charset=utf-8').send(css);
    });

    /**
     * A skin's own files, read-only.
     *
     * Only what the install wrote is reachable: the served set is the media
     * index, not the folder, so a file dropped in by hand is not a way in. A
     * path that escapes answers 404 rather than 403 — a caller is not entitled
     * to learn what else is on the disk.
     */
    app.get('/api/skins/:id/media/*', async (request, reply) => {
        const { id } = idParams.parse(request.params);
        const rest = (request.params as Record<string, string>)['*'] ?? '';
        const declared = await declaredAssetPaths(id);
        const asset = await readSkinAsset(id, declared, rest);
        if (!asset) {
            throw notFound();
        }
        return reply
            .header('Cache-Control', 'private, max-age=3600')
            .header('X-Content-Type-Options', 'nosniff')
            .type(asset.contentType)
            .send(asset.data);
    });

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

    /**
     * Install from a file a person has on disk.
     *
     * Accepts a `.catcup` holding a `catcup.skin` manifest, or a bare
     * `manifest.json` — the same JSON, so the two paths agree about what a skin
     * is and a person who has not read RFC 0007 can still bring one. What makes
     * it a container is the ZIP signature, not the file extension: an archive
     * renamed to `.json` is read as an archive, and JSON renamed to `.catcup` is
     * read as JSON.
     */
    app.post(
        '/api/skins/import',
        {
            // The global multipart limit is 20 MB, sized for a card upload. A
            // package may legitimately be larger — the archive reader caps it at
            // 60 MB in total — so without this a valid skin would be refused by the
            // upload layer before the reader ever saw it.
            bodyLimit: 64 * 1024 * 1024,
        },
        async (request) => {
            for await (const part of request.parts()) {
                if (part.type !== 'file') {
                    continue;
                }
                const buffer = await part.toBuffer();
                const fileName = part.filename ?? 'skin';

                if (looksLikeArchive(buffer)) {
                    // A package that is not a skin, uses a format this build
                    // does not read, or has no manifest is a *request* problem
                    // rather than a server fault, so its message reaches the
                    // person instead of becoming "Internal server error".
                    // `parsePack` writes those messages for exactly this reason.
                    let pack: ReturnType<typeof parsePack>;
                    try {
                        pack = parsePack(buffer);
                    } catch (error) {
                        throw badRequest(error instanceof Error ? error.message : 'That package could not be read.');
                    }
                    if (pack.kind !== 'skin') {
                        throw badRequest('That package is not a skin');
                    }
                    return { skin: await installSkin(pack.manifest, pack.css, pack.assets), fileName };
                }

                let raw: unknown;
                try {
                    raw = JSON.parse(buffer.toString('utf8'));
                } catch {
                    throw badRequest(`${fileName} is neither a .catcup package nor valid JSON.`);
                }
                return { skin: await installSkin(raw), fileName };
            }
            throw badRequest('No file was uploaded');
        },
    );
}
