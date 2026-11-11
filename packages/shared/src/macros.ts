/**
 * The macro subset CatCup expands in prompts and when it displays stored
 * messages.
 *
 * SillyTavern's macro engine is much larger; this covers the macros that the
 * built-in prompts and character cards use. Unknown macros are left untouched
 * so user content is never silently lost.
 */
export interface MacroContext {
    char: string;
    user: string;
    description: string;
    personality: string;
    scenario: string;
    /**
     * Text the current prompt replaces, for `{{original}}`. SillyTavern
     * expands it once and yields an empty string for later occurrences.
     */
    original?: string;
    /** Group chats: every member name, including muted members. */
    group?: readonly string[];
    /** Group chats: members that may reply. */
    groupNotMuted?: readonly string[];
}

const MACRO_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export interface MacroOptions {
    /**
     * Applied to each expanded value rather than to the whole string.
     *
     * Regex scripts use this to escape a macro's value for `substituteRegex:
     * ESCAPED`; escaping the finished pattern would also escape its `/`
     * delimiters.
     */
    escapeValue?: (value: string) => string;
}

export function substituteMacros(text: string, context: MacroContext, options: MacroOptions = {}): string {
    if (!text) {
        return '';
    }

    const now = new Date();
    let originalUsed = false;

    const values: Record<string, () => string> = {
        char: () => context.char,
        user: () => context.user,
        persona: () => context.user,
        description: () => context.description,
        personality: () => context.personality,
        scenario: () => context.scenario,
        // In a group, `{{charIfNotGroup}}` is the member list; otherwise the
        // character name, as SillyTavern's group macros do.
        charifnotgroup: () => (context.group?.length ? context.group.join(', ') : context.char),
        group: () => (context.group ?? []).join(', '),
        groupnotmuted: () => (context.groupNotMuted ?? context.group ?? []).join(', '),
        notchar: () => [...(context.group ?? []).filter((name) => name !== context.char), context.user].join(', '),
        original: () => {
            if (originalUsed) {
                return '';
            }
            originalUsed = true;
            return context.original ?? '';
        },
        time: () => now.toLocaleTimeString('en-GB', { hour12: false }),
        date: () => now.toLocaleDateString('en-GB'),
    };

    return text.replace(MACRO_PATTERN, (match, name: string) => {
        const resolve = values[name.toLowerCase()];
        if (!resolve) {
            return match;
        }
        const value = resolve();
        return options.escapeValue ? options.escapeValue(value) : value;
    });
}
