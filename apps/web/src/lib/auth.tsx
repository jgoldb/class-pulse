import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useAuth as useClerkAuth, useUser } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, setTokenGetter } from './api';

export interface Me {
  authenticated: boolean;
  provisioned: boolean;
  posture: 'demonstration' | 'operational';
  /** False when the deployment runs with AI_PROVIDER=off: anything that reaches the model refuses. */
  modelEnabled?: boolean;
  user?: { id: string; email: string; displayName: string };
  roles?: string[];
  assignments?: Array<{ role: string; sectionId: string | null; studentId: string | null; schoolId: string | null }>;
  sections?: Array<{ id: string; name: string; periodTag: string | null }>;
  schools?: Array<{ id: string; name: string }>;
  workspace?: { id: string; name: string } | null;
  caseCount?: number;
  approverRoles?: string[];
}

interface AuthCtx {
  /** Clerk session state. */
  signedIn: boolean;
  clerkLoaded: boolean;
  /** Class Pulse profile, once provisioned. */
  me: Me | null;
  loading: boolean;
  primaryRole: string | null;
  roleBase: string;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({ signedIn: false, clerkLoaded: false, me: null, loading: true, primaryRole: null, roleBase: '/', refresh: async () => {}, signOut: async () => {} });

const ROLE_ORDER = ['administrator', 'support_professional', 'teacher', 'guardian', 'student'];

export function roleHome(role: string | null): string {
  switch (role) {
    case 'administrator':
      return '/admin';
    case 'support_professional':
      return '/support';
    case 'teacher':
      return '/teacher';
    case 'guardian':
      return '/family';
    case 'student':
      return '/student';
    default:
      return '/onboarding';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const clerk = useClerkAuth();
  const { user } = useUser();
  const qc = useQueryClient();

  useEffect(() => {
    setTokenGetter(async () => (clerk.isSignedIn ? await clerk.getToken() : null));
  }, [clerk, clerk.isSignedIn]);

  const q = useQuery({
    queryKey: ['me', clerk.userId],
    queryFn: () => api.get<Me>('/auth/me'),
    enabled: clerk.isLoaded && !!clerk.isSignedIn,
    retry: false,
    staleTime: 30_000,
  });
  const me = q.data ?? null;
  const primaryRole = me?.roles ? ROLE_ORDER.find((r) => me.roles!.includes(r)) ?? null : null;
  void user;
  return (
    <Ctx.Provider
      value={{
        signedIn: !!clerk.isSignedIn,
        clerkLoaded: clerk.isLoaded,
        me,
        loading: !clerk.isLoaded || (!!clerk.isSignedIn && q.isLoading),
        primaryRole,
        roleBase: roleHome(primaryRole),
        refresh: async () => {
          await qc.invalidateQueries({ queryKey: ['me'] });
        },
        signOut: async () => {
          await clerk.signOut();
          qc.clear();
        },
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
