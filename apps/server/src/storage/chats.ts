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

function cleanChatId(chatId: string): string {
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

function greetingFor(character: CharacterDetail, greetingIndex: number | undefined): string {
    if (greetingIndex === undefined || greetingIndex <= 0) {
        return character.card.first_mes;
    }
    return character.card.alternate_greetings[greetingIndex - 1] ?? character.card.first_mes;
}

export async function createChat(character: CharacterDetail, options: NewChatRequest = {}): Promise<ChatDetail> {
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

    const greeting = greetingFor(character, options.greetingIndex).trim();
    const messages: ChatMessage[] = greeting
        ? [
              {
                  name: character.name,
                  is_user: false,
                  send_date: new Date().toISOString(),
                  mes: greeting,
                  extra: {},
              },
          ]
        : [];

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
