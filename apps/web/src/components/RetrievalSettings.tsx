import type { WorldInfoConfig } from '@catcup/shared';
import { useEffect, useId, useState } from 'react';

/**
 * The world info retrieval controls, in the World Info settings panel.
 *
 * A collapsible group rather than a third block of always-visible rows: the
 * lexical pass is off for most people, and a panel that always shows three
 * knobs for a disabled feature is noise. The group opens itself when the pass
 * is already on, so someone who uses it never has to re-open it — the same
 * shape the persona editor's **Voice** section uses.
 *
 * The three controls are deliberately not equal in weight:
 *
 * - **Match by meaning** is the decision, and it is a checkbox because it is a
 *   boolean.
 * - **Entries per turn** is the primary tuning control. It is a hard cap on
 *   what the pass may add, so every step of the slider has a visible effect.
 * - **Trim weak matches** is the secondary control, and its label describes
 *   what the number *does* rather than naming the underlying BM25 score. The
 *   value is a fraction of this turn's best hit, not a score of its own: the
 *   best hit is always kept, whatever the setting, so this only ever trims the
 *   tail behind it. Calling it "strictness" would promise something the code
 *   does not do.
 */

interface RetrievalSettingsProps {
    config: WorldInfoConfig;
    /** Called on commit — the end of a drag or a clicking of the box. */
    onChange: (patch: Partial<WorldInfoConfig>) => void;
    /** True while a save is in flight, so the controls can show it without blocking. */
    busy: boolean;
}

export function RetrievalSettings({ config, onChange, busy }: RetrievalSettingsProps) {
    const toggleId = useId();
    const limitId = useId();
    const trimId = useId();

    return (
        <details className="rounded-xl border border-line-soft bg-surface/40 px-3 py-2" open={config.lexicalMatch}>
            <summary className="cursor-pointer select-none text-xs text-parchment-dim">Retrieval</summary>

            <div className="mt-3 space-y-4">
                <div>
                    <label className="flex cursor-pointer items-start gap-2" htmlFor={toggleId}>
                        <input
                            id={toggleId}
                            type="checkbox"
                            className="mt-0.5 accent-amber"
                            checked={config.lexicalMatch}
                            disabled={busy}
                            onChange={(event) => onChange({ lexicalMatch: event.target.checked })}
                        />
                        <span className="text-sm leading-snug text-parchment">Match by meaning, not only keywords</span>
                    </label>
                    <p className="mt-1 pl-6 text-footnote leading-relaxed text-muted">
                        Adds entries whose keywords the chat never used but whose text is on the same subject. It only
                        ever adds — nothing a keyword matched is removed.
                    </p>
                </div>

                <div className={config.lexicalMatch ? undefined : 'opacity-50'}>
                    <RangeField
                        id={limitId}
                        label="Entries per turn"
                        value={config.lexicalLimit}
                        min={1}
                        max={50}
                        step={1}
                        format={(value) => String(value)}
                        hint="How many extra entries one turn may add, on top of the ones the keywords found."
                        disabled={!config.lexicalMatch || busy}
                        onCommit={(value) => onChange({ lexicalLimit: value })}
                    />

                    <RangeField
                        id={trimId}
                        label="Trim weak matches"
                        value={Math.round(config.lexicalThreshold * 100)}
                        min={0}
                        max={100}
                        step={5}
                        format={(value) => `${value}%`}
                        hint="Keeps matches scoring within this much of this turn's best hit. Higher is more selective, but even at 100% the best hit is still added — use the checkbox above to turn the pass off."
                        disabled={!config.lexicalMatch || busy}
                        onCommit={(value) => onChange({ lexicalThreshold: value / 100 })}
                    />
                </div>
            </div>
        </details>
    );
}

/**
 * A range input that reports its value when the change settles.
 *
 * Dragging across a slider fires an `input` event per pixel, and each of those
 * would be a settings write. The thumb therefore tracks local state while the
 * drag is live, and the value is committed on `pointerup`, `blur` or a
 * discrete keypress — one write per gesture.
 *
 * Keyboard use commits per press deliberately: an arrow key is a deliberate
 * step, and a screen-reader or keyboard user has no pointer to release.
 */
function RangeField({
    id,
    label,
    value,
    min,
    max,
    step,
    format,
    hint,
    disabled,
    onCommit,
}: {
    id: string;
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format: (value: number) => string;
    hint: string;
    disabled: boolean;
    onCommit: (value: number) => void;
}) {
    const hintId = `${id}-hint`;
    const [live, setLive] = useState(value);

    // A save from elsewhere (another tab, a profile switch) wins once the user
    // is no longer dragging.
    useEffect(() => setLive(value), [value]);

    const commit = (next: number): void => {
        setLive(next);
        if (next !== value) {
            onCommit(next);
        }
    };

    return (
        <div className="mt-4 first:mt-0">
            <div className="flex items-center justify-between gap-3">
                <label className="label-text mb-0" htmlFor={id}>
                    {label}
                </label>
                <span className="text-xs tabular-nums text-parchment-dim">{format(live)}</span>
            </div>
            <input
                id={id}
                type="range"
                min={min}
                max={max}
                step={step}
                value={live}
                disabled={disabled}
                aria-describedby={hintId}
                className="mt-2 w-full accent-amber disabled:cursor-not-allowed"
                onChange={(event) => setLive(Number(event.currentTarget.value))}
                onPointerUp={(event) => commit(Number(event.currentTarget.value))}
                onBlur={(event) => commit(Number(event.currentTarget.value))}
            />
            <p id={hintId} className="mt-1 text-footnote leading-relaxed text-muted">
                {hint}
            </p>
        </div>
    );
}
