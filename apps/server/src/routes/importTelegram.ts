import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { badRequest } from '../http/errors.js';
import { importTelegramChat, scanExport, TelegramImportError } from '../import/telegramImport.js';
import { importChatFile } from '../storage/chats.js';
import { requireCharacter } from './helpers.js';

/**
 * Importing a Telegram chat export.
 *
 * Two steps, like the SillyTavern folder import: scan returns what would be
 * imported and writes nothing, and the second call does it. The split exists
 * because the one decision that cannot be automated — **who in the export is
 * you** — has to be made after seeing who spoke.
 */

const scanSchema = z.object({
    /** The export's text. A Telegram export can be large, so the route caps it. */
    raw: z.string().min(2).max(64_000_000),
});

const importSchema = scanSchema.extend({
    characterId: z.string().trim().min(1).max(200),
    /** The participant who becomes the persona. Required — never guessed. */
    owner: z.string().trim().min(1).max(200),
});

export async function registerTelegramImportRoutes(app: FastifyInstance): Promise<void> {
    app.post('/api/import/telegram/scan', async (request) => {
        const body = scanSchema.parse(request.body ?? {});
        try {
            return { scan: scanExport(body.raw) };
        } catch (error) {
            if (error instanceof TelegramImportError) {
                throw badRequest(error.message, error.code);
            }
            throw error;
        }
    });

    app.post('/api/import/telegram', async (request) => {
        const body = importSchema.parse(request.body ?? {});
        const character = await requireCharacter(body.characterId);

        try {
            // The scan is redone from the same bytes rather than trusted from
            // the client: a scan the client could edit would let an import write
            // messages the person never saw on the confirmation screen.
            const scan = scanExport(body.raw);
            const chat = await importTelegramChat(character, scan, body.owner, importChatFile);
            return { chat, imported: scan.messages.length };
        } catch (error) {
            if (error instanceof TelegramImportError) {
                throw badRequest(error.message, error.code);
            }
            throw error;
        }
    });
}
