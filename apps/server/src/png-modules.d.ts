/**
 * Type declarations for the two PNG chunk packages used by `@catcup/compat-st`.
 *
 * Neither ships types. They are declared here as well as in the package because
 * this project compiles the package's source directly (the workspace export
 * points at `src`), so this program has to see the declarations too.
 */

declare module 'png-chunk-text' {
    interface PngText {
        decode(data: Uint8Array): { keyword: string; text: string };
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
    export default function extract(data: Uint8Array): PngChunk[];
}
