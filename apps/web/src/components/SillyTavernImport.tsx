import type { SillyTavernImportPlan, SillyTavernImportResult } from '@catcup/shared';
import { useQueryClient } from '@tanstack/react-query';
import { FolderInput, Import } from 'lucide-react';
import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import { useAppStore } from '../store/app';
import { Modal } from './Modal';
import { Spinner } from './Spinner';

function Counts({ counts }: { counts: { characters: number; chats: number; worlds: number; presets: number } }) {
    return (
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {(
                [
                    ['Characters', counts.characters],
                    ['Chats', counts.chats],
                    ['World info', counts.worlds],
                    ['Presets', counts.presets],
                ] as const
            ).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-line-soft bg-surface/60 px-3 py-2">
                    <dt className="text-[10px] uppercase tracking-[0.14em] text-muted/70">{label}</dt>
                    <dd className="tabular-nums text-parchment">{value}</dd>
                </div>
            ))}
        </dl>
    );
}

/**
 * Copy an existing SillyTavern installation in one go.
 *
 * The server does the reading, so the path is a path on the machine running
 * CatCup. A scan comes first: nothing is written until the user has seen what
 * was found.
 */
export function SillyTavernImport({ open, onClose }: { open: boolean; onClose: () => void }) {
    const [path, setPath] = useState('');
    const [plan, setPlan] = useState<SillyTavernImportPlan | null>(null);
    const [result, setResult] = useState<SillyTavernImportResult | null>(null);
    const [busy, setBusy] = useState(false);
    const queryClient = useQueryClient();
    const pushToast = useAppStore((state) => state.pushToast);

    useEffect(() => {
        if (!open) {
            setPath('');
            setPlan(null);
            setResult(null);
            setBusy(false);
        }
    }, [open]);

    const describe = (error: unknown) => (error instanceof Error ? error.message : 'Import failed');

    const scan = async () => {
        if (!path.trim()) {
            return;
        }
        setBusy(true);
        try {
            const data = await api.importFromSillyTavern(path.trim(), true);
            if ('plan' in data) {
                setPlan(data.plan);
                setResult(null);
            }
        } catch (error) {
            pushToast(describe(error), 'error');
        } finally {
            setBusy(false);
        }
    };

    const run = async () => {
        setBusy(true);
        try {
            const data = await api.importFromSillyTavern(path.trim(), false);
            if ('result' in data) {
                setResult(data.result);
                setPlan(null);
                void queryClient.invalidateQueries({ queryKey: ['characters'] });
                void queryClient.invalidateQueries({ queryKey: ['worlds'] });
                void queryClient.invalidateQueries({ queryKey: ['presets'] });
                pushToast(
                    `Imported ${data.result.imported.characters} characters and ${data.result.imported.chats} chats.`,
                    'success',
                );
            }
        } catch (error) {
            pushToast(describe(error), 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <Modal open={open} onClose={onClose} title="Import from SillyTavern" widthClassName="max-w-2xl">
            <div className="space-y-4 p-5">
                <p className="text-sm leading-relaxed text-muted">
                    Point at the SillyTavern user folder — the one that holds{' '}
                    <code className="text-parchment-dim">characters</code>,{' '}
                    <code className="text-parchment-dim">chats</code> and{' '}
                    <code className="text-parchment-dim">worlds</code>. Nothing is copied until you confirm the scan.
                </p>

                <div>
                    <label className="label-text" htmlFor="st-path">
                        SillyTavern data folder
                    </label>
                    <div className="flex gap-2">
                        <input
                            id="st-path"
                            className="input-shell font-mono text-xs"
                            placeholder="C:\SillyTavern\data\default-user"
                            value={path}
                            onChange={(event) => setPath(event.target.value)}
                        />
                        <button
                            type="button"
                            className="btn-ghost shrink-0"
                            onClick={() => void scan()}
                            disabled={busy || !path.trim()}
                        >
                            {busy && !plan ? <Spinner size={15} /> : <FolderInput size={15} />}
                            Scan
                        </button>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted/70">
                        Group chats, backgrounds, themes and SillyTavern&apos;s own settings are not imported.
                    </p>
                </div>

                {plan ? (
                    <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
                        <Counts counts={plan} />
                        <p className="text-[11px] leading-relaxed text-muted">
                            From {plan.sources.length} folder{plan.sources.length === 1 ? '' : 's'}
                            {plan.sources.length > 0 ? `: ${plan.sources.join(', ')}` : ''}
                        </p>
                        {plan.errors.length > 0 ? (
                            <ul className="list-inside list-disc text-xs text-wine">
                                {plan.errors.slice(0, 5).map((error) => (
                                    <li key={error}>{error}</li>
                                ))}
                            </ul>
                        ) : null}
                        <button type="button" className="btn-primary" onClick={() => void run()} disabled={busy}>
                            {busy ? <Spinner size={15} /> : <Import size={15} />}
                            Import these
                        </button>
                    </div>
                ) : null}

                {result ? (
                    <div className="space-y-3 rounded-xl border border-sage/40 bg-sage/10 p-4">
                        <p className="text-sm text-parchment">Import finished.</p>
                        <Counts counts={result.imported} />
                        {result.skippedChats.length > 0 ? (
                            <p className="text-xs leading-relaxed text-parchment-dim">
                                {result.skippedChats.length} chat file
                                {result.skippedChats.length === 1 ? '' : 's'} could not be matched to an imported
                                character and {result.skippedChats.length === 1 ? 'was' : 'were'} skipped.
                            </p>
                        ) : null}
                        {result.errors.length > 0 ? (
                            <ul className="list-inside list-disc text-xs text-wine">
                                {result.errors.slice(0, 5).map((error) => (
                                    <li key={error}>{error}</li>
                                ))}
                            </ul>
                        ) : null}
                    </div>
                ) : null}
            </div>
        </Modal>
    );
}
