import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * What a settings panel tells the dialog about the edits it is holding.
 *
 * A panel that saves with a button registers one of these. The dialog asks it
 * before it moves to another section or closes, so an unsaved form is never
 * thrown away without the person being asked. The three methods are the ones
 * `ProviderSettingsHandle` already had — that panel solved this first.
 */
export interface SettingsDraftHandle {
    isDirty(): boolean;
    /** Persist the form. Resolves false when validation or the request fails. */
    save(): Promise<boolean>;
    /** Throw the local edits away and show the saved values again. */
    discard(): void;
}

/**
 * Passed to every panel by `SettingsDialog`. It returns its own unregister
 * function, so the cleanup cannot remove a handle another panel registered
 * after this one mounted.
 */
export type RegisterSettingsDraft = (handle: SettingsDraftHandle) => () => void;

export interface SettingsDraft<Value> {
    /** What the form currently shows. */
    draft: Value;
    /** Whether `draft` differs from the last saved value. */
    dirty: boolean;
    /** Replace the draft, under the same rules `update` applies. */
    setDraft: (next: Value | ((current: Value) => Value)) => void;
    /** Apply one field of the draft. */
    update: <Key extends keyof Value>(key: Key, value: Value[Key]) => void;
    /** Return to the saved values, dropping every local edit. */
    discard: () => void;
    /** Call after a successful save so the new values become the baseline. */
    markSaved: () => void;
}

/**
 * Are these two settings values the same?
 *
 * Every value this hook holds is plain JSON — no dates, no class instances, no
 * cycles — so a serialise-and-compare is a correct deep equality here. Key order
 * is stable because both sides come from the same schema parse.
 */
export function sameDraftValues<Value>(left: Value, right: Value): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * A form over a saved value, with a dirty flag the settings dialog can trust.
 *
 * Panels used to keep an `editedRef` and a copy of the saved value that lived
 * only inside a closure, which is why the dialog could not ask them anything
 * and why switching sections silently destroyed the edits. Keeping the saved
 * value as a baseline makes `dirty` a comparison rather than a guess.
 *
 * A value that arrives from a refetch replaces the draft only while the form is
 * untouched — once someone has typed, their draft wins until they save or
 * discard. That is the rule `MemorySettings` and `ImageSettings` each wrote by
 * hand with `editedRef`; it lives here once instead.
 */
export function useSettingsDraft<Value>(baseline: Value | null, empty: () => Value): SettingsDraft<Value> {
    const emptyRef = useRef(empty);
    emptyRef.current = empty;

    const [draft, setDraftState] = useState<Value>(() => baseline ?? empty());
    const [saved, setSaved] = useState<Value | null>(baseline);
    const draftRef = useRef(draft);
    const savedRef = useRef<Value | null>(baseline);

    const show = useCallback((value: Value) => {
        draftRef.current = value;
        setDraftState(value);
    }, []);

    // Adopt a value saved elsewhere — another tab, or a section that rewrites
    // this one — but never over an edit in progress.
    useEffect(() => {
        if (baseline === null) {
            return;
        }
        const current = savedRef.current;
        const untouched = current === null || sameDraftValues(draftRef.current, current);
        savedRef.current = baseline;
        setSaved(baseline);
        if (untouched) {
            show(baseline);
        }
    }, [baseline, show]);

    const dirty = saved === null ? false : !sameDraftValues(draft, saved);

    const setDraft = useCallback(
        (next: Value | ((current: Value) => Value)) => {
            const value = typeof next === 'function' ? (next as (current: Value) => Value)(draftRef.current) : next;
            show(value);
        },
        [show],
    );

    const update = useCallback(
        <Key extends keyof Value>(key: Key, value: Value[Key]) => {
            show({ ...draftRef.current, [key]: value });
        },
        [show],
    );

    const discard = useCallback(() => {
        const value = savedRef.current ?? emptyRef.current();
        show(value);
    }, [show]);

    const markSaved = useCallback(() => {
        savedRef.current = draftRef.current;
        setDraftState((current) => {
            setSaved(current);
            return current;
        });
    }, []);

    return { draft, dirty, setDraft, update, discard, markSaved };
}

/**
 * Register a panel's draft with the dialog that hosts it.
 *
 * `save` and `discard` are read through a ref, so a panel can pass fresh
 * closures every render without re-registering — and the dialog never calls a
 * stale one, which is what happens when a handle is captured once on mount.
 */
export function useSettingsDraftHandle(register: RegisterSettingsDraft | undefined, handle: SettingsDraftHandle) {
    const latest = useRef(handle);
    latest.current = handle;

    const stable = useRef<SettingsDraftHandle>({
        isDirty: () => latest.current.isDirty(),
        save: () => latest.current.save(),
        discard: () => latest.current.discard(),
    });

    useEffect(() => {
        if (!register) {
            return undefined;
        }
        return register(stable.current);
    }, [register]);
}
