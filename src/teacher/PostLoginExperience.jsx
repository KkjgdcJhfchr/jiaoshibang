import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BellRing,
  Check,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { api } from '../lib/api.js';
import './post-login-experience.css';

export function PostLoginExperience() {
  const [announcements, setAnnouncements] = useState([]);
  const [tutorial, setTutorial] = useState(null);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dismissedLoadError, setDismissedLoadError] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');

  async function loadExperience() {
    setLoading(true);
    setLoadError('');
    setDismissedLoadError(false);
    try {
      const response = await api.getAppContentBootstrap();
      const content = response.data?.content || response.data || {};
      const nextAnnouncements = Array.isArray(content.announcements)
        ? [...content.announcements].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))
        : [];
      const nextTutorial = normalizeTutorial(content.tutorial, content.tutorialProgress);
      setAnnouncements(nextAnnouncements);
      setTutorial(nextTutorial.tutorial);
      setTutorialStep(nextTutorial.stepIndex);
      setActionError('');
    } catch (requestError) {
      setLoadError(requestError.message || '登录后内容读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadExperience(); }, []);

  const activeAnnouncement = announcements[0] || null;
  const activeTutorial = !activeAnnouncement ? tutorial : null;
  const dialogOpen = Boolean(activeAnnouncement || activeTutorial || (loadError && !dismissedLoadError));

  async function acknowledgeAnnouncement() {
    if (!activeAnnouncement || busy) return;
    setBusy('announcement');
    setActionError('');
    try {
      await api.acknowledgeAnnouncement(activeAnnouncement.id, { revision: activeAnnouncement.revision });
      setAnnouncements((items) => items.slice(1));
    } catch (requestError) {
      setActionError(requestError.message || '公告确认失败，请重试');
    } finally {
      setBusy('');
    }
  }

  async function moveTutorial(nextIndex) {
    if (!activeTutorial || busy) return;
    const safeIndex = Math.max(0, Math.min(nextIndex, activeTutorial.steps.length - 1));
    setBusy('tutorial');
    setActionError('');
    try {
      await api.saveTutorialProgress(tutorialProgressPayload(activeTutorial, 'active', safeIndex));
      setTutorialStep(safeIndex);
    } catch (requestError) {
      setActionError(requestError.message || '教程进度保存失败，请重试');
    } finally {
      setBusy('');
    }
  }

  async function finishTutorial(status) {
    if (!activeTutorial || busy) return;
    setBusy('tutorial');
    setActionError('');
    try {
      await api.saveTutorialProgress(tutorialProgressPayload(activeTutorial, status, tutorialStep));
      setTutorial(null);
    } catch (requestError) {
      setActionError(requestError.message || '教程进度保存失败，请重试');
    } finally {
      setBusy('');
    }
  }

  if (!dialogOpen || typeof document === 'undefined') return null;

  return createPortal(
    <ExperienceDialog open={dialogOpen}>
      {activeAnnouncement ? (
        <AnnouncementDialog
          announcement={activeAnnouncement}
          current={1}
          total={announcements.length}
          busy={busy === 'announcement'}
          error={actionError}
          onConfirm={acknowledgeAnnouncement}
        />
      ) : null}
      {activeTutorial ? (
        <TutorialDialog
          tutorial={activeTutorial}
          stepIndex={tutorialStep}
          busy={busy === 'tutorial'}
          error={actionError}
          onPrevious={() => moveTutorial(tutorialStep - 1)}
          onNext={() => moveTutorial(tutorialStep + 1)}
          onSkip={() => finishTutorial('skipped')}
          onComplete={() => finishTutorial('completed')}
        />
      ) : null}
      {!activeAnnouncement && !activeTutorial && loadError && !dismissedLoadError ? (
        <LoadErrorDialog
          message={loadError}
          loading={loading}
          onRetry={loadExperience}
          onContinue={() => setDismissedLoadError(true)}
        />
      ) : null}
    </ExperienceDialog>,
    document.body,
  );
}

function ExperienceDialog({ open, children }) {
  const dialogLayerRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const appRoot = document.getElementById('root');
    const activeBeforeOpen = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const rootWasInert = appRoot?.hasAttribute('inert') || false;
    const rootWasHidden = appRoot?.getAttribute('aria-hidden');
    if (appRoot) {
      appRoot.setAttribute('inert', '');
      appRoot.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = 'hidden';

    const focusTimer = window.requestAnimationFrame(() => {
      const dialog = dialogLayerRef.current?.querySelector('[role="dialog"], [role="alertdialog"]');
      dialog?.querySelector('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')?.focus();
    });

    function trapFocus(event) {
      if (event.key !== 'Tab') return;
      const dialog = dialogLayerRef.current?.querySelector('[role="dialog"], [role="alertdialog"]');
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.hasAttribute('hidden'));
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', trapFocus);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.removeEventListener('keydown', trapFocus);
      document.body.style.overflow = previousOverflow;
      if (appRoot) {
        if (!rootWasInert) appRoot.removeAttribute('inert');
        if (rootWasHidden === null) appRoot.removeAttribute('aria-hidden');
        else appRoot.setAttribute('aria-hidden', rootWasHidden);
      }
      if (activeBeforeOpen instanceof HTMLElement) activeBeforeOpen.focus();
    };
  }, [open]);

  return <div className="post-login-layer" ref={dialogLayerRef}><div className="post-login-backdrop" />{children}</div>;
}

function AnnouncementDialog({ announcement, current, total, busy, error, onConfirm }) {
  const titleId = useId();
  return (
    <section className="post-login-dialog post-login-announcement" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header><span className="post-login-icon"><BellRing size={23} /></span><div><small>平台公告{total > 1 ? ` · ${current}/${total}` : ''}</small><h2 id={titleId}>{announcement.title}</h2></div></header>
      <div className="post-login-announcement-content">{String(announcement.content || '').split(/\n{2,}/).map((paragraph, index) => <p key={`${index}-${paragraph.slice(0, 12)}`}>{paragraph}</p>)}</div>
      {error ? <InlineError message={error} /> : null}
      <footer><span>{formatAnnouncementPeriod(announcement)}</span><button className="post-login-primary" type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{busy ? '正在确认…' : total > 1 ? '确认并查看下一条' : '我知道了'}</button></footer>
    </section>
  );
}

function TutorialDialog({ tutorial, stepIndex, busy, error, onPrevious, onNext, onSkip, onComplete }) {
  const titleId = useId();
  const step = tutorial.steps[stepIndex];
  const isLast = stepIndex === tutorial.steps.length - 1;
  return (
    <section className="post-login-dialog post-login-tutorial" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <header className="post-login-tutorial-header"><div><span><Sparkles size={16} />新手教程</span><h2 id={titleId}>{tutorial.title}</h2></div><button type="button" onClick={onSkip} disabled={busy}>跳过教程</button></header>
      <div className="post-login-progress" aria-label={`第 ${stepIndex + 1} 步，共 ${tutorial.steps.length} 步`}>
        <div><span style={{ width: `${((stepIndex + 1) / tutorial.steps.length) * 100}%` }} /></div><small>{stepIndex + 1} / {tutorial.steps.length}</small>
      </div>
      <div className="post-login-tutorial-body">
        <span className="post-login-step-number">{String(stepIndex + 1).padStart(2, '0')}</span>
        <div><small>第 {stepIndex + 1} 步</small><h3>{step.title}</h3><p>{step.content}</p></div>
      </div>
      {error ? <InlineError message={error} /> : null}
      <footer className="post-login-tutorial-footer">
        <button className="post-login-secondary" type="button" onClick={onPrevious} disabled={busy || stepIndex === 0}><ArrowLeft size={17} />上一步</button>
        {isLast ? <button className="post-login-primary" type="button" onClick={onComplete} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}{busy ? '正在保存…' : '完成教程'}</button> : <button className="post-login-primary" type="button" onClick={onNext} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}{busy ? '正在保存…' : '下一步'}</button>}
      </footer>
    </section>
  );
}

function LoadErrorDialog({ message, loading, onRetry, onContinue }) {
  const titleId = useId();
  return (
    <section className="post-login-dialog post-login-load-error" role="alertdialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <span><AlertTriangle size={25} /></span><h2 id={titleId}>登录内容暂时无法读取</h2><p>{message}</p>
      <footer><button className="post-login-secondary" type="button" onClick={onContinue} disabled={loading}>先进入工作台</button><button className="post-login-primary" type="button" onClick={onRetry} disabled={loading}>{loading ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}{loading ? '正在重试…' : '重新读取'}</button></footer>
    </section>
  );
}

function InlineError({ message }) {
  return <div className="post-login-inline-error" role="alert"><AlertTriangle size={16} /><span>{message}</span></div>;
}

function normalizeTutorial(value, fallbackProgress) {
  if (!value || !value.enabled || !Array.isArray(value.steps) || value.steps.length === 0) return { tutorial: null, stepIndex: 0 };
  const tutorial = { ...value, steps: [...value.steps].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)) };
  const progress = tutorial.progress || fallbackProgress || {};
  const progressVersion = Number(progress.tutorialVersion ?? progress.version ?? 0);
  const tutorialVersion = Number(tutorial.version || 0);
  const belongsToCurrentVersion = !progressVersion || !tutorialVersion || progressVersion === tutorialVersion;
  if (belongsToCurrentVersion && ['completed', 'skipped'].includes(progress.status)) return { tutorial: null, stepIndex: 0 };
  const progressStepId = progress.currentStepId ?? progress.stepId;
  const progressStepIndex = progressStepId
    ? tutorial.steps.findIndex((step) => step.id === progressStepId)
    : Number(progress.stepIndex ?? progress.currentStep ?? progress.currentStepIndex ?? 0);
  const stepIndex = belongsToCurrentVersion && Number.isFinite(progressStepIndex) && progressStepIndex >= 0
    ? Math.max(0, Math.min(progressStepIndex, tutorial.steps.length - 1))
    : 0;
  return { tutorial, stepIndex };
}

function tutorialProgressPayload(tutorial, status, stepIndex) {
  const step = tutorial.steps[stepIndex];
  return {
    tutorialId: tutorial.id,
    version: tutorial.version,
    status,
    currentStepId: step?.id || null,
  };
}

function formatAnnouncementPeriod(announcement) {
  const endDate = new Date(announcement.endsAt);
  if (announcement.endsAt && Number.isFinite(endDate.getTime())) return `有效至 ${endDate.toLocaleDateString('zh-CN')}`;
  return '平台通知';
}

export default PostLoginExperience;
