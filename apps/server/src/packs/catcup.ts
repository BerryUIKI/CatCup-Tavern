import { isRecord, type SkinManifest, skinManifestSchema } from '@catcup/shared';

import { type ArchiveEntry, entryText, findEntry, readArchive } from './archive.js';

/**
 * One container, many formats: the `.catcup` reader.
 *
 * See `docs/RFC/0007-skins-and-packs.md`. The extension says nothing; the
 * archive's `manifest.json` says everything. That is what lets a person keep
 * one file type and still get a card, a skin or a game back, and it is why this
 * module is the only place that decides what a file is.
 */

/** The formats this build reads. A `format` outside this list is refused by name. */
export const KNOWN_FORMATS = ['catcup.card', 'catcup.skin'] as const;
export type KnownFormat = (typeof KNOWN_FORMATS)[number];

/** A manifest this build cannot read, with enough detail to act on. */
export class UnknownFormatError extends Error {
    constructor(
        readonly format: string,
        readonly version: unknown,
    ) {
        super(
            `This file is a "${format}" package${
                typeof version === 'number' ? ` (format version ${version})` : ''
            }. This build reads: ${KNOWN_FORMATS.join(', ')}.`,
        );
    }
}

/** The manifest's shared header, as every format carries it. */
export interface PackHeader {
    format: KnownFormat;
    formatVersion: number;
    id: string;
    name: string;
    version: string;
    namespace?: string;
    engine?: { min?: string };
    author?: string;
    license?: string;
    preview?: string;
}

export interface ParsedSkinPack {
    kind: 'skin';
    header: PackHeader;
    manifest: SkinManifest;
    /** Every entry this reader validated, so a later feature can read CSS or fonts. */
    entries: ArchiveEntry[];
}

export type ParsedPack = ParsedSkinPack;

/** The manifest path, which is the only entry read before the rest is trusted. */
const MANIFEST = 'manifest.json';

/** A manifest larger than this is not a manifest. */
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;

function readHeader(raw: unknown): PackHeader {
    if (!isRecord(raw)) {
        throw new Error('The package has no manifest.json at its root');
    }
    if (typeof raw.format !== 'string' || !raw.format) {
        throw new Error('manifest.json does not say what kind of package this is (missing "format")');
    }
    if (!(KNOWN_FORMATS as readonly string[]).includes(raw.format)) {
        throw new UnknownFormatError(raw.format, raw.formatVersion);
    }
    const format = raw.format as KnownFormat;

    // `formatVersion` is the compatibility contract: a version this build has
    // never published is refused rather than half-read.
    const formatVersion = typeof raw.formatVersion === 'number' ? raw.formatVersion : 0;
    if (formatVersion !== 1) {
        throw new UnknownFormatError(format, raw.formatVersion);
    }

    if (typeof raw.id !== 'string' || !raw.id.trim()) {
        throw new Error('manifest.json needs an "id"');
    }
    if (typeof raw.name !== 'string' || !raw.name.trim()) {
        throw new Error('manifest.json needs a "name"');
    }

    return {
        format,
        formatVersion,
        id: raw.id,
        name: raw.name,
        version: typeof raw.version === 'string' ? raw.version : '1.0.0',
        ...(typeof raw.namespace === 'string' ? { namespace: raw.namespace } : {}),
        ...(isRecord(raw.engine) && typeof raw.engine.min === 'string' ? { engine: { min: raw.engine.min } } : {}),
        ...(typeof raw.author === 'string' ? { author: raw.author } : {}),
        ...(typeof raw.license === 'string' ? { license: raw.license } : {}),
        ...(typeof raw.preview === 'string' ? { preview: raw.preview } : {}),
    };
}

/**
 * Read a `.catcup` and say what it is.
 *
 * Only `manifest.json` is read first; the rest of the archive is not interpreted
 * until the header validates. A 60 MB package with a broken manifest therefore
 * costs one entry rather than sixty — and, more importantly, a package cannot
 * influence what this build does before it is known to be a format we read.
 */
export function parsePack(buffer: Buffer | Uint8Array): ParsedPack {
    // `readArchive` already throws a typed error for each failure it owns, so
    // it is not wrapped: a caller that wants to tell "too large" from "not a
    // ZIP" can, and the message a person sees is the one written for them.
    const entries: ArchiveEntry[] = readArchive(buffer);

    const manifestEntry = findEntry(entries, MANIFEST);
    if (!manifestEntry) {
        throw new Error(
            'The package has no manifest.json at its root. A .catcup needs one; a card package from before this format did is opened with the card importer instead.',
        );
    }
    if (manifestEntry.bytes.byteLength > MAX_MANIFEST_BYTES) {
        throw new Error('The package’s manifest.json is too large');
    }

    let raw: unknown;
    try {
        raw = JSON.parse(entryText(manifestEntry));
    } catch {
        throw new Error('The package’s manifest.json is not valid JSON');
    }

    const header = readHeader(raw);

    if (header.format === 'catcup.skin') {
        const parsed = skinManifestSchema.safeParse(raw);
        if (!parsed.success) {
            const issue = parsed.error.issues[0];
            const where = issue?.path.join('.') || 'manifest';
            throw new Error(`manifest.json ${where}: ${issue?.message ?? 'is not valid'}`);
        }
        return { kind: 'skin', header, manifest: parsed.data, entries };
    }

    // `catcup.card` is the legacy layout: a `card.json` this build already
    // imports through the character route. It is recognised here so a person is
    // told to use that path rather than shown "unknown format".
    throw new Error(
        'This is a character card package. Open it from the library’s Import button instead of the skin installer.',
    );
}

/** Whether a buffer starts like a ZIP, so a wrong file is refused before parsing. */
export function looksLikeArchive(buffer: Buffer): boolean {
    return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}
