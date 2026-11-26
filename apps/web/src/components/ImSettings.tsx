import type { ImStatusView } from '@catcup/shared';
import { MessageCircle, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSettings } from '../hooks/data';
import { api } from '../lib/api';
import { type RegisterSettingsDraft, useSettingsDraft, useSettingsDraftHandle } from '../lib/settingsDraft';
import { useAppStore } from '../store/app';
import { Spinner } from './Spinner';

/**
 * The bot's settings.
 *
 * Three things here and no more: the token, who may talk to it, and whether it
 * says anything when a reply finishes. Everything else about the bot is a
 * command sent inside Telegram, because that is where a person is when they
 * want to change what it is talking to.
 *
 * The token field is write-only. It is stored in `data/secrets.json` and no
 * endpoint returns it, so the form shows whether one exists rather than what it
 * is — which is the same contract the provider key field keeps.
 */
export function ImSettings({ registerDraft }: { registerDraft?: RegisterSettingsDraft }) {
    const settings = useSettings().data;
    const pushToast = useAppStore((state) => state.pushToast);

    const [status, setStatus] = useState<ImStatusView | null>(null);
    const [token, setToken] = useState('');
    const [busy, setBusy] = useState(false);
    const {
        draft: form,
        dirty,
        update: set,
        discard,
        markSaved,
    } = useSettingsDraft(settings?.im ?? null, () => ({
        enabled: false,
        ownerId: '',
        notifyOnReply: false,
    }));

    useEffect(() => {
        void api
            .imStatus()
            .then((data) => setStatus(data.status))
            .catch(() => setStatus(null));
    }, []);

    const save = async (): Promise<boolean> => {
        setBusy(true);
        try {
            // The token first: turning the bot on with no token would start
            // nothing and look like a broken switch.
            if (token) {
                await api.setImToken(token);
                setToken('');
            }
            const result = await api.updateImSettings(form);
            setStatus(result.status);
            markSaved();
            pushToast('Bot settings saved.', 'success');
            return true;
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not save the bot settings.', 'error');
            return false;
        } finally {
            setBusy(false);
        }
    };

    useSettingsDraftHandle(registerDraft, {
        isDirty: () => dirty || token.length > 0,
        save,
        discard: () => {
            discard();
            setToken('');
        },
    });

    const clearToken = async () => {
        setBusy(true);
        try {
            const result = await api.setImToken('');
            setStatus(result.status);
            pushToast('Bot token removed.', 'success');
        } catch (error) {
            pushToast(error instanceof Error ? error.message : 'Could not remove the token.', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-5 p-5">
            <p className="flex items-center gap-2 text-sm text-parchment">
                <MessageCircle className="size-4 text-muted" />
                Talk to a character from Telegram
            </p>
            <p className="text-footnote leading-relaxed text-muted">
                The bot polls Telegram directly — no public address, no webhook, nothing exposed to the network. Only
                the one user id below can reach it; every other message is ignored without a reply. Message text and
                replies <strong className="text-parchment-dim">do travel through Telegram</strong> when this is on. See
                the security page.
            </p>
            <p className="text-footnote leading-relaxed text-muted">
                The owner id is also where notifications go — a private chat with the bot, which works before you have
                ever messaged it. Leave it empty and there is nowhere to send them.
            </p>

            <div>
                <label className="label-text" htmlFor="im-token">
                    Bot token
                </label>
                <div className="flex gap-2">
                    <input
                        id="im-token"
                        className="input-shell font-mono text-xs"
                        placeholder={status?.hasToken ? 'A token is stored — type to replace it' : '123456:ABC-DEF…'}
                        type="password"
                        value={token}
                        onChange={(event) => setToken(event.target.value)}
                    />
                    {status?.hasToken ? (
                        <button
                            className="btn-ghost shrink-0"
                            disabled={busy}
                            onClick={() => void clearToken()}
                            type="button"
                        >
                            Remove
                        </button>
                    ) : null}
                </div>
                <p className="field-hint">From @BotFather in Telegram. Stored on the server, never shown again.</p>
            </div>

            <div>
                <label className="label-text" htmlFor="im-owner">
                    Your Telegram user id
                </label>
                <input
                    id="im-owner"
                    className="input-shell font-mono text-xs"
                    placeholder="99999999"
                    value={form.ownerId}
                    onChange={(event) => set('ownerId', event.target.value)}
                />
                <p className="field-hint">
                    The only account allowed to talk to the bot. Leave it empty to allow nobody — which is not the same
                    as allowing everyone.
                </p>
            </div>

            <label className="flex items-start gap-2 text-sm text-parchment-dim">
                <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-amber"
                    checked={form.enabled}
                    onChange={(event) => set('enabled', event.target.checked)}
                />
                <span>
                    Receive messages
                    <span className="mt-0.5 block text-footnote text-muted">
                        Starts polling when saved, and again on the next start.
                    </span>
                </span>
            </label>

            <label className="flex items-start gap-2 text-sm text-parchment-dim">
                <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0 accent-amber"
                    checked={form.notifyOnReply}
                    onChange={(event) => set('notifyOnReply', event.target.checked)}
                />
                <span>
                    Tell me when a reply finishes
                    <span className="mt-0.5 block text-footnote text-muted">
                        Only for a reply you were not watching. Works with receiving off above — a notification needs
                        the token, not the poll loop.
                    </span>
                </span>
            </label>

            {status ? (
                <div className="rounded-lg border border-line-soft bg-surface/60 px-3 py-2 text-xs">
                    <p className="text-parchment-dim">
                        {status.running ? 'Polling now.' : 'Not polling.'}
                        {status.bot ? ` Connected to @${status.bot.username}.` : ''}
                    </p>
                    {status.error ? <p className="mt-1 text-danger">{status.error}</p> : null}
                </div>
            ) : null}

            <div className="flex items-center justify-end gap-3">
                <p className="text-footnote text-muted">{dirty || token.length > 0 ? 'Unsaved changes.' : 'Saved.'}</p>
                <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || !(dirty || token.length > 0)}
                    onClick={() => void save()}
                >
                    {busy ? <Spinner size={15} /> : <Save size={15} />}
                    Save
                </button>
            </div>
        </div>
    );
}
