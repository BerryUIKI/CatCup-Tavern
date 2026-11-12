import type { ReactNode } from 'react';

interface EmptyStateProps {
    icon: ReactNode;
    title: string;
    description: string;
    action?: ReactNode;
}

/** Centered placeholder used by both the character and group chat panes. */
export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
            <div className="mb-4 flex size-16 items-center justify-center rounded-2xl border border-line bg-surface/60">
                {icon}
            </div>
            <h3 className="font-display text-xl text-parchment">{title}</h3>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
            {action ? <div className="mt-5">{action}</div> : null}
        </div>
    );
}
