import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The id a test fixture uses, so the server adopts it instead of minting one. */
export const TEST_PROFILE_ID = 'default';

/**
 * Make a scratch data folder already in the profile shape.
 *
 * The server adopts an existing `profiles/default` folder when it starts (see
 * `seedProfileIndex`), so a fixture written here is the one the test then reads
 * through the API without the server creating a second, empty profile beside it.
 */
export async function createProfileDataDir(prefix = 'catcup-test-'): Promise<string> {
    const root = await mkdtemp(path.join(tmpdir(), prefix));
    await mkdir(path.join(root, 'profiles', TEST_PROFILE_ID), { recursive: true });
    return root;
}

/** Absolute path of something inside the fixture's profile. */
export function fixturePath(root: string, ...parts: string[]): string {
    return path.join(root, 'profiles', TEST_PROFILE_ID, ...parts);
}

/**
 * Point the storage layer at the fixture's profile.
 *
 * A storage test imports the modules directly rather than going through
 * `buildApp()`, so nothing has set a scope. Call this after the stubs and
 * `resetModules` imports, before the first storage read.
 */
export async function activateFixtureScope(root: string): Promise<void> {
    const { setActiveScope } = await import('../storage/paths.js');
    setActiveScope(fixturePath(root));
    const { ensureDataDirs } = await import('../storage/paths.js');
    await ensureDataDirs();
}
