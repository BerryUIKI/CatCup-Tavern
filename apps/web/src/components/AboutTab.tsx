import { useQuery } from '@tanstack/react-query';

import { api } from '../lib/api';
import { Spinner } from './Spinner';

const WORKS = [
    'Import SillyTavern cards (PNG V2/V3, JSON), chats, lorebooks and OpenAI presets — or point at a whole SillyTavern folder and copy everything at once.',
    'Chat with streaming replies, swipes, regenerate, continue, inline editing, branching and alternate greetings.',
    'Lorebooks with SillyTavern’s full scan pipeline, and an editor for every entry field.',
    'OpenAI presets: import, activate, and change prompt order and injection positions.',
    'Regex scripts with import and export, applied to input, output, reasoning and lorebook content.',
    'Several personas, with one default and a per-chat choice.',
    'Edit character cards and export them back to PNG or JSON.',
    'Windows desktop app that installs without an administrator and carries its own runtime.',
];

const DOES_NOT_WORK = [
    'Group chats with several characters in one conversation.',
    'Quick Replies and STscript / slash commands.',
    'SillyTavern extensions — none of them load.',
    'Text to speech and image generation.',
    'Summary memory or vector memory for long chats.',
    'CharX (.charx) import and export.',
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
        </div>
    );
}
