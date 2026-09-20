import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ClerkProvider } from '@clerk/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import './index.css';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { TooltipProvider } from './components/ui/tooltip';
import { applyStoredTheme } from './lib/theme';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
if (!PUBLISHABLE_KEY) throw new Error('VITE_CLERK_PUBLISHABLE_KEY is missing. Run `clerk init` in apps/web or set it in the repo .env.');

applyStoredTheme();

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: true } } });

const clerkAppearance = {
  variables: { colorPrimary: '#1f8a7a', colorText: '#17201f', borderRadius: '12px', fontFamily: 'Inter, ui-sans-serif, system-ui' },
  elements: { card: 'shadow-lg border border-border', formButtonPrimary: 'bg-primary hover:bg-primary-hover text-sm normal-case', footerActionLink: 'text-primary' },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" appearance={clerkAppearance}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <TooltipProvider>
              <App />
              <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { fontFamily: 'Inter, ui-sans-serif, system-ui' } }} />
            </TooltipProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ClerkProvider>
  </React.StrictMode>,
);
