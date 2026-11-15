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
    if (!persona) {
        return DEFAULT_PERSONA;
    }
    // The optional fields are carried through rather than dropped: a persona
    // made from a card says how it behaves, and that is the whole point of it.
    return {
        name: persona.name,
        description: persona.description,
        ...(persona.personality ? { personality: persona.personality } : {}),
        ...(persona.scenario ? { scenario: persona.scenario } : {}),
        ...(persona.mesExample ? { mesExample: persona.mesExample } : {}),
    };
}

/**
 * Build a persona from a character card, so a person can play the character.
 *
 * Only the fields that make sense from the user's seat travel. `first_mes` is
 * deliberately not one of them: the card's opening line is something the
 * *assistant* says, and copying it into a persona would make the model greet
 * itself. `description` keeps the appearance and history, which is exactly what
 * a persona description is for.
 */
export function personaFromCard(card: {
    name: string;
    description?: string;
    personality?: string;
    scenario?: string;
    mes_example?: string;
}): PersonaSettings {
    return {
        name: card.name.slice(0, 80) || 'You',
        description: card.description ?? '',
        ...(card.personality?.trim() ? { personality: card.personality } : {}),
        ...(card.scenario?.trim() ? { scenario: card.scenario } : {}),
        ...(card.mes_example?.trim() ? { mesExample: card.mes_example } : {}),
    };
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
