#!/usr/bin/env node
// Stamp a card's metadata into a PNG so the image is the card.
//
//   node embed-portrait.mjs <card.json> <portrait.png> <out.png>
//
// CatCup has no "set avatar" endpoint: a JSON card has no avatar, and the
// avatar route serves the card file itself. The way an image becomes a card
// portrait is by carrying the card metadata in PNG tEXt chunks, which is what
// SillyTavern and CatCup both read. This writes exactly the two chunks the app
// writes back (see apps/server/src/cards/write.ts): `chara` for the card body
// and `ccv3` for the same body under the V3 spec, so a V3 reader and a V2-only
// reader see the same character.
//
// No dependencies: png chunk parsing, CRC and tEXt encoding are done here.

import { readFileSync, writeFileSync } from 'node:fs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function isPng(buffer) {
    return buffer.length > PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

/** Read a PNG into its chunks, so known tEXt keys can be replaced and the rest kept byte for byte. */
function readChunks(buffer) {
    if (!isPng(buffer)) {
        throw new Error('not a PNG file (missing the 8-byte signature)');
    }

    const chunks = [];
    let offset = PNG_SIGNATURE.length;

    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const name = buffer.toString('ascii', offset + 4, offset + 8);
        const dataStart = offset + 8;

        if (dataStart + length + 4 > buffer.length) {
            throw new Error(`truncated PNG chunk "${name}"`);
        }

        chunks.push({ name, data: buffer.subarray(dataStart, dataStart + length) });
        offset = dataStart + length + 4;

        if (name === 'IEND') {
            break;
        }
    }

    return chunks;
}

/** tEXt stores a Latin-1 keyword, a NUL, then Latin-1 text. Keyframes are base64 so text stays ASCII. */
function encodeTextChunk(keyword, text) {
    const keywordBuffer = Buffer.from(keyword, 'latin1');
    if (keywordBuffer.length === 0 || keywordBuffer.length > 79) {
        throw new Error(`invalid tEXt keyword length: ${keyword}`);
    }
    return Buffer.concat([keywordBuffer, Buffer.from([0]), Buffer.from(text, 'latin1')]);
}

function decodeTextChunk(data) {
    const separator = data.indexOf(0);
    if (separator === -1) {
        return null;
    }
    return {
        keyword: data.toString('latin1', 0, separator),
        text: data.toString('latin1', separator + 1),
    };
}

function encodePng(chunks) {
    const parts = [PNG_SIGNATURE];

    for (const chunk of chunks) {
        const name = Buffer.from(chunk.name, 'ascii');
        if (name.length !== 4) {
            throw new Error(`invalid PNG chunk name: ${chunk.name}`);
        }

        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.data.length, 0);

        const covered = Buffer.concat([name, chunk.data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(covered), 0);

        parts.push(length, name, chunk.data, crc);
    }

    return Buffer.concat(parts);
}

/** Replace the given tEXt keywords, keeping every other chunk untouched. */
function withTextChunks(buffer, texts) {
    const wanted = new Set(texts.map((entry) => entry.keyword.toLowerCase()));
    const kept = [];

    for (const chunk of readChunks(buffer)) {
        if (chunk.name === 'tEXt') {
            const decoded = decodeTextChunk(chunk.data);
            if (decoded && wanted.has(decoded.keyword.toLowerCase())) {
                continue;
            }
        }
        kept.push({ name: chunk.name, data: Buffer.from(chunk.data) });
    }

    const added = texts.map(({ keyword, text }) => ({
        name: 'tEXt',
        data: encodeTextChunk(keyword, text),
    }));

    const end = kept.findIndex((chunk) => chunk.name === 'IEND');
    kept.splice(end === -1 ? kept.length : end, 0, ...added);

    return encodePng(kept);
}

function main() {
    const [cardPath, portraitPath, outPath] = process.argv.slice(2);
    if (!cardPath || !portraitPath || !outPath) {
        console.error('usage: node embed-portrait.mjs <card.json> <portrait.png> <out.png>');
        process.exit(2);
    }

    const card = JSON.parse(readFileSync(cardPath, 'utf8'));

    // A flat card cannot be written back losslessly, so promote it, as the app does.
    let payload = card;
    if (!payload.data || typeof payload.data !== 'object') {
        const flat = { ...payload };
        delete flat.spec;
        delete flat.spec_version;
        delete flat.data;
        payload = { spec: 'chara_card_v2', spec_version: '2.0', data: flat };
        console.warn(`note: promoted a flat card to a V2 wrapper`);
    }
    if (payload.spec !== 'chara_card_v2' && payload.spec !== 'chara_card_v3') {
        payload = { ...payload, spec: 'chara_card_v2', spec_version: '2.0' };
        console.warn('note: set spec to chara_card_v2');
    }

    const name = payload.data?.name;
    if (typeof name !== 'string' || !name.trim()) {
        console.error('error: the card has no data.name — CatCup would store it as "character"');
        process.exit(1);
    }

    const v3 = { ...payload, spec: 'chara_card_v3', spec_version: '3.0' };
    const encode = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

    const portrait = readFileSync(portraitPath);
    const output = withTextChunks(portrait, [
        { keyword: 'chara', text: encode(payload) },
        { keyword: 'ccv3', text: encode(v3) },
    ]);

    writeFileSync(outPath, output);
    console.log(`${outPath}: ${name} ← ${cardPath} + ${portraitPath} (${output.length} bytes)`);
    console.log('Import the PNG; CatCup stores it as a PNG card with its metadata and avatar together.');
}

main();
