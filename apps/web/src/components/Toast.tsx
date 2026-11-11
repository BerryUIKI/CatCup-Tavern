import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

import { cn } from '../lib/cn';
import { type ToastTone, useAppStore } from '../store/app';

const TONE_STYLES: Record<ToastTone, string> = {
    info: 'border-line bg-surface text-parchment',
    success: 'border-sage/40 bg-sage/10 text-parchment',
    error: 'border-wine/60 bg-wine/15 text-parchment',
};

const TONE_ICONS: Record<ToastTone, typeof Info> = {
    info: Info,
    success: CheckCircle2,
    error: AlertTriangle,
};

export function ToastViewport() {
    const toasts = useAppStore((state) => state.toasts);
    const dismiss = useAppStore((state) => state.dismissToast);

    if (toasts.length === 0) {
        return null;
    }

    return (
        <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2">
            {toasts.map((toast) => {
                const Icon = TONE_ICONS[toast.tone];
                return (
                    <div
                        key={toast.id}
                        className={cn(
                            'animate-fade-up pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl shadow-black/40',
                            TONE_STYLES[toast.tone],
                        )}
                        role="status"
                    >
                        <Icon
                            size={17}
                            className={cn(
                                'mt-0.5 shrink-0',
                                toast.tone === 'success'
                                    ? 'text-sage'
                                    : toast.tone === 'error'
                                      ? 'text-amber'
                                      : 'text-muted',
                            )}
                        />
                        <span className="min-w-0 flex-1 leading-relaxed">{toast.message}</span>
                        <button
                            type="button"
                            className="shrink-0 rounded p-0.5 text-muted transition hover:text-parchment"
                            onClick={() => dismiss(toast.id)}
                            aria-label="Dismiss notification"
                        >
                            <X size={14} />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}
