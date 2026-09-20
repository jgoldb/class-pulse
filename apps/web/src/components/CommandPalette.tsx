import { Command } from 'cmdk';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ClipboardList, Home, Inbox, Plus, Sparkles, User, Zap } from 'lucide-react';
import { Dialog, DialogContent } from './ui/dialog';
import { api } from '../lib/api';
import type { CaseListItem, RosterStudent } from '../lib/types';
import type { Surface } from './AppShell';

export function CommandPalette({ open, onOpenChange, surface }: { open: boolean; onOpenChange: (o: boolean) => void; surface: Surface }) {
  const nav = useNavigate();
  const teacherish = surface === 'teacher' || surface === 'support';
  const base = surface === 'support' ? '/support' : '/teacher';
  const roster = useQuery({ queryKey: ['roster'], queryFn: () => api.get<RosterStudent[]>('/api/roster'), enabled: open && teacherish });
  const cases = useQuery({ queryKey: ['cases'], queryFn: () => api.get<CaseListItem[]>('/api/cases'), enabled: open && teacherish });
  const go = (to: string) => {
    onOpenChange(false);
    nav(to);
  };
  const byStudent = new Map<string, CaseListItem>();
  for (const c of cases.data ?? []) for (const s of roster.data ?? []) if (s.caseKeys.includes(c.caseKey)) byStudent.set(s.id, c);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Search" hideClose className="p-0 [&>h2]:sr-only">
        <Command label="Command palette" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-subtle">
          <Command.Input autoFocus placeholder="Jump to a student, a screen, or an action…" className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none placeholder:text-subtle" />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-center text-sm text-muted">Nothing found.</Command.Empty>
            {teacherish && (
              <Command.Group heading="Actions">
                <Item icon={<Plus />} onSelect={() => go(`${base}/intake`)}>
                  New intake
                </Item>
                <Item icon={<Sparkles />} onSelect={() => go(`${base}/patterns`)}>
                  Pattern queue
                </Item>
                <Item icon={<ClipboardList />} onSelect={() => go(`${base}/reviews`)}>
                  Reviews due
                </Item>
                <Item icon={<Inbox />} onSelect={() => go(`${base}/requests`)}>
                  Family requests
                </Item>
              </Command.Group>
            )}
            {teacherish && (roster.data?.length ?? 0) > 0 && (
              <Command.Group heading="Students">
                {roster.data!.map((s) => {
                  const c = byStudent.get(s.id);
                  return (
                    <Item key={s.id} icon={<User />} onSelect={() => go(c ? `${base}/cases/${c.caseKey}` : `${base}/intake?studentId=${s.id}`)} hint={c ? (c.plan?.status === 'active' ? 'open case' : 'draft') : 'start intake'}>
                      {s.displayName} <span className="text-subtle">· {s.sectionName}</span>
                    </Item>
                  );
                })}
              </Command.Group>
            )}
            {teacherish && (cases.data ?? []).some((c) => c.plan?.status === 'active') && (
              <Command.Group heading="Quick entry">
                {cases.data!
                  .filter((c) => c.plan?.status === 'active')
                  .map((c) => {
                    const s = (roster.data ?? []).find((r) => r.caseKeys.includes(c.caseKey));
                    return (
                      <Item key={c.caseKey} icon={<Zap />} onSelect={() => go(`${base}/cases/${c.caseKey}/log`)}>
                        Log for {s?.displayName ?? c.caseKey}
                      </Item>
                    );
                  })}
              </Command.Group>
            )}
            <Command.Group heading="Go to">
              <Item icon={<Home />} onSelect={() => go(base === '/teacher' && surface !== 'teacher' ? '/' : surface === 'admin' ? '/admin' : surface === 'student' ? '/student' : surface === 'family' ? '/family' : base)}>
                Home
              </Item>
              {teacherish && (
                <Item icon={<BookOpen />} onSelect={() => go(`${base}/cases`)}>
                  All cases
                </Item>
              )}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Item({ children, icon, onSelect, hint }: { children: React.ReactNode; icon: React.ReactNode; onSelect: () => void; hint?: string }) {
  return (
    <Command.Item onSelect={onSelect} className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm aria-selected:bg-sunken [&_svg]:size-4 [&_svg]:text-muted">
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-[11px] text-subtle">{hint}</span>}
    </Command.Item>
  );
}
