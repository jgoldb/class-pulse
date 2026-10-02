// Stands in for @clerk/react inside the isolated UI harness only (aliased in pulse-vite.config.ts).
// The production build never sees this file: the app keeps its real Clerk integration, and the
// harness gets a signed-in teacher so the real shell (navigation, top bar) can render offline.
import type { ReactNode } from 'react';

export const useAuth = () => ({ isLoaded: true, isSignedIn: true, userId: 'harness-teacher', getToken: async () => null, signOut: async () => {} });
export const useUser = () => ({ isLoaded: true, isSignedIn: true, user: null });
export const UserButton = () => <span aria-label="Account" role="img" className="inline-flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-fg">MT</span>;
export const ClerkProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
export const SignIn = () => null;
export const SignUp = () => null;
