import { type DirectorChoice, MAX_CHOICES, MIN_CHOICES } from '@catcup/shared';

/**
 * Reading the choices out of a streamed reply.
 *
 * The format is a line-oriented sentinel block, not JSON, and that is the
 * reliability plan rather than an aesthetic choice. A JSON object in a stream
 * has to balance its brackets, survive an unescaped quote, and be complete
 * before it can be read at all. A line format degrades instead: every complete
 * line is a usable option, so a block cut off mid-way still yields the lines
 * before the cut.
 *
 * The consequence worth stating plainly: **this never throws.** A reply with no
 * block, a half-written block or an empty one all produce prose plus fewer-or-no
 * options. Choices are an enhancement and must never be able to fail a reply.
 */

const OPEN = '<<<CHOICES>>>';
const CLOSE = '<<<END>>>';

export interface ParsedChoices {
    /** The reply with the block removed, trimmed. This is what gets stored. */
    prose: string;
    /** The options, in the order written. May be empty. */
    options: DirectorChoice[];
    /**
     * True when the opening sentinel was found, whether or not it closed.
     *
     * A caller uses this to decide whether to ask again: a block that started
     * and never finished suggests a truncated stream, while no block at all
     * suggests the model ignored the instruction.
     */
    sawBlock: boolean;
}

/**
 * Strip option-looking decoration from a line.
 *
 * A model asked for one option per line will still number them, bullet them or
 * wrap them in quotes about half the time. All three are cheap to remove and
 * removing them keeps the label looking typed rather than generated — which
 * matters because the label is what gets sent as the person's message.
 */
export function cleanOptionLine(line: string): string {
    let text = line.trim();

    // Leading list markers: `1.`, `1)`, `-`, `*`, `•`, `·`.
    text = text.replace(/^(?:\d{1,2}[.)]\s*|[-*•·]\s+)/u, '');
    // A label that was never closed keeps its opening quote otherwise, and the
    // quote would be sent as part of the person's message.
    if ((text.startsWith('"') && !text.endsWith('"')) || (text.startsWith('“') && !text.endsWith('”'))) {
        text = text.slice(1);
    }
    text = text.replace(/^["“]|["”]$/gu, '');

    return text.trim();
}

/**
 * Turn the lines between the sentinels into options.
 *
 * Bounded both ways: a reply offering one option is not a choice, and one
 * offering twenty is a menu. The lower bound is checked by the caller against
 * `MIN_CHOICES`, because fewer than two is not a choice.
 */
export function optionsFromLines(lines: readonly string[], limit = MAX_CHOICES): DirectorChoice[] {
    const options: DirectorChoice[] = [];

    for (const line of lines) {
        const label = cleanOptionLine(line);
        if (!label) {
            continue;
        }
        // A model that ignores the format sometimes writes a whole paragraph as
        // one "option"; a button cannot carry that, and sending it as a message
        // would be a wall of text.
        if (label.length > 200) {
            continue;
        }
        options.push({ id: `choice-${options.length + 1}`, label });
        if (options.length >= limit) {
            break;
        }
    }

    return options;
}

/**
 * Split a reply into prose and options.
 *
 * The block is removed from the prose whether or not it closed, because a
 * dangling `<<<CHOICES>>>` in a stored message is worse than no options: it
 * would show in the chat, export to SillyTavern and appear in the prompt on the
 * next turn.
 */
export function parseChoices(reply: string, limit = MAX_CHOICES): ParsedChoices {
    const open = reply.indexOf(OPEN);
    if (open < 0) {
        return { prose: reply.trim(), options: [], sawBlock: false };
    }

    const beforeBlock = reply.slice(0, open);
    const afterOpen = reply.slice(open + OPEN.length);
    const close = afterOpen.indexOf(CLOSE);

    const block = close >= 0 ? afterOpen.slice(0, close) : afterOpen;
    // Anything after the closing sentinel belongs to the prose — a model that
    // writes a closing line after the options is not wrong, just unusual.
    const after = close >= 0 ? afterOpen.slice(close + CLOSE.length) : '';

    const options = optionsFromLines(block.split('\n'), limit);
    return {
        prose: `${beforeBlock}${after}`.trim(),
        options,
        sawBlock: true,
    };
}

/**
 * Whether a parsed result is a usable set of options.
 *
 * One option is not a choice — it is a suggestion wearing a button. The parser
 * keeps what it found so the caller can decide, rather than silently padding or
 * discarding.
 */
export function isUsableChoiceSet(options: readonly DirectorChoice[]): boolean {
    return options.length >= MIN_CHOICES;
}

/**
 * The instruction that asks a model for the block.
 *
 * Restated after the history, the same way the analysis prompt restates its
 * contract: a reply that contains the sentinel block by accident is less likely
 * than one that contains the words "ignore the above" as dialogue.
 */
export function choiceInstruction(count: number, language: 'en' | 'zh' = 'en'): string {
    const lines =
        language === 'zh'
            ? [
                  `在回复的最后，另起一段，写出 ${count} 个玩家接下来可以做的选择。`,
                  `每个选择单独一行，不要编号，不要引号，要像玩家会直接打出来的话。`,
                  `用下面这两行把选择包起来，不要写别的内容：`,
                  OPEN,
                  '……每一行是一个选择……',
                  CLOSE,
                  '如果这一轮不适合给出选择，就不要写这个块。',
              ]
            : [
                  `After your reply, on a new paragraph, write ${count} things the player could do next.`,
                  'One per line, no numbering, no quotes, phrased as something the player would type.',
                  'Wrap them in exactly these two lines and write nothing else inside:',
                  OPEN,
                  '…one option per line…',
                  CLOSE,
                  'If this turn does not call for options, omit the block entirely.',
              ];

    return lines.join('\n');
}
