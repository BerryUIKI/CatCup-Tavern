// Written for CatCup. Preparing a message for speech, and splitting a long one
// into chunks a provider will accept.

/**
 * Text preparation for speech.
 *
 * The stored message is never changed — only the copy sent to the speaker. That
 * matters because the same text is also the chat the user reads and the history
 * the model gets; a cleaner that wrote back would quietly damage both.
 */

export interface SpeechTextOptions {
    /** Remove fenced code blocks. */
    skipCodeBlocks?: boolean;
    /** Remove HTML tags and script/style blocks. */
    stripTags?: boolean;
    /** Remove markdown emphasis asterisks. */
    stripAsterisks?: boolean;
}

/** Tags whose opening and closing form a block that carries no speech. */
const BLOCK_TAGS = /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Inline and block tags that survive as text.
 *
 * Every one of these is replaced by a space rather than removed, so `a<b>c`
 * does not become `ac`. The list is deliberately explicit rather than a general
 * `<[^>]+>`: card text and model replies legitimately contain `<` in prose
 * (`<3`, a comparison), and swallowing everything between two angle brackets
 * would delete real sentences.
 */
const TRANSPARENT_TAGS =
    /<\/?(?:a|abbr|b|blockquote|br|code|div|em|h[1-6]|hr|i|img|li|ol|p|pre|s|small|span|strong|table|tbody|td|th|thead|tr|u|ul)\b[^>]*>/gi;

/**
 * Turn a message into something worth reading aloud.
 *
 * The order of the passes is the point, because each one changes what the next
 * one sees:
 *
 * 1. Normalise line endings first, so every later pattern only has to handle
 *    `\n`.
 * 2. Remove fenced code before anything else: a block's contents are not prose,
 *    and stripping its backticks first would leave the code itself behind to be
 *    spoken.
 * 3. Remove script and style elements whole, then the transparent tags. A
 *    `<style>` rule would otherwise be read aloud as a list of declarations.
 * 4. Drop images and keep a link's label — `[the tavern](http://…)` should be
 *    spoken as "the tavern", not as the URL.
 * 5. Remove emphasis markers, then the leading punctuation of headings, quotes
 *    and list items, then inline code backticks.
 * 6. Collapse all whitespace runs, so the removed pieces do not leave gaps that
 *    a speech synthesiser renders as long pauses.
 */
export function prepareSpeechText(text: string, options: SpeechTextOptions = {}): string {
    const skipCodeBlocks = options.skipCodeBlocks ?? true;
    const stripTags = options.stripTags ?? true;
    const stripAsterisks = options.stripAsterisks ?? true;

    let output = text.replace(/\r\n?/g, '\n');

    if (skipCodeBlocks) {
        output = output.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ');
    }
    if (stripTags) {
        output = output.replace(BLOCK_TAGS, ' ').replace(TRANSPARENT_TAGS, ' ');
    }

    // Images carry no useful speech; links keep their label.
    output = output.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

    if (stripAsterisks) {
        output = output.replace(/\*+/g, '').replace(/~~/g, '');
    }

    // Markdown punctuation that would otherwise be read aloud.
    output = output
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/^\s*[-+]\s+/gm, '')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/`/g, '');

    return output.replace(/\s+/g, ' ').trim();
}

/**
 * Split text into chunks a provider can accept.
 *
 * Splits on sentence punctuation and newlines first so a chunk boundary lands
 * where a reader would pause. Only a single sentence longer than the limit is
 * hard-wrapped, and then at the last space before the limit so no word is cut
 * in half.
 *
 * Every returned chunk is non-empty and at most `maxLength` characters. Empty
 * input yields no chunks rather than one empty string, because a provider asked
 * to speak nothing is an error, not a silent no-op.
 */
export function splitSpeechText(text: string, maxLength = 3500): string[] {
    const limit = Math.max(1, Math.floor(maxLength));
    const trimmed = text.trim();
    if (!trimmed) {
        return [];
    }
    if (trimmed.length <= limit) {
        return [trimmed];
    }

    const pieces = trimmed.match(/[^.!?…\n]+[.!?…]*\s*|\n+/g) ?? [trimmed];
    const chunks: string[] = [];
    let current = '';

    const push = (value: string) => {
        const clean = value.trim();
        if (clean) {
            chunks.push(clean);
        }
    };

    for (const piece of pieces) {
        if (piece.length > limit) {
            if (current) {
                push(current);
                current = '';
            }
            let rest = piece;
            while (rest.length > limit) {
                let cut = rest.lastIndexOf(' ', limit);
                if (cut <= 0) {
                    // A single word longer than the limit: cut it rather than
                    // loop forever, since no boundary exists to prefer.
                    cut = limit;
                }
                push(rest.slice(0, cut));
                rest = rest.slice(cut).trimStart();
            }
            current = rest;
            continue;
        }
        if (current.length + piece.length > limit) {
            push(current);
            current = piece;
        } else {
            current += piece;
        }
    }
    push(current);
    return chunks;
}
