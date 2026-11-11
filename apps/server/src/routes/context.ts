import { type ContextPreview, resolvePersona, sanitizeRegexMacro } from '@catcup/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { notFound } from '../http/errors.js';
import { buildPrompt } from '../prompt/builder.js';
import { substituteMacros } from '../prompt/macros.js';
import { resolvePreset } from '../prompt/preset.js';
import { createTokenCounter, ESTIMATE_COUNTER } from '../prompt/tokenizer.js';
import { createMacroContext, scanWorldInfoForTurn } from '../prompt/worldInfoTurn.js';
import { chatPersonaId, readChat } from '../storage/chats.js';
import { readPresetBody } from '../storage/presets.js';
import { listRegexScripts } from '../storage/regex.js';
import { getActiveProvider, getSettings } from '../storage/settings.js';
import { requireCharacter } from './helpers.js';

const paramsSchema = z.object({
    characterId: z.string().min(1).max(200),
    chatId: z.string().min(1).max(300),
});

/**
 * Rebuild the prompt for a chat without generating or persisting anything.
 *
 * The scan runs against a deep clone of `chat_metadata`, so timed effects are
 * evaluated faithfully but never written back. This is the context inspector's
 * data source.
 */
export async function registerContextRoutes(app: FastifyInstance): Promise<void> {
    app.get('/api/chats/:characterId/:chatId/context', async (request) => {
        const { characterId, chatId } = paramsSchema.parse(request.params);
        const character = await requireCharacter(characterId);
        const chat = await readChat(character, chatId);
        if (!chat) {
            throw notFound('Chat not found');
        }

        const settings = await getSettings();
        const provider = await getActiveProvider();
        const tokenCounter = provider ? createTokenCounter(provider.kind, provider.model) : ESTIMATE_COUNTER;
        const persona = resolvePersona(settings, chatPersonaId(chat));
        const regexScripts = await listRegexScripts();
        const macroContext = createMacroContext(character, persona);
        const substitute = (text: string, escapeValues: boolean) =>
            substituteMacros(text, macroContext, escapeValues ? { escapeValue: sanitizeRegexMacro } : {});
        const activePreset = settings.activePresetId ? await readPresetBody(settings.activePresetId) : null;
        const preset = resolvePreset(activePreset, settings.generation);

        const worldInfoTurn = await scanWorldInfoForTurn({
            character,
            messages: chat.messages,
            persona: persona,
            config: settings.worldInfo,
            authorNote: settings.authorNote,
            contextSize: preset.generation.contextSize,
            trigger: 'normal',
            metadata: structuredClone(chat.header.chat_metadata),
            countTokens: tokenCounter.count,
            regexScripts,
            substitute,
        });

        const assembled = buildPrompt({
            character,
            messages: chat.messages,
            persona: persona,
            settings: preset.generation,
            promptSettings: preset.promptSettings,
            worldInfo: worldInfoTurn.prompt,
            generationType: 'normal',
            formats: preset.formats,
            newChatPrompt: preset.newChatPrompt,
            newExampleChatPrompt: preset.newExampleChatPrompt,
            continueNudgePrompt: preset.continueNudgePrompt,
            squashSystemMessages: preset.squashSystemMessages,
            countTokens: tokenCounter.count,
            regexScripts,
            substitute,
        });

        const scan = worldInfoTurn.scan;
        const context: ContextPreview = {
            messages: assembled.messages.map((message) => ({
                role: message.role,
                content: message.content,
                ...(message.name ? { name: message.name } : {}),
            })),
            worldInfo: {
                books: worldInfoTurn.books,
                activated: scan.activated.map((entry) => {
                    const line = scan.trace.find(
                        (candidate) => candidate.world === entry.world && candidate.uid === entry.uid,
                    );
                    return {
                        id: entry.id,
                        world: entry.world,
                        uid: entry.uid,
                        comment: entry.comment,
                        reason: line?.reason ?? 'unknown',
                        loop: line?.loop ?? 1,
                    };
                }),
                trace: scan.trace,
                before: scan.positions.before,
                after: scan.positions.after,
                authorNoteTop: scan.positions.authorNoteTop,
                authorNoteBottom: scan.positions.authorNoteBottom,
                atDepth: scan.positions.atDepth,
                examples: scan.positions.examples,
                outlets: scan.positions.outlets,
                budget: scan.budget,
                loops: scan.loops,
            },
            budget: {
                exceeded: assembled.budgetExceeded,
                tokenCounts: assembled.tokenCounts,
                total: Object.values(assembled.tokenCounts).reduce((sum, value) => sum + value, 0),
                counter: tokenCounter.label,
                counterSource: tokenCounter.source,
            },
        };

        return { context };
    });
}
