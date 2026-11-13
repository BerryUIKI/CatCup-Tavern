import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { queryKeys, useSetPassword } from '../hooks/data';
import { api } from '../lib/api';
import { Spinner } from './Spinner';

const WORKS = [
    'Import SillyTavern cards (PNG V2/V3, JSON), chats, lorebooks and OpenAI presets — or point at a whole SillyTavern folder and copy everything at once.',
    'Chat with streaming replies, swipes, regenerate, continue, inline editing, branching and alternate greetings.',
    'Group chats with their own greetings, per-member avatars and natural, list, manual or pooled reply order.',
    'Summary memory: a rolling summary stored in the chat file, with automatic updates, an editable Memory panel and configurable prompt injection.',
    'Quick Replies (subset): SillyTavern quick reply sets with a button bar, import and export, and the /send, /sys, /echo, /trigger, /continue, /regenerate and /run commands.',
    'Text to speech: browser voices or an OpenAI-compatible /audio/speech endpoint, with per-character voices, a narrator voice, autoplay and a play button on every reply.',
    'Image generation through Automatic1111/Forge, a ComfyUI API workflow or an OpenAI-compatible /images/generations endpoint, with per-character and per-group galleries and images inserted into the chat as SillyTavern media messages.',
    'Lorebooks with SillyTavern’s full scan pipeline, and an editor for every entry field.',
    'OpenAI presets: import, activate, and change prompt order and injection positions.',
    'Regex scripts with import and export, applied to input, output, reasoning and lorebook content.',
    'Several personas, with one default and a per-chat choice.',
    'Edit character cards and export them back to PNG or JSON, or as a CharX package with its assets.',
    'A character library with tags, favorites, tag and favorite filters, five sort orders, and bulk favorite, tag and delete actions.',
    'Windows desktop app that installs without an administrator and carries its own runtime.',
];

const DOES_NOT_WORK = [
    'STscript, the full Quick Replies engine (auto-execution, context menus, per-character sets) and typed slash commands.',
    'SillyTavern extensions — none of them load.',
    'Vector/embedding memory for long chats; the rolling summary is the only long-term memory.',
    'Group chats answer one member per turn with that member’s own card; SillyTavern’s append modes, automatic turns and multi-member reply batches are not implemented.',
    'Regex scripts are global only: SillyTavern’s per-character and per-preset scopes are not implemented.',
    'Personas have a name and a description only — no avatars and no per-persona injection settings.',
    'Phone-sized layouts and translated interfaces.',
    'Automatic updates and signed installers.',
];

/**
 * What this build does and does not do.
 *
 * Kept short on purpose: the full list lives in `docs/LIMITATIONS.md`, and a
 * user-facing claim that drifts from the code is worse than a short one.
 */
export function AboutTab() {
    const health = useQuery({ queryKey: ['health'], queryFn: api.health, staleTime: Number.POSITIVE_INFINITY });

    return (
        <div className="space-y-5 p-5">
            <div>
                <h3 className="font-display text-lg text-parchment">CatCup Tavern</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">
                    A local-first roleplay client that reads and writes SillyTavern’s files. This is early-access
                    software: it does what is listed on the left well, and it does not pretend to do the rest.
                </p>
                <p className="mt-2 text-xs text-muted/80">
                    Version{' '}
                    {health.isLoading ? (
                        <Spinner size={11} className="inline text-muted" />
                    ) : (
                        (health.data?.version ?? 'unknown')
                    )}{' '}
                    · AGPL-3.0
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-sage/30 bg-sage/5 p-4">
                    <h4 className="mb-2 text-sm font-medium text-parchment">What works</h4>
                    <ul className="list-inside list-disc space-y-1.5 text-xs leading-relaxed text-parchment-dim">
                        {WORKS.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>

                <div className="rounded-xl border border-wine/30 bg-wine/5 p-4">
                    <h4 className="mb-2 text-sm font-medium text-parchment">What does not work yet</h4>
                    <ul className="list-inside list-disc space-y-1.5 text-xs leading-relaxed text-parchment-dim">
                        {DOES_NOT_WORK.map((item) => (
                            <li key={item}>{item}</li>
                        ))}
                    </ul>
                </div>
            </div>

            <p className="text-[11px] leading-relaxed text-muted/70">
                Your data stays in the server’s data folder: cards, chats, lorebooks, presets and regex scripts are
                plain SillyTavern-format files you can copy out at any time. API keys never leave the server.
            </p>

            <PasswordPanel />
        </div>
    );
}

/**
 * The access password panel.
 *
 * It has two shapes. In a desktop open session it sets a first password; on any
 * install that already has one — web, LAN, or a desktop that opted in — it
 * changes it. Only the desktop may remove a password, so there is no remove
 * button here: doing so on a LAN install would leave the server reachable and
 * signed out.
 */
function PasswordPanel() {
    const auth = useQuery({
        queryKey: queryKeys.auth,
        queryFn: api.auth.status,
        staleTime: Number.POSITIVE_INFINITY,
    });
    const passwordMutation = useSetPassword();
    const [current, setCurrent] = useState('');
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

    if (!auth.data) {
        return null;
    }

    const openSession = auth.data.openSession;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setMessage(null);
        if (password !== confirm) {
            setMessage({ kind: 'error', text: 'The two passwords do not match.' });
            return;
        }
        try {
            await passwordMutation.mutateAsync({ password, ...(openSession ? {} : { currentPassword: current }) });
            setCurrent('');
            setPassword('');
            setConfirm('');
            setMessage({
                kind: 'ok',
                text: openSession
                    ? 'Password set. The app now asks for it when it starts.'
                    : 'Password changed. Other browsers and devices are signed out.',
            });
        } catch (caught) {
            setMessage({
                kind: 'error',
                text: caught instanceof Error ? caught.message : 'Could not save the password.',
            });
        }
    };

    const canSubmit =
        !passwordMutation.isPending && password !== '' && (openSession || current !== '') && password === confirm;

    return (
        <form className="rounded-xl border border-brass/25 bg-brass/5 p-4" onSubmit={submit}>
            <h4 className="text-sm font-medium text-parchment">Access password</h4>
            <p className="mt-1 text-xs leading-relaxed text-muted">
                {openSession
                    ? 'This desktop app opens without a password, because only you can reach it on this machine. Setting one brings back the sign-in screen.'
                    : 'Changing the password signs out every other browser and device. This one stays signed in.'}
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {openSession ? null : (
                    <input
                        type="password"
                        className="input sm:col-span-2"
                        placeholder="Current password"
                        autoComplete="current-password"
                        value={current}
                        onChange={(event) => setCurrent(event.target.value)}
                    />
                )}
                <input
                    type="password"
                    className="input"
                    placeholder="New password (8+ characters)"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                />
                <input
                    type="password"
                    className="input"
                    placeholder="Repeat the password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(event) => setConfirm(event.target.value)}
                />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="submit" className="btn-secondary" disabled={!canSubmit}>
                    {passwordMutation.isPending ? <Spinner size={14} /> : null}
                    {openSession ? 'Set password' : 'Change password'}
                </button>
            </div>
            {message ? (
                <p
                    className={message.kind === 'ok' ? 'mt-2 text-xs text-sage' : 'mt-2 text-xs text-wine'}
                    role="status"
                >
                    {message.text}
                </p>
            ) : null}
        </form>
    );
}
