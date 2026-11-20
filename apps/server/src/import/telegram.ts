import { type ChatMessage, isRecord } from '@catcup/shared';

/**
 * Turn a Telegram Desktop export into CatCup chat messages.
 *
 * Telegram Desktop's JSON export is `{ name, type, id, messages: [...] }`, and
 * each message is a flat object whose shape depends on what it is: a text
 * message carries `text` (a string or an array of parts), a photo carries
 * `photo`, a service message carries `type: "service"` and an `action`.
 *
 * Three rules shape this file, and all three exist because guessing wrong is
 * silent:
 *
 * 1. **Who is the user is decided by the caller, never inferred.** Guessing from
 *    a name that happens to match a persona reverses every "I" in the story and
 *    is invisible until someone reads the import back.
 * 2. **A row with no text is not a message.** Joins, pins, service actions and
 *    media-only rows are counted and dropped, not invented into prose.
 * 3. **Nothing from the export's own filesystem is written into a chat.** Media
 *    becomes a short marker, never a path — a chat file can be exported to
 *    SillyTavern or shared, and a machine path in a story is a leak.
 */

/** One row of the export that became a message. */
export interface ImportedMessage {
    /** The participant name as Telegram recorded it. */
    from: string;
    text: string;
    /** ISO timestamp when the export carried one. */
    date: string | null;
    /** A short marker for media that had no text, e.g. `[photo]`. */
    media: string | null;
}

export interface ScanResult {
    /** Messages that carry text and will be imported. */
    messages: ImportedMessage[];
    /** Participants, in the order they first spoke, with how many messages each sent. */
    participants: { name: string; count: number }[];
    /** Rows that could not become a message, by reason. */
    skipped: { service: number; empty: number; malformed: number };
    /** The earliest and latest `date` seen, when the export carried one. */
    range: { from: string | null; to: string | null };
    /** The chat title from the export, when present. */
    title: string | null;
}

/**
 * Flatten a Telegram `text` field.
 *
 * It is either a plain string, or an array whose entries are strings or
 * `{ type: "bold", text: "…" }` objects. Inline links and mentions also appear
 * as objects with a `text` that is the visible label — which is what belongs in
 * a chat, not the URL behind it.
 */
export function flattenText(value: unknown): string {
    if (typeof value === 'string') {
        return value;
    }
    if (!Array.isArray(value)) {
        return '';
    }

    let out = '';
    for (const part of value) {
        if (typeof part === 'string') {
            out += part;
        } else if (isRecord(part) && typeof part.text === 'string') {
            out += part.text;
        }
    }
    return out;
}

/**
 * A short marker for a row that had media and no text.
 *
 * These are worth keeping: a conversation where every third row vanished reads
 * as broken, and "they sent a photo" is part of the scene. They are *not* worth
 * keeping as paths, which is why this returns a word rather than a file name.
 */
export function mediaMarker(row: Record<string, unknown>): string | null {
    // Telegram writes a *relative path string* for most media (`"photo":
    // "photos/photo_1.jpg"`) and an object for a sticker. Both mean the same
    // thing to an importer, so both are checked.
    if (isRecord(row.photo) || typeof row.photo === 'string') {
        return '[photo]';
    }
    if (isRecord(row.sticker) || typeof row.sticker === 'string') {
        return '[sticker]';
    }
    if (isRecord(row.file) || typeof row.file === 'string') {
        return '[file]';
    }
    if (isRecord(row.voice_message) || typeof row.voice_message === 'string') {
        return '[voice message]';
    }
    if (isRecord(row.video_file) || typeof row.video_file === 'string') {
        return '[video]';
    }
    if (isRecord(row.animation) || typeof row.animation === 'string') {
        return '[animation]';
    }
    if (row.media_type === 'audio_file' || isRecord(row.audio_file)) {
        return '[audio]';
    }
    return null;
}

/** The display name Telegram recorded for a message's sender. */
function senderOf(row: Record<string, unknown>): string {
    if (typeof row.from === 'string' && row.from.trim()) {
        return row.from.trim();
    }
    // An export written by some clients uses `actor`.
    if (typeof row.actor === 'string' && row.actor.trim()) {
        return row.actor.trim();
    }
    return '';
}

/**
 * Read the export into messages and counts, without deciding who is the user.
 *
 * `title` and `participants` are what a confirmation screen needs; the messages
 * are what an import writes. Both come from one pass so the counts a person
 * sees are the counts that will be written.
 */
export function scanTelegramExport(raw: unknown): ScanResult {
    const result: ScanResult = {
        messages: [],
        participants: [],
        skipped: { service: 0, empty: 0, malformed: 0 },
        range: { from: null, to: null },
        title: null,
    };

    if (!isRecord(raw)) {
        return result;
    }
    if (typeof raw.name === 'string') {
        result.title = raw.name;
    }

    const rows = raw.messages;
    if (!Array.isArray(rows)) {
        return result;
    }

    const counts = new Map<string, number>();

    for (const entry of rows) {
        if (!isRecord(entry)) {
            result.skipped.malformed += 1;
            continue;
        }
        // Service rows are joins, pins, title changes and calls. They have no
        // text and are not part of a conversation.
        if (entry.type === 'service' || isRecord(entry.action)) {
            result.skipped.service += 1;
            continue;
        }

        const from = senderOf(entry);
        const text = flattenText(entry.text);
        const media = text.trim() ? null : mediaMarker(entry);
        const body = text.trim() ? text.trim() : media;

        if (!from || !body) {
            result.skipped.empty += 1;
            continue;
        }

        const date = typeof entry.date === 'string' ? entry.date : null;
        if (date) {
            if (!result.range.from || date < result.range.from) {
                result.range.from = date;
            }
            if (!result.range.to || date > result.range.to) {
                result.range.to = date;
            }
        }

        result.messages.push({ from, text: body, date, media });
        counts.set(from, (counts.get(from) ?? 0) + 1);
    }

    result.participants = [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count);

    return result;
}

/**
 * Build the chat messages an import writes.
 *
 * `owner` is the export participant who becomes the persona — the caller asks;
 * this function never guesses. Everyone else is the character, which is the
 * case a Telegram export of a roleplay actually is: two people, one of them
 * playing the character.
 *
 * A Telegram export of a **group** has more than two participants. That is not
 * supported here and returns `null` rather than silently collapsing everyone
 * else into one name, because collapsing them would rewrite the story.
 */
export function buildChatMessages(
    scan: ScanResult,
    owner: string,
    options: { characterName: string; systemNote?: string },
): ChatMessage[] | null {
    const names = new Set(scan.messages.map((message) => message.from));
    if (!names.has(owner)) {
        return null;
    }

    const others = [...names].filter((name) => name !== owner);
    if (others.length > 1) {
        // More than one non-owner speaker: a group, which this importer does
        // not flatten. See the note in `docs/LIMITATIONS.md`.
        return null;
    }

    const messages: ChatMessage[] = [];

    if (options.systemNote) {
        messages.push({
            name: 'System',
            is_user: false,
            is_system: true,
            mes: options.systemNote,
            send_date: scan.range.from ?? undefined,
        });
    }

    for (const message of scan.messages) {
        const isUser = message.from === owner;
        messages.push({
            name: isUser ? owner : options.characterName,
            is_user: isUser,
            mes: message.text,
            ...(message.date ? { send_date: message.date } : {}),
        });
    }

    return messages;
}
