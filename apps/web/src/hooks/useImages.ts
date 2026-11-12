import type { AttachImageRequest, DraftImagePromptRequest, GenerateImageRequest, ImageScope } from '@catcup/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../lib/api';
import { queryKeys } from './data';

/** The chat an image belongs to; `id` is the character or group id. */
export interface ImageChatTarget {
    kind: 'character' | 'group';
    id: string;
    chatId: string;
    name: string;
}

export function imageScope(target: ImageChatTarget): ImageScope {
    return target.kind === 'character' ? { characterId: target.id } : { groupId: target.id };
}

function scopeKey(target: ImageChatTarget): string {
    return `${target.kind}:${target.id}`;
}

export function useImageGallery(target: ImageChatTarget | null) {
    return useQuery({
        queryKey: queryKeys.images(target ? scopeKey(target) : ''),
        queryFn: () => api.images.list(imageScope(target as ImageChatTarget)),
        enabled: Boolean(target),
    });
}

export function useDraftImagePrompt() {
    return useMutation({
        mutationFn: (input: DraftImagePromptRequest) => api.images.draft(input),
    });
}

export function useGenerateImage() {
    return useMutation({
        mutationFn: (input: GenerateImageRequest) => api.images.generate(input),
    });
}

export function useAttachImage(target: ImageChatTarget) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (input: AttachImageRequest) => api.images.attach(input),
        onSuccess: () => {
            if (target.kind === 'character') {
                void queryClient.invalidateQueries({ queryKey: queryKeys.chat(target.id, target.chatId) });
            } else {
                void queryClient.invalidateQueries({ queryKey: queryKeys.groupChat(target.id, target.chatId) });
            }
        },
    });
}

export function useDeleteImage(target: ImageChatTarget) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (image: { folder: string; file: string }) => api.images.remove(image.folder, image.file),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.images(scopeKey(target)) });
        },
    });
}
