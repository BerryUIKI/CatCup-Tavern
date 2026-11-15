import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import {
    ANALYSIS_REPAIR_USER_TEMPLATE,
    ANALYSIS_SAMPLING,
    ANALYSIS_SYSTEM_PROMPT,
    CHARACTER_OUTLINE_SYSTEM_PROMPT,
    DISTILL_PROMPTS,
    NEAR_MISS_SYSTEM_PROMPT,
    PLACE_OUTLINE_SYSTEM_PROMPT,
} from './prompts.js';
import { buildSkillArchive, SKILL_FILES, SKILL_NAME, skillFiles } from './skill.js';

/**
 * The skill is generated, so the only thing worth testing is that it agrees with
 * the runtime it was generated from — plus that it carries nothing it should not.
 */

const files = skillFiles();

function entry(path: string): string {
    const value = files[path as keyof typeof files];
    if (value === undefined) {
        throw new Error(`missing ${path}`);
    }
    return value;
}

describe('the skill bundle', () => {
    it('has every file, and only those', () => {
        expect(Object.keys(files).sort()).toEqual([...SKILL_FILES].sort());
    });

    it('carries SKILL.md frontmatter with a name and a description', () => {
        const skill = entry('SKILL.md');
        expect(skill.startsWith('---\n')).toBe(true);
        const frontmatter = skill.slice(4, skill.indexOf('\n---\n', 3));
        expect(frontmatter).toContain(`name: ${SKILL_NAME}`);
        expect(frontmatter).toMatch(/^description: .{40,}$/m);
    });

    it('names the input formats it can read, and the one it cannot', () => {
        const skill = entry('SKILL.md');
        expect(skill).toContain('`.txt`');
        expect(skill).toContain('`.md`');
        expect(skill).toContain('EPUB');
        expect(skill).toContain('GB18030');
    });
});

describe('the skill agrees with the runtime', () => {
    it('every system prompt the pipeline sends appears in the reference', () => {
        const reference = entry('reference/prompts.md');
        for (const system of [
            ANALYSIS_SYSTEM_PROMPT,
            NEAR_MISS_SYSTEM_PROMPT,
            CHARACTER_OUTLINE_SYSTEM_PROMPT,
            PLACE_OUTLINE_SYSTEM_PROMPT,
        ]) {
            expect(reference).toContain(system);
        }
    });

    it('every template the catalogue declares appears in the reference', () => {
        const reference = entry('reference/prompts.md');
        for (const prompt of DISTILL_PROMPTS) {
            expect(reference).toContain(prompt.user);
        }
    });

    it('carries the repair turn and the sampling numbers', () => {
        const reference = entry('reference/prompts.md');
        expect(reference).toContain(ANALYSIS_REPAIR_USER_TEMPLATE);
        expect(reference).toContain(`temperature ${ANALYSIS_SAMPLING.temperature}`);
        expect(reference).toContain(`${ANALYSIS_SAMPLING.maxTokens.toLocaleString('en-US')} output tokens`);
    });

    it('the reference has one section per prompt', () => {
        const reference = entry('reference/prompts.md');
        // Every prompt section opens with its stage line, which the surrounding
        // sections (request settings, the repair turn) do not.
        const promptSections = reference
            .split('\n## ')
            .filter((section) => section.includes('_Stage: '))
            .map((section) => section.split('\n')[0]?.trim());
        expect(promptSections).toEqual(DISTILL_PROMPTS.map((prompt) => prompt.title));
    });

    it('the analysis schema in the bundle is the one the pipeline validates against', () => {
        const schema = JSON.parse(entry('reference/analysis.schema.json')) as {
            properties: Record<string, unknown>;
            required: string[];
        };
        expect(Object.keys(schema.properties).sort()).toEqual(['characters', 'facts', 'places']);
        expect(schema.required.sort()).toEqual(['characters', 'facts', 'places']);
    });

    it('the draft schema in the bundle has both kinds of row', () => {
        const schema = JSON.parse(entry('reference/draft.schema.json')) as {
            properties: Record<string, { items: { required: string[] } }>;
        };
        expect(Object.keys(schema.properties).sort()).toEqual(['characters', 'entries']);
        expect(schema.properties.entries?.items.required).toContain('key');
        expect(schema.properties.characters?.items.required).toContain('first_mes');
    });
});

describe('what the bundle must not carry', () => {
    it('has no script, because a second chunker would drift', () => {
        for (const [path, text] of Object.entries(files)) {
            expect(path.endsWith('.md') || path.endsWith('.json'), path).toBe(true);
            expect(text).not.toContain('child_process');
            // Every opening fence names text or JSON: no runnable code travels.
            const fences = [...text.matchAll(/^```(\w*)$/gm)].map((match) => match[1]);
            const openings = fences.filter((_tag, index) => index % 2 === 0);
            expect(
                openings.filter((tag) => tag !== 'text' && tag !== 'json'),
                path,
            ).toEqual([]);
            expect(fences.length % 2, `${path} has an unclosed fence`).toBe(0);
        }
    });

    it('carries no key, secret or chat text', () => {
        for (const [path, text] of Object.entries(files)) {
            expect(text, path).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
            expect(text, path).not.toMatch(/api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i);
            expect(text, path).not.toContain('catcup_session');
        }
    });
});

describe('the archive', () => {
    it('is a ZIP holding one folder whose files match the generated ones', () => {
        const archive = buildSkillArchive();
        expect(archive.subarray(0, 2).toString('latin1')).toBe('PK');

        const unzipped = unzipSync(new Uint8Array(archive));
        const paths = Object.keys(unzipped).sort();
        expect(paths).toEqual(SKILL_FILES.map((path) => `${SKILL_NAME}/${path}`).sort());

        for (const path of SKILL_FILES) {
            const packed = unzipped[`${SKILL_NAME}/${path}`];
            expect(packed, path).toBeDefined();
            expect(strFromU8(packed as Uint8Array), path).toBe(files[path]);
        }
    });
});
