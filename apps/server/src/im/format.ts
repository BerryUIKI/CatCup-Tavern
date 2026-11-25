/**
 * Turning a roleplay reply into Telegram's HTML subset.
 *
 * A character speaks in markdown — `*she smiles*`, `_a whisper_`, `**in the
 * dark**` — and Telegram renders none of it, so the person on the phone reads the
 * asterisks instead of the emphasis. This converts the three markers Telegram's
 * `parse_mode: 'HTML'` has an element for, and leaves everything else exactly as
 * written.
 *
 * **Why HTML rather than Markdown.** Telegram's Markdown modes are picky in ways
 * the sender cannot see: a lone `_` or `*` in ordinary prose opens a span, an
 * unbalanced one makes the whole message fail to parse, and a character name
 * containing an underscore breaks it outright. HTML needs only that the text be
 * escaped, which is a rule this file can enforce completely.
 *
 * **Why the conversion is conservative.** A roleplay reply is prose, not a
 * document. Anything that is not one of the three unambiguous markers is left
 * alone, because turning `snake_case_word` into italics is worse than leaving a
 * markup character visible. Underlines and bold are matched on their doubled and
 * tripled forms only; single asterisks are italic, which is what a character
 * sheet means by them.
 */

/** Characters that must be escaped for Telegram's HTML parser to accept the message. */
const HTML_ESCAPE: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
};

/** Escape the three characters Telegram's HTML mode treats as markup. */
export function escapeTelegramHtml(text: string): string {
    return text.replace(/[&<>]/g, (character) => HTML_ESCAPE[character] ?? character);
}

/**
 * Whether a candidate emphasis span is worth converting.
 *
 * Two rejections, both about not mangling prose:
 *
 * - **A span that crosses a line break** is almost never emphasis; it is a
 *   bullet or a delimiter someone typed. Telegram HTML allows it, but a roleplay
 *   reply that "starts italic and ends four paragraphs later" is a parse the
 *   author did not intend.
 * - **An empty or whitespace-only span** is `** **`, which is a separator, not
 *   emphasis.
 */
function usableSpan(content: string): boolean {
    return content.trim().length > 0 && !content.includes('\n');
}

/**
 * Convert a reply for `parse_mode: 'HTML'`.
 *
 * The order matters. Escaping runs first, so a `<` the author wrote is text and
 * the tags this function adds are the only markup in the result. The marker
 * passes then run from longest to shortest (`***`, then `**`, then `*`),
 * because converting the shorter form first would eat a character from the
 * longer one and leave a stray asterisk behind.
 */
export function formatForTelegram(text: string): string {
    const escaped = escapeTelegramHtml(text);

    return (
        escaped
            // Bold italic, then bold, then italic. `[^\n]` keeps a span from
            // crossing a line, and the lazy quantifier stops one marker pair
            // from swallowing the rest of the sentence.
            .replace(/\*\*\*([^*\n]+?)\*\*\*/g, (_match, inner: string) =>
                usableSpan(inner) ? `<b><i>${inner}</i></b>` : `***${inner}***`,
            )
            .replace(/\*\*([^*\n]+?)\*\*/g, (_match, inner: string) =>
                usableSpan(inner) ? `<b>${inner}</b>` : `**${inner}**`,
            )
            .replace(/\*([^*\n]+?)\*/g, (_match, inner: string) =>
                usableSpan(inner) ? `<i>${inner}</i>` : `*${inner}*`,
            )
            // `__underline__` is Telegram's own marker; a single `_` is left
            // alone because it appears inside ordinary words far more often.
            .replace(/__([^_\n]+?)__/g, (_match, inner: string) =>
                usableSpan(inner) ? `<u>${inner}</u>` : `__${inner}__`,
            )
    );
}

/**
 * Whether a formatted string has balanced tags.
 *
 * A last check before sending. Telegram rejects the *whole* message on a parse
 * error, and a reply the person never sees is worse than one with a stray
 * asterisk — so the caller falls back to plain text when this says no.
 */
export function hasBalancedTags(html: string): boolean {
    const stack: string[] = [];
    const pattern = /<(\/?)(b|i|u)>/g;
    let match = pattern.exec(html);

    while (match) {
        const [, closing, tag] = match;
        if (closing) {
            if (stack.pop() !== tag) {
                return false;
            }
        } else {
            stack.push(tag as string);
        }
        match = pattern.exec(html);
    }

    return stack.length === 0;
}
