import { strToU8, type Zippable, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { BookParseError, decodeEntities, decodeText, formatOf, htmlToText, parseBook, parseEpub } from './parse.js';

/** Build a minimal but structurally real EPUB. */
function buildEpub(
    documents: { id: string; href: string; html: string }[],
    options: { encryption?: string } = {},
): Uint8Array {
    const manifest = documents.map(
        (doc) => `<item id="${doc.id}" href="${doc.href}" media-type="application/xhtml+xml"/>`,
    );
    const spine = documents.map((doc) => `<itemref idref="${doc.id}"/>`);
    const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <manifest>${manifest.join('')}</manifest>
  <spine>${spine.join('')}</spine>
</package>`;

    const files: Zippable = {
        mimetype: strToU8('application/epub+zip'),
        'META-INF/container.xml': strToU8(
            '<?xml version="1.0"?><container version="1.0"><rootfiles>' +
                '<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>' +
                '</rootfiles></container>',
        ),
        'OEBPS/content.opf': strToU8(opf),
    };
    for (const doc of documents) {
        files[`OEBPS/${doc.href}`] = strToU8(`<html><body>${doc.html}</body></html>`);
    }
    if (options.encryption) {
        files['META-INF/encryption.xml'] = strToU8(options.encryption);
    }
    return zipSync(files);
}

const utf8 = (text: string) => new TextEncoder().encode(text);

describe('formatOf', () => {
    it('accepts the three formats and nothing else', () => {
        expect(formatOf('novel.txt')).toBe('txt');
        expect(formatOf('Novel.MD')).toBe('md');
        expect(formatOf('book.epub')).toBe('epub');
        expect(formatOf('book.pdf')).toBeNull();
        expect(formatOf('book')).toBeNull();
    });
});

describe('decodeText', () => {
    it('reads UTF-8, including a byte-order mark', () => {
        expect(decodeText(utf8('第一章 Mira'))).toBe('第一章 Mira');
        const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Mira')]);
        expect(decodeText(bom)).toBe('Mira');
    });

    it('falls back to GB18030 for a Chinese novel that is not UTF-8', () => {
        // 你好世界 in GBK, which is not valid UTF-8.
        const gbk = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7]);
        expect(decodeText(gbk)).toBe('你好世界');
    });

    it('never throws on bytes no encoding claims', () => {
        expect(decodeText(new Uint8Array([0x81, 0x30, 0xff]))).toBeTypeOf('string');
    });
});

describe('decodeEntities', () => {
    it('decodes named and numeric references', () => {
        expect(decodeEntities('a &amp; b &lt;c&gt; &#65; &#x42; &nbsp;d')).toBe('a & b <c> A B  d');
    });
});

describe('htmlToText', () => {
    it('keeps block boundaries and drops markup and scripts', () => {
        const { title, text } = htmlToText(
            '<h2>Chapter 1</h2><script>var x = 1;</script><p>Mira lit</p><p>the lamp.</p>',
        );
        expect(title).toBe('Chapter 1');
        // A blank line between blocks is what makes them separate paragraphs
        // downstream, so the chunker can split a long chapter on them.
        expect(text).toBe('Chapter 1\n\nMira lit\n\nthe lamp.');
    });
});

describe('parseBook', () => {
    it('reads a plain text novel at its chapter headings', () => {
        const parsed = parseBook(utf8('第一章\nMira.\n\n第二章\nBram.'), 'novel.txt');
        expect(parsed.format).toBe('txt');
        expect(parsed.sections.map((section) => section.title)).toEqual(['第一章', '第二章']);
    });

    it('refuses an unsupported extension', () => {
        expect(() => parseBook(utf8('x'), 'novel.pdf')).toThrow(BookParseError);
    });

    it('refuses a file with no readable text', () => {
        expect(() => parseBook(utf8('   \n\n  '), 'novel.txt')).toThrow(/no readable text/i);
    });

    it('refuses bytes that are not an EPUB archive', () => {
        expect(() => parseBook(utf8('not a zip'), 'book.epub')).toThrow(BookParseError);
    });
});

describe('parseEpub', () => {
    it('reads the spine in its declared order, not the archive order', () => {
        const epub = buildEpub([
            { id: 'c2', href: 'c2.xhtml', html: '<h1>Chapter 2</h1><p>Second.</p>' },
            { id: 'c1', href: 'c1.xhtml', html: '<h1>Chapter 1</h1><p>First.</p>' },
        ]);
        const parsed = parseEpub(epub);
        expect(parsed.sections.map((section) => section.title)).toEqual(['Chapter 2', 'Chapter 1']);
    });

    it('titles a document without a heading by its ordinal', () => {
        const epub = buildEpub([{ id: 'a', href: 'a.xhtml', html: '<p>Just text.</p>' }]);
        expect(parseEpub(epub).sections[0]?.title).toBe('Section 1');
    });

    it('skips a cover document that carries no text', () => {
        const epub = buildEpub([
            { id: 'cover', href: 'cover.xhtml', html: '<img src="cover.jpg"/>' },
            { id: 'c1', href: 'c1.xhtml', html: '<h1>One</h1><p>Text.</p>' },
        ]);
        expect(parseEpub(epub).sections.map((section) => section.title)).toEqual(['One']);
    });

    it('refuses an EPUB whose spine is encrypted', () => {
        const encryption =
            '<encryption><EncryptedData><CipherData>' +
            '<CipherReference URI="OEBPS/c1.xhtml"/>' +
            '</CipherData></EncryptedData></encryption>';
        const epub = buildEpub([{ id: 'c1', href: 'c1.xhtml', html: '<h1>One</h1><p>Text.</p>' }], { encryption });

        expect(() => parseEpub(epub)).toThrow(/DRM/i);
        try {
            parseEpub(epub);
        } catch (error) {
            expect((error as BookParseError).code).toBe('DISTILL_EPUB');
        }
    });

    it('reads an EPUB that only obfuscates its fonts', () => {
        // The common case for a commercial EPUB: fonts listed, text not.
        const encryption =
            '<encryption><EncryptedData><CipherData>' +
            '<CipherReference URI="OEBPS/fonts/serif.otf"/>' +
            '</CipherData></EncryptedData></encryption>';
        const epub = buildEpub([{ id: 'c1', href: 'c1.xhtml', html: '<h1>One</h1><p>Text.</p>' }], { encryption });

        expect(parseEpub(epub).sections.map((section) => section.title)).toEqual(['One']);
    });
});
