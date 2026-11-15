import type { ItemScope, SharedItemActionResult, SharedItemKind } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest, notFound } from '../http/errors.js';
import { changeCharacterScope, copyCharacterIntoScope } from '../storage/characters.js';
import { changePresetScope, copyPresetIntoScope } from '../storage/presets.js';
import { changeQuickReplySetScope, copyQuickReplySetIntoScope } from '../storage/quickReplies.js';
import { changeRegexScriptScope, copyRegexScriptIntoScope } from '../storage/regex.js';
import { liveProfileCount } from '../storage/scopes.js';
import { changeWorldScope, copyWorldIntoScope } from '../storage/worlds.js';

const paramsSchema = z.object({
    kind: z.enum(['characters', 'worlds', 'presets', 'quickreplies', 'regex']),
    id: z.string().min(1).max(300),
    action: z.enum(['move', 'copy']),
});

/**
 * Change where a library item lives.
 *
 * `move` puts the item in `scope` under the id it already has, so every chat, a
 * group membership and an `extensions.world` link that names it keep resolving.
 * `copy` leaves the original where it is and makes a second item under a free
 * id, which is what taking a shared item into a profile means.
 *
 * Personas are the exception: they are a list inside `settings.json` rather than
 * a file per item, so they have their own endpoints on the persona route.
 */
export async function registerSharedRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/shared/:kind/:id/:action', async (request) => {
        const { kind, id, action } = paramsSchema.parse(request.params);
        const scope = scopeFrom(request.query);

        const result = await run(kind, id, action, scope);
        return {
            kind,
            id: result.id,
            scope: result.scope,
            visibleToProfiles: result.scope === 'shared' ? await liveProfileCount() : 1,
        } satisfies SharedItemActionResult;
    });
}

/** The scope an action targets, from `?scope=shared` or `?scope=profile`. */
function scopeFrom(query: unknown): ItemScope {
    const parsed = z.object({ scope: z.enum(['profile', 'shared']).default('shared') }).parse(query ?? {});
    return parsed.scope;
}

/**
 * The kinds that are a folder of files, which is every kind except personas:
 * those are a list inside `settings.json` and have their own endpoints.
 */
type FileItemKind = Exclude<SharedItemKind, 'personas'>;

type ScopeAction = (id: string, target: ItemScope) => Promise<{ id: string; scope: ItemScope }>;

const copyActions: Record<FileItemKind, ScopeAction> = {
    characters: (id, target) => copyCharacterIntoScope(id, target),
    worlds: (id, target) => copyWorldIntoScope(id, target),
    presets: (id, target) => copyPresetIntoScope(id, target),
    quickreplies: (id, target) => copyQuickReplySetIntoScope(id, target),
    regex: (id, target) => nonNull(copyRegexScriptIntoScope(id, target)),
};

const moveActions: Record<FileItemKind, ScopeAction> = {
    characters: (id, target) => changeCharacterScope(id, target),
    worlds: (id, target) => changeWorldScope(id, target),
    presets: (id, target) => changePresetScope(id, target),
    quickreplies: (id, target) => changeQuickReplySetScope(id, target),
    regex: (id, target) => nonNull(changeRegexScriptScope(id, target)),
};

async function run(kind: FileItemKind, id: string, action: 'move' | 'copy', target: ItemScope) {
    const actions = action === 'copy' ? copyActions : moveActions;
    try {
        return await actions[kind](id, target);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Scope change failed';
        if (/not found/i.test(message)) {
            throw notFound(message);
        }
        if (/already in this scope|already has an item/i.test(message)) {
            throw badRequest(message, 'SCOPE_CONFLICT');
        }
        throw error;
    }
}

async function nonNull(promise: Promise<{ id: string; scope: ItemScope } | null>) {
    const result = await promise;
    if (!result) {
        throw notFound('Item not found');
    }
    return result;
}
