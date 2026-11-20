import { imSettingsPatchSchema, imTokenSchema } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';

import { imStatus, syncTransport } from '../im/service.js';
import { getSettings, setTelegramToken, updateSettings } from '../storage/settings.js';

/**
 * The bot's settings and its state.
 *
 * Two rules shape this file. The token is written straight to `secrets.json` and
 * is never returned — not in the settings response, not here, not in an error
 * message — so the client only ever learns `hasToken`. And every route that
 * changes something the transport was built from calls `syncTransport`, because
 * a settings save that does not take effect until the next restart is a bug
 * people blame on the bot.
 */
export async function registerImRoutes(app: FastifyInstance): Promise<void> {
    /** The bot's state. `hasToken` stands in for the token itself. */
    app.get('/api/im/status', async () => ({ status: await imStatus() }));

    /**
     * Store or clear the token.
     *
     * Omitted keeps what is stored, an empty string clears it — the same
     * contract the provider key field uses, so one form pattern covers both.
     */
    app.put('/api/im/telegram/token', async (request) => {
        const { token } = imTokenSchema.parse(request.body ?? {});
        await setTelegramToken(token);
        await syncTransport();
        return { status: await imStatus() };
    });

    /**
     * Turn the bot on or off, and set who may talk to it.
     *
     * This goes through the normal settings patch rather than its own storage,
     * so the IM block lives beside every other profile setting and a profile
     * switch carries it.
     */
    app.patch('/api/im/settings', async (request) => {
        const im = imSettingsPatchSchema.parse(request.body ?? {});
        await updateSettings({ im });
        await syncTransport();
        return { settings: (await getSettings()).im, status: await imStatus() };
    });
}
