import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { ArchiveTooLargeError } from './archive.js';
import { looksLikeArchive, parsePack, UnknownFormatError } from './catcup.js';

/**
 * The `.catcup` container is one extension carrying several formats, and the
 * manifest is what decides which. These cases are about that decision: what is
 * recognised, what is refused by name, and what a file from before this format
 * does.
 */

const SKIN = {
    format: 'catcup.skin',
    formatVersion: 1,
    id: 'grimoire-night',
    name: 'Grimoire Night',
    version: '1.0.0',
    scope: 'app',
    tokens: { color: { surface: '#16161f' } },
};

function archive(files: Record<string, string | Uint8Array>): Buffer {
    const zippable: Record<string, Uint8Array> = {};
    for (const [name, value] of Object.entries(files)) {
        zippable[name] = typeof value === 'string' ? strToU8(value) : value;
    }
    return Buffer.from(zipSync(zippable, { level: 6 }));
}

describe('looksLikeArchive', () => {
    it('recognises a ZIP by its signature, not its name', () => {
        expect(looksLikeArchive(archive({ 'manifest.json': JSON.stringify(SKIN) }))).toBe(true);
        expect(looksLikeArchive(Buffer.from(JSON.stringify(SKIN)))).toBe(false);
        expect(looksLikeArchive(Buffer.alloc(0))).toBe(false);
    });
});

describe('parsePack', () => {
    it('reads a skin package and returns its manifest', () => {
        const pack = parsePack(archive({ 'manifest.json': JSON.stringify(SKIN), 'skin.css': 'body{}' }));
        expect(pack.kind).toBe('skin');
        if (pack.kind !== 'skin') {
            return;
        }
        expect(pack.header.id).toBe('grimoire-night');
        expect(pack.manifest.tokens.color?.surface).toBe('#16161f');
        // Every entry is kept, so a later feature can read the stylesheet or a font.
        expect(pack.entries.map((entry) => entry.path)).toContain('skin.css');
    });

    it('refuses a format this build does not read, naming it', () => {
        const buffer = archive({
            'manifest.json': JSON.stringify({ format: 'catcup.game', formatVersion: 1, id: 'x', name: 'X' }),
        });
        expect(() => parsePack(buffer)).toThrow(UnknownFormatError);
        expect(() => parsePack(buffer)).toThrow(/catcup\.game/);
        // The message says what *is* readable, so a person knows what to do.
        expect(() => parsePack(buffer)).toThrow(/catcup\.skin/);
    });

    it('refuses a format version it has never published, naming it', () => {
        const buffer = archive({ 'manifest.json': JSON.stringify({ ...SKIN, formatVersion: 2 }) });
        expect(() => parsePack(buffer)).toThrow(UnknownFormatError);
        expect(() => parsePack(buffer)).toThrow(/format version 2/);
    });

    it('says a card package belongs to the card importer, not the skin installer', () => {
        const buffer = archive({
            'manifest.json': JSON.stringify({ format: 'catcup.card', formatVersion: 1, id: 'mira', name: 'Mira' }),
            'card.json': JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Mira' } }),
        });
        expect(() => parsePack(buffer)).toThrow(/Import button/);
    });

    it('reports a missing manifest rather than guessing', () => {
        const buffer = archive({ 'card.json': '{}' });
        expect(() => parsePack(buffer)).toThrow(/manifest\.json/);
    });

    it('names the field a skin manifest gets wrong', () => {
        const buffer = archive({
            'manifest.json': JSON.stringify({ ...SKIN, tokens: { color: { surfce: '#000000' } } }),
        });
        expect(() => parsePack(buffer)).toThrow(/surfce/);
    });

    it('reports a manifest that is not JSON', () => {
        expect(() => parsePack(archive({ 'manifest.json': '{not json' }))).toThrow(/not valid JSON/);
    });

    it('refuses a file that is not an archive at all', () => {
        expect(() => parsePack(Buffer.from('hello'))).toThrow();
    });

    it('keeps an unknown manifest field, because a newer format must survive an older host', () => {
        const pack = parsePack(archive({ 'manifest.json': JSON.stringify({ ...SKIN, futureField: 'kept' }) }));
        expect((pack.manifest as unknown as Record<string, unknown>).futureField).toBe('kept');
    });

    it('drops an entry whose path tries to escape, without refusing the whole package', () => {
        // A package may carry a file for another tool; the reader only needs
        // `manifest.json`, and a traversal attempt is not that file.
        const pack = parsePack(
            archive({ 'manifest.json': JSON.stringify(SKIN), '../evil.css': 'x', 'assets/ok.css': 'y' }),
        );
        const paths = pack.entries.map((entry) => entry.path);
        expect(paths).toContain('assets/ok.css');
        expect(paths.some((path) => path.includes('..'))).toBe(false);
    });

    it('refuses an archive past the entry cap', () => {
        const files: Record<string, string> = { 'manifest.json': JSON.stringify(SKIN) };
        for (let index = 0; index < 210; index += 1) {
            files[`assets/${index}.txt`] = 'x';
        }
        expect(() => parsePack(archive(files))).toThrow(ArchiveTooLargeError);
    });

    it('finds manifest.json regardless of case, because archives differ', () => {
        const pack = parsePack(archive({ 'Manifest.JSON': JSON.stringify(SKIN) }));
        expect(pack.kind).toBe('skin');
    });
});
