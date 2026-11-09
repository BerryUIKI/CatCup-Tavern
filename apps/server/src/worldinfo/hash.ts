// Derived from SillyTavern (AGPL-3.0)
// https://github.com/SillyTavern/SillyTavern/blob/1.19.0/public/scripts/utils.js
// cyrb53 (c) 2018 bryc, public domain / MIT. See docs/REUSE.md.

/**
 * 53-bit string hash used to identify a world info entry across edits and
 * chats. SillyTavern stores it in timed-effect records, so the implementation
 * and the payload it is applied to must match exactly for imported chats to
 * keep working.
 */
export function getStringHash(input: string, seed = 0): number {
    if (typeof input !== 'string') {
        return 0;
    }

    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;

    for (let index = 0; index < input.length; index += 1) {
        const code = input.charCodeAt(index);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }

    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
