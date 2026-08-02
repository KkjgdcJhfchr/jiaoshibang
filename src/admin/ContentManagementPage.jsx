import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  Edit3,
  Eye,
  LoaderCircle,
  Megaphone,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import './admin-content-management.css';

const DISPLAY_POLICIES = Object.freeze({
  once_per_user: { label: '每位用户仅一次', description: '用户确认后不再展示，适合长期通知。' },
  once_per_revision: { label: '每次更新后一次', description: '公告内容更新后，可再次向已确认用户展示。' },
  every_login: { label: '每次登录', description: '在有效期内每次登录都展示，适合重要临时提醒。' },
});

const EMPTY_ANNOUNCEMENT = Object.freeze({
  title: '',
  content: '',
  enabled: true,
  startsAt: '',
  endsAt: '',
  priority: '50',
  displayPolicy: 'once_per_user',
});

const EMPTY_TUTORIAL = Object.freeze({
  id: 'onboarding',
  title: '欢迎使用',
  enabled: false,
  version: 0,
  steps: [],
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function ContentManagementPage({ onNotice = () => {}, initialSection = 'announcements' }) {
  const [activeSection, setActiveSection] = useState(initialSection);
  const [announcements, setAnnouncements] = useState([]);
  const [tutorial, setTutorial] = useState(() => ({ ...EMPTY_TUTORIAL }));
  const [tutorialDirty, setTutorialDirty] = useState(false);
  const [announcementEditor, setAnnouncementEditor] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const response = await api.getAdminContent();
      const content = response.data?.content || response.data || {};
      const nextAnnouncements = Array.isArray(content.announcements) ? content.announcements : [];
      setAnnouncements(sortAnnouncements(nextAnnouncements));
      setTutorial(normalizeTutorial(content.tutorial));
      setTutorialDirty(false);
    } catch (requestError) {
      setError(requestError.message || '公告与教程读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);
  useEffect(() => { setActiveSection(initialSection); }, [initialSection]);

  const announcementSummary = useMemo(() => {
    const now = Date.now();
    return {
      total: announcements.length,
      enabled: announcements.filter((item) => item.enabled).length,
      active: announcements.filter((item) => isAnnouncementActive(item, now)).length,
    };
  }, [announcements]);

  function openNewAnnouncement() {
    setAnnouncementEditor({ id: '', form: { ...EMPTY_ANNOUNCEMENT } });
  }

  function openAnnouncement(announcement) {
    setAnnouncementEditor({
      id: announcement.id,
      form: {
        title: announcement.title || '',
        content: announcement.content || '',
        enabled: Boolean(announcement.enabled),
        startsAt: toDateTimeInput(announcement.startsAt),
        endsAt: toDateTimeInput(announcement.endsAt),
        priority: String(Number.isFinite(Number(announcement.priority)) ? announcement.priority : 50),
        displayPolicy: DISPLAY_POLICIES[announcement.displayPolicy] ? announcement.displayPolicy : 'once_per_user',
      },
    });
  }

  async function saveAnnouncement(event) {
    event.preventDefault();
    if (!announcementEditor || busy) return;
    const { id, form } = announcementEditor;
    const startsAt = fromDateTimeInput(form.startsAt);
    const endsAt = fromDateTimeInput(form.endsAt);
    if (startsAt && endsAt && new Date(endsAt) <= new Date(startsAt)) {
      setError('公告结束时间必须晚于开始时间');
      return;
    }
    setBusy('announcement-save');
    setError('');
    try {
      const payload = {
        title: form.title.trim(),
        content: form.content.trim(),
        enabled: Boolean(form.enabled),
        startsAt,
        endsAt,
        priority: clampPriority(form.priority),
        displayPolicy: form.displayPolicy,
      };
      if (id) await api.updateAnnouncement(id, payload);
      else await api.createAnnouncement(payload);
      setAnnouncementEditor(null);
      await reload();
      onNotice(id ? '公告已更新' : '公告已创建');
    } catch (requestError) {
      setError(requestError.message || '公告保存失败');
    } finally {
      setBusy('');
    }
  }

  async function toggleAnnouncement(announcement) {
    if (busy) return;
    setBusy(`announcement-toggle-${announcement.id}`);
    setError('');
    try {
      await api.updateAnnouncement(announcement.id, { enabled: !announcement.enabled });
      setAnnouncements((items) => items.map((item) => item.id === announcement.id ? { ...item, enabled: !item.enabled } : item));
      onNotice(announcement.enabled ? '公告已停用' : '公告已启用');
    } catch (requestError) {
      setError(requestError.message || '公告状态更新失败');
    } finally {
      setBusy('');
    }
  }

  async function confirmDeleteAnnouncement() {
    if (!deleteTarget || busy) return;
    setBusy(`announcement-delete-${deleteTarget.id}`);
    setError('');
    try {
      await api.deleteAnnouncement(deleteTarget.id);
      setAnnouncements((items) => items.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      onNotice('公告已删除');
    } catch (requestError) {
      setError(requestError.message || '公告删除失败');
    } finally {
      setBusy('');
    }
  }

  function updateTutorial(field, value) {
    setTutorial((current) => ({ ...current, [field]: value }));
    setTutorialDirty(true);
  }

  function updateTutorialStep(stepId, field, value) {
    setTutorial((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === stepId ? { ...step, [field]: value } : step),
    }));
    setTutorialDirty(true);
  }

  function addTutorialStep() {
    const step = { id: createClientId(), title: '', content: '', order: tutorial.steps.length + 1 };
    setTutorial((current) => ({ ...current, steps: [...current.steps, step] }));
    setTutorialDirty(true);
  }

  function removeTutorialStep(stepId) {
    setTutorial((current) => ({
      ...current,
      steps: withStepOrder(current.steps.filter((step) => step.id !== stepId)),
    }));
    setTutorialDirty(true);
  }

  function moveTutorialStep(stepId, direction) {
    setTutorial((current) => {
      const index = current.steps.findIndex((step) => step.id === stepId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.steps.length) return current;
      const steps = [...current.steps];
      [steps[index], steps[targetIndex]] = [steps[targetIndex], steps[index]];
      return { ...current, steps: withStepOrder(steps) };
    });
    setTutorialDirty(true);
  }

  async function saveTutorial(event) {
    event.preventDefault();
    if (!tutorialDirty || busy) return;
    const steps = tutorial.steps.map((step, index) => ({
      id: step.id,
      title: step.title.trim(),
      content: step.content.trim(),
      order: index + 1,
    }));
    if (tutorial.enabled && steps.length === 0) {
      setError('启用新手教程前，请至少添加一个步骤');
      return;
    }
    if (steps.some((step) => !step.title || !step.content)) {
      setError('请填写每个教程步骤的标题和内容');
      return;
    }
    setBusy('tutorial-save');
    setError('');
    try {
      const response = await api.saveTutorial({
        expectedUpdatedAt: tutorial.updatedAt || null,
        title: tutorial.title.trim(),
        enabled: Boolean(tutorial.enabled),
        steps,
      });
      const saved = response.data?.tutorial || response.data?.content?.tutorial;
      setTutorial(saved ? normalizeTutorial(saved) : { ...tutorial, steps });
      setTutorialDirty(false);
      onNotice('新手教程已保存，用户下次进入工作台时按新版本展示');
    } catch (requestError) {
      setError(requestError.message || '新手教程保存失败');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="admin-content-page" aria-busy={loading}>
      <div className="admin-page-heading admin-content-heading">
        <div><h1>公告与新手教程</h1><p>管理登录后公告弹窗，以及新用户进入工作台时看到的分步使用指引</p></div>
        <button className="admin-button admin-button-secondary" type="button" onClick={reload} disabled={loading || Boolean(busy)}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />刷新内容
        </button>
      </div>

      {error ? <ErrorBanner message={error} onClose={() => setError('')} /> : null}

      <div className="admin-content-tabs" role="tablist" aria-label="内容管理分类">
        <button type="button" role="tab" aria-selected={activeSection === 'announcements'} className={activeSection === 'announcements' ? 'active' : ''} onClick={() => setActiveSection('announcements')}><Megaphone size={17} />公告管理</button>
        <button type="button" role="tab" aria-selected={activeSection === 'tutorial'} className={activeSection === 'tutorial' ? 'active' : ''} onClick={() => setActiveSection('tutorial')}><CheckCircle2 size={17} />新手教程</button>
      </div>

      {activeSection === 'announcements' ? (
        <AnnouncementSection
          announcements={announcements}
          summary={announcementSummary}
          loading={loading}
          busy={busy}
          onCreate={openNewAnnouncement}
          onEdit={openAnnouncement}
          onToggle={toggleAnnouncement}
          onDelete={setDeleteTarget}
        />
      ) : (
        <TutorialSection
          tutorial={tutorial}
          loading={loading}
          busy={busy}
          dirty={tutorialDirty}
          onUpdate={updateTutorial}
          onUpdateStep={updateTutorialStep}
          onAddStep={addTutorialStep}
          onRemoveStep={removeTutorialStep}
          onMoveStep={moveTutorialStep}
          onPreview={() => setPreviewOpen(true)}
          onSave={saveTutorial}
        />
      )}

      {announcementEditor ? (
        <AnnouncementEditor
          editor={announcementEditor}
          busy={busy === 'announcement-save'}
          onChange={(field, value) => setAnnouncementEditor((current) => ({ ...current, form: { ...current.form, [field]: value } }))}
          onClose={() => setAnnouncementEditor(null)}
          onSubmit={saveAnnouncement}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDeleteDialog
          title={deleteTarget.title}
          busy={busy === `announcement-delete-${deleteTarget.id}`}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDeleteAnnouncement}
        />
      ) : null}

      {previewOpen ? <TutorialPreview tutorial={tutorial} onClose={() => setPreviewOpen(false)} /> : null}
    </div>
  );
}

function AnnouncementSection({ announcements, summary, loading, busy, onCreate, onEdit, onToggle, onDelete }) {
  return (
    <section className="admin-panel admin-content-section" role="tabpanel">
      <header className="admin-content-section-header">
        <div><h2>公告列表</h2><p>启用且处于有效期的公告，将在用户登录后按优先级从高到低展示。</p></div>
        <button className="admin-button admin-button-primary" type="button" onClick={onCreate} disabled={loading || Boolean(busy)}><Plus size={17} />新增公告</button>
      </header>
      <div className="admin-content-summary" aria-label="公告汇总">
        <span><b>{summary.total}</b>全部公告</span>
        <span><b>{summary.enabled}</b>已启用</span>
        <span><b>{summary.active}</b>当前展示中</span>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table admin-content-table">
          <caption className="admin-sr-only">公告列表</caption>
          <thead><tr><th>公告</th><th>状态</th><th>展示策略</th><th>有效期</th><th>优先级</th><th>操作</th></tr></thead>
          <tbody>
            {!loading ? announcements.map((announcement) => {
              const status = getAnnouncementStatus(announcement);
              const rowBusy = busy.endsWith(announcement.id);
              return (
                <tr key={announcement.id}>
                  <td><div className="admin-content-announcement-title"><b>{announcement.title}</b><small>修订版本 {announcement.revision || 1} · 更新于 {formatDateTime(announcement.updatedAt)}</small></div></td>
                  <td><span className={`admin-status ${status.className}`}>{status.label}</span></td>
                  <td>{DISPLAY_POLICIES[announcement.displayPolicy]?.label || '每位用户仅一次'}</td>
                  <td>{formatValidity(announcement)}</td>
                  <td><b className="admin-content-priority">{Number(announcement.priority || 0)}</b></td>
                  <td><div className="admin-content-row-actions">
                    <button className={`admin-toggle ${announcement.enabled ? 'admin-toggle-on' : ''}`} type="button" role="switch" aria-checked={Boolean(announcement.enabled)} aria-label={`${announcement.enabled ? '停用' : '启用'}公告 ${announcement.title}`} disabled={Boolean(busy)} aria-busy={rowBusy} onClick={() => onToggle(announcement)}><span className="admin-toggle-knob" /></button>
                    <button type="button" aria-label={`编辑公告 ${announcement.title}`} onClick={() => onEdit(announcement)} disabled={Boolean(busy)}><Edit3 size={15} /></button>
                    <button className="danger" type="button" aria-label={`删除公告 ${announcement.title}`} onClick={() => onDelete(announcement)} disabled={Boolean(busy)}><Trash2 size={15} /></button>
                  </div></td>
                </tr>
              );
            }) : null}
            {loading ? <tr><td className="admin-content-state" colSpan="6"><LoaderCircle className="spin" size={20} />正在读取公告…</td></tr> : null}
            {!loading && announcements.length === 0 ? <tr><td className="admin-content-empty" colSpan="6"><Megaphone size={25} /><b>还没有公告</b><span>点击“新增公告”创建第一条登录后通知。</span></td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TutorialSection({ tutorial, loading, busy, dirty, onUpdate, onUpdateStep, onAddStep, onRemoveStep, onMoveStep, onPreview, onSave }) {
  return (
    <form className="admin-content-tutorial" role="tabpanel" onSubmit={onSave}>
      <section className="admin-panel admin-content-tutorial-settings">
        <header><div><h2>教程设置</h2><p>教程启用后，未完成当前版本的用户会从其服务端保存的进度继续。</p></div><button className={`admin-toggle ${tutorial.enabled ? 'admin-toggle-on' : ''}`} type="button" role="switch" aria-checked={tutorial.enabled} aria-label="启用新手教程" disabled={loading || Boolean(busy)} onClick={() => onUpdate('enabled', !tutorial.enabled)}><span className="admin-toggle-knob" /></button></header>
        <label><span>教程标题</span><input value={tutorial.title} onChange={(event) => onUpdate('title', event.target.value)} minLength={2} maxLength={80} required disabled={loading || Boolean(busy)} /></label>
        <dl><div><dt>当前版本</dt><dd>{tutorial.version || 0}</dd></div><div><dt>步骤数量</dt><dd>{tutorial.steps.length}</dd></div><div><dt>保存后</dt><dd>自动生成新版本</dd></div></dl>
        <div className="admin-content-tutorial-actions">
          <button className="admin-button admin-button-secondary" type="button" onClick={onPreview} disabled={tutorial.steps.length === 0 || loading}><Eye size={17} />预览教程</button>
          <button className="admin-button admin-button-primary" type="submit" disabled={!dirty || loading || Boolean(busy)}>{busy === 'tutorial-save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存教程</button>
        </div>
      </section>

      <section className="admin-panel admin-content-steps">
        <header className="admin-content-section-header"><div><h2>教程步骤</h2><p>使用上下按钮调整顺序；用户端将按这里的顺序逐步展示。</p></div><button className="admin-button admin-button-secondary" type="button" onClick={onAddStep} disabled={loading || Boolean(busy)}><Plus size={17} />添加步骤</button></header>
        <div className="admin-content-step-list">
          {tutorial.steps.map((step, index) => (
            <article className="admin-content-step" key={step.id}>
              <div className="admin-content-step-number"><span>{index + 1}</span><small>第 {index + 1} 步</small></div>
              <div className="admin-content-step-fields">
                <label><span>步骤标题</span><input value={step.title} onChange={(event) => onUpdateStep(step.id, 'title', event.target.value)} maxLength={80} required disabled={Boolean(busy)} placeholder="例如：上传本章教材" /></label>
                <label><span>说明内容</span><textarea value={step.content} onChange={(event) => onUpdateStep(step.id, 'content', event.target.value)} maxLength={2000} required disabled={Boolean(busy)} placeholder="说明这一步要完成的操作、注意事项或成功结果" /></label>
              </div>
              <div className="admin-content-step-actions">
                <button type="button" aria-label={`上移第 ${index + 1} 步`} disabled={index === 0 || Boolean(busy)} onClick={() => onMoveStep(step.id, -1)}><ArrowUp size={15} /></button>
                <button type="button" aria-label={`下移第 ${index + 1} 步`} disabled={index === tutorial.steps.length - 1 || Boolean(busy)} onClick={() => onMoveStep(step.id, 1)}><ArrowDown size={15} /></button>
                <button className="danger" type="button" aria-label={`删除第 ${index + 1} 步`} disabled={Boolean(busy)} onClick={() => onRemoveStep(step.id)}><Trash2 size={15} /></button>
              </div>
            </article>
          ))}
          {!loading && tutorial.steps.length === 0 ? <div className="admin-content-step-empty"><CheckCircle2 size={27} /><b>尚未添加教程步骤</b><span>添加后可编辑每一步的标题、说明和展示顺序。</span><button className="admin-button admin-button-secondary" type="button" onClick={onAddStep}><Plus size={17} />添加第一步</button></div> : null}
          {loading ? <div className="admin-content-step-loading"><LoaderCircle className="spin" size={20} />正在读取教程…</div> : null}
        </div>
      </section>
    </form>
  );
}

function AnnouncementEditor({ editor, busy, onChange, onClose, onSubmit }) {
  const { form } = editor;
  return (
    <div className="admin-content-dialog-layer">
      <button className="admin-content-dialog-backdrop" type="button" onClick={onClose} aria-label="关闭公告编辑窗口" disabled={busy} />
      <section className="admin-content-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-content-announcement-title">
        <header><div><h2 id="admin-content-announcement-title">{editor.id ? '编辑公告' : '新增公告'}</h2><p>公告保存后会按照状态、有效期和展示策略自动出现在用户端。</p></div><button type="button" onClick={onClose} aria-label="关闭" disabled={busy}><X size={20} /></button></header>
        <form onSubmit={onSubmit}>
          <label className="wide"><span>公告标题</span><input value={form.title} onChange={(event) => onChange('title', event.target.value)} minLength={2} maxLength={100} required autoFocus disabled={busy} /></label>
          <label className="wide"><span>公告内容</span><textarea value={form.content} onChange={(event) => onChange('content', event.target.value)} minLength={2} maxLength={10000} required disabled={busy} /></label>
          <label><span>开始时间（可留空）</span><input type="datetime-local" value={form.startsAt} onChange={(event) => onChange('startsAt', event.target.value)} disabled={busy} /></label>
          <label><span>结束时间（可留空）</span><input type="datetime-local" value={form.endsAt} onChange={(event) => onChange('endsAt', event.target.value)} disabled={busy} /></label>
          <label><span>展示策略</span><select value={form.displayPolicy} onChange={(event) => onChange('displayPolicy', event.target.value)} disabled={busy}>{Object.entries(DISPLAY_POLICIES).map(([value, option]) => <option value={value} key={value}>{option.label}</option>)}</select><small>{DISPLAY_POLICIES[form.displayPolicy]?.description}</small></label>
          <label><span>优先级（0–100）</span><input type="number" value={form.priority} onChange={(event) => onChange('priority', event.target.value)} min="0" max="100" step="1" required disabled={busy} /><small>数值越高越先展示。</small></label>
          <div className="admin-content-dialog-switch wide"><div><b>立即启用</b><span>关闭时仅保存内容，不会向用户展示。</span></div><button className={`admin-toggle ${form.enabled ? 'admin-toggle-on' : ''}`} type="button" role="switch" aria-checked={form.enabled} disabled={busy} onClick={() => onChange('enabled', !form.enabled)}><span className="admin-toggle-knob" /></button></div>
          <footer className="wide"><button className="admin-button admin-button-secondary" type="button" onClick={onClose} disabled={busy}>取消</button><button className="admin-button admin-button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{busy ? '正在保存…' : '保存公告'}</button></footer>
        </form>
      </section>
    </div>
  );
}

function ConfirmDeleteDialog({ title, busy, onCancel, onConfirm }) {
  return (
    <div className="admin-content-dialog-layer">
      <button className="admin-content-dialog-backdrop" type="button" onClick={onCancel} aria-label="取消删除" disabled={busy} />
      <section className="admin-content-dialog admin-content-confirm" role="alertdialog" aria-modal="true" aria-labelledby="admin-content-delete-title">
        <span><Trash2 size={23} /></span>
        <h2 id="admin-content-delete-title">删除这条公告？</h2>
        <p>“{title}”删除后无法恢复，尚未确认的用户也不会再看到它。</p>
        <footer><button className="admin-button admin-button-secondary" type="button" onClick={onCancel} disabled={busy}>取消</button><button className="admin-button admin-content-delete-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{busy ? '正在删除…' : '确认删除'}</button></footer>
      </section>
    </div>
  );
}

function TutorialPreview({ tutorial, onClose }) {
  const [stepIndex, setStepIndex] = useState(0);
  const steps = tutorial.steps;
  const step = steps[stepIndex];
  if (!step) return null;
  return (
    <div className="admin-content-dialog-layer">
      <button className="admin-content-dialog-backdrop" type="button" onClick={onClose} aria-label="关闭教程预览" />
      <section className="admin-content-preview" role="dialog" aria-modal="true" aria-labelledby="admin-content-preview-title">
        <header><span>用户端预览</span><button type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
        <div className="admin-content-preview-progress"><span style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }} /></div>
        <div className="admin-content-preview-body"><small>第 {stepIndex + 1} 步，共 {steps.length} 步</small><h2 id="admin-content-preview-title">{step.title || '未填写步骤标题'}</h2><p>{step.content || '未填写步骤说明。'}</p></div>
        <footer><button className="admin-button admin-button-secondary" type="button" onClick={stepIndex === 0 ? onClose : () => setStepIndex((value) => value - 1)}>{stepIndex === 0 ? '退出预览' : '上一步'}</button><button className="admin-button admin-button-primary" type="button" onClick={stepIndex === steps.length - 1 ? onClose : () => setStepIndex((value) => value + 1)}>{stepIndex === steps.length - 1 ? '完成' : '下一步'}</button></footer>
      </section>
    </div>
  );
}

function ErrorBanner({ message, onClose }) {
  return <div className="admin-content-error" role="alert"><AlertTriangle size={18} /><span>{message}</span><button type="button" onClick={onClose} aria-label="关闭错误提示"><X size={16} /></button></div>;
}

function normalizeTutorial(value) {
  const tutorial = value && typeof value === 'object' ? value : EMPTY_TUTORIAL;
  const steps = Array.isArray(tutorial.steps) ? [...tutorial.steps].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)) : [];
  return { ...EMPTY_TUTORIAL, ...tutorial, enabled: Boolean(tutorial.enabled), steps: withStepOrder(steps) };
}

function sortAnnouncements(items) {
  return [...items].sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0) || new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

function withStepOrder(steps) {
  return steps.map((step, index) => ({ ...step, id: step.id || createClientId(), order: index + 1 }));
}

function createClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `step-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function clampPriority(value) {
  return Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
}

function isAnnouncementActive(announcement, now = Date.now()) {
  if (!announcement.enabled) return false;
  if (announcement.startsAt && new Date(announcement.startsAt).getTime() > now) return false;
  if (announcement.endsAt && new Date(announcement.endsAt).getTime() < now) return false;
  return true;
}

function getAnnouncementStatus(announcement) {
  const now = Date.now();
  if (!announcement.enabled) return { label: '已停用', className: 'admin-status-muted' };
  if (announcement.startsAt && new Date(announcement.startsAt).getTime() > now) return { label: '待开始', className: 'admin-status-info' };
  if (announcement.endsAt && new Date(announcement.endsAt).getTime() < now) return { label: '已结束', className: 'admin-status-muted' };
  return { label: '展示中', className: 'admin-status-success' };
}

function formatValidity(announcement) {
  if (!announcement.startsAt && !announcement.endsAt) return '长期有效';
  const start = announcement.startsAt ? formatDateTime(announcement.startsAt) : '立即';
  const end = announcement.endsAt ? formatDateTime(announcement.endsAt) : '长期';
  return `${start} 至 ${end}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? DATE_TIME_FORMATTER.format(date) : '—';
}

function toDateTimeInput(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromDateTimeInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
