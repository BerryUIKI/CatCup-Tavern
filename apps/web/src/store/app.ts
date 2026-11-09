import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'error';

export interface ToastItem {
    id: string;
    message: string;
    tone: ToastTone;
}

interface AppState {
    selectedCharacterId: string | null;
    selectedChatId: string | null;
    settingsOpen: boolean;
    sidebarOpen: boolean;
    toasts: ToastItem[];
    selectCharacter: (id: string | null) => void;
    selectChat: (id: string | null) => void;
    setSettingsOpen: (open: boolean) => void;
    setSidebarOpen: (open: boolean) => void;
    pushToast: (message: string, tone?: ToastTone) => void;
    dismissToast: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
    selectedCharacterId: null,
    selectedChatId: null,
    settingsOpen: false,
    sidebarOpen: false,
    toasts: [],

    selectCharacter: (id) => set({ selectedCharacterId: id, selectedChatId: null, sidebarOpen: false }),
    selectChat: (id) => set({ selectedChatId: id, sidebarOpen: false }),
    setSettingsOpen: (open) => set({ settingsOpen: open }),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),

    pushToast: (message, tone = 'info') => {
        const id = crypto.randomUUID();
        set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
        window.setTimeout(() => get().dismissToast(id), 4500);
    },

    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
