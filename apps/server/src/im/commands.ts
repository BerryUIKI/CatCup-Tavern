/**
 * The handful of commands an IM conversation understands, and the splitting
 * rule that makes a long reply fit Telegram.
 *
 * Both live here, apart from the transport and apart from the binding, because
 * both are pure: a string in, a decision out. That is what lets them be tested
 * without a bot, a socket or a chat file.
 */

export type ImCommand =
    | { kind: 'chat'; argument: string }
    | { kind: 'new' }
    | { kind: 'stop' }
    | { kind: 'who' }
    | { kind: 'help' }
    /** Anything that is not a command: talk to the bound character. */
    | { kind: 'message'; text: string };

/** Longest a command name may be before it is treated as ordinary text. */
const MAX_COMMAND = 20;

/**
 * Read one message as a command or as speech.
 *
 * A bare text message has to mean "talk to the bound character" and nothing
 * else, so only a leading `/word` is a command. Telegram appends `@botname` when
 * a command is sent in a group, which is stripped — otherwise `/stop@catcup_bot`
 * would be read as `stop@catcup_bot` and silently treated as speech.
 */
export function parseCommand(raw: string): ImCommand {
    const text = raw.trim();
    if (!text.startsWith('/')) {
        return { kind: 'message', text };
    }

    // `/chat@catcup_bot Aurelia` -> name `chat`, argument `Aurelia`.
    const withoutSlash = text.slice(1);
    const space = withoutSlash.search(/\s/);
    const head = space >= 0 ? withoutSlash.slice(0, space) : withoutSlash;
    const argument = space >= 0 ? withoutSlash.slice(space + 1).trim() : '';

    const name = (head.split('@')[0] ?? '').toLowerCase();
    if (!name || name.length > MAX_COMMAND) {
        return { kind: 'message', text };
    }

    switch (name) {
        case 'chat':
            return { kind: 'chat', argument };
        case 'new':
            return { kind: 'new' };
        case 'stop':
            return { kind: 'stop' };
        case 'who':
            return { kind: 'who' };
        case 'start':
        case 'help':
            // `/start` is what Telegram sends when someone opens a bot, so it
            // gets the help text rather than being ignored as unknown.
            return { kind: 'help' };
        default:
            // An unknown `/command` is text: refusing it would lose a message
            // that might legitimately start with a slash.
            return { kind: 'message', text };
    }
}

/** Telegram's maximum message length. */
export const TELEGRAM_MAX_LENGTH = 4096;

/**
 * Split a reply into messages Telegram will accept.
 *
 * Paragraphs first, then sentences, then a hard cut — in that order, because
 * each is less damaging than the next. A blank line is where a writer put a
 * boundary; a full stop is where a sentence ended; a character count is where
 * Telegram stopped caring.
 *
 * Streaming the reply as edits is deliberately not done: the Bot API allows
 * roughly one edit per second per chat, and a rate-limited edit loop looks worse
 * than one finished message.
 */
export function splitForTelegram(text: string, limit = TELEGRAM_MAX_LENGTH): string[] {
    const trimmed = text.trim();
    if (!trimmed) {
        return [];
    }
    if (trimmed.length <= limit) {
        return [trimmed];
    }

    const chunks: string[] = [];
    let current = '';

    const flush = (): void => {
        if (current.trim()) {
            chunks.push(current.trim());
        }
        current = '';
    };

    for (const paragraph of trimmed.split(/\n{2,}/)) {
        // A paragraph that fits goes in whole, joining the current chunk.
        const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
        if (candidate.length <= limit) {
            current = candidate;
            continue;
        }

        flush();

        if (paragraph.length <= limit) {
            current = paragraph;
            continue;
        }

        // Too long even alone: break it on sentences, then on characters.
        for (const piece of splitSentences(paragraph, limit)) {
            const joined = current ? `${current} ${piece}` : piece;
            if (joined.length <= limit) {
                current = joined;
                continue;
            }
            flush();
            if (piece.length <= limit) {
                current = piece;
                continue;
            }
            // A single "sentence" longer than the limit: cut it, preferring a
            // space so a word is not split unless there is no space at all.
            for (const hard of hardCut(piece, limit)) {
                chunks.push(hard);
            }
        }
    }
    flush();

    return chunks;
}

/** Break a paragraph into sentences, keeping the punctuation. */
function splitSentences(text: string, limit: number): string[] {
    // Latin, CJK and the two ellipsis forms. A CJK full stop matters here: a
    // Chinese reply has no spaces, so without it the whole paragraph is one
    // "sentence" and falls through to a character cut.
    const parts = text.split(/(?<=[.!?。！？…])\s*/gu);
    const out: string[] = [];
    for (const part of parts) {
        if (!part) {
            continue;
        }
        if (part.length <= limit) {
            out.push(part);
        } else {
            out.push(...hardCut(part, limit));
        }
    }
    return out;
}

/** Cut at the last space before the limit, or exactly at it when there is none. */
function hardCut(text: string, limit: number): string[] {
    const out: string[] = [];
    let rest = text;

    while (rest.length > limit) {
        const window = rest.slice(0, limit);
        const space = window.lastIndexOf(' ');
        // `> limit / 4` avoids emitting a tiny fragment because of one odd
        // space near the start.
        const cut = space > limit / 4 ? space : limit;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
    }
    if (rest) {
        out.push(rest);
    }
    return out;
}
