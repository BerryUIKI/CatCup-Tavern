import type { DirectorChoice } from '@catcup/shared';
import { choicesOf } from '@catcup/shared';
import { CornerDownRight } from 'lucide-react';

/**
 * The director's options under a reply.
 *
 * Clicking one sends its label as the person's next message — exactly what
 * typing it would do, through the same path. That is deliberate: an option is
 * not a special kind of turn, it is a shortcut for a line the person could have
 * written themselves.
 *
 * The composer stays fully usable while these are showing. They are a
 * convenience and must never be a gate: a person who ignores them and types
 * something else has not broken anything, and a reply with no options is a
 * normal outcome rather than a failure.
 */
export function ChoiceChips({
    choices,
    disabled,
    onChoose,
}: {
    choices: DirectorChoice[];
    disabled?: boolean;
    onChoose: (label: string) => void;
}) {
    if (choices.length === 0) {
        return null;
    }

    return (
        <ul className="mt-2 flex flex-col gap-1.5 border-t border-line-soft pt-2">
            {choices.map((choice) => (
                <li key={choice.id}>
                    <button
                        type="button"
                        className="group flex w-full items-start gap-2 rounded-lg border border-line-soft bg-surface/50 px-2.5 py-1.5 text-left text-xs text-parchment-dim transition hover:border-amber/40 hover:bg-amber/5 hover:text-parchment disabled:opacity-50"
                        disabled={disabled}
                        onClick={() => onChoose(choice.label)}
                        title={choice.detail ?? `Send "${choice.label}"`}
                    >
                        <CornerDownRight size={12} className="mt-0.5 shrink-0 text-muted group-hover:text-amber" />
                        <span>{choice.label}</span>
                    </button>
                </li>
            ))}
        </ul>
    );
}

/** The choices a message carries, for a caller that would otherwise re-parse `extra`. */
export function useChoicesOf(message: { extra?: Record<string, unknown> }) {
    return choicesOf(message)?.options ?? [];
}
