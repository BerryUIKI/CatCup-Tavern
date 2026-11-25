import { assetPath } from '../assets.js';

export {
    createTokenCounter,
    ESTIMATE_COUNTER,
    estimateTokens,
    warmTokenizers as warmTokenizerModule,
} from '@catcup/compat-st';

import { warmTokenizers as warm } from '@catcup/compat-st';

/**
 * Load the tokenizer vocabulary from this server's assets.
 *
 * The counting itself lives in `@catcup/compat-st`, which is derived code; the
 * asset directory belongs to the server, so the path is supplied here rather
 * than guessed at from inside the package.
 */
export async function warmTokenizers(): Promise<void> {
    await warm(assetPath('tokenizers', 'claude.json'));
}
