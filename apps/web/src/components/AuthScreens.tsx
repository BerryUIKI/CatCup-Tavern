// biome-ignore-all lint/a11y/noAutofocus: the auth forms intentionally focus their single primary field
import { Eye, EyeOff, KeyRound, LogIn, ShieldCheck } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';

import { useLogin, useSetup } from '../hooks/data';
import { cn } from '../lib/cn';
import { Logo } from './Logo';
import { Spinner } from './Spinner';

interface PasswordFieldProps {
    id: string;
    label: string;
    value: string;
    onChange: (value: string) => void;
    autoComplete: string;
    autoFocus?: boolean;
    placeholder?: string;
}

function PasswordField({ id, label, value, onChange, autoComplete, autoFocus, placeholder }: PasswordFieldProps) {
    const [visible, setVisible] = useState(false);

    return (
        <div>
            <label htmlFor={id} className="label-text">
                {label}
            </label>
            <div className="relative">
                <KeyRound
                    size={16}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                    id={id}
                    type={visible ? 'text' : 'password'}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    autoComplete={autoComplete}
                    autoFocus={autoFocus}
                    placeholder={placeholder}
                    className="input-shell pl-9 pr-11"
                />
                <button
                    type="button"
                    className="icon-btn absolute right-1.5 top-1/2 size-8 -translate-y-1/2"
                    onClick={() => setVisible((current) => !current)}
                    aria-label={visible ? 'Hide password' : 'Show password'}
                >
                    {visible ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
            </div>
        </div>
    );
}

function FormError({ message }: { message: string | null }) {
    if (!message) {
        return null;
    }
    return (
        <div
            className="rounded-lg border border-wine/50 bg-wine/15 px-3.5 py-2.5 text-sm leading-relaxed text-parchment"
            role="alert"
        >
            {message}
        </div>
    );
}

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
    return (
        <div className="relative flex min-h-dvh items-center justify-center px-5 py-10">
            <div className="w-full max-w-md">
                <div className="mb-8 flex flex-col items-center text-center">
                    <Logo size={58} className="text-amber drop-shadow-[0_0_24px_rgba(226,165,90,0.28)]" />
                    <h1 className="mt-4 font-display text-3xl tracking-wide text-parchment">CatCup Tavern</h1>
                    <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted">
                        A quiet room for stories, characters, and long conversations.
                    </p>
                </div>

                <div className="tavern-panel p-6 sm:p-7">
                    <h2 className="font-display text-xl text-parchment">{title}</h2>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p>
                    {children}
                </div>

                <p className="mt-5 text-center text-xs text-muted/70">Local-first. API keys stay on the server.</p>
            </div>
        </div>
    );
}

export function SplashScreen() {
    return (
        <div className="flex min-h-dvh flex-col items-center justify-center gap-5">
            <Logo size={64} className="text-amber drop-shadow-[0_0_28px_rgba(226,165,90,0.3)]" />
            <Spinner size={20} className="text-muted" />
        </div>
    );
}

export function SetupScreen() {
    const setup = useSetup();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);

        if (password.length < 8) {
            setError('Use at least 8 characters.');
            return;
        }
        if (password !== confirm) {
            setError('The passwords do not match.');
            return;
        }

        try {
            await setup.mutateAsync(password);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Setup failed.');
        }
    };

    return (
        <AuthShell
            title="Welcome in"
            subtitle="Set an access password for this tavern. You will use it here and on any device on your local network."
        >
            <form className="mt-5 space-y-4" onSubmit={submit}>
                <PasswordField
                    id="new-password"
                    label="Access password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="new-password"
                    autoFocus
                    placeholder="At least 8 characters"
                />
                <PasswordField
                    id="confirm-password"
                    label="Confirm password"
                    value={confirm}
                    onChange={setConfirm}
                    autoComplete="new-password"
                    placeholder="Repeat the password"
                />
                <FormError message={error} />
                <button type="submit" className="btn-primary w-full" disabled={setup.isPending}>
                    {setup.isPending ? <Spinner size={16} /> : <ShieldCheck size={17} />}
                    {setup.isPending ? 'Creating…' : 'Create password'}
                </button>
            </form>

            <p className="mt-4 text-xs leading-relaxed text-muted/80">
                First-time setup must be completed on the computer running the server. If you plan to use this over LAN,
                set the password here first.
            </p>
        </AuthShell>
    );
}

export function LoginScreen() {
    const login = useLogin();
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        setError(null);

        if (!password) {
            setError('Enter the access password.');
            return;
        }

        try {
            await login.mutateAsync(password);
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Login failed.');
        }
    };

    return (
        <AuthShell
            title="Welcome back"
            subtitle="Enter the access password to continue. This device will stay signed in for 30 days."
        >
            <form className="mt-5 space-y-4" onSubmit={submit}>
                <PasswordField
                    id="password"
                    label="Access password"
                    value={password}
                    onChange={setPassword}
                    autoComplete="current-password"
                    autoFocus
                    placeholder="Password"
                />
                <FormError message={error} />
                <button type="submit" className={cn('btn-primary w-full')} disabled={login.isPending}>
                    {login.isPending ? <Spinner size={16} /> : <LogIn size={17} />}
                    {login.isPending ? 'Opening…' : 'Enter the tavern'}
                </button>
            </form>
        </AuthShell>
    );
}
