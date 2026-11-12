import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export type LibraryTab = 'characters' | 'groups';

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
    sidebarOpen: boolean;
    toasts: ToastItem[];
    selectCharacter: (id: string | null) => void;
    selectGroup: (id: string | null) => void;
    selectChat: (id: string | null) => void;
    setLibraryTab: (tab: LibraryTab) => void;
    setSettingsOpen: (open: boolean) => void;
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
    setLibraryTab: (tab) => set({ libraryTab: tab }),
    setSettingsOpen: (open) => set({ settingsOpen: open }),
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
