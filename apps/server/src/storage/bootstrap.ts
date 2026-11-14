import { describePlan, migrateDataFolder, planMigration } from './migrate.js';
import { activateProfile, readProfileIndex, seedProfileIndex } from './profiles.js';

/**
 * Bring the data folder into the profile shape and point the server at the
 * active profile.
 *
 * Runs once at startup, before any route can read a path:
 *
 * - a pre-profile data folder is migrated into a `Default` profile;
 * - an index that names an active profile is honored;
 * - a tree already in the new shape without an index — a test fixture, or a
 *   folder copied by hand — gets one, so the server always has a profile.
 *
 * `CATCUP_MIGRATE_DRY_RUN=1` prints the plan and exits before anything moves.
 */
export async function prepareDataFolder(): Promise<void> {
    if (process.env.CATCUP_MIGRATE_DRY_RUN === '1') {
        const plan = await planMigration();
        const lines = plan.needed ? describePlan(plan) : [`Nothing to migrate: ${plan.reason ?? 'no plan'}.`];
        process.stdout.write(`${lines.join('\n')}\n`);
        process.exit(0);
    }

    await migrateDataFolder();

    const index = await readProfileIndex();
    if (index) {
        await activateProfile(index.activeProfileId);
        return;
    }

    const created = await seedProfileIndex();
    await activateProfile(created.id);
}
