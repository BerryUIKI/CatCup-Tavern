import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scanSillyTavern } from './sillytavern.js';

let root = '';

afterEach(async () => {
    if (root) {
        await rm(root, { recursive: true, force: true });
        root = '';
    }
});

async function makeTree(): Promise<string> {
    root = await mkdtemp(path.join(tmpdir(), 'catcup-st-'));
    return root;
}

describe('SillyTavern scan', () => {
    it('counts the four kinds of file it understands', async () => {
        const dir = await makeTree();
        await mkdir(path.join(dir, 'characters'), { recursive: true });
        await mkdir(path.join(dir, 'chats', 'Seraphina'), { recursive: true });
        await mkdir(path.join(dir, 'worlds'), { recursive: true });
        await mkdir(path.join(dir, 'openai presets'), { recursive: true });

        await writeFile(path.join(dir, 'characters', 'Seraphina.png'), 'png');
        await writeFile(path.join(dir, 'characters', 'notes.txt'), 'ignored');
        await writeFile(path.join(dir, 'chats', 'Seraphina', 'chat one.jsonl'), '{}\n');
        await writeFile(path.join(dir, 'chats', 'Seraphina', 'chat two.jsonl'), '{}\n');
        await writeFile(path.join(dir, 'worlds', 'eldoria.json'), '{}');
        await writeFile(path.join(dir, 'openai presets', 'Default.json'), '{}');

        const plan = await scanSillyTavern(dir);

        expect(plan).toMatchObject({ characters: 1, chats: 2, worlds: 1, presets: 1 });
        expect(plan.sources).toHaveLength(4);
        expect(plan.errors).toEqual([]);
    });

    it('finds presets in the older public folder too', async () => {
        const dir = await makeTree();
        await mkdir(path.join(dir, 'public', 'presets', 'openai'), { recursive: true });
        await writeFile(path.join(dir, 'public', 'presets', 'openai', 'Roleplay.json'), '{}');

        const plan = await scanSillyTavern(dir);

        expect(plan.presets).toBe(1);
    });

    it('rejects a directory that holds nothing it recognises', async () => {
        const dir = await makeTree();
        await expect(scanSillyTavern(dir)).rejects.toThrow(/No SillyTavern data/);
    });

    it('rejects a missing path and a relative one', async () => {
        await expect(scanSillyTavern(path.join(tmpdir(), 'catcup-does-not-exist'))).rejects.toThrow(/not a directory/);
        await expect(scanSillyTavern('./data')).rejects.toThrow(/absolute/);
    });
});
