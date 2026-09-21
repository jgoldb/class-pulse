import { Navigate, Route, Routes, useLocation } from 'react-router';
import { roleHome, useAuth } from './lib/auth';
import { PageSkeleton } from './components/ui';
import { Landing } from './pages/public/Landing';
import { SignInPage, SignUpPage } from './pages/public/Auth';
import { CheckoutPage, GetStarted } from './pages/public/GetStarted';
import { Onboarding } from './pages/public/Onboarding';
import { TeacherShell } from './pages/teacher/TeacherShell';
import { TeacherToday } from './pages/teacher/Today';
import { CasesList } from './pages/teacher/CasesList';
import { MyClass } from './pages/teacher/MyClass';
import { IntakePage } from './pages/teacher/Intake';
import { CaseDetail } from './pages/teacher/CaseDetail';
import { DraftReview } from './pages/teacher/DraftReview';
import { QuickEntry } from './pages/teacher/QuickEntry';
import { PatternQueue } from './pages/teacher/PatternQueue';
import { PatternCard } from './pages/teacher/PatternCard';
import { ReviewsList } from './pages/teacher/ReviewsList';
import { ReviewDecision } from './pages/teacher/ReviewDecision';
import { PrintPlan } from './pages/teacher/PrintPlan';
import { Requests } from './pages/teacher/Requests';
import { SupportHome } from './pages/support/SupportHome';
import { StudentShell } from './pages/student/StudentShell';
import { StudentHome } from './pages/student/StudentHome';
import { FamilyShell } from './pages/family/FamilyShell';
import { FamilyHome } from './pages/family/FamilyHome';
import { AdminShell } from './pages/admin/AdminShell';
import { AdminOverview } from './pages/admin/Overview';
import { AdminCatalog } from './pages/admin/Catalog';
import { AdminEquity } from './pages/admin/Equity';
import { AdminPrompts } from './pages/admin/Prompts';
import { AdminPeople } from './pages/admin/People';
import { AdminStructure } from './pages/admin/Structure';
import { AdminAudit } from './pages/admin/Audit';

function Loading() {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <PageSkeleton />
    </div>
  );
}

/** Gate a route group on Clerk sign-in, Class Pulse provisioning, and role. */
function RequireRole({ roles, children }: { roles: string[]; children: React.ReactElement }) {
  const { signedIn, clerkLoaded, me, loading, primaryRole } = useAuth();
  const loc = useLocation();
  if (!clerkLoaded || loading) return <Loading />;
  if (!signedIn) return <Navigate to="/sign-in" state={{ from: loc.pathname }} replace />;
  if (!me?.provisioned) return <Navigate to="/onboarding" replace />;
  if (!roles.some((r) => me.roles?.includes(r))) return <Navigate to={roleHome(primaryRole)} replace />;
  return children;
}

function Home() {
  const { signedIn, clerkLoaded, me, loading, primaryRole } = useAuth();
  if (!clerkLoaded || loading) return <Loading />;
  if (!signedIn) return <Landing />;
  if (!me?.provisioned) return <Navigate to="/onboarding" replace />;
  return <Navigate to={roleHome(primaryRole)} replace />;
}

/** Route groups by role, not by entity (docs/05): the surfaces differ in information architecture. */
export function App() {
  const TEACHERISH = ['teacher', 'support_professional'];
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />
      <Route path="/get-started" element={<GetStarted />} />
      <Route path="/checkout/:id" element={<CheckoutPage />} />
      <Route path="/onboarding" element={<Onboarding />} />

      <Route path="/teacher" element={<RequireRole roles={TEACHERISH}><TeacherShell surface="teacher" /></RequireRole>}>
        <Route index element={<TeacherToday />} />
        <Route path="cases" element={<CasesList />} />
        <Route path="class" element={<MyClass />} />
        <Route path="intake" element={<IntakePage />} />
        <Route path="cases/:caseKey" element={<CaseDetail />} />
        <Route path="cases/:caseKey/log" element={<QuickEntry />} />
        <Route path="cases/:caseKey/print" element={<PrintPlan />} />
        <Route path="drafts/:draftId" element={<DraftReview />} />
        <Route path="patterns" element={<PatternQueue queue="teacher" />} />
        <Route path="candidates/:id" element={<PatternCard />} />
        <Route path="reviews" element={<ReviewsList />} />
        <Route path="reviews/:id" element={<ReviewDecision />} />
        <Route path="requests" element={<Requests />} />
      </Route>

      <Route path="/support" element={<RequireRole roles={['support_professional']}><TeacherShell surface="support" /></RequireRole>}>
        <Route index element={<SupportHome />} />
        <Route path="cases" element={<CasesList />} />
        <Route path="intake" element={<IntakePage />} />
        <Route path="cases/:caseKey" element={<CaseDetail />} />
        <Route path="cases/:caseKey/log" element={<QuickEntry />} />
        <Route path="cases/:caseKey/print" element={<PrintPlan />} />
        <Route path="drafts/:draftId" element={<DraftReview />} />
        <Route path="patterns" element={<PatternQueue queue="support" />} />
        <Route path="candidates/:id" element={<PatternCard />} />
        <Route path="reviews" element={<ReviewsList />} />
        <Route path="reviews/:id" element={<ReviewDecision />} />
        <Route path="requests" element={<Requests />} />
      </Route>

      <Route path="/student" element={<RequireRole roles={['student']}><StudentShell /></RequireRole>}>
        <Route index element={<StudentHome />} />
      </Route>

      <Route path="/family" element={<RequireRole roles={['guardian']}><FamilyShell /></RequireRole>}>
        <Route index element={<FamilyHome />} />
      </Route>

      <Route path="/admin" element={<RequireRole roles={['administrator']}><AdminShell /></RequireRole>}>
        <Route index element={<AdminOverview />} />
        <Route path="catalog" element={<AdminCatalog />} />
        <Route path="equity" element={<AdminEquity />} />
        <Route path="prompts" element={<AdminPrompts />} />
        <Route path="people" element={<AdminPeople />} />
        <Route path="structure" element={<AdminStructure />} />
        <Route path="audit" element={<AdminAudit />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
