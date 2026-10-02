// Isolated component harness. No authentication seam is added to the production application:
// Clerk is replaced by e2e/clerk-stub.tsx through the harness's own Vite alias.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'framer-motion';
import { MemoryRouter, Route, Routes } from 'react-router';
import { Toaster } from 'sonner';
import { ClassPulse } from '../apps/web/src/pages/teacher/ClassPulse';
import { Landing } from '../apps/web/src/pages/public/Landing';
import { AppUpdates } from '../apps/web/src/components/AppUpdates';
import { ClassroomDrafts } from '../apps/web/src/pages/teacher/ClassroomDrafts';
import { Tomorrow } from '../apps/web/src/pages/teacher/Tomorrow';
import { Classes } from '../apps/web/src/pages/teacher/classes/Classes';
import { ManageStudents } from '../apps/web/src/pages/teacher/classes/ManageStudents';
import { Families } from '../apps/web/src/pages/teacher/Families';
import { Reports } from '../apps/web/src/pages/teacher/Reports';
import { TeacherSettings } from '../apps/web/src/pages/teacher/Settings';
import { TeacherShell } from '../apps/web/src/pages/teacher/TeacherShell';
import { PulseProfiles } from '../apps/web/src/pages/PulseProfiles';
import { AuthProvider } from '../apps/web/src/lib/auth';
import { TooltipProvider } from '../apps/web/src/components/ui';
import '../apps/web/src/index.css';

const params = new URLSearchParams(location.search);
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');
const route = params.get('route') ?? '/teacher';
// ?bare=1 renders a page without the shell, as the original walkthroughs did.
const bare = params.get('bare') === '1';

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <MemoryRouter initialEntries={[route]}>
          <AuthProvider>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/updates" element={<main className="m-4 max-w-60"><AppUpdates /></main>} />
              <Route path="/teacher" element={bare ? <main className="mx-auto max-w-7xl p-4 pb-24"><ClassPulse /></main> : <TeacherShell surface="teacher" />}>
                <Route index element={<ClassPulse />} />
                <Route path="drafts" element={<ClassroomDrafts />} />
                <Route path="tomorrow" element={<Tomorrow />} />
                <Route path="students" element={<PulseProfiles role="teacher" />} />
                <Route path="classes" element={<Classes />} />
                <Route path="classes/:sectionId/students" element={<ManageStudents />} />
                <Route path="families" element={<Families />} />
                <Route path="reports" element={<Reports />} />
                <Route path="settings" element={<TeacherSettings />} />
              </Route>
              <Route path="/student" element={<main className="mx-auto max-w-6xl p-4 pb-24"><PulseProfiles role="student" /></main>} />
              <Route path="/family" element={<main className="mx-auto max-w-6xl p-4 pb-24"><PulseProfiles role="guardian" /></main>} />
            </Routes>
            <Toaster position="bottom-right" />
          </AuthProvider>
        </MemoryRouter>
      </TooltipProvider>
    </MotionConfig>
  </QueryClientProvider>,
);
