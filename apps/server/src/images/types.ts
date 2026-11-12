import type { ImageBackend } from '@catcup/shared';

/** Formats the adapters accept and the gallery stores. */
export type ImageFormat = 'png' | 'jpeg' | 'webp';

/** What a request needs, after settings and the prompt prefix are resolved. */
export interface ImageRequest {
    prompt: string;
    negativePrompt: string;
    width: number;
    height: number;
    steps: number;
    cfgScale: number;
    sampler: string;
    /** `-1` asks the backend for a random seed. */
    seed: number;
}

/** A generated image before it is written to the gallery. */
export interface GeneratedImageData {
    data: Buffer;
    format: ImageFormat;
    /** The seed the backend actually used, when it reports one. */
    seed: number | null;
    model: string;
}

export interface ImageBackendSettings {
    backend: ImageBackend;
    baseUrl: string;
    model: string;
}
