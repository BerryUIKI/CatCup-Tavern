import { useConfirmStore } from '../store/confirm';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * The single place the app's confirmations are drawn.
 *
 * Mounted once, beside the toast viewport. Every `confirm({...})` call resolves
 * through here, so a destructive action looks the same whether it was started
 * from a menu, a settings panel or a keydown — and a skin can reach it.
 */
export function ConfirmHost() {
    const pending = useConfirmStore((state) => state.pending);
    const settle = useConfirmStore((state) => state.settle);
    const current = pending[0];

    if (!current) {
        return null;
    }

    return (
        <ConfirmDialog
            key={current.id}
            open
            title={current.title}
            description={current.description}
            confirmLabel={current.confirmLabel}
            cancelLabel={current.cancelLabel}
            tone={current.tone}
            initialFocus={current.initialFocus}
            onConfirm={() => settle(current.id, true)}
            onCancel={() => settle(current.id, false)}
        />
    );
}
