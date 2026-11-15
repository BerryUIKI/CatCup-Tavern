#!/usr/bin/env node
// Validate a novel-to-catcup pack before the user tries to import it.
//
//   node validate-pack.mjs <pack-dir>
//
// Exits 1 and lists every problem when the pack would import badly, so the
// assistant can fix it instead of handing over a pack that half-loads.
// No dependencies: this runs from a skill folder, not from the app.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REQUIRED_CARD_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'];

/** The ST entry template every world book entry must carry in full. */
const REQUIRED_ENTRY_FIELDS = [
    'uid',
    'key',
    'keysecondary',
    'comment',
    'content',
    'constant',
    'selective',
    'selectiveLogic',
    'order',
    'position',
    'disable',
    'group',
    'groupWeight',
    'sticky',
    'cooldown',
    'delay',
    'probability',
    'depth',
    'useProbability',
    'vectorized',
];

const problems = [];
const notes = [];

function fail(file, message) {
    problems.push(`${file}: ${message}`);
}

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
        fail(file, `not valid JSON — ${error.message}`);
        return null;
    }
}

function isDirectory(path) {
    try {
        return statSync(path).isDirectory();
    } catch {
        return false;
    }
}

function listFiles(dir, extension) {
    if (!isDirectory(dir)) {
        return [];
    }
    return readdirSync(dir)
        .filter((name) => name.toLowerCase().endsWith(extension))
        .sort();
}

function checkCard(file) {
    const card = readJson(file);
    if (!card) {
        return;
    }

    if (card.spec !== 'chara_card_v2' && card.spec !== 'chara_card_v3') {
        fail(file, `spec is ${JSON.stringify(card.spec)}, expected "chara_card_v2" or "chara_card_v3"`);
    }

    const data = card.data;
    if (!data || typeof data !== 'object') {
        fail(file, 'no data object — a flat legacy card imports, but not losslessly');
        return;
    }

    for (const field of REQUIRED_CARD_FIELDS) {
        const value = data[field];
        if (typeof value !== 'string' || !value.trim()) {
            fail(file, `data.${field} is missing or empty`);
        }
    }

    if (!Array.isArray(data.tags) || data.tags.length === 0) {
        fail(file, 'data.tags is empty — tags drive library sorting');
    }

    const model = data.extensions?.catcup_model;
    if (!model || typeof model !== 'object') {
        notes.push(`${file}: no data.extensions.catcup_model provenance block`);
    }

    // A card without a greeting opens a chat to nothing.
    if (typeof data.first_mes === 'string' && data.first_mes.trim().length > 0) {
        if (!data.first_mes.includes('{{user}}') && data.first_mes.trim().length < 40) {
            notes.push(`${file}: first_mes is very short — check it reads as an opening scene`);
        }
    }

    if (typeof data.mes_example === 'string' && data.mes_example.trim()) {
        if (!data.mes_example.includes('<START>')) {
            notes.push(`${file}: mes_example has no <START> separator`);
        }
    }
}

function checkWorld(file) {
    const book = readJson(file);
    if (!book) {
        return;
    }

    const entries = book.entries;
    if (!entries || typeof entries !== 'object') {
        fail(file, 'no entries object');
        return;
    }

    const keys = Object.keys(entries);
    if (keys.length === 0) {
        fail(file, 'entries is empty');
        return;
    }

    const seenUids = new Set();
    let constantCount = 0;

    for (const [mapKey, entry] of Object.entries(entries)) {
        const label = `${file} [${mapKey}]`;

        if (!entry || typeof entry !== 'object') {
            fail(label, 'entry is not an object');
            continue;
        }

        const missing = REQUIRED_ENTRY_FIELDS.filter((field) => !(field in entry));
        if (missing.length) {
            fail(label, `missing ST template fields: ${missing.join(', ')}`);
        }

        if (typeof entry.uid !== 'number' || !Number.isInteger(entry.uid)) {
            fail(label, 'uid must be an integer');
        } else if (seenUids.has(entry.uid)) {
            fail(label, `duplicate uid ${entry.uid}`);
        } else {
            seenUids.add(entry.uid);
        }

        if (!Array.isArray(entry.key) || entry.key.length === 0) {
            fail(label, 'key must be a non-empty array');
        } else if (entry.key.some((value) => typeof value !== 'string' || !value.trim())) {
            fail(label, 'key contains an empty or non-string trigger');
        }

        if (typeof entry.content !== 'string' || !entry.content.trim()) {
            fail(label, 'content is empty');
        }

        if (typeof entry.comment !== 'string' || !entry.comment.trim()) {
            notes.push(`${label}: empty comment — the world info list will show a blank label`);
        }

        if (entry.constant === true) {
            constantCount += 1;
        }
    }

    if (constantCount === 0) {
        notes.push(`${file}: no constant entry — consider marking the protagonist overview constant`);
    } else if (constantCount > 2) {
        notes.push(`${file}: ${constantCount} constant entries — every one is sent every turn`);
    }

    if (!book.name) {
        notes.push(`${file}: no name field — the book is listed by its file name`);
    }
}

function checkPortraits(packDir) {
    const prompts = join(packDir, 'portraits', 'prompts.md');
    try {
        const text = readFileSync(prompts, 'utf8');
        if (!/##\s+/.test(text)) {
            notes.push(`${prompts}: no "## <Name>" sections found`);
        }
        if (!/negative/i.test(text)) {
            notes.push(`${prompts}: no negative prompt section found`);
        }
    } catch {
        notes.push(`${prompts}: missing — write portrait prompts, or say portraits are prompts-only`);
    }
}

function checkReadme(packDir) {
    const readme = join(packDir, 'README.md');
    try {
        const text = readFileSync(readme, 'utf8');
        if (!/api\/(characters|worlds)\/import/.test(text)) {
            notes.push(`${readme}: no import command found`);
        }
    } catch {
        notes.push(`${readme}: missing — the pack has no instructions for the user`);
    }
}

function main() {
    const packDir = process.argv[2];
    if (!packDir) {
        console.error('usage: node validate-pack.mjs <pack-dir>');
        process.exit(2);
    }

    const cardDir = join(packDir, 'characters');
    const worldDir = join(packDir, 'worlds');

    const cards = listFiles(cardDir, '.json');
    const worlds = listFiles(worldDir, '.json');

    if (cards.length === 0) {
        problems.push(`${cardDir}: no character cards found`);
    }
    if (worlds.length === 0) {
        problems.push(`${worldDir}: no world info books found`);
    }

    for (const file of cards) {
        checkCard(join(cardDir, file));
    }
    for (const file of worlds) {
        checkWorld(join(worldDir, file));
    }

    checkPortraits(packDir);
    checkReadme(packDir);

    for (const note of notes) {
        console.log(`note  ${note}`);
    }
    for (const problem of problems) {
        console.error(`FAIL  ${problem}`);
    }

    console.log(
        `\n${cards.length} card(s), ${worlds.length} world book(s), ` +
            `${problems.length} problem(s), ${notes.length} note(s).`,
    );

    process.exit(problems.length === 0 ? 0 : 1);
}

main();
