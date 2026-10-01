// Isolated component harness. No authentication seam is added to the production application.
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { ClassPulse } from '../apps/web/src/pages/teacher/ClassPulse';
import { ClassroomDrafts } from '../apps/web/src/pages/teacher/ClassroomDrafts';
import { PulseProfiles } from '../apps/web/src/pages/PulseProfiles';
import '../apps/web/src/index.css';
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[new URLSearchParams(location.search).get('route') ?? '/teacher']}><main className="mx-auto max-w-6xl p-4 pb-24"><Routes><Route path="/teacher" element={<ClassPulse />} /><Route path="/teacher/drafts" element={<ClassroomDrafts />} /><Route path="/teacher/tomorrow" element={<ClassroomDrafts tomorrow />} /><Route path="/teacher/students" element={<PulseProfiles role="teacher" />} /><Route path="/student" element={<PulseProfiles role="student" />} /><Route path="/family" element={<PulseProfiles role="guardian" />} /></Routes></main></MemoryRouter></QueryClientProvider>);
