import { useEffect } from 'react';

import { LoginScreen, SetupScreen, SplashScreen } from './components/AuthScreens';
import { MainApp } from './components/MainApp';
import { useAuthStatus } from './hooks/data';

export default function App() {
    const auth = useAuthStatus();
    const { refetch } = auth;

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
