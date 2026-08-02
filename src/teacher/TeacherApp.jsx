import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import './teacher.css';
import './teacher-app.css';
import './teacher-editor.css';
import { AuthPage, LandingPage, PasswordRecoveryPage, PricingPage } from './PublicPages.jsx';
import {
  CreateLessonPage,
  DashboardPage,
  GeneratingPage,
  MembershipPage,
  NotFoundAppPage,
  PlansPage,
  QuotaPage,
  SettingsPage,
} from './DashboardPages.jsx';
import { LessonEditor } from './LessonEditor.jsx';
import { KnowledgeMapPage, PaperBuilderPage, TeamWorkspacePage } from './WorkflowPages.jsx';
import { api } from '../lib/api.js';
import { navigate } from '../lib/navigation.jsx';
import { AccountProvider, Logo } from './components.jsx';
import './teacher-workflows.css';

export default function TeacherApp({ path }) {
  if (path === '/') return <LandingPage />;
  if (path === '/login') return <AuthPage mode="login" />;
  if (path === '/register') return <AuthPage mode="register" />;
  if (path === '/forgot-password') return <PasswordRecoveryPage />;
  if (path === '/pricing') return <PricingPage />;
  if (path === '/app' || path.startsWith('/app/')) return <AuthenticatedTeacherRoutes path={path} />;
  return <LandingPage />;
}

function AuthenticatedTeacherRoutes({ path }) {
  const [session, setSession] = useState({ status: 'checking', user: null });

  useEffect(() => {
    let active = true;
    api.authSession().then((response) => {
      if (!active) return;
      const user = response.data?.user;
      if (!user) throw new Error('登录会话缺少用户信息');
      setSession({ status: 'ready', user });
    }).catch(() => {
      if (!active) return;
      sessionStorage.setItem('auth-return-to', path);
      navigate('/login', { replace: true, instant: true });
    });
    return () => { active = false; };
  }, [path]);

  if (session.status !== 'ready') {
    return (
      <main className="auth-session-check" role="status" aria-live="polite">
        <Logo />
        <LoaderCircle className="spin" size={28} />
        <p>正在确认登录状态…</p>
      </main>
    );
  }

  return <AccountProvider user={session.user}><TeacherRoutes path={path} /></AccountProvider>;
}

function TeacherRoutes({ path }) {
  if (path === '/app') return <DashboardPage path={path} />;
  if (path === '/app/create') return <CreateLessonPage path={path} />;
  if (path === '/app/generating') return <GeneratingPage path={path} />;
  if (path === '/app/plans') return <PlansPage path={path} />;
  if (path === '/app/materials') return <PlansPage path={path} materials />;
  if (path === '/app/membership') return <MembershipPage path={path} />;
  if (path === '/app/quota') return <QuotaPage path={path} />;
  if (path === '/app/knowledge' || /\/app\/lesson\/[^/]+\/knowledge$/.test(path)) return <KnowledgeMapPage path={path} />;
  if (path === '/app/papers' || path.startsWith('/app/papers/')) return <PaperBuilderPage path={path} />;
  if (path === '/app/team') return <TeamWorkspacePage path={path} />;
  if (path.startsWith('/app/settings')) return <SettingsPage path={path} />;
  if (path.startsWith('/app/lesson/')) return <LessonEditor path={path} />;
  if (path.startsWith('/app/')) return <NotFoundAppPage path={path} />;
  return <DashboardPage path="/app" />;
}
