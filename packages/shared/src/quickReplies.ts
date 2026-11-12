// Semantics follow SillyTavern's Quick Replies extension and the small set of
// slash commands CatCup supports. This is a new, deliberately smaller parser,
// not a port of SillyTavern's SlashCommandParser. See docs/ST-COMPATIBILITY.md.

/** The slash commands the Quick Replies subset can run. */
export const QUICK_REPLY_COMMAND_NAMES = ['send', 'sys', 'echo', 'trigger', 'continue', 'regenerate', 'run'] as const;
export type QuickReplyCommandName = (typeof QUICK_REPLY_COMMAND_NAMES)[number];

/** SillyTavern's aliases for the supported commands. */
const COMMAND_ALIASES: Record<string, QuickReplyCommandName> = {
    send: 'send',
    sys: 'sys',
    nar: 'sys',
    echo: 'echo',
    trigger: 'trigger',
    continue: 'continue',
    cont: 'continue',
    regenerate: 'regenerate',
    regen: 'regenerate',
    run: 'run',
    call: 'run',
    exec: 'run',
    ':': 'run',
};

/**
 * Named arguments the parser recognizes.
 *
 * A `key=value` token with a key outside this set is kept as message text, so
 * ordinary prose such as `2+2=4` is not mistaken for an argument. The executor
 * decides which of them a command accepts.
 */
const NAMED_ARGUMENT_KEYS = new Set([
    'name',
    'title',
    'severity',
    'await',
    'return',
    'compact',
    'raw',
    'at',
    'args',
    // Echo-only ST arguments; accepted and ignored.
    'timeout',
    'extendedTimeout',
    'preventDuplicates',
    'cssClass',
    'escapeHtml',
    'awaitDismissal',
    'onClick',
]);

export interface ParsedQuickReplyCommand {
    /** The canonical command name. */
    name: QuickReplyCommandName;
    /** The name as written, so errors can quote it. */
    alias: string;
    /** The unnamed text argument, quotes and escapes resolved. */
    argument: string;
    /** Named arguments, in the order they appeared. */
    named: Record<string, string>;
}

export type QuickReplyParseResult =
    | { kind: 'text'; text: string }
    | { kind: 'commands'; commands: ParsedQuickReplyCommand[] }
    | { kind: 'error'; message: string };

/**
 * Read a quick reply message the way SillyTavern does.
 *
 * A message that does not start with `/` is plain text and is placed in the
 * message box. Otherwise it is a `|`-separated command list; quotes protect
 * pipes and spaces, and `\|` escapes a pipe. Leading whitespace before the
 * first slash makes the message plain text, matching ST's check.
 */
export function parseQuickReplyScript(message: string): QuickReplyParseResult {
    if (message[0] !== '/') {
        return { kind: 'text', text: message };
    }

    const script = message.trim();
    if (!script) {
        return { kind: 'text', text: '' };
    }

    const split = splitScript(script);
    if ('error' in split) {
        return { kind: 'error', message: split.error };
    }

    const commands: ParsedQuickReplyCommand[] = [];
    for (const segment of split.segments) {
        const parsed = parseSegment(segment);
        if ('error' in parsed) {
            return { kind: 'error', message: parsed.error };
        }
        commands.push(parsed.command);
    }
    return { kind: 'commands', commands };
}

interface SplitSuccess {
    segments: string[];
}

function splitScript(script: string): SplitSuccess | { error: string } {
    const segments: string[] = [];
    let current = '';
    let quoted = false;

    for (let index = 0; index < script.length; index += 1) {
        const char = script[index] as string;
        if (char === '\\' && index + 1 < script.length) {
            current += char + script[index + 1];
            index += 1;
            continue;
        }
        if (char === '"') {
            quoted = !quoted;
            current += char;
            continue;
        }
        if (char === '|' && !quoted) {
            segments.push(current);
            current = '';
            continue;
        }
        current += char;
    }

    if (quoted) {
        return { error: 'The quick reply has an unclosed quote.' };
    }
    segments.push(current);

    const trimmed = segments.map((segment) => segment.trim());
    if (trimmed.some((segment) => segment.length === 0)) {
        return { error: 'A quick reply command is empty.' };
    }
    return { segments: trimmed };
}

function parseSegment(segment: string): { command: ParsedQuickReplyCommand } | { error: string } {
    let alias: string;
    let rest: string;

    if (segment.startsWith('/:')) {
        alias = ':';
        rest = segment.slice(2).trim();
    } else {
        const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(segment);
        if (!match) {
            return { error: `"${segment}" is not a quick reply command.` };
        }
        alias = match[1] as string;
        rest = (match[2] ?? '').trim();
    }

    const name = COMMAND_ALIASES[alias.toLowerCase()];
    if (!name) {
        return {
            error: `Unsupported quick reply command "/${alias}". Supported commands: ${QUICK_REPLY_COMMAND_NAMES.map((item) => `/${item}`).join(', ')}.`,
        };
    }

    const args = parseArguments(rest);
    if ('error' in args) {
        return args;
    }
    return { command: { name, alias, argument: args.text, named: args.named } };
}

function parseArguments(input: string): { named: Record<string, string>; text: string } | { error: string } {
    const named: Record<string, string> = {};
    let index = 0;

    while (index < input.length) {
        while (index < input.length && /\s/.test(input[index] as string)) {
            index += 1;
        }
        if (index >= input.length) {
            break;
        }

        const keyMatch = /^([A-Za-z][A-Za-z0-9_:-]*)=/.exec(input.slice(index));
        const key = keyMatch?.[1];
        if (!keyMatch || !key || !NAMED_ARGUMENT_KEYS.has(key)) {
            break;
        }
        index += keyMatch[0].length;

        if (input[index] === '"') {
            const quoted = readQuoted(input, index);
            if ('error' in quoted) {
                return quoted;
            }
            named[key] = quoted.value;
            index = quoted.end;
            continue;
        }

        const start = index;
        while (index < input.length && !/\s/.test(input[index] as string)) {
            index += 1;
        }
        named[key] = unescapeText(input.slice(start, index));
    }

    const text = unescapeText(stripOuterQuotes(input.slice(index).trim()));
    return { named, text };
}

function readQuoted(input: string, start: number): { value: string; end: number } | { error: string } {
    let value = '';
    let index = start + 1;
    while (index < input.length) {
        const char = input[index] as string;
        if (char === '\\' && index + 1 < input.length) {
            const next = input[index + 1] as string;
            if (next === '"' || next === '|') {
                value += next;
            } else {
                value += char + next;
            }
            index += 2;
            continue;
        }
        if (char === '"') {
            return { value, end: index + 1 };
        }
        value += char;
        index += 1;
    }
    return { error: 'The quick reply has an unclosed quote.' };
}

/** Remove one pair of quotes when they wrap the whole text argument. */
function stripOuterQuotes(text: string): string {
    if (text.length < 2 || !text.startsWith('"')) {
        return text;
    }
    let index = 1;
    while (index < text.length) {
        const char = text[index] as string;
        if (char === '\\' && index + 1 < text.length) {
            index += 2;
            continue;
        }
        if (char === '"') {
            return index === text.length - 1 ? text.slice(1, -1) : text;
        }
        index += 1;
    }
    return text;
}

/** Resolve `\|` and `\"`; every other backslash stays as written. */
function unescapeText(text: string): string {
    let result = '';
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index] as string;
        if (char === '\\' && index + 1 < text.length) {
            const next = text[index + 1] as string;
            if (next === '|' || next === '"') {
                result += next;
                index += 1;
                continue;
            }
        }
        result += char;
    }
    return result;
}
