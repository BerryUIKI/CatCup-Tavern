import type { CharacterSummary } from '@catcup/shared';

import { requireCharacter } from '../routes/helpers.js';
import { getCharacter, listCharacters } from '../storage/characters.js';
import { createChat, listChats, readChat } from '../storage/chats.js';
import { clearBinding, type ImBinding, readBinding, setBinding } from './bindings.js';
import { parseCommand, splitForTelegram } from './commands.js';
import type { IncomingMessage, Transport } from './transport.js';

/**
 * What happens when a message arrives over an IM transport.
 *
 * The conversation is deliberately thin. It resolves a binding, answers the
 * handful of commands, and hands anything else to `generate` — a callback the
 * wiring supplies, so this file never learns how a reply is produced and the
 * reply path can be swapped or faked in a test.
 *
 * One rule shapes all of it: **a second message while a reply is being
 * generated is refused with a sentence**, not queued and not dropped. A queue
 * is a feature with its own UI and its own failure modes; refusing is honest,
 * and it is what the person would do if they were standing there.
 */

/** How a reply is produced for one conversation turn. */
export interface GenerateInput {
    characterId: string;
    chatId: string;
    message: string;
    /**
     * Aborts the generation. `/stop` trips it, and what had been written is
     * kept — the same partial-reply behaviour a browser stop gets.
     *
     * Required, not optional: an implementation that ignores it would answer
     * "Stopped." and then deliver the whole reply anyway, which is worse than
     * having no `/stop` at all.
     */
    signal: AbortSignal;
}

/** The generation seam. Throws to report failure; the caller turns it into text. */
export type GenerateFn = (input: GenerateInput) => Promise<string>;

export interface ConversationDeps {
    transport: Pick<Transport, 'send'>;
    generate: GenerateFn;
    /** Overridable so a test does not need the real profile storage. */
    resolveCharacter?: (id: string) => Promise<{ id: string; name: string } | null>;
}

/** The chats in flight, by IM chat id. One per conversation. */
const inFlight = new Map<string, AbortController>();

/** Words sent to a person, never stored, when something goes wrong. */
const MESSAGES = {
    unbound: 'No chat is bound yet. Send /chat <character> to pick one.',
    unknownCharacter: (name: string) => `No character called "${name}". Send /chat to see the list.`,
    noChats: 'That character has no chats.',
    busy: 'Still writing the last reply. Send /stop to interrupt it.',
    failed: (reason: string) => `Something went wrong: ${reason}`,
    empty: 'The model returned nothing.',
    /** What the stopping turn itself says after an abort, replacing a reply. */
    stopped: 'Stopped. What had been written is in the chat.',
} as const;

/** A character list short enough for one message. */
function describeCharacters(characters: readonly CharacterSummary[]): string {
    if (characters.length === 0) {
        return 'There are no characters yet. Add one in the app.';
    }
    const names = characters.slice(0, 30).map((character) => character.name);
    const more = characters.length > names.length ? `\n…and ${characters.length - names.length} more.` : '';
    return `Characters:\n${names.map((name) => `· ${name}`).join('\n')}${more}`;
}

/**
 * Answer one incoming message.
 *
 * Returns what was sent, which is what a test asserts on — and is why this
 * function owns every string a person sees rather than leaving them scattered
 * through the handler.
 */
export async function handleMessage(message: IncomingMessage, deps: ConversationDeps): Promise<string[]> {
    const sent: string[] = [];
    const reply = async (text: string): Promise<void> => {
        // Split first: every message this function emits goes through the same
        // length rule, including the command answers.
        for (const chunk of splitForTelegram(text)) {
            await deps.transport.send(message.chatId, chunk);
            sent.push(chunk);
        }
    };

    const command = parseCommand(message.text);

    switch (command.kind) {
        case 'help':
            await reply(helpText());
            return sent;
        case 'who':
            await reply(await describeBinding(message.chatId));
            return sent;
        case 'stop':
            await reply(stopGeneration(message.chatId));
            return sent;
        case 'new':
            await reply(await startNewChat(message.chatId, deps));
            return sent;
        case 'chat':
            await reply(await bindChat(message.chatId, command.argument));
            return sent;
        case 'message':
            await reply(await talk(message.chatId, command.text, deps));
            return sent;
    }
}

function helpText(): string {
    return [
        'Send a message to talk to the bound character.',
        '',
        '/chat <character> — bind this conversation to one of their chats',
        '/chat — list the characters',
        '/new — start a fresh chat with the same character',
        '/stop — interrupt the reply being written',
        '/who — what this conversation is bound to',
    ].join('\n');
}

async function describeBinding(imChatId: string): Promise<string> {
    const binding = await readBinding(imChatId);
    if (!binding) {
        return MESSAGES.unbound;
    }
    const character = await getCharacter(binding.characterId);
    const busy = inFlight.has(imChatId) ? '\nA reply is being written now.' : '';
    return `Talking to ${character?.name ?? binding.characterId} in “${binding.chatId}”.${busy}`;
}

/** Abort whatever is generating for this conversation. */
function stopGeneration(imChatId: string): string {
    const controller = inFlight.get(imChatId);
    if (!controller) {
        return 'Nothing is being written.';
    }
    controller.abort();
    inFlight.delete(imChatId);
    // The partial reply is kept by the generation path, so this only stops it.
    return 'Stopped.';
}

async function startNewChat(imChatId: string, deps: ConversationDeps): Promise<string> {
    const binding = await readBinding(imChatId);
    if (!binding) {
        return MESSAGES.unbound;
    }
    const character = await resolveCharacter(binding.characterId, deps);
    if (!character) {
        return MESSAGES.unknownCharacter(binding.characterId);
    }

    const created = await createChat(await requireCharacter(character.id));
    await setBinding(imChatId, { characterId: character.id, chatId: created.chatId });
    return `Started “${created.chatId}” with ${character.name}.`;
}

async function bindChat(imChatId: string, argument: string): Promise<string> {
    if (!argument) {
        // `/chat` with no argument lists what is available, which is what a
        // person typed it for.
        const characters = await listCharacters();
        return describeCharacters(characters);
    }

    const wanted = argument.toLowerCase();
    const characters = await listCharacters();
    const character =
        characters.find((candidate) => candidate.name.toLowerCase() === wanted) ??
        characters.find((candidate) => candidate.name.toLowerCase().startsWith(wanted)) ??
        characters.find((candidate) => candidate.id.toLowerCase() === wanted);

    if (!character) {
        return MESSAGES.unknownCharacter(argument);
    }

    const chats = await listChats(await requireCharacter(character.id));
    // The newest chat is the one a person means: they were talking in it a
    // moment ago. Creating a chat here would fork the story without asking.
    const newest = chats[0];
    if (!newest) {
        const created = await createChat(await requireCharacter(character.id));
        await setBinding(imChatId, { characterId: character.id, chatId: created.chatId });
        return `Started “${created.chatId}” with ${character.name}.`;
    }

    await setBinding(imChatId, { characterId: character.id, chatId: newest.id });
    return `Bound to ${character.name} in “${newest.id}”.`;
}

async function resolveCharacter(id: string, deps: ConversationDeps): Promise<{ id: string; name: string } | null> {
    if (deps.resolveCharacter) {
        return deps.resolveCharacter(id);
    }
    const character = await getCharacter(id);
    return character ? { id: character.id, name: character.name } : null;
}

/**
 * Send one line to the bound character and answer with the reply.
 *
 * Two things this deliberately does *not* do. It does not queue: a second
 * message while one is generating is refused, because a queue needs its own UI
 * and its own failure modes. And it does not swallow a failure into silence: a
 * provider that is down answers with a sentence, because silence looks
 * exactly like a bot that has died.
 */
async function talk(imChatId: string, text: string, deps: ConversationDeps): Promise<string> {
    const binding = await readBinding(imChatId);
    if (!binding) {
        return MESSAGES.unbound;
    }

    if (inFlight.has(imChatId)) {
        return MESSAGES.busy;
    }

    const character = await resolveCharacter(binding.characterId, deps);
    if (!character) {
        return MESSAGES.unknownCharacter(binding.characterId);
    }

    // A chat deleted from the app is reported, not silently recreated: making a
    // new one would fork the story without telling anyone.
    const chat = await readChat(await requireCharacter(character.id), binding.chatId).catch(() => null);
    if (!chat) {
        await clearBinding(imChatId);
        return `“${binding.chatId}” is gone — it was deleted in the app. Send /chat ${character.name} to bind again.`;
    }

    const controller = new AbortController();
    inFlight.set(imChatId, controller);

    try {
        const reply = await deps.generate({
            characterId: character.id,
            chatId: binding.chatId,
            message: text,
            signal: controller.signal,
        });
        if (!reply.trim()) {
            return MESSAGES.empty;
        }
        // No notification hook here on purpose. This reply is delivered in the
        // conversation it came from, so a "it is ready" message would arrive in
        // the same chat as the reply itself — see `notify.ts`.
        return reply;
    } catch (error) {
        // A stop is not a failure. The generation core stores what it had and
        // reports it as stopped, so blaming the provider for an abort would
        // send the person looking for a problem that does not exist.
        if (controller.signal.aborted) {
            return MESSAGES.stopped;
        }
        return MESSAGES.failed(error instanceof Error ? error.message : 'the reply failed');
    } finally {
        inFlight.delete(imChatId);
    }
}

/** True when a reply is being written for this conversation, for `/who`. */
export function isBusy(imChatId: string): boolean {
    return inFlight.has(imChatId);
}

/** Forget every in-flight marker. Used when the transport stops. */
export function resetInFlight(): void {
    for (const controller of inFlight.values()) {
        controller.abort();
    }
    inFlight.clear();
}

export type { ImBinding };
