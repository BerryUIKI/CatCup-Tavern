import type { CharacterDetail, CharacterSummary } from './character.js';
import type { ChatMessage } from './chat.js';
import type { ModelInfo } from './provider.js';
import type { QuickReplySet } from './quickreplies.js';
import type { RegexScript } from './regex.js';
import type { ItemScope } from './shared.js';
import type { WorldInfoEntry } from './worldinfo.js';

/**
 * The geometry of the shell's custom title bar, in logical pixels.
 *
 * The shell passes these to the server, which hands them on here, so the strip
 * the SPA draws is the same one the shell hit-tests. Present only in the desktop
 * shell: a web or LAN install has no bar and gets `null`.
 */
export interface TitleBarGeometry {
    height: number;
    buttonWidth: number;
    /**
     * The window buttons, left to right. Their meaning is the shell's — their
     * clicks never reach the page — so the SPA only draws them.
     */
    buttonOrder: Array<'minimize' | 'maximize' | 'close'>;
}

export interface AuthStatus {
    needsSetup: boolean;
    authenticated: boolean;
    /** Desktop install with no password: the API is open to the local app. */
    openSession: boolean;
    /**
     * The page is being shown by the desktop shell rather than a browser.
     *
     * The shell serves the same SPA over loopback, so the page cannot tell the
     * two apart on its own.
     */
    desktop: boolean;
    /** The custom title bar to draw, or `null` when the shell keeps the native one. */
    titleBar: TitleBarGeometry | null;
}

export interface AuthSetupRequest {
    password: string;
}

/**
 * Desktop-only password management. `password: ''` removes the password and
 * returns the app to open mode; `currentPassword` is required to change or
 * remove one that is already set.
 */
export interface AuthPasswordRequest {
    password: string;
    currentPassword?: string;
}

export interface AuthPasswordResponse {
    ok: true;
    openSession: boolean;
}

export interface AuthLoginRequest {
    password: string;
}

export interface ApiErrorBody {
    error: string;
    code?: string;
}

export type GenerateAction = 'send' | 'regenerate' | 'continue' | 'trigger' | 'impersonate';

export interface GenerateRequest {
    characterId: string;
    chatId: string;
    action: GenerateAction;
    message?: string;
    /**
     * Ask the server to notify the owner over IM when this generation ends.
     *
     * The client sets it, and only when its window was out of sight at the
     * moment of sending — that is not something the server can tell, since an IM
     * message and a background tab reach it the same way. Absent is "no", which
     * is also what keeps the IM loopback path from notifying a conversation the
     * reply is already in.
     */
    notifyWhenDone?: boolean;
}

/** One member speaking in a group chat. */
export interface GenerationSpeaker {
    id: string;
    /** Character avatar file name, matching the message's `original_avatar`. */
    fileName: string;
    name: string;
    avatarUrl: string;
    /** The member's own model choice, when the card names one. */
    model?: string;
}

export interface GroupGenerateRequest {
    action: GenerateAction;
    message?: string;
    /**
     * Force a member to speak. Manual groups require it; other strategies treat
     * it as an override.
     */
    speaker?: string;
    /** See `GenerateRequest.notifyWhenDone`. */
    notifyWhenDone?: boolean;
}

export type GenerationEvent =
    | {
          type: 'start';
          generationId: string;
          /** The model this request resolved to, after any fallback. */
          model?: string;
          speaker?: GenerationSpeaker;
      }
    | { type: 'token'; text: string }
    | { type: 'reasoning'; text: string }
    | {
          type: 'done';
          message: ChatMessage;
          usage?: { promptTokens?: number; completionTokens?: number };
      }
    | { type: 'error'; message: string };

/** A summary stored on a chat message's `extra.memory`. */
export interface SummaryRecord {
    value: string;
    /** Index of the message that carries it. */
    index: number;
}

export interface SummarizeResponse {
    summary: SummaryRecord | null;
    /** Why nothing was summarized, when `summary` is null. */
    reason?: string;
    /** How many chat messages this request covered. */
    messages?: number;
}

/**
 * A quick reply set as the API addresses it: the file id plus the stored body.
 *
 * `scope` says which folder it was read from, so the editor can warn before
 * changing a set every profile sees.
 */
export type QuickReplySetView = QuickReplySet & { id: string; scope: ItemScope; shadowed?: boolean };

/**
 * A regex script as a library row sees it.
 *
 * Scripts live in one ordered file per scope, so `scope` says which file the
 * row came from and the editor can warn before changing an order every profile
 * shares.
 */
export type RegexScriptView = RegexScript & { scope: ItemScope; shadowed?: boolean };

/** What clicking a quick reply asks the client to do after the server's appends. */
export type QuickReplyAction =
    | {
          type: 'input';
          /** Macro-expanded text for the message box. */
          text: string;
          /** Whether the client should send it immediately. */
          submit: boolean;
          /** Merge with whatever is already typed instead of replacing it. */
          inject: boolean;
          /** With `inject`, put the text before the existing input. */
          placeBefore: boolean;
      }
    | {
          type: 'toast';
          message: string;
          title?: string;
          severity: 'info' | 'success' | 'warning' | 'error';
      }
    | {
          type: 'generate';
          mode: 'trigger' | 'continue' | 'regenerate';
          /** Group member chosen by `/trigger <name>`; the server validates it. */
          speaker?: string;
      };

export interface QuickReplyExecuteRequest {
    setId: string;
    qrId: number;
}

export interface QuickReplyExecuteResponse {
    /** Directives in execution order. Chat appends are already persisted. */
    actions: QuickReplyAction[];
    /** Messages the reply appended to the chat. */
    appended: ChatMessage[];
}

export interface UsageInfo {
    promptTokens?: number;
    completionTokens?: number;
}

export interface ImportCharactersResponse {
    imported: CharacterSummary[];
    errors: { fileName: string; message: string }[];
}

export interface SampleCharacterResponse {
    character: CharacterDetail;
    /** False when the sample was already in the library. */
    created: boolean;
}

/** A card created from nothing; the response carries its full detail so the editor can open it. */
export interface CreateCharacterResponse {
    character: CharacterDetail;
}

export interface ModelsResponse {
    models: ModelInfo[];
}

export interface HealthResponse {
    ok: boolean;
    version: string;
    needsSetup: boolean;
}

export interface NewChatRequest {
    name?: string;
    greetingIndex?: number;
}

export interface UpdateMessageRequest {
    message: string;
}

export interface ProviderTestRequest {
    apiKey?: string;
}

export interface PresetSummary {
    /** File name without `.json`. */
    id: string;
    name: string;
    updatedAt: number;
    promptCount: number;
    /** The scope this preset was read from. */
    scope: ItemScope;
    /** `true` when this profile preset hides a shared one with the same id. */
    shadowed?: boolean;
}

export interface PresetDetail {
    id: string;
    /** The preset body exactly as stored, including unknown fields. */
    preset: Record<string, unknown>;
    /** The scope the preset was read from. */
    scope: ItemScope;
}

export interface ImportPresetRequest {
    /** Base file name to store under; derived from the preset when absent. */
    fileName?: string;
    preset: unknown;
}

export interface WorldSummary {
    /** File name without `.json`. */
    id: string;
    name: string;
    entryCount: number;
    updatedAt: number;
    /** The scope this book was read from. */
    scope: ItemScope;
    /** `true` when this profile book hides a shared one with the same id. */
    shadowed?: boolean;
}

/**
 * One world info entry as the editor sees it: the stored fields with
 * SillyTavern's defaults applied, plus the uid that addresses it.
 */
export type WorldInfoEntryView = WorldInfoEntry & { uid: number };

export interface WorldDetail {
    id: string;
    /** The stored book body, unknown fields included. */
    book: Record<string, unknown>;
    /** Normalized entries in the order the editor lists them. */
    entries: WorldInfoEntryView[];
    /** The scope the book was read from. */
    scope: ItemScope;
}

export interface ImportWorldRequest {
    fileName?: string;
    book: unknown;
}

/**
 * A book's alias sets, keyed by uid.
 *
 * `stale` names the uids whose entry content changed after a model generated
 * their aliases. A hand-entered set is never stale, because it was written
 * against whatever the entry says now.
 */
export interface WorldAliasView {
    aliases: Record<string, string[]>;
    stale: number[];
    generated: Record<string, { from?: string; at?: number; model?: string }>;
}

/** How much of another installation an import move touches. */
export interface ExistingInstallCounts {
    characters: number;
    chats: number;
    worlds: number;
    presets: number;
}

/** What a dry run found. */
export interface ExistingInstallPlan extends ExistingInstallCounts {
    /** Directories that contributed files. */
    sources: string[];
    errors: string[];
}

export interface ExistingInstallResult {
    imported: ExistingInstallCounts;
    errors: string[];
    /** Chats whose character was not found in the same import. */
    skippedChats: string[];
    /**
     * The books this import created.
     *
     * The import dialog offers to generate their aliases, which is worth most
     * the moment a book arrives rather than later, when the button has to be
     * remembered.
     */
    worldIds: string[];
}

export interface ContextPreviewMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    name?: string;
}

export interface ContextPreviewTrace {
    loop: number;
    world: string;
    uid: number;
    comment: string;
    activated: boolean;
    reason: string;
    detail?: string;
}

export interface ContextPreviewWorldInfo {
    /** Books that were scanned for this chat. */
    books: string[];
    activated: Array<{ id: string; world: string; uid: number; comment: string; reason: string; loop: number }>;
    trace: ContextPreviewTrace[];
    before: string[];
    after: string[];
    authorNoteTop: string[];
    authorNoteBottom: string[];
    atDepth: Array<{ depth: number; role: number; entries: string[] }>;
    examples: Array<{ position: number; content: string }>;
    outlets: Record<string, string[]>;
    budget: { limit: number; used: number; overflowed: boolean };
    loops: number;
}

export interface ContextPreview {
    messages: ContextPreviewMessage[];
    worldInfo: ContextPreviewWorldInfo;
    /** The summary in effect for this chat, or null when none is stored. */
    memory: {
        value: string;
        index: number;
        tokens: number;
        /** Formatted with the injection template; empty when position is -1. */
        injection: string;
        position: number;
        role: number;
        depth: number;
    } | null;
    budget: {
        exceeded: boolean;
        tokenCounts: Record<string, number>;
        total: number;
        /** Which counter produced the numbers, e.g. `o200k_base` or `estimate (chars/3.6)`. */
        counter: string;
        /** Whether those numbers come from a real vocabulary or an approximation. */
        counterSource: 'tiktoken' | 'claude' | 'estimate';
    };
}
