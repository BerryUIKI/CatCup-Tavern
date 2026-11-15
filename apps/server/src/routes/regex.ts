import { type ItemScope, regexScriptPatchSchema } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound } from '../http/errors.js';
import {
    createRegexScript,
    deleteRegexScript,
    importRegexScripts,
    listRegexScripts,
    reorderRegexScripts,
    updateRegexScript,
} from '../storage/regex.js';

const idParams = z.object({ id: z.string().min(1).max(200) });

/** Which list a create or an import writes to; `profile` when absent. */
const scopeQuery = z.object({
    scope: z.enum(['profile', 'shared']).default('profile'),
});

const importSchema = z.object({
    data: z.unknown(),
    mode: z.enum(['append', 'replace']).default('append'),
});

const reorderSchema = z.object({
    ids: z.array(z.string().min(1)).max(10_000),
});

const scopeOf = (query: unknown): ItemScope => scopeQuery.parse(query ?? {}).scope;

export async function registerRegexRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/regex', async () => ({ scripts: await listRegexScripts() }));

    app.post('/api/regex', async (request, reply) => {
        const patch = regexScriptPatchSchema.parse(request.body ?? {});
        reply.code(201);
        return { script: await createRegexScript(patch, scopeOf(request.query)) };
    });

    app.post('/api/regex/import', async (request, reply) => {
        const body = importSchema.parse(request.body ?? {});
        reply.code(201);
        const result = await importRegexScripts(body.data, body.mode, scopeOf(request.query));
        return { scripts: result.scripts, errors: result.errors };
    });

    app.put('/api/regex/order', async (request) => ({
        scripts: await reorderRegexScripts(reorderSchema.parse(request.body ?? {}).ids, scopeOf(request.query)),
    }));

    app.get('/api/regex/export', async (_request, reply) => {
        const scripts = await listRegexScripts();
        reply
            .header('Content-Type', 'application/json; charset=utf-8')
            .header('Content-Disposition', 'attachment; filename="catcup-regex.json"');
        return `${JSON.stringify({ scripts }, null, 4)}\n`;
    });

    app.patch('/api/regex/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const patch = regexScriptPatchSchema.parse(request.body ?? {});
        const script = await updateRegexScript(id, patch);
        if (!script) {
            throw notFound('Regex script not found');
        }
        return { script };
    });

    app.delete('/api/regex/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        if (!(await deleteRegexScript(id))) {
            throw notFound('Regex script not found');
        }
        return { ok: true };
    });
}
