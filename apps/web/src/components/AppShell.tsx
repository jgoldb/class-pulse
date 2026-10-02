import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { UserButton } from '@clerk/react';
import { Activity, BarChart3, BookOpen, ClipboardList, FileText, Heart, HeartHandshake, Home, Inbox, LayoutDashboard, LayoutGrid, LogOut, Menu, MessageSquareWarning, Moon, Plus, PowerOff, Search, Settings, Settings2, ShieldCheck, Sparkles, Sun, Users, type LucideIcon } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { applyTheme, resolveTheme, storedTheme, type Theme } from '../lib/theme';
import { Badge, Button, Dialog, Kbd, PageTransition, SheetContent, Tooltip, cn } from './ui';
import { CommandPalette } from './CommandPalette';
import { Brand } from './Brand';
import { InstallApp } from './InstallApp';
import { AppUpdates } from './AppUpdates';

export type Surface = 'teacher' | 'support' | 'student' | 'family' | 'admin';

type CountKey = 'patterns' | 'reviews' | 'requests' | 'drafts' | 'tomorrow';
interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  badgeKey?: CountKey;
  /** Bottom-tab label. Defaults to the first word, which is wrong for "My class". */
  short?: string;
  /** Shown in the phone tab bar; everything else is one tap away in the menu. */
  tab?: boolean;
  /** Lower-priority destinations sit in a quieter group under the main ones. */
  group?: 'more' | 'settings';
}

const NAV: Record<Surface, NavItem[]> = {
  // Visual spec §3: Class Pulse first, then Classes, Drafts, Tomorrow, Students, Families, Reports.
  teacher: [
    { to: '/teacher', label: 'Class Pulse', short: 'Pulse', icon: Home, end: true, tab: true },
    { to: '/teacher/classes', label: 'Classes', icon: LayoutGrid, tab: true },
    { to: '/teacher/drafts', label: 'Drafts', icon: Inbox, badgeKey: 'drafts', tab: true },
    { to: '/teacher/tomorrow', label: 'Tomorrow', icon: Sparkles, badgeKey: 'tomorrow', tab: true },
    { to: '/teacher/students', label: 'Students', icon: Users, tab: true },
    { to: '/teacher/families', label: 'Families', icon: HeartHandshake },
    { to: '/teacher/reports', label: 'Reports', icon: FileText },
    { to: '/teacher/support', label: 'Support work', icon: BookOpen, group: 'more' },
    { to: '/teacher/settings', label: 'Settings', icon: Settings, group: 'settings' },
  ],
  support: [
    { to: '/support', label: 'My students', icon: Users, end: true, tab: true },
    { to: '/support/patterns', label: 'Support queue', icon: Sparkles, badgeKey: 'patterns', tab: true },
    { to: '/support/reviews', label: 'Reviews', icon: ClipboardList, badgeKey: 'reviews', tab: true },
    { to: '/support/report-templates', label: 'Report templates', short: 'Templates', icon: BookOpen, tab: true },
  ],
  student: [{ to: '/student', label: 'My Pulse', icon: Heart, end: true, tab: true }],
  family: [{ to: '/family', label: 'Family Pulse', icon: Heart, end: true, tab: true }],
  admin: [
    { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true, tab: true },
    { to: '/admin/insights', label: 'Pulsera Insights', short: 'Insights', icon: BarChart3, tab: true },
    { to: '/admin/catalog', label: 'Pattern catalog', icon: Activity, tab: true },
    { to: '/admin/equity', label: 'Equity', icon: BarChart3, tab: true },
    { to: '/admin/prompts', label: 'Prompts & evals', icon: Sparkles, tab: true },
    { to: '/admin/people', label: 'People & access', icon: Users },
    { to: '/admin/structure', label: 'School structure', icon: Settings2 },
    { to: '/admin/report-templates', label: 'Report templates', icon: BookOpen },
    { to: '/admin/audit', label: 'Audit log', icon: ShieldCheck },
  ],
};

const TITLE: Record<Surface, string> = { teacher: 'Teacher', support: 'Support', student: 'Student', family: 'Family', admin: 'Administration' };

export type ShellCounts = Partial<Record<CountKey, number>>;

/** Drafts and Tomorrow are AI work waiting on the teacher (violet); the rest need attention (amber). */
const BADGE_TONE: Record<CountKey, 'ai' | 'warning'> = { drafts: 'ai', tomorrow: 'ai', patterns: 'warning', reviews: 'warning', requests: 'warning' };

export function ThemeToggle() {
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

/**
 * Shown on every page when the deployment runs with AI_PROVIDER=off. Without it the model being
 * switched off is indistinguishable from it being broken: drafts fail, evals fail, and nothing
 * says why. Everything that does not touch the model — logging signals, the pattern engine,
 * reviewing and approving existing plans — keeps working, so the banner says that too.
 */
function ModelOffBanner() {
  const { me } = useAuth();
  if (me?.modelEnabled !== false) return null;
  const admin = me.roles?.includes('administrator');
  return (
    <div className="no-print mb-6 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft p-4 text-warning-fg" role="status" data-testid="model-off-banner">
      <PowerOff className="mt-0.5 size-4 shrink-0" />
      <div className="text-xs leading-relaxed">
        <span className="font-semibold">AI features are turned off for this deployment.</span>{' '}
        Drafting a plan, interpreting a pattern and narrating a review will not run, and nothing is sent to the model.
        Logging signals, the pattern engine and reviewing existing plans are unaffected.
        {admin && ' Evals cannot run, so prompt promotion is blocked until the model is turned back on.'}
      </div>
    </div>
  );
}

export function AppShell({ surface, counts = {}, primaryAction, topBar }: { surface: Surface; counts?: ShellCounts; primaryAction?: ReactNode; topBar?: ReactNode }) {
  const { me, signOut } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const items = NAV[surface];
  const tabs = items.filter((i) => i.tab);
  const student = surface === 'student';
  // Surfaces with a single destination get no bottom tab bar, so nothing has to clear it.
  const bottomNav = tabs.length > 1;
  const teacher = surface === 'teacher';

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

  const link = (i: NavItem, onNavigate?: () => void) => {
    const count = i.badgeKey ? counts[i.badgeKey] : undefined;
    return (
      <NavLink
        key={i.to}
        to={i.to}
        end={i.end}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn('group flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors', isActive ? 'bg-primary-soft text-primary-soft-fg' : 'text-muted hover:bg-sunken hover:text-fg')
        }
      >
        <i.icon className="size-[18px] shrink-0" />
        <span className="flex-1 truncate">{i.label}</span>
        {!!count && <Badge tone={BADGE_TONE[i.badgeKey!]}>{count}</Badge>}
      </NavLink>
    );
  };
  const navLinks = (onNavigate?: () => void) => {
    const main = items.filter((i) => !i.group);
    const more = items.filter((i) => i.group === 'more');
    return (
      <>
        <div className="space-y-0.5">{main.map((i) => link(i, onNavigate))}</div>
        {!!more.length && (
          <div className="mt-6 space-y-0.5">
            <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-subtle">More</div>
            {more.map((i) => link(i, onNavigate))}
          </div>
        )}
      </>
    );
  };
  const settings = items.filter((i) => i.group === 'settings');

  return (
    <div className={cn('min-h-dvh', bottomNav && 'with-bottom-nav', student && 'bg-gradient-to-b from-primary-soft/50 via-bg to-bg')}>
      {/* Desktop sidebar */}
      <aside className="no-print fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-elevated lg:flex">
        <div className="flex h-16 items-center px-5">
          <Brand />
        </div>
        <div className="px-3 pb-2">
          <button onClick={() => setPaletteOpen(true)} className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-sunken/60 px-3 text-left text-xs text-muted hover:border-border-strong">
            <Search className="size-3.5" />
            <span className="flex-1">Search or jump to…</span>
            <Kbd>⌘K</Kbd>
          </button>
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-2">{navLinks()}</nav>
        <div className="space-y-2 border-t border-border p-3">
          {settings.map((i) => link(i))}
          <InstallApp />
          <AppUpdates />
          {me?.workspace && (
            <div className="px-3 pt-1">
              <div className="truncate text-xs font-semibold text-fg">{me.workspace.name}</div>
              <div className="truncate text-[11px] text-subtle">{TITLE[surface]} · {me.posture === 'demonstration' ? 'synthetic data' : 'operational'}</div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 px-1">
            {!topBar ? <UserButton appearance={{ elements: { userButtonAvatarBox: 'size-8' } }} /> : <span />}
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

      <div className="lg:pl-60">
        {/* Top bar: mobile always; desktop when the surface supplies one (teacher: class, session, Drafts, Tomorrow). */}
        <header className={cn('no-print sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur-md sm:px-6 lg:px-8', !topBar && 'lg:hidden')}>
          <Button variant="ghost" size="icon" aria-label="Open navigation" className="lg:hidden" onClick={() => setMobileOpen(true)}>
            <Menu />
          </Button>
          {!topBar && (
            <>
              <Brand compact />
              <span className="text-sm font-semibold">{TITLE[surface]}</span>
            </>
          )}
          {topBar ? <div className="flex min-w-0 flex-1 items-center gap-2">{topBar}</div> : <div className="flex-1" />}
          <div className="flex shrink-0 items-center gap-1">
            {primaryAction}
            <UserButton appearance={{ elements: { userButtonAvatarBox: 'size-8' } }} />
          </div>
        </header>

        {/* Content */}
        <main className={cn('mx-auto w-full px-4 pb-[calc(var(--bottom-nav)+2.5rem)] pt-6 sm:px-6 lg:px-8 lg:pt-8', teacher ? 'max-w-7xl' : 'max-w-6xl', student && 'max-w-3xl')}>
          <ModelOffBanner />
          <AppUpdates noticeOnly />
          <PageTransition>
            <Outlet />
          </PageTransition>
        </main>
      </div>

      <Dialog open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" title={<Brand />}>
          <nav aria-label="Main">{navLinks(() => setMobileOpen(false))}</nav>
          <div className="mt-4"><InstallApp /></div>
          <AppUpdates />
          {!!settings.length && <div className="mt-4 border-t border-border pt-4">{settings.map((i) => link(i, () => setMobileOpen(false)))}</div>}
          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => void signOut().then(() => nav('/'))}>
              <LogOut /> Sign out
            </Button>
          </div>
        </SheetContent>
      </Dialog>

      {/* Mobile bottom tabs */}
      {bottomNav && (
        <nav aria-label="Primary" className="no-print fixed inset-x-0 bottom-0 z-30 grid h-[var(--bottom-nav)] border-t border-border bg-elevated/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }}>
          {tabs.map((i) => {
            const count = i.badgeKey ? counts[i.badgeKey] : undefined;
            return (
              <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cn('relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium', isActive ? 'text-primary' : 'text-muted')}>
                <i.icon className="size-5" />
                <span>{i.short ?? i.label.split(' ')[0]}</span>
                {!!count && <span className={cn('absolute right-[calc(50%-18px)] top-1.5 size-2 rounded-full', BADGE_TONE[i.badgeKey!] === 'ai' ? 'bg-ai' : 'bg-warning')} aria-label={`${count} waiting`} />}
              </NavLink>
            );
          })}
        </nav>
      )}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} surface={surface} />
    </div>
  );
}

/** Consistent page header: a large title and one short line, actions to the right (spec §2.3). */
export function PageHeader({ title, description, actions, eyebrow, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back && (
          <NavLink to={back.to} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-fg">
            ← {back.label}
          </NavLink>
        )}
        {eyebrow && <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-subtle">{eyebrow}</div>}
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight sm:text-[30px]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export { Plus, MessageSquareWarning };
