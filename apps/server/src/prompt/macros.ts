/**
 * The macro subset CatCup expands during prompt assembly.
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
}

const MACRO_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export function substituteMacros(text: string, context: MacroContext): string {
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
        // Single-character chats always render the character name; group
        // chats use a different prompt, which this port does not generate yet.
        charifnotgroup: () => context.char,
        group: () => '',
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
        return resolve ? resolve() : match;
    });
}
