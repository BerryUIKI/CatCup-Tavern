import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest } from '../http/errors.js';
import { importSillyTavern, scanSillyTavern } from '../import/sillytavern.js';

const schema = z.object({
    path: z.string().trim().min(1).max(4096),
    dryRun: z.boolean().default(false),
});

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
    /**
     * Copy an existing SillyTavern installation into this one.
     *
     * `dryRun` reports what would be imported without touching anything, which
     * is what the UI shows before the user commits.
     */
    app.post('/api/import/sillytavern', async (request) => {
        const body = schema.parse(request.body ?? {});
        try {
            if (body.dryRun) {
                return { plan: await scanSillyTavern(body.path) };
            }
            return { result: await importSillyTavern(body.path) };
        } catch (error) {
            throw badRequest(error instanceof Error ? error.message : 'Import failed');
        }
    });
}
