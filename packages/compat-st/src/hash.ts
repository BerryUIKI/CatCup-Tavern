// Third-party algorithm, used as published: cyrb53 (c) 2018 bryc. MIT.
// https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js
//
// Written against the algorithm's own publication, not taken from another
// client. CatCup uses it for world info entry identity, and it must stay
// byte-identical: a chat file stores its `timedWorldInfo` records under this
// value, so any change silently detaches an imported chat's sticky and cooldown
// effects from their entries.
//
// The only departure from the published version is the non-string guard, which
// returns 0 rather than throwing on a hand-edited file.

/**
 * 53-bit string hash, used to identify a world info entry across edits and
 * chats.
 *
 * The result is stored in the chat file, so it is a format value rather than an
 * implementation detail: two clients reading the same chat must compute the
 * same number.
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
