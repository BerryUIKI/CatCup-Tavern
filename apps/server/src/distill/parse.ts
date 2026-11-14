import type { BookFormat } from '@catcup/shared';
import { strFromU8, unzipSync } from 'fflate';

import { type Section, splitMarkdown, splitPlainText } from './sections.js';

/**
 * Book parsing.
 *
 * Three formats, one result: an ordered list of sections. Everything after this
 * point — chunking, progress, the review sheet — works on sections, so a new
 * format only needs an entry here.
 */

export interface ParsedBook {
    format: BookFormat;
    sections: Section[];
}

/** The archive is read whole, so the ceilings are about memory, not patience. */
const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

export class BookParseError extends Error {
    constructor(
        message: string,
        /** `DISTILL_FORMAT` for an unreadable file, `DISTILL_EPUB` for an archive CatCup refuses. */
        public readonly code = 'DISTILL_FORMAT',
    ) {
        super(message);
        this.name = 'BookParseError';
    }
}

/** The format a file name asks for, or `null` when CatCup cannot read it. */
export function formatOf(fileName: string): BookFormat | null {
    const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
    const extension = match?.[1]?.toLowerCase();
    return extension === 'txt' || extension === 'md' || extension === 'epub' ? extension : null;
}

/**
 * Decode a text file, preferring UTF-8.
 *
 * A Chinese novel is often GBK or GB18030, and decoding it as UTF-8 with
 * replacement characters produces a file full of `�` that still parses — the
 * failure would only show up in the distilled entries. Strict UTF-8 first, then
 * GB18030 (a superset of GBK), then windows-1252, which cannot fail.
 */
export function decodeText(buffer: Uint8Array): string {
    // A byte-order mark settles it without guessing.
    if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
        return new TextDecoder('utf-8').decode(buffer.subarray(3));
    }
    if (buffer[0] === 0xff && buffer[1] === 0xfe) {
        return new TextDecoder('utf-16le').decode(buffer.subarray(2));
    }

    for (const encoding of ['utf-8', 'gb18030']) {
        try {
            return new TextDecoder(encoding, { fatal: true }).decode(buffer);
        } catch {
            // Try the next encoding.
        }
    }
    return new TextDecoder('windows-1252').decode(buffer);
}

/** Read a `.txt` or `.md` file into sections. */
export function parseTextBook(buffer: Uint8Array, format: 'txt' | 'md'): ParsedBook {
    const text = decodeText(buffer);
    const sections = format === 'md' ? splitMarkdown(text) : splitPlainText(text);
    if (sections.length === 0) {
        throw new BookParseError('The file has no readable text');
    }
    return { format, sections };
}

/** Decode the five XML entities and numeric references a novel can contain. */
export function decodeEntities(value: string): string {
    return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, name: string) => {
        const lower = name.toLowerCase();
        if (lower.startsWith('#x')) {
            return String.fromCodePoint(Number.parseInt(lower.slice(2), 16) || 0);
        }
        if (lower.startsWith('#')) {
            return String.fromCodePoint(Number.parseInt(lower.slice(1), 10) || 0);
        }
        switch (lower) {
            case 'amp':
                return '&';
            case 'lt':
                return '<';
            case 'gt':
                return '>';
            case 'quot':
                return '"';
            case 'apos':
                return "'";
            case 'nbsp':
                return ' ';
            default:
                return match;
        }
    });
}

/** The visible text of one XHTML document, with block boundaries kept as newlines. */
export function htmlToText(html: string): { title: string; text: string } {
    const titleMatch = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
    const title = titleMatch ? stripMarkup(titleMatch[1] ?? '') : '';

    const text = stripMarkup(
        html
            // Scripts and styles are inert text that would otherwise be read as prose.
            .replace(/<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
            .replace(/<!--[\s\S]*?-->/g, ' '),
    );
    return { title, text };
}

function stripMarkup(html: string): string {
    const text = html
        // A closing block tag is where a paragraph ends; inline tags are not.
        .replace(/<\/?(p|div|br|h[1-6]|li|tr|section|article|blockquote)\b[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '');
    return decodeEntities(text)
        .replace(/[ \t ]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Resolve an archive-internal path relative to the document that referenced it. */
function resolveHref(base: string, href: string): string {
    const decoded = decodeEntities(href.split('#')[0] ?? '').replace(/\\/g, '/');
    const segments = base.split('/').slice(0, -1);
    for (const segment of decoded.split('/')) {
        if (segment === '..') {
            segments.pop();
        } else if (segment !== '.' && segment !== '') {
            segments.push(segment);
        }
    }
    return segments.join('/');
}

/** Is `path` listed in `META-INF/encryption.xml` as encrypted content? */
function encryptedPaths(encryptionXml: string): Set<string> {
    const paths = new Set<string>();
    for (const match of encryptionXml.matchAll(/<CipherReference[^>]*URI="([^"]+)"/gi)) {
        const uri = match[1];
        if (uri) {
            paths.add(resolveHref('', decodeURIComponent(uri)));
        }
    }
    return paths;
}

/**
 * Read an EPUB into sections, in the spine's order.
 *
 * DRM has to be told apart from font obfuscation: almost every commercial EPUB
 * lists its fonts in `encryption.xml` with a standard identifier, and refusing
 * those would refuse most of the books people own. Only a spine document being
 * encrypted means the text itself is locked.
 */
export function parseEpub(buffer: Uint8Array): ParsedBook {
    let archive: Record<string, Uint8Array>;
    try {
        archive = unzipSync(buffer);
    } catch (error) {
        throw new BookParseError(`That file is not a readable EPUB: ${(error as Error).message}`);
    }

    const names = Object.keys(archive);
    if (names.length > MAX_ENTRIES) {
        throw new BookParseError('That EPUB contains too many files');
    }
    const total = Object.values(archive).reduce((sum, entry) => sum + entry.length, 0);
    if (total > MAX_TOTAL_BYTES) {
        throw new BookParseError('That EPUB is too large to unpack');
    }

    const read = (path: string): string | null => {
        const entry = archive[path];
        if (!entry || entry.length > MAX_DOCUMENT_BYTES) {
            return null;
        }
        return strFromU8(entry);
    };

    const container = read('META-INF/container.xml');
    const opfPath = container ? /<rootfile\b[^>]*full-path="([^"]+)"/i.exec(container)?.[1] : undefined;
    if (!opfPath) {
        throw new BookParseError('That EPUB has no package document, so its chapters cannot be ordered');
    }

    const opf = read(resolveHref('', decodeEntities(opfPath)));
    if (!opf) {
        throw new BookParseError('That EPUB is missing its package document');
    }

    const manifest = new Map<string, string>();
    for (const match of opf.matchAll(/<item\b[^>]*>/gi)) {
        const tag = match[0];
        const id = /\bid="([^"]+)"/i.exec(tag)?.[1];
        const href = /\bhref="([^"]+)"/i.exec(tag)?.[1];
        if (id && href) {
            manifest.set(id, resolveHref(decodeEntities(opfPath), href));
        }
    }

    const spine: string[] = [];
    for (const match of opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"[^>]*>/gi)) {
        const target = manifest.get(match[1] ?? '');
        if (target) {
            spine.push(target);
        }
    }

    const encryption = read('META-INF/encryption.xml');
    if (encryption) {
        const locked = encryptedPaths(encryption);
        const document = spine.find((path) => locked.has(path));
        if (document) {
            throw new BookParseError('That EPUB is encrypted with DRM, so its text cannot be read', 'DISTILL_EPUB');
        }
    }

    // A spine that names nothing usable still has documents in it; reading the
    // archive in its own order is the best ordering available.
    const documents =
        spine.length > 0 ? spine : names.filter((name) => /\.x?html?$/i.test(name)).sort((a, b) => a.localeCompare(b));

    const sections: Section[] = [];
    for (const path of documents) {
        const html = read(path);
        if (!html) {
            continue;
        }
        const { title, text } = htmlToText(html);
        if (!text) {
            // A cover page that is only an image has no text; the ordinal would
            // make it look like a chapter, so it is skipped.
            continue;
        }
        sections.push({ index: sections.length, title: title || `Section ${sections.length + 1}`, text });
    }

    if (sections.length === 0) {
        throw new BookParseError('That EPUB has no readable text');
    }
    return { format: 'epub', sections };
}

/** Read any supported book. */
export function parseBook(buffer: Uint8Array, fileName: string): ParsedBook {
    const format = formatOf(fileName);
    if (!format) {
        throw new BookParseError('Books must be .txt, .md or .epub files');
    }
    return format === 'epub' ? parseEpub(buffer) : parseTextBook(buffer, format);
}
