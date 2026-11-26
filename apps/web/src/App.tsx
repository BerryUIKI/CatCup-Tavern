import { useEffect } from 'react';

import { LoginScreen, SetupScreen, SplashScreen } from './components/AuthScreens';
import { MainApp } from './components/MainApp';
import { useAuthStatus } from './hooks/data';

/**
 * Keep the browser's chrome colour in step with the page.
 *
 * `index.html` carries the tavern's ink so the address bar matches on first
 * paint; reading the token afterwards means a skin that moves `--color-ink`
 * does not leave the old colour behind in the title bar.
 */
function useThemeColor() {
    useEffect(() => {
        const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
        if (!meta) {
            return;
        }
        const ink = getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim();
        if (ink) {
            meta.content = ink;
        }
    }, []);
}

export default function App() {
    const auth = useAuthStatus();
    const { refetch } = auth;
    useThemeColor();

    useEffect(() => {
        const onUnauthorized = () => {
            void refetch();
        };
        window.addEventListener('catcup:unauthorized', onUnauthorized);
        return () => window.removeEventListener('catcup:unauthorized', onUnauthorized);
    }, [refetch]);

    if (auth.isLoading) {
        return <SplashScreen />;
    }

    if (auth.isError) {
        return (
            <div className="flex min-h-dvh items-center justify-center px-6 text-center">
                <div>
                    <p className="font-display text-xl text-parchment">Cannot reach the tavern server.</p>
                    <p className="mt-2 text-sm text-muted">
                        {auth.error instanceof Error ? auth.error.message : 'Unknown error'}
                    </p>
                    <button type="button" className="btn-primary mt-5" onClick={() => void refetch()}>
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    if (auth.data?.needsSetup) {
        return <SetupScreen />;
    }

    if (!auth.data?.authenticated) {
        return <LoginScreen openSession={auth.data?.openSession ?? false} />;
    }

    return <MainApp />;
}
