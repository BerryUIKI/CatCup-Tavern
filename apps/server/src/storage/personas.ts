import { randomUUID } from 'node:crypto';

import { type Persona, type PersonaView, personaEntrySchema } from '@catcup/shared';

import { readJsonFile, writeJsonFile } from './jsonFile.js';
import { withFileLock } from './mutex.js';
import { paths } from './paths.js';
import { clearSettingsCache } from './settings.js';

/**
 * Personas are the one library kind that is not a folder of files.
 *
 * A profile's personas live in its `settings.json`, because that is where they
 * have always been and where a chat's `persona_id` pin expects to find them.
 * The shared layer therefore keeps `data/shared/personas.json` — a bare array —
 * and the settings response merges the two lists.
 *
 * A profile that never shares a persona has no `personas.json` at all, so
 * nothing about the first slice's storage changes for it.
 */

/** Every persona in the shared scope. */
export async function listSharedPersonas(): Promise<Persona[]> {
    const raw = await readJsonFile<unknown>(paths.sharedPersonas, null);
    if (!Array.isArray(raw)) {
        return [];
    }
    const personas: Persona[] = [];
    for (const candidate of raw) {
        const parsed = personaEntrySchema.safeParse(candidate);
        if (parsed.success) {
            personas.push(parsed.data);
        }
    }
    return personas;
}

async function writeSharedPersonas(personas: readonly Persona[]): Promise<void> {
    await writeJsonFile(paths.sharedPersonas, personas);
}

/**
 * Merge a profile's personas with the shared ones.
 *
 * The profile's entry wins on an id collision and is the one marked
 * `shadowed`, exactly as every other library resolves.
 */
export function mergePersonas(profile: readonly Persona[], shared: readonly Persona[]): PersonaView[] {
    const profileIds = new Set(profile.map((persona) => persona.id));
    return [
        ...profile.map((persona) => {
            const shadowed = shared.some((candidate) => candidate.id === persona.id);
            return { ...persona, scope: 'profile' as const, ...(shadowed ? { shadowed: true } : {}) };
        }),
        ...shared
            .filter((persona) => !profileIds.has(persona.id))
            .map((persona) => ({ ...persona, scope: 'shared' as const })),
    ];
}

/**
 * Every persona this profile can use, for `resolvePersona`.
 *
 * A chat pins a persona by id, so the merged list is what the pin resolves
 * against — a persona marked reusable keeps working from every profile. The
 * scope rides along so the settings response can say where each one lives.
 */
export async function listAllPersonas(profile: readonly Persona[]): Promise<PersonaView[]> {
    return mergePersonas(profile, await listSharedPersonas());
}

export type PersonaScopeResult =
    | { status: 'ok'; persona: PersonaView }
    | { status: 'missing' }
    | { status: 'taken'; message: string }
    | { status: 'already'; message: string };

/**
 * Add a persona to the shared list.
 *
 * `id` is minted here so two profiles that share the same name never collide on
 * identity; a chat pin and `activePersonaId` still address one persona. Adding
 * to a profile is a settings patch, because that is where the list lives.
 *
 * The settings cache is dropped because it holds the merged persona list: a
 * caller that read settings before this write would otherwise keep serving the
 * old list until something else invalidated it.
 */
export async function addSharedPersona(name: string, description: string): Promise<PersonaView> {
    const persona: Persona = { id: randomUUID(), name, description };
    await withFileLock(paths.sharedPersonas, async () => {
        const shared = await listSharedPersonas();
        await writeSharedPersonas([...shared, persona]);
    });
    clearSettingsCache();
    return { ...persona, scope: 'shared' };
}

/**
 * Move a shared persona into the profile's own list.
 *
 * Taking a shared persona into a profile is a copy: the profile can then edit
 * or delete its version without changing what other profiles see. The copy
 * keeps the name and gets a fresh id, so both can be pinned independently.
 */
export function copySharedPersonaIntoProfile(persona: Persona): Persona {
    return { ...persona, id: randomUUID() };
}

/** Remove one persona from the shared list. Returns false when the id is unknown. */
export async function deleteSharedPersona(id: string): Promise<boolean> {
    return withFileLock(paths.sharedPersonas, async () => {
        const shared = await listSharedPersonas();
        const next = shared.filter((persona) => persona.id !== id);
        if (next.length === shared.length) {
            return false;
        }
        await writeSharedPersonas(next);
        clearSettingsCache();
        return true;
    });
}

/** Replace one shared persona. Returns false when the id is unknown. */
export async function updateSharedPersona(id: string, patch: Partial<Persona>): Promise<Persona | null> {
    return withFileLock(paths.sharedPersonas, async () => {
        const shared = await listSharedPersonas();
        const index = shared.findIndex((persona) => persona.id === id);
        if (index < 0) {
            return null;
        }
        const next = personaEntrySchema.parse({ ...shared[index], ...patch, id });
        const list = [...shared];
        list[index] = next;
        await writeSharedPersonas(list);
        clearSettingsCache();
        return next;
    });
}
