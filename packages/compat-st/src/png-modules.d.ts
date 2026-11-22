/**
 * Type declarations for the two PNG chunk packages.
 *
 * Neither ships types and neither has a maintained `@types` entry, and they are
 * used for exactly three calls. Declaring them here keeps the shape honest and
 * keeps `any` out of the parser that uses them.
 *
 * Both import as a default export, which is how the CommonJS entry resolves
 * under `esModuleInterop`.
 */

declare module 'png-chunk-text' {
    interface PngText {
        /** Decode one `tEXt` chunk's bytes into its keyword and text. */
        decode(data: Uint8Array): { keyword: string; text: string };
        /** Encode a keyword and text into a `tEXt` chunk body. */
        /** A complete `tEXt` chunk, not just its body. */
        encode(keyword: string, text: string): { name: string; data: Uint8Array };
    }
    const text: PngText;
    export default text;
}

declare module 'png-chunks-extract' {
    export interface PngChunk {
        name: string;
        data: Uint8Array;
    }
    /** Every chunk in a PNG, in file order. */
    export default function extract(data: Uint8Array): PngChunk[];
}
