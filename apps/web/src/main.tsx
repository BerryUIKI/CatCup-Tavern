import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ApiError } from './lib/api';
import './styles.css';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            retry: (failureCount, error) => {
                if (error instanceof ApiError && error.status < 500) {
                    return false;
                }
                return failureCount < 1;
            },
            refetchOnWindowFocus: false,
            staleTime: 15_000,
        },
    },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
    throw new Error('Root element not found');
}

createRoot(rootElement).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <App />
        </QueryClientProvider>
    </StrictMode>,
);
