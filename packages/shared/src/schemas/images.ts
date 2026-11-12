import { z } from 'zod';

/**
 * Image generation settings and request shapes.
 *
 * Field names follow SillyTavern where a value has an ST counterpart
 * (`prompt_prefix`, `negative_prompt`, generation dimensions), so a future
 * settings import can map them without guesswork.
 */

export const IMAGE_BACKENDS = ['automatic1111', 'comfyui', 'openai-compatible'] as const;
export type ImageBackend = (typeof IMAGE_BACKENDS)[number];

/**
 * SillyTavern's default KSampler scheduler. A1111 and OpenAI-compatible
 * endpoints ignore it; only the ComfyUI workflow's `%scheduler%` uses it.
 */
export const DEFAULT_IMAGE_SCHEDULER = 'normal';

/**
 * SillyTavern's starter ComfyUI graph in API format, with CatCup as the
 * filename prefix. Every value is a placeholder or a literal the KSampler
 * accepts, so the workflow runs on a stock installation with one checkpoint
 * named in Settings.
 */
export const DEFAULT_COMFY_WORKFLOW = `{
    "3": {
        "class_type": "KSampler",
        "inputs": {
            "cfg": "%scale%",
            "denoise": 1,
            "latent_image": ["5", 0],
            "model": ["4", 0],
            "negative": ["7", 0],
            "positive": ["6", 0],
            "sampler_name": "%sampler%",
            "scheduler": "%scheduler%",
            "seed": "%seed%",
            "steps": "%steps%"
        }
    },
    "4": {
        "class_type": "CheckpointLoaderSimple",
        "inputs": {
            "ckpt_name": "%model%"
        }
    },
    "5": {
        "class_type": "EmptyLatentImage",
        "inputs": {
            "batch_size": 1,
            "height": "%height%",
            "width": "%width%"
        }
    },
    "6": {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "clip": ["4", 1],
            "text": "%prompt%"
        }
    },
    "7": {
        "class_type": "CLIPTextEncode",
        "inputs": {
            "clip": ["4", 1],
            "text": "%negative_prompt%"
        }
    },
    "8": {
        "class_type": "VAEDecode",
        "inputs": {
            "samples": ["3", 0],
            "vae": ["4", 2]
        }
    },
    "9": {
        "class_type": "SaveImage",
        "inputs": {
            "filename_prefix": "CatCup",
            "images": ["8", 0]
        }
    }
}`;

export const DEFAULT_IMAGE_PROMPT_PREFIX = 'best quality, absurdres, aesthetic,';

/** SillyTavern's default negative prompt for Stable Diffusion. */
export const DEFAULT_IMAGE_NEGATIVE_PROMPT =
    'lowres, bad anatomy, bad hands, text, error, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';

/**
 * Instruction used when drafting a prompt from the chat. It follows ST's
 * "Now" prompt: only visible details, no dialogue or inner thoughts.
 */
export const DEFAULT_IMAGE_PROMPT_TEMPLATE = `Ignore previous instructions. Reply with a single comma-separated list of visual keywords that describe the last chat message. Start with the location, then the number of characters and their relative positions, then each character's visible appearance and actions. Use pronouns or neutral nouns instead of names. Do not include thoughts, feelings, dialogue, or anything that would not be visible in a still image. Do not write in full sentences.`;

export const imageGenerationSettingsSchema = z.object({
    enabled: z.boolean().default(false),
    backend: z.enum(IMAGE_BACKENDS).default('automatic1111'),
    /**
     * A1111/ComfyUI root, e.g. `http://127.0.0.1:7860` or
     * `http://127.0.0.1:8188`; `/v1` for OpenAI-compatible.
     */
    baseUrl: z.string().trim().max(2000).default('http://127.0.0.1:7860'),
    /**
     * Required by OpenAI-style endpoints. For ComfyUI it is the checkpoint
     * file name substituted for `%model%`; A1111 selects its model server-side.
     */
    model: z.string().trim().max(200).default(''),
    width: z.number().int().min(64).max(2048).default(512),
    height: z.number().int().min(64).max(2048).default(512),
    steps: z.number().int().min(1).max(150).default(20),
    cfgScale: z.number().min(1).max(30).default(7),
    sampler: z.string().trim().max(120).default('DDIM'),
    /** ComfyUI KSampler scheduler; A1111 and OpenAI-compatible ignore it. */
    scheduler: z.string().trim().max(120).default(DEFAULT_IMAGE_SCHEDULER),
    /** `-1` lets the backend pick a random seed. */
    seed: z
        .number()
        .int()
        .min(-1)
        .max(2 ** 32 - 1)
        .default(-1),
    /**
     * ComfyUI API-format workflow JSON. `%name%` placeholders are replaced
     * before the graph is posted to `/prompt`.
     */
    comfyWorkflow: z.string().max(200_000).default(DEFAULT_COMFY_WORKFLOW),
    promptPrefix: z.string().max(2000).default(DEFAULT_IMAGE_PROMPT_PREFIX),
    negativePrompt: z.string().max(4000).default(DEFAULT_IMAGE_NEGATIVE_PROMPT),
    /** Instruction for "Draft from chat"; sent to the active text provider. */
    promptTemplate: z.string().max(10000).default(DEFAULT_IMAGE_PROMPT_TEMPLATE),
    contextMessages: z.number().int().min(1).max(50).default(10),
});
export type ImageGenerationSettings = z.infer<typeof imageGenerationSettingsSchema>;

export const DEFAULT_IMAGE_GENERATION_SETTINGS: ImageGenerationSettings = {
    enabled: false,
    backend: 'automatic1111',
    baseUrl: 'http://127.0.0.1:7860',
    model: '',
    width: 512,
    height: 512,
    steps: 20,
    cfgScale: 7,
    sampler: 'DDIM',
    scheduler: DEFAULT_IMAGE_SCHEDULER,
    seed: -1,
    comfyWorkflow: DEFAULT_COMFY_WORKFLOW,
    promptPrefix: DEFAULT_IMAGE_PROMPT_PREFIX,
    negativePrompt: DEFAULT_IMAGE_NEGATIVE_PROMPT,
    promptTemplate: DEFAULT_IMAGE_PROMPT_TEMPLATE,
    contextMessages: 10,
};

/**
 * Partial image generation settings for `PATCH /api/settings`.
 *
 * `imageGenerationSettingsSchema.partial()` still applies defaults in Zod 4,
 * so a patch carrying one field would reset every other value. This schema
 * keeps unspecified fields absent.
 */
export const imageGenerationPatchSchema = z.object({
    enabled: z.boolean().optional(),
    backend: z.enum(IMAGE_BACKENDS).optional(),
    baseUrl: z.string().trim().max(2000).optional(),
    model: z.string().trim().max(200).optional(),
    width: z.number().int().min(64).max(2048).optional(),
    height: z.number().int().min(64).max(2048).optional(),
    steps: z.number().int().min(1).max(150).optional(),
    cfgScale: z.number().min(1).max(30).optional(),
    sampler: z.string().trim().max(120).optional(),
    scheduler: z.string().trim().max(120).optional(),
    seed: z
        .number()
        .int()
        .min(-1)
        .max(2 ** 32 - 1)
        .optional(),
    comfyWorkflow: z.string().max(200_000).optional(),
    promptPrefix: z.string().max(2000).optional(),
    negativePrompt: z.string().max(4000).optional(),
    promptTemplate: z.string().max(10000).optional(),
    contextMessages: z.number().int().min(1).max(50).optional(),
});
export type ImageGenerationPatch = z.infer<typeof imageGenerationPatchSchema>;

/** A generated image as the API and the chat media attachment describe it. */
export interface GeneratedImage {
    /** Gallery folder: the sanitized character name or the group id. */
    folder: string;
    file: string;
    /** SillyTavern-style client path, `user/images/<folder>/<file>`. */
    url: string;
    prompt: string;
    negativePrompt: string;
    backend: ImageBackend;
    model: string;
    width: number;
    height: number;
    seed: number | null;
    createdAt: string;
}

const scopeFields = {
    characterId: z.string().trim().min(1).optional(),
    groupId: z.string().trim().min(1).optional(),
};

const targetFields = {
    ...scopeFields,
    chatId: z.string().trim().min(1),
};

function hasOneScope(value: { characterId?: string; groupId?: string }): boolean {
    return Boolean(value.characterId) !== Boolean(value.groupId);
}

const targetRefinement = {
    message: 'Choose a character or a group',
    path: ['characterId'],
};

/** A gallery scope: a character or a group, never both and never neither. */
export const imageScopeSchema = z.object(scopeFields).refine(hasOneScope, targetRefinement);
export type ImageScope = z.infer<typeof imageScopeSchema>;

/** Which chat an image operation belongs to. */
export const imageTargetSchema = z.object(targetFields).refine(hasOneScope, targetRefinement);
export type ImageTarget = z.infer<typeof imageTargetSchema>;

export const draftImagePromptRequestSchema = z
    .object({
        ...targetFields,
        /** Include history up to and including this message; defaults to the end. */
        messageIndex: z.number().int().min(0).optional(),
    })
    .refine(hasOneScope, targetRefinement);
export type DraftImagePromptRequest = z.infer<typeof draftImagePromptRequestSchema>;

export const generateImageRequestSchema = z
    .object({
        ...scopeFields,
        prompt: z.string().trim().min(1).max(4000),
    })
    .refine(hasOneScope, targetRefinement);
export type GenerateImageRequest = z.infer<typeof generateImageRequestSchema>;

export const attachImageRequestSchema = z
    .object({
        ...targetFields,
        /** Image file name inside the target's folder. */
        file: z.string().trim().min(1).max(200),
        prompt: z.string().trim().min(1).max(4000),
    })
    .refine(hasOneScope, targetRefinement);
export type AttachImageRequest = z.infer<typeof attachImageRequestSchema>;
