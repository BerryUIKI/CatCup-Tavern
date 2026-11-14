// Derived from SillyTavern (AGPL-3.0) conventions for chapter headings; the
// regular expressions are CatCup's own. See docs/REUSE.md.

/**
 * Split plain text into sections at chapter headings.
 *
 * A novel is written in one of two shapes: with chapter headings, or with none
 * at all. Both have to produce sections, because everything downstream — the
 * chunk budget, the progress list, the review sheet's chapter groups — is built
 * on them. A file with no heading is cut into equal runs of paragraphs rather
 * than treated as a single opaque section, which would make a 300-page import
 * one row.
 */

export interface Section {
    index: number;
    title: string;
    text: string;
}

/** A heading is short. Anything longer is a line of prose that happens to start a paragraph. */
const MAX_HEADING_LENGTH = 60;

/** Paragraphs per synthetic section when a file has no headings at all. */
const PARAGRAPHS_PER_PART = 40;

/** The heading forms a novel actually uses, in English and Chinese. */
const HEADINGS: readonly RegExp[] = [
    // Chapter 12, CHAPTER XII, Chapter Twelve
    /^chapter\s+([\divxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i,
    // Part 1, Part One
    /^part\s+([\divxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
    // Book 2
    /^book\s+(\d+|one|two|three)\b/i,
    // Prologue, Epilogue, Interlude, Afterword, Foreword
    /^(prologue|epilogue|interlude|afterword|foreword)$/i,
    // 第一章, 第十二回, 第三节, 序章, 楔子, 尾声, 后记
    /^第\s*[0-9零一二三四五六七八九十百千]+\s*[章回节卷](\s|$)/,
    /^(序章|序言|楔子|尾声|后记|终章|番外)/,
];

/**
 * Is this line a chapter heading?
 *
 * Deliberately conservative: a false positive splits a scene in half and shows
 * up as a spurious chapter in the review sheet, while a false negative only
 * means one more section than necessary.
 */
export function isHeading(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > MAX_HEADING_LENGTH) {
        return false;
    }
    return HEADINGS.some((pattern) => pattern.test(trimmed));
}

/** Split text into paragraphs on blank lines, trimming each. */
export function paragraphsOf(text: string): string[] {
    return text
        .replace(/\r\n/g, '\n')
        .split(/\n[ \t]*\n+/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean);
}

/**
 * Cut plain text into sections at headings.
 *
 * A heading's own line opens the section and is not repeated in its body. Text
 * before the first heading is a section of its own, because a preface or a
 * title page is genuinely part of the book.
 */
export function splitByHeadings(text: string): Section[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const sections: { title: string; lines: string[] }[] = [];
    let current: { title: string; lines: string[] } | null = null;

    for (const line of lines) {
        if (isHeading(line)) {
            if (current) {
                sections.push(current);
            }
            current = { title: line.trim(), lines: [] };
            continue;
        }
        if (!current) {
            current = { title: '', lines: [] };
        }
        current.lines.push(line);
    }
    if (current) {
        sections.push(current);
    }

    return sections
        .map((section, index) => ({
            index,
            title: section.title || (index === 0 ? 'Opening' : `Part ${index}`),
            text: section.lines.join('\n').trim(),
        }))
        .filter((section) => section.text.length > 0);
}

/** Cut heading-less text into equal runs of paragraphs. */
export function splitIntoParts(text: string, perPart = PARAGRAPHS_PER_PART): Section[] {
    const paragraphs = paragraphsOf(text);
    if (paragraphs.length === 0) {
        return [];
    }

    const sections: Section[] = [];
    for (let start = 0; start < paragraphs.length; start += perPart) {
        sections.push({
            index: sections.length,
            title: `Part ${sections.length + 1}`,
            text: paragraphs.slice(start, start + perPart).join('\n\n'),
        });
    }
    return sections;
}

/**
 * Section a text file.
 *
 * Falls back to paragraph runs only when no heading is found anywhere, so one
 * missed heading in an otherwise chaptered book cannot produce two halves of
 * different shapes.
 */
export function splitPlainText(text: string): Section[] {
    const sections = splitByHeadings(text);
    if (sections.length > 1 || (sections.length === 1 && sections[0]?.title !== 'Opening')) {
        return sections;
    }
    return splitIntoParts(text);
}

/**
 * Section a markdown file at its chapter headings.
 *
 * A novel uses one heading level for chapters and deeper ones for scenes, and
 * which level that is varies by file: `# Chapter 1` repeats at the top level,
 * while a `# Title` over `## Chapter 1` and `## Chapter 2` repeats one level
 * down. The chapter level is therefore the shallowest level that opens more
 * than one section, which finds both. A file where every heading is unique has
 * no repeated level to infer from, so every heading is a chapter. Deeper
 * headings stay inside their section as text.
 */
export function splitMarkdown(text: string): Section[] {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const headings = lines
        .map((line) => /^(#{1,6})\s+(\S.*\S)\s*$/.exec(line))
        .filter((match): match is RegExpExecArray => match !== null);
    if (headings.length === 0) {
        return splitIntoParts(text);
    }

    const counts = new Map<number, number>();
    for (const heading of headings) {
        const level = heading[1]?.length ?? 6;
        counts.set(level, (counts.get(level) ?? 0) + 1);
    }
    const repeated = [...counts.keys()].sort((a, b) => a - b).find((level) => (counts.get(level) ?? 0) > 1);

    const sections: { title: string; lines: string[] }[] = [];
    let current: { title: string; lines: string[] } | null = null;

    for (const line of lines) {
        const heading = /^(#{1,6})\s+(\S.*\S)\s*$/.exec(line);
        if (heading && ((repeated !== undefined && heading[1]?.length === repeated) || repeated === undefined)) {
            if (current) {
                sections.push(current);
            }
            current = { title: (heading[2] ?? '').trim(), lines: [] };
            continue;
        }
        if (!current) {
            current = { title: '', lines: [] };
        }
        // A deeper heading is a scene label, not markup: its text belongs in
        // the section body, without the `#` run.
        current.lines.push(heading ? (heading[2] ?? '') : line);
    }
    if (current) {
        sections.push(current);
    }

    const titled = sections
        .map((section, index) => ({
            index,
            title: section.title || (index === 0 ? 'Opening' : `Part ${index}`),
            text: section.lines.join('\n').trim(),
        }))
        .filter((section) => section.text.length > 0);

    // A markdown file with one heading at the top is a plain text file with a
    // title. Its body still needs sections, or sections mode would store the
    // whole novel as one entry; the title is kept on the first part so the book
    // still reads as one chapter.
    if (titled.length === 1) {
        const title = titled[0]?.title ?? '';
        return splitIntoParts(titled[0]?.text ?? '').map((part, index) => ({
            ...part,
            title: index === 0 ? title : `${title} (${index + 1})`,
        }));
    }
    return titled;
}
