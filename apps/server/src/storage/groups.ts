import { mkdir, readdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
    type ChatFile,
    type ChatHeader,
    type ChatMessage,
    type ChatSummary,
    type Group,
    type GroupChatDetail,
    type GroupCreate,
    type GroupPatch,
    groupSchema,
    isRecord,
} from '@catcup/shared';
import writeFileAtomic from 'write-file-atomic';

import { cleanChatId, type MessagePatch, parseChatContent, serializeChat } from './chats.js';
import { withFileLock } from './mutex.js';
import { assertSimpleName, paths, resolveInside, safeFileName } from './paths.js';

/** A stored group file, with the modification time the library sorts by. */
export interface GroupFile {
    group: Group;
    updatedAt: number;
}

/** A group chat together with the group metadata it changed. */
export interface GroupChatChange {
    chat: GroupChatDetail;
    group: GroupFile;
}

function defaultHeader(): ChatHeader {
    return { chat_metadata: {}, user_name: 'unused', character_name: 'unused' };
}

function groupPath(id: string): string {
    assertSimpleName(id);
    return resolveInside(paths.groups, `${id}.json`);
}

function groupChatPath(chatId: string): string {
    return resolveInside(paths.groupChats, `${cleanChatId(chatId)}.jsonl`);
}

/** Drop `undefined` values so a patch cannot reset a stored default. */
function definedEntries<T extends object>(value: T): Partial<T> {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

async function readGroupFile(filePath: string, id: string): Promise<GroupFile | null> {
    try {
        const [content, stats] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)]);
        const raw: unknown = JSON.parse(content);
        if (!isRecord(raw)) {
            throw new Error('A group file must contain a JSON object');
        }
        // The file name is authoritative. SillyTavern writes `id` inside the
        // body too, but a renamed or copied file must resolve to where it sits.
        const group = groupSchema.parse({ ...raw, id });
        return { group, updatedAt: stats.mtimeMs };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

async function writeGroupFile(filePath: string, group: Group): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFileAtomic(filePath, `${JSON.stringify(group, null, 4)}\n`, { encoding: 'utf8', mode: 0o644 });
}

async function readChatFile(filePath: string, groupId: string, chatId: string): Promise<GroupChatDetail | null> {
    try {
        const content = await readFile(filePath, 'utf8');
        const parsed = parseChatContent(content);
        return { ...parsed, groupId, chatId: cleanChatId(chatId) };
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

async function exists(filePath: string): Promise<boolean> {
    try {
        await stat(filePath);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}

async function uniqueGroupId(): Promise<string> {
    const base = String(Date.now());
    let id = base;
    let index = 2;
    while (await exists(groupPath(id))) {
        id = `${base}-${index}`;
        index += 1;
    }
    return id;
}

/**
 * SillyTavern names group chats `2026-11-11@08h14m52s123ms`. Keeping the same
 * shape means a chat folder copied between the two applications looks native.
 */
function groupChatTimestamp(date = new Date()): string {
    const pad = (value: number, length = 2) => String(value).padStart(length, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hour = pad(date.getHours());
    const minute = pad(date.getMinutes());
    const second = pad(date.getSeconds());
    const millisecond = pad(date.getMilliseconds(), 3);
    return `${year}-${month}-${day}@${hour}h${minute}m${second}s${millisecond}ms`;
}

async function uniqueGroupChatId(group: Group, preferred?: string): Promise<string> {
    const base = safeFileName(preferred?.trim() || groupChatTimestamp(), 'chat');
    const taken = new Set(group.chats.map((chatId) => chatId.toLowerCase()));

    let chatId = base;
    let index = 2;
    for (;;) {
        if (!taken.has(chatId.toLowerCase()) && !(await exists(groupChatPath(chatId)))) {
            return chatId;
        }
        chatId = `${base} (${index})`;
        index += 1;
    }
}

export async function listGroups(): Promise<GroupFile[]> {
    let files: string[];
    try {
        files = (await readdir(paths.groups, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
            .map((entry) => entry.name);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const groups = await Promise.all(
        files.map(async (fileName) => {
            const id = fileName.replace(/\.json$/i, '');
            try {
                return await readGroupFile(path.join(paths.groups, fileName), id);
            } catch (error) {
                console.error(`[groups] Failed to read ${fileName}:`, error);
                return null;
            }
        }),
    );

    return groups.filter((file): file is GroupFile => file !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getGroup(id: string): Promise<GroupFile | null> {
    const cleanId = id.replace(/\.json$/i, '');
    return readGroupFile(groupPath(cleanId), cleanId);
}

export async function createGroup(input: GroupCreate): Promise<GroupFile> {
    const id = await uniqueGroupId();
    const group = groupSchema.parse({
        id,
        ...definedEntries(input),
        members: [...new Set(input.members)],
        chat_id: '',
        chats: [],
    });

    const filePath = groupPath(id);
    await withFileLock(filePath, () => writeGroupFile(filePath, group));

    const written = await readGroupFile(filePath, id);
    if (!written) {
        throw new Error('Group file could not be read back');
    }
    return written;
}

export async function updateGroup(id: string, patch: GroupPatch): Promise<GroupFile | null> {
    const cleanId = id.replace(/\.json$/i, '');
    const filePath = groupPath(cleanId);

    return withFileLock(filePath, async () => {
        const existing = await readGroupFile(filePath, cleanId);
        if (!existing) {
            return null;
        }

        const members = patch.members ? [...new Set(patch.members)] : existing.group.members;
        const disabled = patch.disabled_members ?? existing.group.disabled_members;
        const group = groupSchema.parse({
            ...existing.group,
            ...definedEntries(patch),
            id: cleanId,
            members,
            // Membership changes must not leave disabled names behind.
            disabled_members: disabled.filter((member) => members.includes(member)),
        });
        await writeGroupFile(filePath, group);
        return readGroupFile(filePath, cleanId);
    });
}

/** Delete a group and every chat that belongs to it, as SillyTavern does. */
export async function deleteGroup(id: string): Promise<boolean> {
    const cleanId = id.replace(/\.json$/i, '');
    const filePath = groupPath(cleanId);

    return withFileLock(filePath, async () => {
        const existing = await readGroupFile(filePath, cleanId);
        if (!existing) {
            return false;
        }

        for (const chatId of existing.group.chats) {
            let filePath: string;
            try {
                filePath = groupChatPath(chatId);
            } catch {
                // A stored id that cannot be a file name is skipped rather than
                // failing the whole delete.
                continue;
            }
            try {
                await unlink(filePath);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                    console.error(`[groups] Could not delete chat ${chatId}:`, error);
                }
            }
        }

        try {
            await unlink(filePath);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
        return true;
    });
}

export async function listGroupChats(group: Group): Promise<ChatSummary[]> {
    const summaries = await Promise.all(
        group.chats.map(async (chatId): Promise<ChatSummary | null> => {
            const filePath = groupChatPath(chatId);
            try {
                const [stats, content] = await Promise.all([stat(filePath), readFile(filePath, 'utf8')]);
                const parsed = parseChatContent(content);
                return { id: chatId, title: chatId, updatedAt: stats.mtimeMs, messageCount: parsed.messages.length };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    return null;
                }
                console.error(`[groups] Failed to read chat ${chatId}:`, error);
                return null;
            }
        }),
    );

    return summaries
        .filter((summary): summary is ChatSummary => summary !== null)
        .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readGroupChat(group: Group, chatId: string): Promise<GroupChatDetail | null> {
    const clean = cleanChatId(chatId);
    if (!group.chats.includes(clean)) {
        return null;
    }
    return readChatFile(groupChatPath(clean), group.id, clean);
}

/**
 * Start a chat inside a group and make it the group's current chat.
 *
 * The file begins with a header and no messages; the group generation step
 * seeds the first greeting once it knows which member speaks first.
 */
export async function createGroupChat(id: string, name?: string): Promise<GroupChatChange | null> {
    const cleanId = id.replace(/\.json$/i, '');
    const filePath = groupPath(cleanId);

    return withFileLock(filePath, async () => {
        const existing = await readGroupFile(filePath, cleanId);
        if (!existing) {
            return null;
        }

        const chatId = await uniqueGroupChatId(existing.group, name);
        const chat: ChatFile = { header: defaultHeader(), messages: [] };
        const chatFile = groupChatPath(chatId);
        await withFileLock(chatFile, () => writeChatFile(chatFile, chat));

        const group = groupSchema.parse({
            ...existing.group,
            chats: [...existing.group.chats, chatId],
            chat_id: chatId,
        });
        await writeGroupFile(filePath, group);

        const updated = await readGroupFile(filePath, cleanId);
        if (!updated) {
            throw new Error('Group file could not be read back');
        }
        return { chat: { ...chat, groupId: cleanId, chatId }, group: updated };
    });
}

export async function renameGroupChat(id: string, chatId: string, name: string): Promise<GroupChatChange | null> {
    const cleanId = id.replace(/\.json$/i, '');
    const filePath = groupPath(cleanId);

    return withFileLock(filePath, async () => {
        const existing = await readGroupFile(filePath, cleanId);
        if (!existing) {
            return null;
        }

        const sourceId = cleanChatId(chatId);
        if (!existing.group.chats.includes(sourceId)) {
            return null;
        }

        // Renaming to the name the chat already has is a no-op, not a second file.
        if (safeFileName(name.trim() || sourceId, 'chat') === sourceId) {
            const chat = await readChatFile(groupChatPath(sourceId), cleanId, sourceId);
            return chat ? { chat, group: existing } : null;
        }

        const nextId = await uniqueGroupChatId(existing.group, name);
        if (nextId !== sourceId) {
            await rename(groupChatPath(sourceId), groupChatPath(nextId));
        }

        const group = groupSchema.parse({
            ...existing.group,
            chats: existing.group.chats.map((entry) => (entry === sourceId ? nextId : entry)),
            chat_id: existing.group.chat_id === sourceId ? nextId : existing.group.chat_id,
        });
        await writeGroupFile(filePath, group);

        const chat = await readChatFile(groupChatPath(nextId), cleanId, nextId);
        if (!chat) {
            throw new Error('Chat disappeared during rename');
        }
        const updated = await readGroupFile(filePath, cleanId);
        if (!updated) {
            throw new Error('Group file could not be read back');
        }
        return { chat, group: updated };
    });
}

/** Delete one group chat and its entry in the group file. */
export async function deleteGroupChat(id: string, chatId: string): Promise<GroupFile | null> {
    const cleanId = id.replace(/\.json$/i, '');
    const filePath = groupPath(cleanId);

    return withFileLock(filePath, async () => {
        const existing = await readGroupFile(filePath, cleanId);
        if (!existing) {
            return null;
        }

        const clean = cleanChatId(chatId);
        if (!existing.group.chats.includes(clean)) {
            return null;
        }

        try {
            await unlink(groupChatPath(clean));
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }

        const chats = existing.group.chats.filter((entry) => entry !== clean);
        const group = groupSchema.parse({
            ...existing.group,
            chats,
            chat_id: existing.group.chat_id === clean ? (chats.at(-1) ?? '') : existing.group.chat_id,
        });
        await writeGroupFile(filePath, group);
        return readGroupFile(filePath, cleanId);
    });
}

export async function appendGroupMessage(group: Group, chatId: string, message: ChatMessage): Promise<ChatMessage> {
    const clean = cleanChatId(chatId);
    const filePath = groupChatPath(clean);
    return withFileLock(filePath, async () => {
        if (!group.chats.includes(clean)) {
            throw new Error('Chat not found');
        }
        const chat = await readChatFile(filePath, group.id, clean);
        if (!chat) {
            throw new Error('Chat not found');
        }
        chat.messages.push(message);
        await writeChatFile(filePath, chat);
        return message;
    });
}

export async function updateGroupMessage(
    group: Group,
    chatId: string,
    index: number,
    patch: MessagePatch,
): Promise<ChatMessage> {
    const clean = cleanChatId(chatId);
    const filePath = groupChatPath(clean);
    return withFileLock(filePath, async () => {
        if (!group.chats.includes(clean)) {
            throw new Error('Chat not found');
        }
        const chat = await readChatFile(filePath, group.id, clean);
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

export async function deleteGroupMessage(group: Group, chatId: string, index: number): Promise<GroupChatDetail> {
    const clean = cleanChatId(chatId);
    const filePath = groupChatPath(clean);
    return withFileLock(filePath, async () => {
        if (!group.chats.includes(clean)) {
            throw new Error('Chat not found');
        }
        const chat = await readChatFile(filePath, group.id, clean);
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

/** Merge keys into a group chat's `chat_metadata`, such as a persona pin. */
export async function patchGroupChatMetadata(
    group: Group,
    chatId: string,
    patch: Record<string, unknown>,
): Promise<ChatHeader> {
    const clean = cleanChatId(chatId);
    const filePath = groupChatPath(clean);
    return withFileLock(filePath, async () => {
        if (!group.chats.includes(clean)) {
            throw new Error('Chat not found');
        }
        const chat = await readChatFile(filePath, group.id, clean);
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
