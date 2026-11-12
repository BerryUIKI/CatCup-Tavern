/**
 * Text preparation for speech.
 *
 * SillyTavern strips markdown noise before handing a message to a TTS
 * provider; this is the same idea, kept small and testable. The stored message
 * is never changed — only the copy sent to the speaker.
 */

export interface SpeechTextOptions {
    /** Remove fenced code blocks. */
    skipCodeBlocks?: boolean;
    /** Remove HTML tags and script/style blocks. */
    stripTags?: boolean;
    /** Remove markdown emphasis asterisks. */
    stripAsterisks?: boolean;
}

/** Two leading newlines in a row are common in model replies; keep it simple. */
export function prepareSpeechText(text: string, options: SpeechTextOptions = {}): string {
    const skipCodeBlocks = options.skipCodeBlocks ?? true;
    const stripTags = options.stripTags ?? true;
    const stripAsterisks = options.stripAsterisks ?? true;

    let output = text.replace(/\r\n?/g, '\n');

    if (skipCodeBlocks) {
        output = output.replace(/```[\s\S]*?```/g, ' ').replace(/~~~[\s\S]*?~~~/g, ' ');
    }
    if (stripTags) {
        output = output
            .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
            .replace(
                /<\/?(?:a|abbr|b|blockquote|br|code|div|em|h[1-6]|hr|i|img|li|ol|p|pre|s|small|span|strong|table|tbody|td|th|thead|tr|u|ul)\b[^>]*>/gi,
                ' ',
            );
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
 * Splits on sentence punctuation and newlines first; a single oversized
 * sentence is hard-wrapped at the last space before the limit. Every chunk is
 * non-empty and at most `maxLength` characters.
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
