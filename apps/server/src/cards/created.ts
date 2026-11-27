import { buildCardPayload, encodePng, writePngCard } from '@catcup/compat-st';
import type { CharacterCreateRequest } from '@catcup/shared';

/**
 * The first file of a card that starts in the app.
 *
 * Issue #168 asks for a placeholder picture rather than none, and the reason is
 * about the interface rather than the file: the library is a grid of images, so
 * a card with no image is a hole in the grid rather than a card.
 *
 * The picture is the same empty state the interface draws for a card with no
 * portrait — a hue derived from the name, with the name's initials over it —
 * rendered into a PNG so the card is a real image card from the first moment.
 * A bundled blank PNG would make every new character identical, which reads as
 * a broken image rather than as an empty state.
 */

/** 256×256 is the size SillyTavern crops to, so a later portrait lands cleanly. */
const AVATAR_SIZE = 256;

/** The two gradient stops, from the same tokens `CharacterAvatar` reads in the web app. */
const AVATAR_SATURATION = 0.46;
const AVATAR_LIGHTNESS = 0.62;

/**
 * Relative luminance of a channel, per WCAG.
 *
 * The initials are drawn in one of two inks, and picking it from the tile's own
 * brightness is what keeps a dark name and a pale name both legible.
 */
function channelLuminance(value: number): number {
    const ratio = value / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function luminance([red, green, blue]: readonly [number, number, number]): number {
    return 0.2126 * channelLuminance(red) + 0.7152 * channelLuminance(green) + 0.0722 * channelLuminance(blue);
}

/** HSL → RGB, in degrees and 0–1 fractions. */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const sector = ((((hue % 360) + 360) % 360) / 60) % 6;
    const second = chroma * (1 - Math.abs((sector % 2) - 1));
    const [red, green, blue] =
        sector < 1
            ? [chroma, second, 0]
            : sector < 2
              ? [second, chroma, 0]
              : sector < 3
                ? [0, chroma, second]
                : sector < 4
                  ? [0, second, chroma]
                  : sector < 5
                    ? [second, 0, chroma]
                    : [chroma, 0, second];
    const offset = lightness - chroma / 2;
    return [Math.round((red + offset) * 255), Math.round((green + offset) * 255), Math.round((blue + offset) * 255)];
}

/**
 * The hue a name maps to.
 *
 * The same arithmetic `CharacterAvatar` uses in `apps/web`, and it has to stay
 * that way: a card whose placeholder was mint-green must not render amber in the
 * grid. Both are four lines of integer maths over the name's code points; the
 * alternative is `packages/shared` knowing about rendering, which costs more
 * than the duplication.
 */
function nameHue(name: string): number {
    let hash = 0;
    for (const character of name) {
        hash = (hash * 31 + (character.codePointAt(0) ?? 0)) % 360;
    }
    return hash;
}

/**
 * The initials the interface would show for this name.
 *
 * Two words give their first letters; one word gives its first two characters.
 * Kept identical to `initialsFor` in `CharacterAvatar` for the same reason as
 * `nameHue`.
 */
function initialsFor(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
        return parts
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? '')
            .join('');
    }
    return name.trim().slice(0, 2).toUpperCase() || '?';
}

/**
 * A 5×7 bitmap font, uppercase and digits, one string per row.
 *
 * Drawn by hand instead of pulling a font library in: the picture carries two
 * characters and a background, and a text-shaping dependency in the server's
 * dependency list for that is a poor trade. Glyphs are the smallest size that
 * stays legible at 256px, which is where the initials are actually read.
 */
const GLYPHS: Record<string, readonly string[]> = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
    J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
    X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
    Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
    '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
    '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    '?': ['01110', '10001', '00001', '00110', '00100', '00000', '00100'],
};

/**
 * How large one glyph pixel is, in image pixels.
 *
 * Two five-wide glyphs at 16 are 176px across in a 256px tile, which leaves a
 * 40px margin on each side — the initials read as a mark on the tile rather than
 * as a texture covering it. At 20 they filled 240 of 256 and the margin was gone.
 */
const GLYPH_SCALE = 16;
const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_GAP = 2;

interface Canvas {
    pixels: Uint8Array;
    fill: (x: number, y: number, color: readonly [number, number, number]) => void;
}

function canvas(size: number): Canvas {
    const pixels = new Uint8Array(size * size * 4);
    return {
        pixels,
        fill(x, y, color) {
            if (x < 0 || y < 0 || x >= size || y >= size) {
                return;
            }
            const offset = (y * size + x) * 4;
            pixels[offset] = color[0];
            pixels[offset + 1] = color[1];
            pixels[offset + 2] = color[2];
            pixels[offset + 3] = 255;
        },
    };
}

/**
 * Paint the tile: a corner-to-corner split in two shades of the name's hue, its
 * initials centred over it, and a one-pixel border so it reads as a card rather
 * than as a coloured square.
 */
function paintPlaceholder(name: string): Uint8Array {
    const hue = nameHue(name);
    const top = hslToRgb(hue, AVATAR_SATURATION, AVATAR_LIGHTNESS);
    const bottom = hslToRgb((hue + 42) % 360, AVATAR_SATURATION * 0.82, AVATAR_LIGHTNESS * 0.61);

    const surface = canvas(AVATAR_SIZE);
    for (let y = 0; y < AVATAR_SIZE; y += 1) {
        for (let x = 0; x < AVATAR_SIZE; x += 1) {
            // The seam runs corner to corner, as the interface's 145° gradient does.
            surface.fill(x, y, x + y >= AVATAR_SIZE ? bottom : top);
        }
    }

    const border = hslToRgb(hue, AVATAR_SATURATION * 0.72, AVATAR_LIGHTNESS * 0.72);
    for (let index = 0; index < AVATAR_SIZE; index += 1) {
        surface.fill(index, 0, border);
        surface.fill(index, AVATAR_SIZE - 1, border);
        surface.fill(0, index, border);
        surface.fill(AVATAR_SIZE - 1, index, border);
    }

    // The ink is whichever of near-black and near-white stands further from the
    // tile in luminance, so the initials are never lost against their background.
    const dark: [number, number, number] = [27, 20, 16];
    const light: [number, number, number] = [246, 240, 228];
    const againstLight = (1.05 + 0.05) / (luminance(top) + 0.05);
    const againstDark = (luminance(top) + 0.05) / (luminance(dark) + 0.05);
    const ink = againstLight >= againstDark ? light : dark;

    const glyphs = [...initialsFor(name)].map((character) => GLYPHS[character] ?? GLYPHS['?']).filter(Boolean);
    const drawn = glyphs as readonly (readonly string[])[];
    if (drawn.length === 0) {
        return surface.pixels;
    }

    const width = drawn.length * GLYPH_WIDTH * GLYPH_SCALE + (drawn.length - 1) * GLYPH_GAP * GLYPH_SCALE;
    const height = GLYPH_HEIGHT * GLYPH_SCALE;
    const left = Math.round((AVATAR_SIZE - width) / 2);
    const topmost = Math.round((AVATAR_SIZE - height) / 2);

    drawn.forEach((glyph, glyphIndex) => {
        const originX = left + glyphIndex * (GLYPH_WIDTH + GLYPH_GAP) * GLYPH_SCALE;
        for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
            const bits = glyph[row] ?? '';
            for (let column = 0; column < GLYPH_WIDTH; column += 1) {
                if (bits[column] !== '1') {
                    continue;
                }
                for (let dy = 0; dy < GLYPH_SCALE; dy += 1) {
                    for (let dx = 0; dx < GLYPH_SCALE; dx += 1) {
                        surface.fill(originX + column * GLYPH_SCALE + dx, topmost + row * GLYPH_SCALE + dy, ink);
                    }
                }
            }
        }
    });

    return surface.pixels;
}

/**
 * A 256×256 PNG of the placeholder.
 *
 * Written here rather than pulled from a drawing library: the image is three
 * colours and a bitmap font, and a renderer built for a browser has no business
 * in the server's dependency list for it.
 */
export async function placeholderPng(name: string): Promise<Uint8Array> {
    const pixels = paintPlaceholder(name);

    // Each scanline carries its filter type as a prefix; 0 means "no filter",
    // which costs a little size and saves writing five filtering passes.
    const stride = AVATAR_SIZE * 4;
    const raw = new Uint8Array((stride + 1) * AVATAR_SIZE);
    for (let y = 0; y < AVATAR_SIZE; y += 1) {
        raw[y * (stride + 1)] = 0;
        raw.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
    }

    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, AVATAR_SIZE);
    view.setUint32(4, AVATAR_SIZE);
    header[8] = 8; // bit depth
    header[9] = 6; // colour type: RGBA
    header[10] = 0; // deflate
    header[11] = 0; // adaptive filtering
    header[12] = 0; // no interlace

    const { deflateSync } = await import('node:zlib');
    return encodePng([
        { name: 'IHDR', data: header },
        { name: 'IDAT', data: new Uint8Array(deflateSync(raw)) },
        { name: 'IEND', data: new Uint8Array(0) },
    ]);
}

/**
 * The card payload a creation request writes.
 *
 * `buildCardPayload` with an empty raw card turns the request into a V2 wrapper,
 * which is the same function every editor save goes through — so a card created
 * here and a card edited later are produced by one path, and the fields the
 * editor does not show start out absent rather than invented.
 */
export function newCardPayload(request: CharacterCreateRequest): Record<string, unknown> {
    const { name, ...patch } = request;
    return buildCardPayload({}, { ...patch, name });
}

/** A `.png` card: the placeholder picture with the card embedded in its text chunks. */
export async function newCardPng(request: CharacterCreateRequest): Promise<Buffer> {
    const image = await placeholderPng(request.name);
    return Buffer.from(writePngCard(image, newCardPayload(request)));
}

/** A `.json` card, for a name the file system cannot take as it stands. */
export function newCardJson(request: CharacterCreateRequest): Buffer {
    return Buffer.from(`${JSON.stringify(newCardPayload(request), null, 2)}\n`, 'utf8');
}
