import {
    type AppSettings,
    applyRegexScripts,
    type CharacterDetail,
    type ChatMessage,
    getLatestSummary,
    isRecord,
    type ParsedQuickReplyCommand,
    type PersonaSettings,
    parseQuickReplyScript,
    type QuickReplyAction,
    type QuickReplyExecuteResponse,
    type QuickReplyItem,
    type QuickReplySetView,
    REGEX_PLACEMENT,
    sanitizeRegexMacro,
    substituteMacros,
} from '@catcup/shared';

import { badRequest, notFound } from '../http/errors.js';
import { createMacroContext } from '../prompt/worldInfoTurn.js';
import { listQuickReplySets, readQuickReplySet } from '../storage/quickReplies.js';
import { listRegexScripts } from '../storage/regex.js';
import { getSettings } from '../storage/settings.js';

/**
 * Run one quick reply against a chat.
 *
 * The command set is the subset CatCup implements; SillyTavern's full
 * STscript engine arrives in M3. Appends happen here (the server owns chat
 * persistence), while generation commands and text insertion become
 * directives the client applies through its existing send/trigger paths.
 */

export interface QuickReplyTarget {
    kind: 'character' | 'group';
    character: CharacterDetail;
    persona: PersonaSettings;
    /** Group macros, when this is a group chat. */
    group?: { members: string[]; enabled: string[] };
    /** Members `/trigger <name|index>` may choose, in group order. */
    speakers?: readonly { name: string; fileName: string }[];
    /** The chat's `chat_metadata`, for per-chat set links and the narrator name. */
    metadata: Record<string, unknown>;
    read(): Promise<ChatMessage[] | null>;
    append(message: ChatMessage): Promise<ChatMessage>;
}

interface FlatInput {
    kind: 'input';
    text: string;
    submit: boolean;
    inject: boolean;
    placeBefore: boolean;
}

type FlatStep = { kind: 'command'; command: ParsedQuickReplyCommand } | FlatInput;

/** Commands that hand work to the client and therefore must run last. */
const GENERATION_COMMANDS = new Set(['trigger', 'continue', 'regenerate']);

const NARRATOR_NAME_DEFAULT = 'System';
const MAX_RUN_DEPTH = 10;

/** Named arguments each command understands; the rest are rejected by name. */
const ALLOWED_ARGUMENTS: Record<ParsedQuickReplyCommand['name'], ReadonlySet<string>> = {
    send: new Set(['name', 'return', 'compact', 'raw']),
    sys: new Set(['name', 'return', 'compact', 'raw']),
    echo: new Set([
        'title',
        'severity',
        'timeout',
        'extendedTimeout',
        'preventDuplicates',
        'cssClass',
        'escapeHtml',
        'awaitDismissal',
        'onClick',
    ]),
    trigger: new Set(['await']),
    continue: new Set(['await']),
    regenerate: new Set(['await']),
    run: new Set(),
};

/**
 * Expand macros in a command's arguments, as SillyTavern's parser does before
 * a command callback sees them.
 *
 * The message text of `/send`, `/sys` and `/echo` is left alone because their
 * execution paths expand it exactly once with the same context.
 */
function expandCommand(
    command: ParsedQuickReplyCommand,
    substitute: (text: string) => string,
    expandText: boolean,
): ParsedQuickReplyCommand {
    return {
        ...command,
        ...(expandText ? { argument: substitute(command.argument) } : {}),
        named: Object.fromEntries(Object.entries(command.named).map(([key, value]) => [key, substitute(value)])),
    };
}

/** Expand the arguments a command resolves before its callback runs. */
function prepareCommand(
    command: ParsedQuickReplyCommand,
    substitute: (text: string) => string,
): ParsedQuickReplyCommand {
    return expandCommand(command, substitute, !['send', 'sys', 'echo'].includes(command.name));
}

/** Read the set links SillyTavern stores in `chat_metadata.quickReply`. */
function chatSetNames(metadata: Record<string, unknown>): string[] {
    const config = metadata.quickReply;
    if (!isRecord(config) || !Array.isArray(config.setList)) {
        return [];
    }
    return config.setList
        .map((link) => (isRecord(link) && typeof link.set === 'string' ? link.set : null))
        .filter((name): name is string => Boolean(name));
}

function activeSetNames(settings: AppSettings, metadata: Record<string, unknown>): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const name of [...settings.quickReplies.setList.map((link) => link.set), ...chatSetNames(metadata)]) {
        if (!seen.has(name)) {
            seen.add(name);
            names.push(name);
        }
    }
    return names;
}

/** Find a quick reply by label: active sets first, then `Set.Label`. */
function resolveRun(
    argument: string,
    sets: readonly QuickReplySetView[],
    activeNames: readonly string[],
): { set: QuickReplySetView; reply: QuickReplyItem } {
    const name = argument.trim();
    if (!name) {
        throw badRequest('The /run command needs a quick reply name.');
    }

    const findIn = (set: QuickReplySetView | undefined, label: string): QuickReplyItem | undefined =>
        set?.qrList.find((item) => item.label === label);

    for (const setName of activeNames) {
        const set = sets.find((candidate) => candidate.name === setName);
        const reply = findIn(set, name);
        if (set && reply) {
            return { set, reply };
        }
    }

    const dot = name.indexOf('.');
    if (dot > 0) {
        const set = sets.find((candidate) => candidate.name === name.slice(0, dot));
        const reply = findIn(set, name.slice(dot + 1));
        if (set && reply) {
            return { set, reply };
        }
    }

    throw badRequest(`No quick reply named "${name}" was found.`);
}

/**
 * Expand `/run` into the commands it points at.
 *
 * A run target that is plain text ends the chain with an input directive,
 * mirroring ST's behaviour of placing it in the message box and clicking send.
 * A set with `disableSend` pastes its message literally instead.
 */
function flattenCommands(
    commands: readonly ParsedQuickReplyCommand[],
    sets: readonly QuickReplySetView[],
    activeNames: readonly string[],
    depth: number,
    out: FlatStep[],
    substitute: (text: string) => string,
): void {
    for (const command of commands) {
        if (command.name !== 'run') {
            out.push({ kind: 'command', command });
            continue;
        }
        const expanded = expandCommand(command, substitute, true);
        assertArguments(expanded);
        if (depth >= MAX_RUN_DEPTH) {
            throw badRequest('Quick replies are nested too deeply. Check for a /run loop.');
        }
        const target = resolveRun(expanded.argument, sets, activeNames);
        if (target.set.disableSend) {
            out.push({
                kind: 'input',
                text: target.reply.message,
                submit: false,
                inject: false,
                placeBefore: false,
            });
            continue;
        }
        const parsed = parseQuickReplyScript(target.reply.message);
        if (parsed.kind === 'error') {
            throw badRequest(parsed.message);
        }
        if (parsed.kind === 'text') {
            out.push({ kind: 'input', text: parsed.text, submit: true, inject: false, placeBefore: false });
            continue;
        }
        flattenCommands(parsed.commands, sets, activeNames, depth + 1, out, substitute);
    }
}

function assertArguments(command: ParsedQuickReplyCommand): void {
    const allowed = ALLOWED_ARGUMENTS[command.name];
    for (const key of Object.keys(command.named)) {
        if (!allowed.has(key)) {
            throw badRequest(`The "${key}" argument is not supported for /${command.alias}.`);
        }
    }
}

/**
 * Check every command before the first append.
 *
 * The API promises that a malformed reply leaves the chat untouched; running
 * this over the flattened steps keeps a bad tail from leaving earlier appends
 * behind.
 */
function validateCommand(command: ParsedQuickReplyCommand, target: QuickReplyTarget): void {
    assertArguments(command);
    const text = command.argument.trim();

    if (command.name === 'send' && !text) {
        throw badRequest('The /send command needs text.');
    }
    if (command.name === 'sys' && !text) {
        throw badRequest('The /sys command needs text.');
    }
    if (command.name === 'echo') {
        if (!text) {
            throw badRequest('The /echo command needs text.');
        }
        const severity = command.named.severity ?? 'info';
        if (!['info', 'success', 'warning', 'error'].includes(severity)) {
            throw badRequest('The /echo severity must be info, success, warning or error.');
        }
    }
    if (command.name === 'continue' && text) {
        throw badRequest('The /continue command does not take a prompt yet.');
    }
    if (command.name === 'regenerate' && text) {
        throw badRequest('The /regenerate command does not take arguments.');
    }
    if (command.name === 'trigger' && text) {
        if (target.kind !== 'group') {
            throw badRequest('Only a group chat can choose who /trigger asks to speak.');
        }
        if (/^\d+$/.test(text) && !target.speakers?.[Number(text)]) {
            throw badRequest(`There is no group member at index ${text}.`);
        }
    }
}

function userMessageName(command: ParsedQuickReplyCommand, target: QuickReplyTarget): string {
    return 'name' in command.named ? (command.named.name as string) : target.persona.name;
}

function narratorName(command: ParsedQuickReplyCommand, target: QuickReplyTarget): string {
    if ('name' in command.named) {
        return command.named.name as string;
    }
    const stored = target.metadata.narrator_name;
    return typeof stored === 'string' && stored ? stored : NARRATOR_NAME_DEFAULT;
}

interface ExecutionContext {
    target: QuickReplyTarget;
    regexScripts: Awaited<ReturnType<typeof listRegexScripts>>;
    substitute: (text: string, escapeValues?: boolean) => string;
    actions: QuickReplyAction[];
    appended: ChatMessage[];
}

async function appendUserMessage(context: ExecutionContext, command: ParsedQuickReplyCommand): Promise<void> {
    const text = command.argument.trim();
    if (!text) {
        throw badRequest('The /send command needs text.');
    }
    assertArguments(command);

    // USER_INPUT scripts run before the text is stored, then macros expand, as
    // in the normal send path.
    const stored = context.substitute(
        applyRegexScripts(context.regexScripts, text, REGEX_PLACEMENT.USER_INPUT, {
            substitute: (value, escapeValues) => context.substitute(value, escapeValues),
        }),
    );
    const message = await context.target.append({
        name: userMessageName(command, context.target),
        is_user: true,
        send_date: new Date().toISOString(),
        mes: stored,
        extra: {},
    });
    context.appended.push(message);
}

async function appendNarratorMessage(context: ExecutionContext, command: ParsedQuickReplyCommand): Promise<void> {
    assertArguments(command);
    const text = context.substitute(command.argument.trim());

    // SillyTavern's sendNarratorMessage: an assistant-shaped message carrying
    // `extra.type = 'narrator'`, which the prompt sends as a system turn and
    // group selection skips.
    const message = await context.target.append({
        name: narratorName(command, context.target),
        is_user: false,
        send_date: new Date().toISOString(),
        mes: text,
        extra: {
            type: 'narrator',
            api: 'manual',
            model: 'slash command',
        },
    });
    context.appended.push(message);
}

function pushEcho(context: ExecutionContext, command: ParsedQuickReplyCommand): void {
    assertArguments(command);
    const message = context.substitute(command.argument.trim());

    const severity = command.named.severity ?? 'info';
    if (!['info', 'success', 'warning', 'error'].includes(severity)) {
        throw badRequest('The /echo severity must be info, success, warning or error.');
    }
    context.actions.push({
        type: 'toast',
        message,
        ...(command.named.title ? { title: command.named.title } : {}),
        severity: severity as 'info' | 'success' | 'warning' | 'error',
    });
}

function pushGeneration(context: ExecutionContext, command: ParsedQuickReplyCommand): void {
    assertArguments(command);
    if (command.name === 'continue') {
        if (command.argument.trim()) {
            throw badRequest('The /continue command does not take a prompt yet.');
        }
    } else if (command.name === 'regenerate') {
        if (command.argument.trim()) {
            throw badRequest('The /regenerate command does not take arguments.');
        }
    } else if (command.name !== 'trigger') {
        throw badRequest(`/${command.alias} is not a generation command.`);
    }

    if (command.name !== 'trigger') {
        context.actions.push({ type: 'generate', mode: command.name });
        return;
    }

    let speaker: string | undefined;
    const chosen = command.argument.trim();
    if (chosen) {
        if (context.target.kind !== 'group') {
            throw badRequest('Only a group chat can choose who /trigger asks to speak.');
        }
        if (/^\d+$/.test(chosen)) {
            const member = context.target.speakers?.[Number(chosen)];
            if (!member) {
                throw badRequest(`There is no group member at index ${chosen}.`);
            }
            speaker = member.fileName;
        } else {
            speaker = chosen;
        }
    }
    context.actions.push({ type: 'generate', mode: 'trigger', ...(speaker ? { speaker } : {}) });
}

async function runSimpleCommand(context: ExecutionContext, command: ParsedQuickReplyCommand): Promise<void> {
    if (command.name === 'send') {
        await appendUserMessage(context, command);
        return;
    }
    if (command.name === 'sys') {
        await appendNarratorMessage(context, command);
        return;
    }
    if (command.name === 'echo') {
        pushEcho(context, command);
        return;
    }
    // `run` is expanded before execution; a remaining one is a bug in flatten.
    throw badRequest(`The /${command.alias} command cannot run here.`);
}

/**
 * Run a set's quick reply and return the directives the client applies.
 *
 * Nothing is appended until the whole script and every `/run` target parse, so
 * a malformed reply leaves the chat untouched.
 */
export async function executeQuickReply(
    target: QuickReplyTarget,
    setId: string,
    qrId: number,
): Promise<QuickReplyExecuteResponse> {
    const set = await readQuickReplySet(setId);
    if (!set) {
        throw notFound('Quick reply set not found');
    }
    const reply = set.qrList.find((item) => item.id === qrId);
    if (!reply) {
        throw notFound('Quick reply not found');
    }

    const raw = reply.message;
    if (!raw.trim()) {
        return { actions: [], appended: [] };
    }

    const [messages, settings, regexScripts, sets] = await Promise.all([
        target.read(),
        getSettings(),
        listRegexScripts(),
        listQuickReplySets(),
    ]);
    if (!messages) {
        throw notFound('Chat not found');
    }

    const macroContext = createMacroContext(
        target.character,
        target.persona,
        target.group,
        getLatestSummary(messages)?.value,
    );
    const substitute = (text: string, escapeValues = false) =>
        substituteMacros(text, macroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});

    // `disableSend` turns the whole reply, commands included, into text in the
    // message box, exactly as SillyTavern does.
    if (set.disableSend) {
        return {
            actions: [
                {
                    type: 'input',
                    text: substitute(raw),
                    submit: false,
                    inject: set.injectInput,
                    placeBefore: set.placeBeforeInput,
                },
            ],
            appended: [],
        };
    }

    const steps: FlatStep[] = [];
    const parsed = parseQuickReplyScript(raw);
    if (parsed.kind === 'error') {
        throw badRequest(parsed.message);
    }
    if (parsed.kind === 'text') {
        steps.push({
            kind: 'input',
            text: raw,
            submit: true,
            inject: set.injectInput,
            placeBefore: set.placeBeforeInput,
        });
    } else {
        flattenCommands(parsed.commands, sets, activeSetNames(settings, target.metadata), 0, steps, substitute);
    }

    // Expand the arguments of every command before validation and execution,
    // as ST's parser does before a command callback runs.
    for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        if (step?.kind === 'command') {
            steps[index] = { kind: 'command', command: prepareCommand(step.command, substitute) };
        }
    }

    if (steps.length === 0) {
        return { actions: [], appended: [] };
    }

    for (const [index, step] of steps.entries()) {
        if (index === steps.length - 1) {
            continue;
        }
        if (step.kind === 'input') {
            throw badRequest('A text quick reply can only be the last command.');
        }
        if (GENERATION_COMMANDS.has(step.command.name)) {
            throw badRequest(`/${step.command.alias} must be the last command in a quick reply.`);
        }
    }

    const context: ExecutionContext = {
        target,
        regexScripts,
        substitute,
        actions: [],
        appended: [],
    };

    // Validate the whole script before the first write.
    for (const step of steps) {
        if (step.kind === 'command') {
            validateCommand(step.command, target);
        }
    }

    const last = steps[steps.length - 1] as FlatStep;
    for (const step of steps.slice(0, -1)) {
        if (step.kind !== 'command') {
            throw badRequest('A text quick reply can only be the last command.');
        }
        await runSimpleCommand(context, step.command);
    }

    if (last.kind === 'input') {
        context.actions.push({
            type: 'input',
            text: substitute(last.text),
            submit: last.submit,
            inject: last.inject,
            placeBefore: last.placeBefore,
        });
    } else if (GENERATION_COMMANDS.has(last.command.name)) {
        pushGeneration(context, last.command);
    } else {
        await runSimpleCommand(context, last.command);
    }

    return { actions: context.actions, appended: context.appended };
}
