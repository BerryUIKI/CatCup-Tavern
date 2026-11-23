// Written for CatCup. The macro vocabulary CatCup expands, and nothing more:
// a name that is not in the table below is left exactly as the author typed it.

/**
 * The macro subset CatCup expands in prompts and when it displays stored
 * messages.
 *
 * A macro is `{{name}}`, case-insensitive, with optional spaces inside the
 * braces. Unknown names are left untouched rather than blanked: a card written
 * for a richer engine loses nothing visible, and the author can see which
 * macros this client does not know.
 */
export interface MacroContext {
    char: string;
    user: string;
    description: string;
    personality: string;
    scenario: string;
    /**
     * Text the current prompt replaces, for `{{original}}`.
     *
     * Expanded once and then empty, so a card that wraps the default prompt in
     * its own text cannot splice the same paragraph in twice.
     */
    original?: string;
    /** Group chats: every member name, including muted members. */
    group?: readonly string[];
    /** Group chats: members that may reply. */
    groupNotMuted?: readonly string[];
    /** Latest chat summary, for `{{summary}}`. Empty when none exists. */
    summary?: string;
    /** Target word count for the summary prompt, for `{{words}}`. */
    words?: number;
}

/** `{{name}}`, with a name that starts with a letter or underscore. */
const MACRO_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export interface MacroOptions {
    /**
     * Applied to each expanded value rather than to the whole string.
     *
     * Regex scripts use this to escape a macro's value for `substituteRegex:
     * ESCAPED`. Escaping the finished pattern instead would escape its `/`
     * delimiters too, which is the bug this option exists to avoid.
     */
    escapeValue?: (value: string) => string;
}

/**
 * Expand the macros in one string.
 *
 * Values are resolved lazily, which matters for `{{original}}` — it tracks
 * whether it has been used, so resolution cannot happen up front.
 *
 * `{{charIfNotGroup}}` is the odd one: in a group it is the member list,
 * because a group prompt has no single character to name, and outside one it is
 * the character. `{{notChar}}` is everyone else, muted members included,
 * followed by the user.
 */
export function substituteMacros(text: string, context: MacroContext, options: MacroOptions = {}): string {
    if (!text) {
        return '';
    }

    const now = new Date();
    let originalUsed = false;

    const members = context.group ?? [];
    const values: Record<string, () => string> = {
        char: () => context.char,
        user: () => context.user,
        persona: () => context.user,
        description: () => context.description,
        personality: () => context.personality,
        scenario: () => context.scenario,
        charifnotgroup: () => (members.length > 0 ? members.join(', ') : context.char),
        group: () => members.join(', '),
        groupnotmuted: () => (context.groupNotMuted ?? members).join(', '),
        notchar: () => [...members.filter((name) => name !== context.char), context.user].join(', '),
        summary: () => context.summary ?? '',
        words: () => (context.words === undefined ? '' : String(context.words)),
        original: () => {
            if (originalUsed) {
                return '';
            }
            originalUsed = true;
            return context.original ?? '';
        },
        hour: () => now.toLocaleTimeString('en-GB', { hour12: false }),
        date: () => now.toLocaleDateString('en-GB'),
    };
    // `{{time}}` predates `{{hour}}` in the presets people share; both names are
    // accepted so an imported preset keeps working.
    values.time = values.hour;

    return text.replace(MACRO_PATTERN, (match, name: string) => {
        const resolve = values[name.toLowerCase()];
        if (!resolve) {
            return match;
        }
        const value = resolve();
        return options.escapeValue ? options.escapeValue(value) : value;
    });
}
