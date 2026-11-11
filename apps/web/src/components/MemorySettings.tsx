import {
    DEFAULT_MEMORY_PROMPT,
    type MemorySettings as MemorySettingsValue,
    memorySettingsSchema,
} from '@catcup/shared';
import { RotateCcw, Save } from 'lucide-react';
import { useState } from 'react';

import { useSettings, useUpdateSettings } from '../hooks/data';
import { useAppStore } from '../store/app';
import { Spinner } from './Spinner';

const POSITIONS = [
    { value: -1, label: 'None (not injected)' },
    { value: 2, label: 'Before the main prompt' },
    { value: 0, label: 'After the main prompt' },
    { value: 1, label: 'In chat at depth' },
];

const ROLES = [
    { value: 0, label: 'System' },
    { value: 1, label: 'User' },
    { value: 2, label: 'Assistant' },
];

/**
 * Summary memory settings, mirroring SillyTavern's Memory extension.
 *
 * The prompt and template are edited as text because they are macro-bearing;
 * the numeric controls are the same knobs the extension exposes.
 */
export function MemorySettings() {
    const settings = useSettings().data;
    const updateSettings = useUpdateSettings();
    const pushToast = useAppStore((state) => state.pushToast);
    const [form, setForm] = useState<MemorySettingsValue>(() => ({
        ...(settings?.memory ?? memorySettingsSchema.parse({})),
    }));

    const set = <Key extends keyof MemorySettingsValue>(key: Key, value: MemorySettingsValue[Key]) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const handleSave = () => {
        updateSettings.mutate(
            { memory: form },
            {
                onSuccess: () => pushToast('Memory settings saved.', 'success'),
                onError: (error) =>
                    pushToast(error instanceof Error ? error.message : 'Could not save memory settings.', 'error'),
            },
        );
    };

    return (
        <div className="space-y-5 p-5">
            <p className="text-sm leading-relaxed text-muted">
                The summary is stored in the chat file on the message it covers, the way SillyTavern&apos;s Memory
                extension stores it. Automatic updates run after a reply when the update interval is reached; you can
                always summarize or edit the summary from the Memory button in a chat.
            </p>

            <label className="flex items-center gap-2 text-sm text-parchment-dim">
                <input
                    type="checkbox"
                    checked={form.enabled}
                    onChange={(event) => set('enabled', event.target.checked)}
                    className="size-4 accent-amber"
                />
                Update the summary automatically after replies
            </label>

            <div>
                <label className="label-text" htmlFor="memory-prompt">
                    Summary prompt
                </label>
                <textarea
                    id="memory-prompt"
                    className="input-shell min-h-32 resize-y font-normal leading-relaxed"
                    value={form.prompt}
                    onChange={(event) => set('prompt', event.target.value)}
                />
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
                    <span>
                        Sent to the model. <code>{'{{words}}'}</code> becomes the target length; other macros expand as
                        usual.
                    </span>
                    <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-[11px]"
                        onClick={() => set('prompt', DEFAULT_MEMORY_PROMPT)}
                    >
                        <RotateCcw size={12} />
                        Default
                    </button>
                </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <label className="label-text" htmlFor="memory-words">
                        Target summary length (words)
                    </label>
                    <input
                        id="memory-words"
                        type="number"
                        min={25}
                        max={1000}
                        className="input-shell"
                        value={form.promptWords}
                        onChange={(event) => set('promptWords', Number(event.target.value))}
                    />
                </div>
                <div>
                    <label className="label-text" htmlFor="memory-interval">
                        Update every N messages
                    </label>
                    <input
                        id="memory-interval"
                        type="number"
                        min={0}
                        max={250}
                        className="input-shell"
                        value={form.promptInterval}
                        onChange={(event) => set('promptInterval', Number(event.target.value))}
                    />
                    <p className="mt-1 text-[11px] text-muted">0 disables the message interval.</p>
                </div>
                <div>
                    <label className="label-text" htmlFor="memory-force-words">
                        Update every N words
                    </label>
                    <input
                        id="memory-force-words"
                        type="number"
                        min={0}
                        max={10000}
                        className="input-shell"
                        value={form.promptForceWords}
                        onChange={(event) => set('promptForceWords', Number(event.target.value))}
                    />
                    <p className="mt-1 text-[11px] text-muted">
                        0 disables the word trigger. Both triggers may be active.
                    </p>
                </div>
                <div>
                    <label className="label-text" htmlFor="memory-max-messages">
                        Messages per summary request
                    </label>
                    <input
                        id="memory-max-messages"
                        type="number"
                        min={0}
                        max={250}
                        className="input-shell"
                        value={form.maxMessages}
                        onChange={(event) => set('maxMessages', Number(event.target.value))}
                    />
                    <p className="mt-1 text-[11px] text-muted">0 sends as much as the context budget allows.</p>
                </div>
            </div>

            <div className="border-t border-line-soft pt-4">
                <div>
                    <label className="label-text" htmlFor="memory-template">
                        Injection template
                    </label>
                    <input
                        id="memory-template"
                        className="input-shell"
                        value={form.template}
                        onChange={(event) => set('template', event.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-muted">
                        <code>{'{{summary}}'}</code> is replaced with the stored summary.
                    </p>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div>
                        <label className="label-text" htmlFor="memory-position">
                            Injection position
                        </label>
                        <select
                            id="memory-position"
                            className="input-shell"
                            value={form.position}
                            onChange={(event) => set('position', Number(event.target.value))}
                        >
                            {POSITIONS.map((position) => (
                                <option key={position.value} value={position.value}>
                                    {position.label}
                                </option>
                            ))}
                        </select>
                    </div>
                    {form.position === 1 ? (
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="label-text" htmlFor="memory-depth">
                                    Depth
                                </label>
                                <input
                                    id="memory-depth"
                                    type="number"
                                    min={0}
                                    max={10000}
                                    className="input-shell"
                                    value={form.depth}
                                    onChange={(event) => set('depth', Number(event.target.value))}
                                />
                            </div>
                            <div>
                                <label className="label-text" htmlFor="memory-role">
                                    Role
                                </label>
                                <select
                                    id="memory-role"
                                    className="input-shell"
                                    value={form.role}
                                    onChange={(event) => set('role', Number(event.target.value))}
                                >
                                    {ROLES.map((role) => (
                                        <option key={role.value} value={role.value}>
                                            {role.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    ) : null}
                </div>

                <label className="mt-4 flex items-center gap-2 text-sm text-parchment-dim">
                    <input
                        type="checkbox"
                        checked={form.scan}
                        onChange={(event) => set('scan', event.target.checked)}
                        className="size-4 accent-amber"
                    />
                    Include the summary in World Info scanning
                </label>
            </div>

            <div className="flex justify-end">
                <button type="button" className="btn-primary" onClick={handleSave} disabled={updateSettings.isPending}>
                    {updateSettings.isPending ? <Spinner size={15} /> : <Save size={15} />}
                    Save memory settings
                </button>
            </div>
        </div>
    );
}
