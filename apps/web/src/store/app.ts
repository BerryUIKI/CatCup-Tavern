import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type LibraryTab = 'characters' | 'groups';

/** Sections of the Settings dialog. Kept in the store so any surface can deep-link into one. */
export type SettingsSectionId =
    | 'providers'
    | 'generation'
    | 'prompts'
    | 'worldinfo'
    | 'regex'
    | 'memory'
    | 'persona'
    | 'quickreplies'
    | 'profiles'
    | 'tts'
    | 'images'
    | 'about';

export interface ToastItem {
    id: string;
    message: string;
    tone: ToastTone;
    /** Optional heading, used by quick reply `/echo title=`. */
    title?: string;
}

interface AppState {
    selectedCharacterId: string | null;
    selectedGroupId: string | null;
    selectedChatId: string | null;
    libraryTab: LibraryTab;
    settingsOpen: boolean;
    /** The section the Settings dialog opens on; `null` keeps its default. */
    settingsSection: SettingsSectionId | null;
    sidebarOpen: boolean;
    toasts: ToastItem[];
    selectCharacter: (id: string | null) => void;
    selectGroup: (id: string | null) => void;
    selectChat: (id: string | null) => void;
    /** Return to an empty view — used when a profile switch replaces every id. */
    resetSelection: () => void;
    setLibraryTab: (tab: LibraryTab) => void;
    setSettingsOpen: (open: boolean) => void;
    openSettings: (section?: SettingsSectionId) => void;
    setSidebarOpen: (open: boolean) => void;
    pushToast: (message: string, tone?: ToastTone, title?: string) => void;
    dismissToast: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
    selectedCharacterId: null,
    selectedGroupId: null,
    selectedChatId: null,
    libraryTab: 'characters',
    settingsOpen: false,
    settingsSection: null,
    sidebarOpen: false,
    toasts: [],

    // A character and a group are never selected at the same time; whichever
    // one is chosen owns the main pane.
    selectCharacter: (id) =>
        set({
            selectedCharacterId: id,
            selectedGroupId: null,
            selectedChatId: null,
            libraryTab: 'characters',
            sidebarOpen: false,
        }),
    selectGroup: (id) =>
        set({
            selectedGroupId: id,
            selectedCharacterId: null,
            selectedChatId: null,
            libraryTab: 'groups',
            sidebarOpen: false,
        }),
    selectChat: (id) => set({ selectedChatId: id, sidebarOpen: false }),
    resetSelection: () =>
        set({
            selectedCharacterId: null,
            selectedGroupId: null,
            selectedChatId: null,
            libraryTab: 'characters',
        }),
    setLibraryTab: (tab) => set({ libraryTab: tab }),
    setSettingsOpen: (open) => set({ settingsOpen: open, ...(open ? {} : { settingsSection: null }) }),
    openSettings: (section) => set({ settingsOpen: true, settingsSection: section ?? null }),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),

    pushToast: (message, tone = 'info', title) => {
        const id = crypto.randomUUID();
        set((state) => ({
            toasts: [...state.toasts, { id, message, tone, ...(title ? { title } : {}) }],
        }));
        window.setTimeout(() => get().dismissToast(id), 4500);
    },

    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
