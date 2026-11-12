import {
    attachImageRequestSchema,
    type CharacterDetail,
    type ChatMessage,
    draftImagePromptRequestSchema,
    generateImageRequestSchema,
} from '@catcup/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import { badRequest, notFound } from '../http/errors.js';
import { generateImage as generateAutomatic1111Image } from '../images/automatic1111.js';
import { generateImage as generateComfyImage } from '../images/comfyui.js';
import { generateImage as generateOpenAiImage, requiresImageKey } from '../images/openaiCompatible.js';
import { draftImagePrompt } from '../images/prompt.js';
import { testImageBackend } from '../images/test.js';
import type { ImageRequest } from '../images/types.js';
import { getCharacter } from '../storage/characters.js';
import { appendMessage, readChat } from '../storage/chats.js';
import { appendGroupMessage, type GroupFile, getGroup, readGroupChat } from '../storage/groups.js';
import {
    characterFolder,
    deleteImage,
    groupFolder,
    imageExists,
    listImages,
    readImage,
    readImageMetadata,
    saveImage,
} from '../storage/images.js';
import { assertSimpleName } from '../storage/paths.js';
import { getActiveProvider, getImageSecret, getProviderSecret, getSettings } from '../storage/settings.js';

const galleryScopeSchema = z
    .object({
        characterId: z.string().trim().min(1).max(200).optional(),
        groupId: z.string().trim().min(1).max(200).optional(),
    })
    .refine((value) => Boolean(value.characterId) !== Boolean(value.groupId), {
        message: 'Choose a character or a group',
        path: ['characterId'],
    });

const fileParamsSchema = z.object({
    folder: z.string().trim().min(1).max(200),
    file: z.string().trim().min(1).max(200),
});

type Target = { characterId?: string; groupId?: string; chatId: string };

/** Character and group ids are file names; reject anything that could traverse. */
function assertSafeId(id: string): void {
    try {
        assertSimpleName(id);
    } catch {
        throw badRequest('Invalid image scope', 'IMAGE_PATH');
    }
}

type LoadedChat =
    | { kind: 'character'; character: CharacterDetail; messages: ChatMessage[]; name: string }
    | { kind: 'group'; group: GroupFile['group']; messages: ChatMessage[]; name: string };

async function loadChat(target: Target): Promise<LoadedChat> {
    if (target.characterId) {
        assertSafeId(target.characterId);
        const character = await getCharacter(target.characterId);
        if (!character) {
            throw notFound('Character not found');
        }
        const chat = await readChat(character, target.chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }
        return { kind: 'character', character, messages: chat.messages, name: character.name };
    }

    const groupId = target.groupId;
    if (!groupId) {
        throw badRequest('Choose a character or a group', 'IMAGE_SCOPE');
    }
    assertSafeId(groupId);
    const groupFile = await getGroup(groupId);
    if (!groupFile) {
        throw notFound('Group not found');
    }
    const chat = await readGroupChat(groupFile.group, target.chatId);
    if (!chat) {
        throw notFound('Chat not found');
    }
    return { kind: 'group', group: groupFile.group, messages: chat.messages, name: groupFile.group.name };
}

/** Resolve the ST-style gallery folder for a request's scope. */
async function folderForScope(scope: { characterId?: string; groupId?: string }): Promise<string> {
    if (scope.characterId) {
        assertSafeId(scope.characterId);
        const character = await getCharacter(scope.characterId);
        if (!character) {
            throw notFound('Character not found');
        }
        return characterFolder(character);
    }
    if (!scope.groupId) {
        throw badRequest('Choose a character or a group', 'IMAGE_SCOPE');
    }
    assertSafeId(scope.groupId);
    const groupFile = await getGroup(scope.groupId);
    if (!groupFile) {
        throw notFound('Group not found');
    }
    return groupFolder(groupFile.group);
}

/** Abort the upstream request when the browser goes away. */
function abortOnClose(reply: FastifyReply): { controller: AbortController; done: () => void } {
    const controller = new AbortController();
    const onClose = () => {
        if (!reply.raw.writableEnded) {
            controller.abort();
        }
    };
    reply.raw.on('close', onClose);
    return {
        controller,
        done: () => reply.raw.off('close', onClose),
    };
}

/** Prefix and prompt are comma-separated tag lists; avoid a doubled comma. */
export function combineImagePrompt(prefix: string, prompt: string): string {
    return [prefix.trim().replace(/,\s*$/, ''), prompt.trim().replace(/^,\s*/, '')]
        .filter(Boolean)
        .join(', ')
        .slice(0, 4000);
}

export async function registerImageRoutes(app: FastifyInstance): Promise<void> {
    /** Check the saved backend configuration without generating an image. */
    app.post('/api/images/test', async () => {
        const settings = await getSettings();
        await testImageBackend(settings.imageGeneration, await getImageSecret());
        return { ok: true };
    });

    /**
     * Draft an image prompt from the chat with the active text provider.
     * Nothing is generated or stored; the user can edit the result first.
     */
    app.post('/api/images/draft', async (request, reply) => {
        const target = draftImagePromptRequestSchema.parse(request.body ?? {});
        const settings = await getSettings();
        if (!settings.imageGeneration.enabled) {
            throw badRequest('Image generation is disabled', 'IMAGE_DISABLED');
        }

        const chat = await loadChat(target);
        const messages =
            target.messageIndex === undefined ? chat.messages : chat.messages.slice(0, target.messageIndex + 1);
        if (messages.length === 0) {
            throw badRequest('There are no messages to draft an image prompt from', 'IMAGE_PROMPT_EMPTY');
        }

        const provider = await getActiveProvider();
        if (!provider) {
            throw badRequest('No chat provider is available to draft an image prompt', 'IMAGE_PROMPT_FAILED');
        }
        const apiKey = await getProviderSecret(provider.id);
        const persona = settings.personas.find((item) => item.id === settings.activePersonaId);
        const { controller, done } = abortOnClose(reply);

        try {
            const prompt = await draftImagePrompt({
                settings: settings.imageGeneration,
                provider,
                apiKey,
                messages,
                characterName: chat.name,
                userName: persona?.name || 'You',
                signal: controller.signal,
            });
            return { prompt };
        } finally {
            done();
        }
    });

    /** Generate one image and store it in the gallery. It is not posted to chat yet. */
    app.post('/api/images/generate', async (request, reply) => {
        const body = generateImageRequestSchema.parse(request.body ?? {});
        const settings = await getSettings();
        const imageSettings = settings.imageGeneration;

        if (!imageSettings.enabled) {
            throw badRequest('Image generation is disabled', 'IMAGE_DISABLED');
        }

        const apiKey = await getImageSecret();
        if (imageSettings.backend === 'openai-compatible' && requiresImageKey(imageSettings.baseUrl) && !apiKey) {
            throw badRequest('No image generation API key is configured', 'IMAGE_KEY_MISSING');
        }

        const folder = await folderForScope(body);
        const prompt = combineImagePrompt(imageSettings.promptPrefix, body.prompt);
        const imageRequest: ImageRequest = {
            prompt,
            negativePrompt: imageSettings.negativePrompt,
            width: imageSettings.width,
            height: imageSettings.height,
            steps: imageSettings.steps,
            cfgScale: imageSettings.cfgScale,
            sampler: imageSettings.sampler,
            scheduler: imageSettings.scheduler,
            seed: imageSettings.seed,
        };

        const { controller, done } = abortOnClose(reply);
        try {
            const result =
                imageSettings.backend === 'automatic1111'
                    ? await generateAutomatic1111Image(imageSettings, apiKey, imageRequest, controller.signal)
                    : imageSettings.backend === 'comfyui'
                      ? await generateComfyImage(imageSettings, apiKey, imageRequest, controller.signal)
                      : await generateOpenAiImage(imageSettings, apiKey, imageRequest, controller.signal);

            const image = await saveImage(folder, result.data, result.format, {
                prompt,
                negativePrompt: imageSettings.negativePrompt,
                backend: imageSettings.backend,
                model: result.model,
                width: imageSettings.width,
                height: imageSettings.height,
                seed: result.seed,
                createdAt: new Date().toISOString(),
            });
            return { image };
        } finally {
            done();
        }
    });

    /** Append the image to the chat as a SillyTavern media message. */
    app.post('/api/images/attach', async (request) => {
        const body = attachImageRequestSchema.parse(request.body ?? {});
        const chat = await loadChat(body);
        const folder = chat.kind === 'character' ? characterFolder(chat.character) : groupFolder(chat.group);

        if (!(await imageExists(folder, body.file))) {
            throw notFound('Image not found');
        }
        const metadata = await readImageMetadata(folder, body.file);

        const message: ChatMessage = {
            name: chat.name,
            is_user: false,
            send_date: new Date().toISOString(),
            mes: `[${chat.name} sends a picture that contains: ${body.prompt}].`,
            extra: {
                media: [
                    {
                        url: `user/images/${folder}/${body.file}`,
                        type: 'image',
                        title: body.prompt,
                        generation_type: -1,
                        ...(metadata.negativePrompt ? { negative: metadata.negativePrompt } : {}),
                        source: 'generated',
                    },
                ],
                media_display: 'gallery',
                media_index: 0,
                inline_image: false,
            },
        };

        if (chat.kind === 'character') {
            await appendMessage(chat.character, body.chatId, message);
        } else {
            await appendGroupMessage(chat.group, body.chatId, message);
        }

        return { message };
    });

    /** List one gallery, resolved from the character or group. */
    app.get('/api/images', async (request) => {
        const scope = galleryScopeSchema.parse(request.query ?? {});
        const folder = await folderForScope(scope);
        return { images: await listImages(folder) };
    });

    /** Serve one image. Authentication is enforced by the global hook. */
    app.get('/api/images/:folder/:file', async (request, reply) => {
        const { folder, file } = fileParamsSchema.parse(request.params ?? {});
        const image = await readImage(folder, file);
        return reply
            .header('Cache-Control', 'private, max-age=3600')
            .header('X-Content-Type-Options', 'nosniff')
            .type(image.contentType)
            .send(image.data);
    });

    app.delete('/api/images/:folder/:file', async (request) => {
        const { folder, file } = fileParamsSchema.parse(request.params ?? {});
        await deleteImage(folder, file);
        return { ok: true };
    });
}
