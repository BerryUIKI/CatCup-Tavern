import { profileCreateSchema, profileRenameSchema, type SettingsResponse } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { activeGenerations } from '../generation/registry.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import { withFileLock } from '../storage/mutex.js';
import { paths } from '../storage/paths.js';
import {
    archiveProfile,
    createProfile,
    deleteArchivedProfile,
    listArchivedProfiles,
    listProfiles,
    renameProfile,
    restoreProfile,
    switchProfile,
} from '../storage/profiles.js';
import { clearSettingsCache, getSettingsResponse } from '../storage/settings.js';

const idParamsSchema = z.object({
    id: z.string().min(1).max(120),
});

const activateSchema = z.object({
    id: z.string().min(1).max(120),
});

/** Translate a storage-level refusal into the HTTP code the client shows. */
function profileError(error: unknown): never {
    const message = error instanceof Error ? error.message : 'Profile error';
    if (/not found/i.test(message)) {
        throw notFound(message);
    }
    if (/cannot be archived|last profile|archive the profile|already active|not archived/i.test(message)) {
        throw badRequest(message, 'PROFILE_STATE');
    }
    throw error;
}

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/profiles', async () => {
        const [live, archived] = await Promise.all([listProfiles(), listArchivedProfiles()]);
        return { activeProfileId: live.active, profiles: live.profiles, archived };
    });

    app.post('/api/profiles', async (request, reply) => {
        const input = profileCreateSchema.parse(request.body ?? {});
        try {
            const profile = await createProfile(input);
            reply.code(201);
            return { profile };
        } catch (error) {
            profileError(error);
        }
    });

    app.patch('/api/profiles/:id', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        const patch = profileRenameSchema.parse(request.body ?? {});
        try {
            return { profile: await renameProfile(id, patch) };
        } catch (error) {
            profileError(error);
        }
    });

    /**
     * Switch the profile the server serves.
     *
     * Refused while a generation is running: a reply resolves its provider and
     * preset when the request starts, so letting the scope move underneath it
     * would write the finished message into a different profile's chat file.
     * The answer is a 409 the client turns into "finish or stop the reply".
     */
    app.put('/api/profiles/active', async (request) => {
        const { id } = activateSchema.parse(request.body ?? {});
        if (activeGenerations.size > 0) {
            throw conflict('Finish or stop the current reply before switching profiles.', 'PROFILE_BUSY');
        }

        return withFileLock(paths.globalSettings, async () => {
            try {
                await switchProfile(id);
            } catch (error) {
                profileError(error);
            }
            // The scope changed, so every cached value belongs to the old one.
            clearSettingsCache();
            const settings: SettingsResponse = await getSettingsResponse();
            return { activeProfileId: id, settings };
        });
    });

    app.post('/api/profiles/:id/archive', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        try {
            await archiveProfile(id);
            return { ok: true };
        } catch (error) {
            profileError(error);
        }
    });

    app.post('/api/profiles/:id/restore', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        try {
            await restoreProfile(id);
            return { ok: true };
        } catch (error) {
            profileError(error);
        }
    });

    app.delete('/api/profiles/:id', async (request) => {
        const { id } = idParamsSchema.parse(request.params);
        try {
            await deleteArchivedProfile(id);
            return { ok: true };
        } catch (error) {
            profileError(error);
        }
    });
}
