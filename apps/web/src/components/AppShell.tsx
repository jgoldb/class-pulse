import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { UserButton } from '@clerk/react';
import { Activity, BarChart3, BookOpen, ClipboardList, Heart, Home, Inbox, LayoutDashboard, LogOut, Menu, MessageSquareWarning, Moon, Plus, Search, Settings2, ShieldCheck, Sparkles, Sun, Users, type LucideIcon } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { applyTheme, resolveTheme, storedTheme, type Theme } from '../lib/theme';
import { Badge, Button, Dialog, Kbd, PageTransition, SheetContent, Tooltip, cn } from './ui';
import { CommandPalette } from './CommandPalette';

export type Surface = 'teacher' | 'support' | 'student' | 'family' | 'admin';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badgeKey?: 'patterns' | 'reviews' | 'requests';
}

const NAV: Record<Surface, NavItem[]> = {
  teacher: [
    { to: '/teacher', label: 'Today', icon: Home, end: true },
    { to: '/teacher/cases', label: 'Cases', icon: BookOpen },
    { to: '/teacher/patterns', label: 'Patterns', icon: Sparkles, badgeKey: 'patterns' },
    { to: '/teacher/reviews', label: 'Reviews', icon: ClipboardList, badgeKey: 'reviews' },
    { to: '/teacher/requests', label: 'Family requests', icon: Inbox, badgeKey: 'requests' },
  ],
  support: [
    { to: '/support', label: 'My students', icon: Users, end: true },
    { to: '/support/patterns', label: 'Support queue', icon: Sparkles, badgeKey: 'patterns' },
    { to: '/support/reviews', label: 'Reviews', icon: ClipboardList, badgeKey: 'reviews' },
  ],
  student: [{ to: '/student', label: 'My goals', icon: Heart, end: true }],
  family: [{ to: '/family', label: 'My child', icon: Heart, end: true }],
  admin: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
    { to: '/admin/catalog', label: 'Pattern catalog', icon: Activity },
    { to: '/admin/equity', label: 'Equity', icon: BarChart3 },
    { to: '/admin/prompts', label: 'Prompts & evals', icon: Sparkles },
    { to: '/admin/people', label: 'People & access', icon: Users },
    { to: '/admin/structure', label: 'School structure', icon: Settings2 },
    { to: '/admin/audit', label: 'Audit log', icon: ShieldCheck },
  ],
};

const TITLE: Record<Surface, string> = { teacher: 'Teacher', support: 'Support', student: 'Student', family: 'Family', admin: 'Administration' };

export interface ShellCounts {
  patterns?: number;
  reviews?: number;
  requests?: number;
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => storedTheme());
  const resolved = resolveTheme(theme);
  return (
    <Tooltip content={resolved === 'dark' ? 'Light mode' : 'Dark mode'}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Toggle theme"
        onClick={() => {
          const next: Theme = resolved === 'dark' ? 'light' : 'dark';
          setTheme(next);
          applyTheme(next);
        }}
      >
        {resolved === 'dark' ? <Sun /> : <Moon />}
      </Button>
    </Tooltip>
  );
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="relative inline-flex size-8 items-center justify-center rounded-lg bg-primary text-primary-fg shadow-sm">
        <Activity className="size-4" />
      </span>
      {!compact && <span className="text-[15px] font-bold tracking-tight">Class Pulse</span>}
    </div>
  );
}

export function AppShell({ surface, counts = {}, primaryAction }: { surface: Surface; counts?: ShellCounts; primaryAction?: ReactNode }) {
  const { me, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const items = NAV[surface];
  const student = surface === 'student';
  // Surfaces with a single destination get no bottom tab bar, so nothing has to clear it.
  const bottomNav = items.length > 1;

  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const navLinks = (onNavigate?: () => void) =>
    items.map((i) => {
      const count = i.badgeKey ? counts[i.badgeKey] : undefined;
      return (
        <NavLink
          key={i.to}
          to={i.to}
          end={i.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn('group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors', isActive ? 'bg-primary-soft text-primary-soft-fg' : 'text-muted hover:bg-sunken hover:text-fg')
          }
        >
          <i.icon className="size-4 shrink-0" />
          <span className="flex-1 truncate">{i.label}</span>
          {!!count && <Badge tone="warning">{count}</Badge>}
        </NavLink>
      );
    });

  return (
    <div className={cn('min-h-dvh', bottomNav && 'with-bottom-nav', student && 'bg-gradient-to-b from-primary-soft/50 via-bg to-bg')}>
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-elevated/80 backdrop-blur lg:flex">
        <div className="flex h-14 items-center px-4">
          <Brand />
        </div>
        <div className="px-3 pb-2">
          <button onClick={() => setPaletteOpen(true)} className="flex w-full items-center gap-2 rounded-md border border-border bg-sunken/60 px-2.5 py-1.5 text-left text-xs text-muted hover:border-border-strong">
            <Search className="size-3.5" />
            <span className="flex-1">Search or jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">{navLinks()}</nav>
        <div className="border-t border-border p-3">
          {me?.workspace && (
            <div className="mb-2 px-1">
              <div className="truncate text-xs font-semibold text-fg">{me.workspace.name}</div>
              <div className="truncate text-[11px] text-subtle">{TITLE[surface]} · {me.posture === 'demonstration' ? 'synthetic data' : 'operational'}</div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <UserButton appearance={{ elements: { userButtonAvatarBox: 'size-8' } }} />
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <Tooltip content="Sign out">
                <Button variant="ghost" size="icon" aria-label="Sign out" onClick={() => void signOut().then(() => nav('/'))}>
                  <LogOut />
                </Button>
              </Tooltip>
            </div>
          </div>
        </div>
      </aside>

      {/* Top bar (mobile + tablet) */}
      <header className="no-print sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-elevated/90 px-3 backdrop-blur lg:hidden">
        <Button variant="ghost" size="icon" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
          <Menu />
        </Button>
        <Brand compact />
        <span className="text-sm font-semibold">{TITLE[surface]}</span>
        <div className="ml-auto flex items-center gap-1">
          {primaryAction}
          <UserButton appearance={{ elements: { userButtonAvatarBox: 'size-8' } }} />
        </div>
      </header>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" title={<Brand />}>
          <nav className="space-y-0.5">{navLinks(() => setMobileOpen(false))}</nav>
          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => void signOut().then(() => nav('/'))}>
              <LogOut /> Sign out
            </Button>
          </div>
        </SheetContent>
      </Dialog>

      {/* Content */}
      <main className={cn('mx-auto w-full max-w-6xl px-4 pb-[calc(var(--bottom-nav)+2.5rem)] pt-4 sm:px-6 lg:pl-[17rem] lg:pr-8 lg:pt-6', student && 'max-w-3xl')}>
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>

      {/* Mobile bottom tabs */}
      {bottomNav && (
        <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid h-[var(--bottom-nav)] border-t border-border bg-elevated/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" style={{ gridTemplateColumns: `repeat(${Math.min(items.length, 5)}, 1fr)` }}>
          {items.slice(0, 5).map((i) => {
            const count = i.badgeKey ? counts[i.badgeKey] : undefined;
            return (
              <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn('relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium', isActive ? 'text-primary' : 'text-muted')}>
                <i.icon className="size-5" />
                <span>{i.label.split(' ')[0]}</span>
                {!!count && <span className="absolute right-[calc(50%-18px)] top-1 size-2 rounded-full bg-warning" />}
              </NavLink>
            );
          })}
        </nav>
      )}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} surface={surface} />
    </div>
  );
}

/** Consistent page header with optional actions. */
export function PageHeader({ title, description, actions, eyebrow, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <NavLink to={back.to} className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
            ← {back.label}
          </NavLink>
        )}
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">{eyebrow}</div>}
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export { Plus, MessageSquareWarning };
