import type { TelegramScanView } from '@catcup/shared';
import { FileUp, MessageSquare } from 'lucide-react';
import { useRef, useState } from 'react';

import { useCharacters } from '../hooks/data';
import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { Select } from './Select';
import { Spinner } from './Spinner';

/**
 * Turn a Telegram Desktop chat export into a CatCup chat.
 *
 * Two steps, and the second one exists because of the only decision that cannot
 * be automated: **which participant is you**. Getting it wrong reverses every
 * "I" in the story and is invisible until someone reads the import back, so the
 * scan shows who spoke and how often, and the person picks.
 *
 * The file is read in the browser and sent as text. A Telegram export is a
 * single JSON file the user already has — no bot, no token, no network call to
 * Telegram.
 */
export function TelegramImport() {
    const fileRef = useRef<HTMLInputElement>(null);
    const [raw, setRaw] = useState<string | null>(null);
    const [fileName, setFileName] = useState('');
    const [scan, setScan] = useState<TelegramScanView | null>(null);
    const [owner, setOwner] = useState('');
    const [characterId, setCharacterId] = useState('');
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState<{ chatId: string; imported: number } | null>(null);

    const characters = useCharacters().data ?? [];
    const pushToast = useAppStore((state) => state.pushToast);

    const reset = () => {
        setRaw(null);
        setScan(null);
        setOwner('');
        setDone(null);
    };

    const describe = (error: unknown) => (error instanceof Error ? error.message : 'The import failed');

    const pick = async (file: File | undefined) => {
        if (!file) {
            return;
        }
        setBusy(true);
        setDone(null);
        try {
            const text = await file.text();
            const data = await api.scanTelegramExport(text);
            setRaw(text);
            setFileName(file.name);
            setScan(data.scan);
            // The likeliest owner is the participant who spoke most, but it is
            // only a preselection — the picker is what decides.
            setOwner(data.scan.participants[0]?.name ?? '');
        } catch (error) {
            pushToast(describe(error), 'error');
            reset();
        } finally {
            setBusy(false);
        }
    };

    const run = async () => {
        if (!raw || !owner || !characterId) {
            return;
        }
        setBusy(true);
        try {
            const result = await api.importTelegramExport(raw, characterId, owner);
            setDone({ chatId: result.chat.chatId, imported: result.imported });
            pushToast(`Imported ${result.imported} messages.`, 'success');
        } catch (error) {
            pushToast(describe(error), 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
            <div>
                <p className="flex items-center gap-2 text-sm text-parchment">
                    <MessageSquare className="size-4 text-muted" />
                    From a Telegram chat
                </p>
                <p className="mt-1 text-footnote leading-relaxed text-muted">
                    Export the conversation in Telegram Desktop — Settings → Advanced → Export chat history, and choose{' '}
                    <span className="font-mono">JSON</span> — then choose that file. Nothing is sent to Telegram; this
                    reads a file you already have.
                </p>
            </div>

            {!scan ? (
                <>
                    <button
                        className="btn-ghost"
                        disabled={busy}
                        onClick={() => fileRef.current?.click()}
                        type="button"
                    >
                        {busy ? <Spinner size={15} /> : <FileUp size={15} />}
                        {busy ? 'Reading…' : 'Choose an export'}
                    </button>
                    <input
                        accept=".json,application/json"
                        className="hidden"
                        onChange={(event) => void pick(event.target.files?.[0])}
                        ref={fileRef}
                        type="file"
                    />
                </>
            ) : null}

            {scan && !done ? (
                <div className="space-y-3">
                    <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                        {(
                            [
                                ['Messages', scan.messages],
                                ['From', scan.range.from?.slice(0, 10) ?? '—'],
                                ['To', scan.range.to?.slice(0, 10) ?? '—'],
                                ['Dropped', scan.skipped.service + scan.skipped.empty],
                            ] as const
                        ).map(([label, value]) => (
                            <div key={label} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-2">
                                <dt className="text-caption uppercase tracking-[0.14em] text-muted">{label}</dt>
                                <dd className="tabular-nums text-parchment">{value}</dd>
                            </div>
                        ))}
                    </dl>

                    <p className="text-footnote leading-relaxed text-muted">
                        {fileName}
                        {scan.title ? ` · “${scan.title}”` : ''}. Service rows, joins and empty messages are not
                        imported.
                    </p>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                            <Select<string>
                                id="telegram-owner"
                                label="Which participant is you?"
                                value={owner}
                                onChange={setOwner}
                                options={scan.participants.map((participant) => ({
                                    value: participant.name,
                                    label: `${participant.name} — ${participant.count} message${participant.count === 1 ? '' : 's'}`,
                                }))}
                            />
                            <p className="field-hint">
                                Every other participant becomes the character. This decides which messages are yours, so
                                a wrong pick reverses the whole conversation.
                            </p>
                        </div>
                        <div>
                            <Select<string>
                                id="telegram-character"
                                label="Import as a chat with"
                                value={characterId}
                                onChange={setCharacterId}
                                options={[
                                    { value: '', label: 'Choose a character' },
                                    ...characters.map((character) => ({ value: character.id, label: character.name })),
                                ]}
                            />
                            <p className="field-hint">The chat is written to this character's chat list.</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            className="btn-primary"
                            disabled={busy || !owner || !characterId}
                            onClick={() => void run()}
                            type="button"
                        >
                            {busy ? <Spinner size={15} /> : null}
                            Import
                        </button>
                        <button className="btn-ghost" disabled={busy} onClick={reset} type="button">
                            Choose another file
                        </button>
                    </div>
                </div>
            ) : null}

            {done ? (
                <div className="space-y-2 rounded-lg border border-sage/40 bg-sage/10 px-3 py-2">
                    <p className="text-sm text-parchment">
                        Imported {done.imported} messages into “{done.chatId}”.
                    </p>
                    <button className="btn-ghost py-1 text-xs" onClick={reset} type="button">
                        Import another
                    </button>
                </div>
            ) : null}
        </section>
    );
}
