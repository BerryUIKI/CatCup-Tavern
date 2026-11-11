// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/src/png/encode.js
// Which is itself based on https://github.com/hughsk/png-chunks-encode (MIT).
// See docs/REUSE.md.

import PNGtext from 'png-chunk-text';
import extract from 'png-chunks-extract';

const SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export interface PngChunk {
    name: string;
    data: Uint8Array;
}

/**
 * Serialize chunks back into a PNG.
 *
 * `png-chunks-extract` reads a file into `{ name, data }` pairs but there is no
 * matching encoder in the dependency set, so this writes the length-prefixed
 * chunk format with a CRC over the name and the data, which is what any reader
 * validates.
 */
export function encodePng(chunks: readonly PngChunk[]): Uint8Array {
    let total = SIGNATURE.length;
    for (const chunk of chunks) {
        total += 12 + chunk.data.length;
    }

    const output = new Uint8Array(total);
    output.set(SIGNATURE, 0);

    const view = new DataView(output.buffer);
    const encoder = new TextEncoder();
    let offset = SIGNATURE.length;

    for (const chunk of chunks) {
        const name = encoder.encode(chunk.name);
        if (name.length !== 4) {
            throw new Error(`Invalid PNG chunk name: ${chunk.name}`);
        }

        view.setUint32(offset, chunk.data.length);
        output.set(name, offset + 4);
        output.set(chunk.data, offset + 8);

        const covered = new Uint8Array(4 + chunk.data.length);
        covered.set(name, 0);
        covered.set(chunk.data, 4);
        view.setUint32(offset + 8 + chunk.data.length, crc32(covered));

        offset += 12 + chunk.data.length;
    }

    return output;
}

/**
 * Replace text chunks by keyword, leaving every other chunk untouched.
 *
 * New chunks are inserted just before `IEND`, which is where SillyTavern puts
 * them. A keyword that appears more than once is collapsed to one chunk,
 * because readers take the first match and duplicates would be ambiguous.
 */
export function withTextChunks(
    buffer: Uint8Array,
    texts: ReadonlyArray<{ keyword: string; text: string }>,
): Uint8Array {
    const chunks = extract(buffer);
    const wanted = new Set(texts.map((entry) => entry.keyword.toLowerCase()));

    const kept: PngChunk[] = [];
    for (const chunk of chunks) {
        if (chunk.name === 'tEXt') {
            const decoded = PNGtext.decode(Buffer.from(chunk.data));
            if (wanted.has(decoded.keyword.toLowerCase())) {
                continue;
            }
        }
        kept.push({ name: chunk.name, data: new Uint8Array(chunk.data) });
    }

    const added = texts.map(({ keyword, text }) => ({
        name: 'tEXt',
        data: new Uint8Array(PNGtext.encode(keyword, text).data),
    }));

    // Insert before IEND when it is present, otherwise append.
    const end = kept.findIndex((chunk) => chunk.name === 'IEND');
    kept.splice(end === -1 ? kept.length : end, 0, ...added);

    return encodePng(kept);
}
