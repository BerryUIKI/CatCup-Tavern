import { DEFAULT_PERSONA, type Persona, type PersonaSettings } from './schemas/settings.js';

export interface PersonaSource {
    personas: readonly Persona[];
    activePersonaId: string | null;
}

/**
 * The persona to use for a request.
 *
 * A chat can pin its own persona; otherwise the account default applies. An
 * unknown id falls back to the first persona rather than failing, so deleting
 * the persona a chat pointed at never breaks that chat. With no personas at
 * all — a file written before the list existed — the built-in default is used.
 */
export function resolvePersona(source: PersonaSource, personaId?: string | null): PersonaSettings {
    const wanted = personaId ?? source.activePersonaId;
    const persona = source.personas.find((candidate) => candidate.id === wanted) ?? source.personas[0];
    return persona ? { name: persona.name, description: persona.description } : DEFAULT_PERSONA;
}

/**
 * The persona a chat pinned, read from its `chat_metadata`.
 *
 * Kept in a metadata field rather than a separate file so a chat travels with
 * its choice when the JSONL is copied or exported.
 */
export function chatPersonaId(metadata: Record<string, unknown> | null | undefined): string | null {
    const value = metadata?.persona_id;
    return typeof value === 'string' && value ? value : null;
}
