import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ClerkProvider } from '@clerk/react';
import { clerkLocalization } from './components/Brand';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { Toaster } from 'sonner';
import './index.css';
import { App } from './App';
import { AuthProvider } from './lib/auth';
import { TooltipProvider } from './components/ui/tooltip';
import { applyStoredTheme } from './lib/theme';
import { initializePwa } from './lib/pwa';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
if (!PUBLISHABLE_KEY) throw new Error('VITE_CLERK_PUBLISHABLE_KEY is missing. Run `clerk init` in apps/web or set it in the repo .env.');

applyStoredTheme();

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: true } } });

const clerkAppearance = {
  variables: { colorPrimary: '#2f5fd0', colorText: '#1b2233', borderRadius: '12px', fontFamily: 'Inter, ui-sans-serif, system-ui' },
  elements: { card: 'shadow-lg border border-border', formButtonPrimary: 'bg-primary hover:bg-primary-hover text-sm normal-case', footerActionLink: 'text-primary' },
};

// Check for a newer release before rendering editable classroom screens.
void initializePwa().then((reloading) => {
if (reloading) return;
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} signInUrl="/sign-in" signUpUrl="/sign-up" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/" appearance={clerkAppearance} localization={clerkLocalization}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            {/* Every Framer Motion animation honours the device's reduced-motion setting (spec §2.4, §14). */}
            <MotionConfig reducedMotion="user">
            <TooltipProvider>
              <App />
              <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { fontFamily: 'Inter, ui-sans-serif, system-ui' } }} />
            </TooltipProvider>
            </MotionConfig>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ClerkProvider>
  </React.StrictMode>,
);
});
