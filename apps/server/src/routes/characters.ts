import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    type CharacterBulkResponse,
    type CharacterDetail,
    type CharacterSummary,
    characterBulkRequestSchema,
    characterFavoriteRequestSchema,
    characterIdSchema,
    characterPatchSchema,
    type ImportCharactersResponse,
    type ItemScope,
} from '@catcup/shared';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assetPath } from '../assets.js';
import { buildCharx, parseCharx } from '../cards/charx.js';
import { parseJsonCard } from '../cards/parse.js';
import { buildCardPayload, writePngCard } from '../cards/write.js';
import { config } from '../config.js';
import { badRequest, internal, notFound } from '../http/errors.js';
import { readCharacterAssets, storeCharacterAssets } from '../storage/characterAssets.js';
import {
    deleteCharacter,
    getCharacterFile,
    importCharacter,
    listCharacters,
    normalizeCharacterId,
    setCharacterFavorite,
    setCharacterWorld,
    toSummary,
    updateCharacter,
    updateCharacterTags,
} from '../storage/characters.js';
import { createWorld, readWorld } from '../storage/worlds.js';
import { convertCharacterBook } from '../worldinfo/characterBook.js';
import { requireCharacter } from './helpers.js';

const idParamsSchema = z.object({
    id: characterIdSchema,
});

const exportQuerySchema = z.object({
    format: z.enum(['png', 'json', 'charx', 'catcup']).default('png'),
});

/** The card that ships with the app, relative to the assets folder. */
const SAMPLE_CARD = 'samples/mira.json';

/** The card formats the importer accepts, by extension. */
const CARD_EXTENSIONS = /\.(png|json|charx|catcup)$/i;

/**
 * Packages that are a ZIP holding `card.json` and `assets/`.
 *
 * `.catcup` is CatCup's own name for that layout. It is deliberately the same
 * container CharX uses, so the two convert by renaming and one parser serves
 * both.
 */
const PACKAGE_EXTENSIONS = /\.(charx|catcup)$/i;

const CARD_EXTENSION_MESSAGE = 'Only .png, .json, .charx and .catcup character cards are supported';

const importPathSchema = z.object({
    path: z.string().trim().min(1).max(4096),
});

/** Which scope an import writes to; the profile's own folder when absent. */
function importScope(query: unknown): ItemScope {
    return z.object({ scope: z.enum(['profile', 'shared']).default('profile') }).parse(query ?? {}).scope;
}

/**
 * Import one card file, whatever shape it arrived in.
 *
 * Shared by the multipart upload and by the desktop-only import-by-path route,
 * so both accept exactly the same formats and store CharX assets the same way.
 */
async function importCardFile(
    fileName: string,
    buffer: Buffer,
    log: FastifyBaseLogger,
    scope: ItemScope,
): Promise<ImportCharactersResponse['imported'][number]> {
    if (!CARD_EXTENSIONS.test(fileName)) {
        throw new Error(CARD_EXTENSION_MESSAGE);
    }

    let detail: CharacterDetail;
    if (PACKAGE_EXTENSIONS.test(fileName)) {
        const parsed = parseCharx(buffer);
        const payload = buildCardPayload(parsed.card.raw, {});
        if (parsed.icon) {
            const png = writePngCard(new Uint8Array(parsed.icon), payload);
            detail = await importCharacter('character.png', Buffer.from(png), scope);
        } else {
            const json = `${JSON.stringify(payload, null, 2)}\n`;
            detail = await importCharacter('character.json', Buffer.from(json, 'utf8'), scope);
        }
        await storeCharacterAssets(detail.id, parsed.assets, scope).catch((error) => {
            log.warn({ err: error, characterId: detail.id }, 'CharX assets were not stored');
        });
    } else {
        detail = await importCharacter(fileName, buffer, scope);
    }

    const { card: _card, rawCard: _rawCard, ...summary } = detail;
    return summary;
}

export async function registerCharacterRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/characters', async () => ({
        characters: await listCharacters(),
    }));

    app.get('/api/characters/:id', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        return { character: await requireCharacter(id) };
    });

    app.get('/api/characters/:id/avatar', async (request, reply) => {
        const { id } = idParamsSchema.parse(request.params);
        const found = await getCharacterFile(id);
        if (!found) {
            throw notFound('Avatar not found');
        }
        if (found.detail.format !== 'png') {
            throw notFound('Avatar not found');
        }
        const buffer = await readFile(found.filePath);
        return reply.header('Cache-Control', 'private, max-age=300').type('image/png').send(buffer);
    });

    /**
     * Merge an edit into a card and write it back to its own file.
     *
     * A PNG card keeps its image and gets both `chara` and `ccv3` rewritten, so
     * a reader that prefers V3 and one that only knows V2 agree.
     */
    app.patch('/api/characters/:id', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const patch = characterPatchSchema.parse(request.body ?? {});
        const character = await updateCharacter(id, patch);
        if (!character) {
            throw notFound('Character not found');
        }
        return { character };
    });

    /**
     * Set or clear SillyTavern's favorite flag on a card.
     *
     * The flag lives at `data.extensions.fav`. CatCup keeps it on its own
     * exports; SillyTavern clears favorites when it exports or imports a card.
     */
    app.patch('/api/characters/:id/favorite', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const body = characterFavoriteRequestSchema.parse(request.body ?? {});
        const result = await setCharacterFavorite(id, body.favorite);
        if (result.status === 'missing') {
            throw notFound('Character not found');
        }
        if (result.status === 'unreadable') {
            throw internal('The card could not be read back after writing', 'CHARACTER_READ_FAILED');
        }
        return { character: result.character };
    });

    /**
     * Apply one library action to several characters.
     *
     * Each id is handled independently so one missing or unreadable card does
     * not stop the rest; the caller gets the updated summaries, the deleted ids
     * and the failures.
     */
    app.post('/api/characters/bulk', async (request) => {
        const body = characterBulkRequestSchema.parse(request.body ?? {});
        const ids = [...new Set(body.ids.map(normalizeCharacterId))];
        const characters: CharacterSummary[] = [];
        const deleted: string[] = [];
        const errors: CharacterBulkResponse['errors'] = [];

        for (const id of ids) {
            try {
                if (body.action === 'delete') {
                    if (!(await deleteCharacter(id))) {
                        throw new Error('Character not found');
                    }
                    deleted.push(id);
                    continue;
                }

                const result =
                    body.action === 'favorite' || body.action === 'unfavorite'
                        ? await setCharacterFavorite(id, body.action === 'favorite')
                        : await updateCharacterTags(id, body.tags ?? [], body.action === 'add-tags' ? 'add' : 'remove');
                if (result.status === 'missing') {
                    throw new Error('Character not found');
                }
                if (result.status === 'unreadable') {
                    throw new Error('The card could not be read back after writing');
                }
                characters.push(toSummary(result.character));
            } catch (error) {
                errors.push({ id, message: error instanceof Error ? error.message : 'Bulk action failed' });
            }
        }

        return { characters, deleted, errors } satisfies CharacterBulkResponse;
    });

    /**
     * Import the card's embedded lorebook and link it through `extensions.world`.
     *
     * SillyTavern offers the same action when a card with a book is selected and
     * leaves the lore inert until it is taken. Repeating the call is harmless:
     * a card already linked to an existing book gets that book back.
     */
    app.post('/api/characters/:id/lorebook', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const character = await requireCharacter(id);
        const book = character.card.character_book;
        if (!book || book.entries.length === 0) {
            throw badRequest('This card has no embedded lorebook');
        }

        const linkedName =
            typeof character.card.extensions.world === 'string' ? character.card.extensions.world.trim() : '';
        if (linkedName) {
            const linked = await readWorld(linkedName);
            if (linked) {
                return { world: linked, character, created: false };
            }
        }

        const name = book.name?.trim() || `${character.name}'s Lorebook`;
        const world = await createWorld({ fileName: name, book: convertCharacterBook(book) });
        const updated = await setCharacterWorld(character.id, world.id);
        return { world, character: updated ?? character, created: true };
    });

    app.get('/api/characters/:id/export', async (request, reply) => {
        const { id } = idParamsSchema.parse(request.params);
        const { format } = exportQuerySchema.parse(request.query ?? {});
        const found = await getCharacterFile(id);
        if (!found) {
            throw notFound('Character not found');
        }

        const safeName = found.detail.name.replace(/[^\w.-]+/g, '_') || 'character';

        if (format === 'charx' || format === 'catcup') {
            const assets = await readCharacterAssets(found.detail.id, found.detail.scope);
            const avatar = found.detail.format === 'png' ? await readFile(found.filePath) : null;
            const archive = buildCharx({
                rawCard: found.detail.rawCard,
                name: found.detail.name,
                id: found.detail.id,
                avatar,
                assets,
            });
            return reply
                .header('Content-Type', 'application/zip')
                .header('Content-Disposition', `attachment; filename="${safeName}.${format}"`)
                .send(archive);
        }

        if (format === 'png') {
            if (found.detail.format !== 'png') {
                throw badRequest('This card has no image; export it as JSON instead.');
            }
            const buffer = await readFile(found.filePath);
            reply
                .header('Content-Type', 'image/png')
                .header('Content-Disposition', `attachment; filename="${safeName}.png"`);
            return reply.send(buffer);
        }

        const payload = buildCardPayload(found.detail.rawCard, {});
        return reply
            .header('Content-Type', 'application/json; charset=utf-8')
            .header('Content-Disposition', `attachment; filename="${safeName}.json"`)
            .send(`${JSON.stringify(payload, null, 4)}\n`);
    });

    /**
     * Add the bundled sample character, so a fresh install has someone to talk
     * to. Running it twice returns the copy that is already there rather than
     * making a second one.
     */
    app.post('/api/characters/sample', async (_request, reply) => {
        let buffer: Buffer;
        try {
            buffer = await readFile(assetPath(SAMPLE_CARD));
        } catch {
            throw notFound('The sample character is missing from this build');
        }

        const parsed = parseJsonCard(buffer);
        const existing = (await listCharacters()).find((character) => character.name === parsed.card.name);
        if (existing) {
            return { character: await requireCharacter(existing.id), created: false };
        }

        reply.code(201);
        return { character: await importCharacter('mira.json', buffer), created: true };
    });

    app.post('/api/characters/import', async (request) => {
        const imported: ImportCharactersResponse['imported'] = [];
        const errors: ImportCharactersResponse['errors'] = [];
        const scope = importScope(request.query);

        for await (const part of request.parts()) {
            if (part.type !== 'file') {
                continue;
            }
            const fileName = part.filename ?? 'card';
            const buffer = await part.toBuffer();

            try {
                imported.push(await importCardFile(fileName, buffer, request.log, scope));
            } catch (error) {
                errors.push({
                    fileName,
                    message: error instanceof Error ? error.message : 'Import failed',
                });
            }
        }

        return { imported, errors } satisfies ImportCharactersResponse;
    });

    /**
     * Import a card from a path on this machine.
     *
     * The desktop shell uses this to open a card the user double-clicked. It is
     * only registered in desktop mode, so a web or LAN server answers 404: a
     * route that reads an arbitrary local path has no business there. In
     * desktop mode the boundary is the loopback bind plus the server's origin
     * check, the same as every other endpoint (see docs/SECURITY.md).
     */
    if (config.desktop) {
        app.post('/api/characters/import-path', async (request) => {
            const { path: filePath } = importPathSchema.parse(request.body ?? {});
            const fileName = path.basename(filePath);

            if (!CARD_EXTENSIONS.test(fileName)) {
                throw badRequest(CARD_EXTENSION_MESSAGE);
            }

            let buffer: Buffer;
            try {
                buffer = await readFile(filePath);
            } catch {
                throw badRequest('Could not read the file');
            }

            return {
                imported: [await importCardFile(fileName, buffer, request.log, 'profile')],
                errors: [],
            } satisfies ImportCharactersResponse;
        });
    }

    app.delete('/api/characters/:id', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const deleted = await deleteCharacter(id);
        if (!deleted) {
            throw notFound('Character not found');
        }
        return { ok: true };
    });
}
