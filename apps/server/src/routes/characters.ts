import { readFile } from 'node:fs/promises';

import type { ImportCharactersResponse } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound } from '../http/errors.js';
import { deleteCharacter, getCharacterFile, importCharacter, listCharacters } from '../storage/characters.js';
import { requireCharacter } from './helpers.js';

const idParamsSchema = z.object({
    id: z.string().min(1).max(200),
});

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

    app.post('/api/characters/import', async (request) => {
        const imported: ImportCharactersResponse['imported'] = [];
        const errors: ImportCharactersResponse['errors'] = [];

        for await (const part of request.parts()) {
            if (part.type !== 'file') {
                continue;
            }
            const fileName = part.filename ?? 'card';
            const buffer = await part.toBuffer();

            if (!/\.(png|json)$/i.test(fileName)) {
                errors.push({ fileName, message: 'Only .png and .json character cards are supported' });
                continue;
            }

            try {
                const detail = await importCharacter(fileName, buffer);
                const { card: _card, rawCard: _rawCard, ...summary } = detail;
                imported.push(summary);
            } catch (error) {
                errors.push({
                    fileName,
                    message: error instanceof Error ? error.message : 'Import failed',
                });
            }
        }

        return { imported, errors } satisfies ImportCharactersResponse;
    });

    app.delete('/api/characters/:id', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const deleted = await deleteCharacter(id);
        if (!deleted) {
            throw notFound('Character not found');
        }
        return { ok: true };
    });
}
