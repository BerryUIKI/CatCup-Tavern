import { z } from 'zod';

/**
 * SillyTavern regex scripts.
 *
 * A script is one find/replace rule plus the places it applies to. The numeric
 * placement values are persisted in SillyTavern's settings and must not be
 * renumbered; 4 is a retired `sendAs` slot and is skipped.
 */
export const REGEX_PLACEMENT = {
    /** Retired markdown display slot. Accepted so old files round-trip. */
    MD_DISPLAY: 0,
    USER_INPUT: 1,
    AI_OUTPUT: 2,
    SLASH_COMMAND: 3,
    WORLD_INFO: 5,
    REASONING: 6,
} as const;

/** How macros in `findRegex` are handled before the pattern is compiled. */
export const SUBSTITUTE_REGEX = {
    NONE: 0,
    RAW: 1,
    ESCAPED: 2,
} as const;

export const regexScriptSchema = z
    .object({
        id: z.string().min(1),
        scriptName: z.string().default(''),
        findRegex: z.string().default(''),
        replaceString: z.string().default(''),
        trimStrings: z.array(z.string()).default([]),
        placement: z.array(z.number().int()).default([]),
        disabled: z.boolean().default(false),
        /** Apply only when rendering in the chat view, not in the prompt. */
        markdownOnly: z.boolean().default(false),
        /** Apply only when building the prompt, leaving the stored text alone. */
        promptOnly: z.boolean().default(false),
        /** Also run when a message is edited. */
        runOnEdit: z.boolean().default(false),
        substituteRegex: z.number().int().min(0).max(2).default(0),
        minDepth: z.number().nullable().default(null),
        maxDepth: z.number().nullable().default(null),
    })
    .passthrough();

/** Fields the editor may change. `id` is the record key and is not patchable. */
export const regexScriptPatchSchema = z
    .object({
        scriptName: z.string().optional(),
        findRegex: z.string().optional(),
        replaceString: z.string().optional(),
        trimStrings: z.array(z.string()).optional(),
        placement: z.array(z.number().int()).optional(),
        disabled: z.boolean().optional(),
        markdownOnly: z.boolean().optional(),
        promptOnly: z.boolean().optional(),
        runOnEdit: z.boolean().optional(),
        substituteRegex: z.number().int().min(0).max(2).optional(),
        minDepth: z.number().nullable().optional(),
        maxDepth: z.number().nullable().optional(),
    })
    .strict();

export const regexFileSchema = z
    .object({
        scripts: z.array(regexScriptSchema).default([]),
    })
    .passthrough();

export type RegexScript = z.infer<typeof regexScriptSchema>;
export type RegexScriptPatch = z.infer<typeof regexScriptPatchSchema>;
export type RegexFile = z.infer<typeof regexFileSchema>;
