import { randomUUID } from 'node:crypto';

import { type PersonaView, personaEntrySchema } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound } from '../http/errors.js';
import { addSharedPersona, deleteSharedPersona, listSharedPersonas, updateSharedPersona } from '../storage/personas.js';
import { getSettings, getSettingsResponse, profilePersonas, updateSettings } from '../storage/settings.js';

const idParams = z.object({ id: z.string().min(1).max(200) });

const createSchema = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().max(10_000).default(''),
    /** `shared` creates the persona reusable in every profile. */
    scope: z.enum(['profile', 'shared']).default('profile'),
});

const patchSchema = personaEntrySchema.partial().omit({ id: true });

/**
 * Personas are the one library kind that is not a file per item.
 *
 * A profile's list lives in `settings.json`, which is where a chat's
 * `persona_id` pin and `activePersonaId` already point. The shared list is
 * `data/shared/personas.json`, and `getSettings()` merges the two, so every
 * consumer — the prompt assembler, the settings response, a chat's pin — sees
 * one list.
 *
 * These routes therefore decide one thing: which file a write belongs to. A
 * write to the profile's file always starts from the profile's own entries,
 * never from the merged list, or a shared persona would be copied into the
 * profile on the next save.
 */
export async function registerPersonaRoutes(app: FastifyInstance): Promise<void> {
    /** Whether this id names a shared persona rather than one of the profile's own. */
    async function isShared(id: string): Promise<boolean> {
        return (await listSharedPersonas()).some((persona) => persona.id === id);
    }

    app.post('/api/personas', async (request, reply) => {
        const body = createSchema.parse(request.body ?? {});
        reply.code(201);

        if (body.scope === 'shared') {
            return { persona: await addSharedPersona(body.name, body.description) };
        }

        const persona = { id: randomUUID(), name: body.name, description: body.description };
        const settings = await getSettings();
        await updateSettings({ personas: [...(await profilePersonas(settings)), persona] });
        return { persona: { ...persona, scope: 'profile' } satisfies PersonaView };
    });

    app.patch('/api/personas/:id', async (request) => {
        const { id } = idParams.parse(request.params);
        const patch = patchSchema.parse(request.body ?? {});

        if (await isShared(id)) {
            const updated = await updateSharedPersona(id, patch);
            if (!updated) {
                throw notFound('Persona not found');
            }
            return { persona: { ...updated, scope: 'shared' } };
        }

        const settings = await getSettings();
        const personas = (await profilePersonas(settings)).map((persona) =>
            persona.id === id ? { ...persona, ...patch } : persona,
        );
        if (!personas.some((persona) => persona.id === id)) {
            throw notFound('Persona not found');
        }
        await updateSettings({ personas });
        return { persona: { ...personas.find((persona) => persona.id === id), scope: 'profile' } };
    });

    app.delete('/api/personas/:id', async (request) => {
        const { id } = idParams.parse(request.params);

        if (await isShared(id)) {
            if (!(await deleteSharedPersona(id))) {
                throw notFound('Persona not found');
            }
            return { settings: await getSettingsResponse() };
        }

        const settings = await getSettings();
        const own = await profilePersonas(settings);
        if (!own.some((persona) => persona.id === id)) {
            throw notFound('Persona not found');
        }
        await updateSettings({
            personas: own.filter((persona) => persona.id !== id),
            activePersonaId: settings.activePersonaId === id ? null : settings.activePersonaId,
        });
        return { settings: await getSettingsResponse() };
    });
}
