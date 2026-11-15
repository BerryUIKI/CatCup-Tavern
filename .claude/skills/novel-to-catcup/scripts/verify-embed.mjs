// Verify the skill's PNG writer against CatCup's own writePngCard.
//
//   node verify-embed.mjs <card.json> <portrait.png>
//
// The skill script writes a PNG card; this compares its two tEXt payloads with
// the ones apps/server/src/cards/write.ts produces from the same inputs. The
// reference is taken from the built server bundle, so build first:
//
//   pnpm --filter @catcup/server build
//
// and point CATCUP_REPO at that checkout if it is not the default.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = process.env.CATCUP_REPO ?? 'D:/dev/CatCup-Tavern';
const BUNDLE = join(REPO, 'apps/server/dist/index.js');
const EMBED = join(import.meta.dirname, 'embed-portrait.mjs');

const [cardPath, portraitPath] = process.argv.slice(2);
if (!cardPath || !portraitPath) {
    console.error('usage: node verify-embed.mjs <card.json> <portrait.png>');
    process.exit(2);
}
if (!existsSync(BUNDLE)) {
    console.error(`missing ${BUNDLE} — run "pnpm --filter @catcup/server build" in ${REPO} first`);
    process.exit(2);
}

const bundle = readFileSync(BUNDLE, 'utf8');

// The bundle is one scope. Lift the png.ts module (SIGNATURE, CRC table and the
// chunk helpers) and the card writer that calls it, then point the module's own
// imports at the packages the checkout actually has.
const pkgIndex = (name) => join(REPO, `node_modules/.pnpm/${name}@1.0.0/node_modules/${name}/index.js`);

const bannerAt = bundle.indexOf('// src/cards/png.ts');
if (bannerAt === -1) throw new Error('the bundle has no // src/cards/png.ts section');
const nextBanner = bundle.indexOf('\n// src/', bannerAt + 21);
let pngModule = bundle.slice(bannerAt, nextBanner === -1 ? undefined : nextBanner);

for (const [specifier, name] of [
    ['png-chunks-extract', 'png-chunks-extract'],
    ['png-chunk-text', 'png-chunk-text'],
]) {
    const resolved = pkgIndex(name);
    pngModule = pngModule.replace(
        new RegExp(`^import (\\w+) from "${specifier}";$`, 'm'),
        `import $1 from ${JSON.stringify(pathToFileURL(existsSync(resolved) ? resolved : BUNDLE).href)};`,
    );
}

const writerAt = bundle.indexOf('function encodeChunkPayload(');
const writerEnd = bundle.indexOf('\nfunction ', bundle.indexOf('function writePngCard(') + 1);
if (writerAt === -1) throw new Error('the bundle has no encodeChunkPayload');

const dir = mkdtempSync(join(tmpdir(), 'catcup-embed-'));
const modulePath = join(dir, 'reference.mjs');
writeFileSync(modulePath, `${pngModule}\n\n${bundle.slice(writerAt, writerEnd)}\nexport { writePngCard };`);

const { writePngCard } = await import(pathToFileURL(modulePath).href);

const card = JSON.parse(readFileSync(cardPath, 'utf8'));
const portrait = readFileSync(portraitPath);

const expected = Buffer.from(writePngCard(new Uint8Array(portrait), card));
const mine = join(dir, 'mine.png');
execFileSync(process.execPath, [EMBED, cardPath, portraitPath, mine], { stdio: 'ignore' });

function texts(buffer) {
    const out = {};
    let offset = 8;
    while (offset + 8 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const name = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (name === 'tEXt') {
            const separator = data.indexOf(0);
            out[data.toString('latin1', 0, separator)] = data.toString('latin1', separator + 1);
        }
        offset += 12 + length;
        if (name === 'IEND') break;
    }
    return out;
}

const a = texts(readFileSync(mine));
const b = texts(expected);

let failed = false;
for (const key of ['chara', 'ccv3']) {
    const same = a[key] === b[key];
    console.log(`${key}: ${same ? 'identical to the app writer' : 'DIFFERS from the app writer'}`);
    if (!same) {
        failed = true;
        const parse = (value) => JSON.parse(Buffer.from(value ?? '', 'base64').toString('utf8'));
        console.log('  skill:', JSON.stringify(parse(a[key])).slice(0, 200));
        console.log('  app  :', JSON.stringify(parse(b[key])).slice(0, 200));
    }
}

process.exit(failed ? 1 : 0);
