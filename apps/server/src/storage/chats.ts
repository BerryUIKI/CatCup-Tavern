import { mkdir, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
    type CharacterDetail,
    type ChatDetail,
    type ChatFile,
    type ChatHeader,
    type ChatMessage,
    type ChatSummary,
    chatHeaderSchema,
    chatMessageSchema,
    chatPersonaId as chatPersonaIdFromMetadata,
    isRecord,
    type NewChatRequest,
} from '@catcup/shared';
import writeFileAtomic from 'write-file-atomic';

import { withFileLock } from './mutex.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';

const HEADER_KEYS = new Set(['chat_metadata', 'user_name', 'character_name']);

function defaultHeader(): ChatHeader {
    return { chat_metadata: {}, user_name: 'unused', character_name: 'unused' };
}

function timestampForFile(date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return [
        date.getFullYear(),
        '-',
        pad(date.getMonth() + 1),
        '-',
        pad(date.getDate()),
        '_',
        pad(date.getHours()),
        '-',
        pad(date.getMinutes()),
        '-',
        pad(date.getSeconds()),
    ].join('');
}

export function cleanChatId(chatId: string): string {
    const clean = chatId.replace(/\.jsonl$/i, '');
    assertSimpleName(clean);
    return clean;
}

export function parseChatContent(content: string): ChatFile {
    const lines = content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');

    if (lines.length === 0) {
        return { header: defaultHeader(), messages: [] };
    }

    let index = 0;
    let header = defaultHeader();

    const first = JSON.parse(lines[0] ?? '{}') as unknown;
    if (isRecord(first) && !('mes' in first)) {
        const hasHeaderShape =
            'chat_metadata' in first ||
            'user_name' in first ||
            'character_name' in first ||
            Object.keys(first).some((key) => HEADER_KEYS.has(key));
        if (hasHeaderShape) {
            header = chatHeaderSchema.parse(first);
            index = 1;
        }
    }

    const messages: ChatMessage[] = [];
    for (; index < lines.length; index += 1) {
        try {
            messages.push(chatMessageSchema.parse(JSON.parse(lines[index] ?? '{}')));
        } catch (error) {
            console.error('[chats] Skipping malformed JSONL line:', error);
        }
    }
    return { header, messages };
}

export function serializeChat(chat: ChatFile): string {
    const lines = [JSON.stringify(chat.header), ...chat.messages.map((message) => JSON.stringify(message))];
    return `${lines.join('\n')}\n`;
}

function chatDirectoryCandidates(character: CharacterDetail): string[] {
    const candidates = [
        resolveInside(paths.chats, safeFileName(character.name, character.id)),
        resolveInside(paths.chats, safeFileName(character.id, character.id)),
    ];
    return [...new Set(candidates)];
}

async function findChatDirectory(character: CharacterDetail): Promise<string | null> {
    for (const candidate of chatDirectoryCandidates(character)) {
        try {
            const stats = await stat(candidate);
            if (stats.isDirectory()) {
                return candidate;
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
    }
    return null;
}

async function ensureChatDirectory(character: CharacterDetail): Promise<string> {
    const existing = await findChatDirectory(character);
    if (existing) {
        return existing;
    }
    const target = chatDirectoryCandidates(character)[0] as string;
    await mkdir(target, { recursive: true });
    return target;
}

async function chatFilePath(character: CharacterDetail, chatId: string): Promise<string> {
    const directory = await findChatDirectory(character);
    const clean = cleanChatId(chatId);
    return resolveInside(directory ?? (await ensureChatDirectory(character)), `${clean}.jsonl`);
}

async function readChatFile(filePath: string, character: CharacterDetail, chatId: string): Promise<ChatDetail | null> {
    try {
        const content = await readFile(filePath, 'utf8');
        const parsed = parseChatContent(content);
        return {
            ...parsed,
            characterId: character.id,
            chatId: cleanChatId(chatId),
        };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

async function writeChatFile(filePath: string, chat: ChatFile): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, serializeChat(chat), { encoding: 'utf8', mode: 0o644 });
}

/**
 * Store a chat read from another installation.
 *
 * The file name becomes the chat id, with a numeric suffix when it is taken, so
 * importing the same folder twice adds copies instead of overwriting the first.
 */
export async function importChatFile(
    character: CharacterDetail,
    fileName: string,
    content: string,
): Promise<ChatDetail> {
    const parsed = parseChatContent(content);
    const base = cleanChatId(fileName.replace(/\.jsonl$/i, '')) || timestampForFile();
    const directory = await ensureChatDirectory(character);

    const existing = new Set((await readdir(directory).catch(() => [] as string[])).map((name) => name.toLowerCase()));

    let chatId = base;
    let index = 2;
    while (existing.has(`${chatId}.jsonl`.toLowerCase())) {
        chatId = `${base} (${index})`;
        index += 1;
    }

    const filePath = resolveInside(directory, `${chatId}.jsonl`);
    await withFileLock(filePath, () => writeChatFile(filePath, parsed));

    return { ...parsed, characterId: character.id, chatId };
}

export async function listChats(character: CharacterDetail): Promise<ChatSummary[]> {
    const directory = await findChatDirectory(character);
    if (!directory) {
        return [];
    }

    const entries = await readdir(directory, { withFileTypes: true });
    const summaries: ChatSummary[] = [];

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jsonl')) {
            continue;
        }
        const filePath = path.join(directory, entry.name);
        try {
            const [stats, content] = await Promise.all([stat(filePath), readFile(filePath, 'utf8')]);
            const parsed = parseChatContent(content);
            summaries.push({
                id: entry.name.replace(/\.jsonl$/i, ''),
                title: entry.name.replace(/\.jsonl$/i, ''),
                updatedAt: stats.mtimeMs,
                messageCount: parsed.messages.length,
            });
        } catch (error) {
            console.error(`[chats] Failed to read ${entry.name}:`, error);
        }
    }

    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readChat(character: CharacterDetail, chatId: string): Promise<ChatDetail | null> {
    const filePath = await chatFilePath(character, chatId);
    return readChatFile(filePath, character, chatId);
}

export interface GreetingOption {
    /** Index in the card: 0 is `first_mes`, n is `alternate_greetings[n - 1]`. */
    index: number;
    text: string;
}

/**
 * Every non-empty greeting in card order, after the source transform.
 *
 * `index` keeps the card's numbering even when an empty greeting is skipped, so
 * the chat picker and `greetingIndex` keep agreeing.
 */
export function greetingOptions(character: CharacterDetail, transform?: (text: string) => string): GreetingOption[] {
    return [character.card.first_mes, ...character.card.alternate_greetings]
        .map((text, index) => {
            const trimmed = text.trim();
            return { index, text: trimmed && transform ? transform(trimmed) : trimmed };
        })
        .filter((option) => option.text.length > 0);
}

function selectGreeting(
    character: CharacterDetail,
    greetingIndex: number,
    transform?: (text: string) => string,
): { selected: GreetingOption; swipes: string[] } | null {
    const greetings = greetingOptions(character, transform);
    const selected = greetings.find((greeting) => greeting.index === greetingIndex);
    return selected ? { selected, swipes: greetings.map((greeting) => greeting.text) } : null;
}

/**
 * The first message a chat starts with.
 *
 * Every greeting becomes a swipe, as in SillyTavern's `getFirstMessage`, so the
 * normal swipe controls can switch openings later.
 */
export function buildGreetingMessage(
    character: CharacterDetail,
    greetingIndex: number | undefined,
    transform?: (text: string) => string,
): ChatMessage | null {
    const cardGreetings = [character.card.first_mes, ...character.card.alternate_greetings];
    const wanted = greetingIndex ?? 0;
    const index = wanted >= 0 && wanted < cardGreetings.length ? wanted : 0;
    const picked = selectGreeting(character, index, transform);
    if (!picked) {
        return null;
    }
    const { selected, swipes } = picked;
    return {
        name: character.name,
        is_user: false,
        send_date: new Date().toISOString(),
        mes: selected.text,
        extra: { swipe_id: Math.max(0, swipes.indexOf(selected.text)), swipes },
    };
}

/** The persona a chat pinned, if any. */
export function chatPersonaId(chat: { header: { chat_metadata: Record<string, unknown> } }): string | null {
    return chatPersonaIdFromMetadata(chat.header.chat_metadata);
}

export interface CreateChatOptions extends NewChatRequest {
    /**
     * Applied to the greeting before it is stored.
     *
     * SillyTavern runs `AI_OUTPUT` regex scripts over the first message, so a
     * greeting shows up in the chat exactly as a generated reply would.
     */
    transformGreeting?: (text: string) => string;
}

export async function createChat(character: CharacterDetail, options: CreateChatOptions = {}): Promise<ChatDetail> {
    const directory = await ensureChatDirectory(character);
    const base = safeFileName(options.name?.trim() || `${character.name} - ${timestampForFile()}`, 'chat');

    const existing = new Set(
        (await readdir(directory, { withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name.toLowerCase()),
    );

    let chatId = base;
    let index = 2;
    while (existing.has(`${chatId}.jsonl`.toLowerCase())) {
        chatId = `${base} (${index})`;
        index += 1;
    }

    const message = buildGreetingMessage(character, options.greetingIndex, options.transformGreeting);
    const messages: ChatMessage[] = message ? [message] : [];

    const chat: ChatFile = { header: defaultHeader(), messages };
    const filePath = resolveInside(directory, `${chatId}.jsonl`);
    await withFileLock(filePath, () => writeChatFile(filePath, chat));

    return { ...chat, characterId: character.id, chatId };
}

export async function appendMessage(
    character: CharacterDetail,
    chatId: string,
    message: ChatMessage,
): Promise<ChatMessage> {
    const filePath = await chatFilePath(character, chatId);
    return withFileLock(filePath, async () => {
        const chat = await readChatFile(filePath, character, chatId);
        if (!chat) {
            throw new Error('Chat not found');
        }
        chat.messages.push(message);
        await writeChatFile(filePath, chat);
        return message;
    });
}

export interface MessagePatch {
    name?: string;
    is_user?: boolean;
    is_system?: boolean;
    send_date?: string;
    mes?: string;
    extra?: Record<string, unknown>;
    /** Group chats record the speaker's avatar file name at the message level. */
    original_avatar?: string;
    force_avatar?: string;
}

export async function updateMessage(
    character: CharacterDetail,
    chatId: string,
    index: number,
    patch: MessagePatch,
): Promise<ChatMessage> {
    const filePath = await chatFilePath(character, chatId);
    return withFileLock(filePath, async () => {
        const chat = await readChatFile(filePath, character, chatId);
        if (!chat) {
            throw new Error('Chat not found');
        }
        const existing = chat.messages[index];
        if (!existing) {
            throw new Error('Message not found');
        }

        const updated: ChatMessage = {
            ...existing,
            ...patch,
            extra: patch.extra === undefined ? existing.extra : { ...(existing.extra ?? {}), ...patch.extra },
        };
        chat.messages[index] = updated;
        await writeChatFile(filePath, chat);
        return updated;
    });
}

export interface SetGreetingOptions {
    greetingIndex: number;
    transformGreeting?: (text: string) => string;
}

/**
 * Replace the opening message with another greeting from the card.
 *
 * The rest of the conversation is untouched. Every non-empty greeting is stored
 * as a swipe, so this also upgrades a chat created before greetings were kept
 * as swipes.
 */
export async function setChatGreeting(
    character: CharacterDetail,
    chatId: string,
    options: SetGreetingOptions,
): Promise<ChatDetail | null> {
    const filePath = await chatFilePath(character, chatId);
    return withFileLock(filePath, async () => {
        const chat = await readChatFile(filePath, character, chatId);
        if (!chat) {
            return null;
        }
        const first = chat.messages[0];
        if (!first || first.is_user) {
            throw new Error('This chat has no greeting to replace');
        }
        const picked = selectGreeting(character, options.greetingIndex, options.transformGreeting);
        if (!picked) {
            throw new Error('That greeting is empty or missing');
        }
        const { selected, swipes } = picked;
        chat.messages[0] = {
            ...first,
            mes: selected.text,
            extra: {
                ...(first.extra ?? {}),
                swipes,
                swipe_id: Math.max(0, swipes.indexOf(selected.text)),
            },
        };
        await writeChatFile(filePath, chat);
        return chat;
    });
}

export async function deleteMessage(character: CharacterDetail, chatId: string, index: number): Promise<ChatDetail> {
    const filePath = await chatFilePath(character, chatId);
    return withFileLock(filePath, async () => {
        const chat = await readChatFile(filePath, character, chatId);
        if (!chat) {
            throw new Error('Chat not found');
        }
        if (index < 0 || index >= chat.messages.length) {
            throw new Error('Message not found');
        }
        chat.messages.splice(index, 1);
        await writeChatFile(filePath, chat);
        return chat;
    });
}

export async function deleteChat(character: CharacterDetail, chatId: string): Promise<boolean> {
    const filePath = await chatFilePath(character, chatId);
    return withFileLock(filePath, async () => {
        try {
            await unlink(filePath);
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return false;
            }
            throw error;
        }
    });
}

/**
 * Rename a chat by moving its file. A name that is already taken gets a
 * numeric suffix rather than overwriting another conversation.
 */
export async function renameChat(character: CharacterDetail, chatId: string, name: string): Promise<ChatDetail> {
    const directory = await ensureChatDirectory(character);
    const sourceId = cleanChatId(chatId);
    const source = resolveInside(directory, `${sourceId}.jsonl`);
    const base = safeFileName(name.trim() || sourceId, 'chat');

    const existing = new Set(
        (await readdir(directory, { withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name.toLowerCase()),
    );

    let nextId = base;
    let index = 2;
    while (existing.has(`${nextId}.jsonl`.toLowerCase()) && nextId !== sourceId) {
        nextId = `${base} (${index})`;
        index += 1;
    }

    const target = resolveInside(directory, `${nextId}.jsonl`);
    if (target === source) {
        const current = await readChatFile(source, character, sourceId);
        if (!current) {
            throw new Error('Chat not found');
        }
        return current;
    }

    return withFileLock(source, async () => {
        const chat = await readChatFile(source, character, sourceId);
        if (!chat) {
            throw new Error('Chat not found');
        }
        await rename(source, target);
        return { ...chat, chatId: nextId };
    });
}

/**
 * Copy the conversation up to and including `index` into a new chat.
 *
 * The header, including `chat_metadata`, is copied as SillyTavern does for
 * bookmarks; the scanner's rewind rule drops timed effects that no longer fit.
 */
export async function branchChat(
    character: CharacterDetail,
    chatId: string,
    index: number,
    name?: string,
): Promise<ChatDetail> {
    const source = await readChat(character, chatId);
    if (!source) {
        throw new Error('Chat not found');
    }
    if (!Number.isInteger(index) || index < 0 || index >= source.messages.length) {
        throw new Error('Message not found');
    }

    const directory = await ensureChatDirectory(character);
    const base = safeFileName(name?.trim() || `${source.chatId} (branch)`, 'chat');
    const existing = new Set(
        (await readdir(directory, { withFileTypes: true }))
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name.toLowerCase()),
    );

    let nextId = base;
    let counter = 2;
    while (existing.has(`${nextId}.jsonl`.toLowerCase())) {
        nextId = `${base} (${counter})`;
        counter += 1;
    }

    const chat: ChatFile = {
        header: structuredClone(source.header),
        messages: source.messages.slice(0, index + 1).map((message) => structuredClone(message)),
    };

    const target = resolveInside(directory, `${nextId}.jsonl`);
    await withFileLock(target, () => writeChatFile(target, chat));

    return { ...chat, characterId: character.id, chatId: nextId };
}

/**
 * Merge keys into the chat header's `chat_metadata`.
 *
 * `appendMessage` and `updateMessage` re-read the file inside their lock, so a
 * caller that mutates the header it read earlier would lose the change. This
 * is the write path for scanner-owned state such as `timedWorldInfo`.
 */
export async function patchChatMetadata(
    character: CharacterDetail,
    chatId: string,
    patch: Record<string, unknown>,
): Promise<ChatHeader> {
    const filePath = await chatFilePath(character, chatId);
    return withFileLock(filePath, async () => {
        const chat = await readChatFile(filePath, character, chatId);
        if (!chat) {
            throw new Error('Chat not found');
        }

        chat.header = {
            ...chat.header,
            chat_metadata: { ...chat.header.chat_metadata, ...patch },
        };
        await writeChatFile(filePath, chat);
        return chat.header;
    });
}
