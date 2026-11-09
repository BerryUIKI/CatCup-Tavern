import type { FastifyInstance } from 'fastify';

import { config } from '../config.js';
import { getAuthFile } from '../storage/auth.js';

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/health', async () => ({
        ok: true,
        version: config.version,
        needsSetup: !(await getAuthFile()),
    }));
}
