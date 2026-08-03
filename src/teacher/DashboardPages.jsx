import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Copy,
  Crown,
  FileText,
  Gift,
  GraduationCap,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  PartyPopper,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  WandSparkles,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { navigate } from '../lib/navigation.jsx';
import { useSiteConfig } from '../lib/site-config.jsx';
import { accountDisplayName, Button, EmptyState, Field, Modal, Status, TeacherShell, Toast, useAccount } from './components.jsx';

const LESSON_LIBRARY_KEY = 'teacher-helper.lesson-library.v2';
const LESSON_DRAFT_VERSION = 2;

const draftDefaults = {
  subject: '语文', grade: '七年级', edition: '人教版', chapterTitle: '', lessonType: '新授课',
  durationMinutes: 45, classSize: 42, classProfile: '', requirements: '', detailLevel: '详细', style: '启发式',
  interaction: '较多', exerciseCount: 10, includeScript: true, includeDifferentiation: true, includeFallbacks: true,
};

let pendingGeneration = null;
const MATERIAL_UPLOAD_CONCURRENCY = 3;

function safeRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function saveDraft(draft) {
  sessionStorage.setItem('lesson-draft', JSON.stringify({ ...draft, draftVersion: LESSON_DRAFT_VERSION }));
}

function readDraft() {
  try {
    const stored = JSON.parse(sessionStorage.getItem('lesson-draft'));
    if (!stored) return draftDefaults;
    const { draftVersion, ...draft } = stored;
    return {
      ...draft,
      chapterTitle: draftVersion !== LESSON_DRAFT_VERSION && draft.chapterTitle === '《春》' ? '' : (draft.chapterTitle || ''),
    };
  } catch { return draftDefaults; }
}

function chapterPlaceholder(subject) {
  if (subject === '语文') return '例如：《春》';
  if (subject === '数学') return '例如：勾股定理';
  return '例如：填写本章节名称';
}

function loadLessonLibrary() {
  const stored = safeRead(LESSON_LIBRARY_KEY, []);
  return Array.isArray(stored) ? stored : [];
}

function persistCurrentLessonSummary(lesson) {
  const metadata = lesson.metadata || {};
  const chapter = metadata.chapter || metadata.chapterTitle || lesson.title || '新教案';
  const title = metadata.title || `${chapter}教学设计`;
  const subject = metadata.subject || '学科待确认';
  const grade = metadata.grade || '年级待确认';
  const duration = Number(metadata.duration_minutes || metadata.durationMinutes || 45);
  const exerciseCount = Array.isArray(lesson.exercises) ? lesson.exercises.length : 0;
  localStorage.setItem(LESSON_LIBRARY_KEY, JSON.stringify([{
    id: lesson.id,
    title,
    meta: `${subject} · ${grade}`,
    duration,
    exerciseCount,
    updated: '刚刚',
    status: '已完成',
  }]));
}

function maskAccount(value = '') {
  const account = String(value);
  if (account.includes('@')) {
    const [name, domain] = account.split('@');
    return `${name.slice(0, 2)}***@${domain}`;
  }
  if (account.length >= 7) return `${account.slice(0, 3)} **** ${account.slice(-4)}`;
  return account || '未提供';
}

async function toAttachment(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return { name: file.name, type: file.type, size: file.size, dataUrl };
}

function fileSizeLabel(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function materialMimeType(file) {
  const declared = String(file.type || '').toLowerCase();
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'].includes(declared)) return declared;
  const extension = String(file.name || '').split('.').pop()?.toLowerCase();
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' })[extension] || '';
}

function UploadMaterialCard({ item, onRemove, onRetry }) {
  const stateLabel = {
    queued: '等待上传',
    uploading: '上传中',
    uploaded: '上传成功',
    failed: '上传失败',
    deleting: '删除中',
  }[item.status] || '等待上传';
  return (
    <article className={`upload-material-card status-${item.status}`} role="listitem">
      <div className="upload-material-preview">
        {item.previewUrl ? <img src={item.previewUrl} alt={`${item.name}预览`} /> : <span><FileText size={28} /><b>PDF</b></span>}
        {item.status === 'uploading' || item.status === 'deleting' ? <i className="upload-material-spinner"><LoaderCircle className="spin" size={18} /></i> : null}
        {item.status === 'uploaded' ? <i className="upload-material-success"><Check size={15} /></i> : null}
      </div>
      <div className="upload-material-copy">
        <b title={item.name}>{item.name}</b>
        <small>{fileSizeLabel(item.size)} · <span>{stateLabel}</span></small>
        {item.error ? <em title={item.error}>{item.error}</em> : null}
      </div>
      <div className="upload-material-actions">
        {item.status === 'failed' ? <button type="button" onClick={() => onRetry(item.clientId)} aria-label={`重新上传 ${item.name}`} title="重新上传"><RotateCcw size={15} /></button> : null}
        <button type="button" onClick={() => onRemove(item)} disabled={item.status === 'deleting'} aria-label={`删除 ${item.name}`} title="删除"><X size={16} /></button>
      </div>
    </article>
  );
}

function normalizeReferralOverviewResponse(response) {
  const payload = response?.data?.overview || response?.data || {};
  const program = payload.settings || payload.program || payload.referralProgram || {};
  const referralCode = String(payload.referralCode || payload.inviteCode || payload.code || '').trim();
  const referralLink = String(payload.shareUrl || payload.referralLink || payload.inviteLink || payload.link || (referralCode ? `${window.location.origin}/register?ref=${encodeURIComponent(referralCode)}` : '')).trim();
  return {
    program,
    referralCode,
    referralLink,
    stats: payload.stats || payload.summary || {},
    records: Array.isArray(payload.records) ? payload.records : Array.isArray(payload.referrals) ? payload.referrals : [],
  };
}

async function writeClipboard(value) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Some browsers expose Clipboard API but deny it outside a secure context.
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('clipboard unavailable');
}

function DashboardReferralCard() {
  const { referralProgram } = useSiteConfig();
  const [state, setState] = useState({ loading: true, error: '', overview: null });
  const [copyStatus, setCopyStatus] = useState('');
  const copyTimerRef = useRef(null);

  useEffect(() => {
    let active = true;
    api.getReferralOverview().then((response) => {
      if (active) setState({ loading: false, error: '', overview: normalizeReferralOverviewResponse(response) });
    }).catch((requestError) => {
      if (active) setState({ loading: false, error: requestError.message || '推广奖励暂时无法读取。', overview: null });
    });
    return () => {
      active = false;
      window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  async function copy(value, label) {
    if (!value) return;
    try {
      await writeClipboard(value);
      setCopyStatus(`${label}已复制`);
    } catch {
      setCopyStatus('复制失败，请手动选择复制');
    }
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyStatus(''), 2_400);
  }

  if (state.loading) {
    return <section className="dashboard-referral-card is-loading" aria-busy="true"><LoaderCircle className="spin" size={21} /><div><b>正在读取推广奖励</b><span>马上为你显示当前奖励规则和专属推广链接。</span></div></section>;
  }
  if (state.error) {
    return <section className="dashboard-referral-card is-error" role="alert"><AlertTriangle size={21} /><div><b>推广奖励暂时无法读取</b><span>{state.error}</span></div><button type="button" onClick={() => navigate('/app/referrals')}>进入推广中心 <ChevronRight size={15} /></button></section>;
  }

  const overview = state.overview || {};
  const program = { ...(overview.program || {}), ...(referralProgram || {}) };
  const enabled = program.enabled === true;
  const inviterReward = program.rewardMode === 'invitee_only' ? 0 : Number(program.inviterRewardCredits || 0);
  const inviteeReward = program.rewardMode === 'inviter_only' ? 0 : Number(program.inviteeRewardCredits || 0);

  return (
    <section className={`dashboard-referral-card ${enabled ? 'is-enabled' : 'is-paused'}`}>
      <div className="dashboard-referral-copy">
        <span><PartyPopper size={17} />{enabled ? '推广有礼 · 活动进行中' : '推广有礼 · 活动暂停'}</span>
        <h2>{program.headline || '邀请好友一起高效备课'}</h2>
        <p>{program.description || '分享专属邀请链接，符合规则后获得教案生成额度。'}</p>
        <div><b>邀请人 +{inviterReward} 额度</b><b>新用户 +{inviteeReward} 额度</b></div>
      </div>
      <div className="dashboard-referral-tools">
        {!enabled ? <p className="dashboard-referral-paused"><Clock3 size={14} />当前活动尚未开启，入口会保留，开启后即可复制分享。</p> : null}
        <label><span>我的邀请码</span><div><strong>{overview.referralCode || '暂未生成'}</strong><button type="button" disabled={!enabled || !overview.referralCode} onClick={() => void copy(overview.referralCode, '邀请码')}><Copy size={15} />复制</button></div></label>
        <label><span>专属推广链接</span><div><input readOnly value={overview.referralLink || ''} aria-label="专属推广链接" /><button type="button" disabled={!enabled || !overview.referralLink} onClick={() => void copy(overview.referralLink, '推广链接')}><Share2 size={15} />复制链接</button></div></label>
        <footer>{copyStatus ? <span role="status"><Check size={14} />{copyStatus}</span> : <span /> }<button type="button" onClick={() => navigate('/app/referrals')}>查看推广详情 <ArrowRight size={15} /></button></footer>
      </div>
    </section>
  );
}

export function DashboardPage({ path }) {
  const account = useAccount();
  const displayName = accountDisplayName(account);
  const credits = Number(account?.credits || 0);
  const lessons = loadLessonLibrary().slice(0, 5);

  return (
    <TeacherShell path={path} title={`你好，${displayName}`} subtitle="今天也一起备好一堂课。">
      <div className="dashboard-layout">
        <div className="dashboard-main-column">
          <DashboardReferralCard />
          <section className="recent-panel">
            <header><div><h2>最近教案</h2><p>继续编辑、查看生成进度或导出定稿。</p></div><Button variant="ghost" onClick={() => navigate('/app/plans')}>查看全部 <ChevronRight size={16} /></Button></header>
            <div className="lesson-list lesson-list-header"><span>教案名称</span><span>学科 / 年级</span><span>更新时间</span><span>状态</span><span /></div>
            {lessons.map((lesson) => (
              <button className="lesson-list" key={lesson.id} onClick={() => navigate(`/app/lesson/${lesson.id}`)}>
                <span className="lesson-name"><FileText size={17} /><b>{lesson.title}</b></span><span>{lesson.meta}</span><span>{lesson.updated}</span><span><Status>{lesson.status}</Status></span><span><MoreHorizontal size={17} /></span>
              </button>
            ))}
            {!lessons.length ? <p className="dashboard-empty-lessons">当前浏览器还没有生成过教案，完成一次生成后会显示在这里。</p> : null}
          </section>
        </div>

        <aside className="dashboard-rail">
          <section className="quota-card"><div className="rail-card-title"><b>教案生成点数</b><CircleDollarSign size={17} /></div><p>真实账户剩余点数</p><div className="quota-value"><strong>{credits}</strong></div><div className="progress-track"><i style={{ width: `${Math.min(100, credits / 3 * 100)}%` }} /></div><button onClick={() => navigate('/app/quota')}>查看规则说明 <ChevronRight size={15} /></button></section>
          <section className="offer-card"><div><Gift size={18} /><b>会员优惠</b></div><h3>查看当前在售套餐</h3><p>套餐价格、点数、有效期和限时优惠以下单确认页为准。</p><button onClick={() => navigate('/app/membership')}>查看会员方案 <ArrowRight size={15} /></button></section>
          <section className="membership-card"><div className="rail-card-title"><b>当前账户</b><Crown size={18} /></div><h3><BadgeCheck size={18} /> 免费体验账户</h3><p>剩余 {credits} 次完整生成额度</p><ul><li><Check size={15} /> 教案生成与 AI 修改</li><li><Check size={15} /> 结构化教案导出</li><li><Check size={15} /> 点数明细与套餐权益</li></ul><Button variant="secondary" onClick={() => navigate('/app/membership')}>查看套餐说明</Button></section>
        </aside>
      </div>
    </TeacherShell>
  );
}

function referralStatusLabel(value) {
  const status = String(value || '').toLowerCase();
  if (['rewarded', 'credited', 'completed', 'success'].includes(status)) return '已到账';
  if (['rejected', 'invalid', 'cancelled'].includes(status)) return '已退回';
  if (['registered', 'qualified'].includes(status)) return '已注册';
  return '审核中';
}

function referralDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '—';
}

export function ReferralPage({ path }) {
  const { referralProgram } = useSiteConfig();
  const [state, setState] = useState({ loading: true, error: '', overview: null });
  const [copyStatus, setCopyStatus] = useState('');
  const copyTimerRef = useRef(null);

  useEffect(() => {
    let active = true;
    api.getReferralOverview().then((response) => {
      if (!active) return;
      setState({
        loading: false,
        error: '',
        overview: normalizeReferralOverviewResponse(response),
      });
    }).catch((requestError) => {
      if (active) setState({ loading: false, error: requestError.message || '推广数据暂时无法读取，请稍后重试。', overview: null });
    });
    return () => {
      active = false;
      window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  async function copyText(value, label) {
    if (!value) return;
    try {
      await writeClipboard(value);
    } catch {
      setCopyStatus('复制失败，请手动选择复制');
      return;
    }
    setCopyStatus(`${label}已复制`);
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopyStatus(''), 2_400);
  }

  const overview = state.overview;
  const program = { ...(overview?.program || {}), ...(referralProgram || {}) };
  const stats = overview?.stats || {};
  const records = overview?.records || [];
  const programEnabled = program.enabled === true;
  const inviterReward = program.rewardMode === 'invitee_only' ? 0 : Number(program.inviterRewardCredits ?? program.referrerCredits ?? program.rewardCredits ?? 0);
  const inviteeReward = program.rewardMode === 'inviter_only' ? 0 : Number(program.inviteeRewardCredits ?? program.newUserCredits ?? 0);
  const rules = Array.isArray(program.rules)
    ? program.rules
    : String(program.rules || program.description || '好友通过你的邀请链接完成注册并符合活动规则后，奖励将自动发放到账户。').split(/\n+/).filter(Boolean);

  return (
    <TeacherShell path={path} title="推广有礼" subtitle="邀请更多教师一起高效备课，符合规则后获得平台额度。" contentClass="referral-shell">
      <div className="referral-page">
        {state.loading ? <div className="referral-loading" role="status"><LoaderCircle className="spin" size={24} /><span>正在读取推广信息…</span></div> : null}
        {state.error ? <div className="referral-error" role="alert"><p>{state.error}</p><Button variant="secondary" onClick={() => window.location.reload()}>重新加载</Button></div> : null}
        {overview ? <>
          <section className={`referral-hero-card ${programEnabled ? 'is-enabled' : 'is-paused'}`}>
            <div className="referral-hero-copy"><span><Gift size={20} /> 邀请奖励 · {programEnabled ? '活动进行中' : '活动暂停'}</span><h2>{program.headline || program.title || '邀请好友，双方都有礼'}</h2><p>{program.subtitle || program.description || '分享你的专属邀请链接，好友完成注册并满足活动条件后，奖励自动到账。'}</p><div className="referral-reward-pills"><b>邀请人 +{inviterReward} 额度</b><b>新用户 +{inviteeReward} 额度</b></div>{!programEnabled ? <p className="referral-program-paused"><Clock3 size={14} />管理员尚未开启本期活动；你仍可查看规则，开启后即可复制分享。</p> : null}</div>
            <div className="referral-share-box">
              <label><span>我的邀请码</span><div><strong>{overview.referralCode || '暂未生成'}</strong><button type="button" disabled={!programEnabled || !overview.referralCode} onClick={() => void copyText(overview.referralCode, '邀请码')}><Copy size={16} /> 复制</button></div></label>
              <label><span>专属邀请链接</span><div><input readOnly value={overview.referralLink} aria-label="专属邀请链接" /><button type="button" disabled={!programEnabled || !overview.referralLink} onClick={() => void copyText(overview.referralLink, '邀请链接')}><Share2 size={16} /> 复制链接</button></div></label>
              {copyStatus ? <p className="referral-copy-status" role="status"><Check size={15} /> {copyStatus}</p> : null}
            </div>
          </section>

          <section className="referral-stats" aria-label="推广统计">
            <article><small>累计邀请</small><b>{Number(stats.invitedCount ?? stats.totalInvites ?? stats.total ?? records.length)}</b><span>人</span></article>
            <article><small>奖励人数</small><b>{Number(stats.rewardedCount ?? stats.qualifiedInvites ?? stats.successful ?? stats.completed ?? 0)}</b><span>人</span></article>
            <article><small>已获奖励</small><b>{Number(stats.creditsEarned ?? stats.rewardCredits ?? stats.credited ?? stats.totalReward ?? 0)}</b><span>额度</span></article>
            <article><small>剩余可奖励</small><b>{stats.remainingRewards === null ? '不限' : Number(stats.remainingRewards ?? 0)}</b><span>{stats.remainingRewards === null ? '' : '人'}</span></article>
          </section>

          <div className="referral-content-grid">
            <section className="referral-rules"><header><h2>活动规则</h2><p>奖励发放以当前活动配置及实际审核结果为准。</p></header><ol>{rules.map((rule, index) => <li key={`${index}-${rule}`}><span>{index + 1}</span><p>{rule}</p></li>)}</ol></section>
            <section className="referral-records"><header><h2>邀请记录</h2><p>这里会显示好友注册及奖励到账进度。</p></header>{records.length ? <div className="referral-record-list">{records.map((record, index) => <article key={record.id || `${record.account || record.invitee || 'record'}-${index}`}><div><b>{record.displayName || record.maskedAccount || record.account || record.invitee || '受邀用户'}</b><small>{referralDate(record.registeredAt || record.createdAt)}</small></div><span>{Number(record.rewardCredits ?? record.reward ?? inviterReward)} 额度</span><Status>{referralStatusLabel(record.status)}</Status></article>)}</div> : <EmptyState icon={UserRound} title="还没有邀请记录" text="复制上方邀请链接分享给好友，成功邀请后会显示在这里。" />}</section>
          </div>
        </> : null}
      </div>
    </TeacherShell>
  );
}

const wizardSteps = ['课程信息', '上传教材', '生成偏好', '确认生成'];

export function CreateLessonPage({ path }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => ({ ...draftDefaults, ...readDraft() }));
  const [materials, setMaterials] = useState([]);
  const [activeUploads, setActiveUploads] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [rights, setRights] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);
  const mountedRef = useRef(true);
  const materialsRef = useRef([]);
  const preserveAttachmentsRef = useRef(false);
  const previewUrlsRef = useRef(new Set());
  const uploadingIdsRef = useRef(new Set());
  const removedIdsRef = useRef(new Set());
  materialsRef.current = materials;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!preserveAttachmentsRef.current) {
        materialsRef.current.forEach((item) => {
          removedIdsRef.current.add(item.clientId);
          if (item.attachment?.id) void api.deleteLessonMaterial(item.attachment.id).catch(() => {});
        });
      }
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
    };
  }, []);

  const uploadMaterial = useCallback(async (item) => {
    try {
      const encoded = await toAttachment(item.file);
      const payload = {
        ...encoded,
        type: item.type,
        dataUrl: encoded.dataUrl.replace(/^data:[^;,]*/i, `data:${item.type}`),
      };
      const response = await api.uploadLessonMaterial(payload);
      const received = response.data?.attachment;
      const attachmentId = received?.id || received?.attachmentId;
      if (!attachmentId) throw new Error('服务器没有返回教材附件编号。');
      const attachment = {
        ...received,
        id: attachmentId,
        name: received?.name || item.name,
        type: received?.type || item.type,
        size: Number(received?.size ?? item.size),
      };
      if (removedIdsRef.current.has(item.clientId)) {
        await api.deleteLessonMaterial(attachment.id).catch(() => {});
        return;
      }
      if (mountedRef.current) {
        setMaterials((current) => current.map((entry) => entry.clientId === item.clientId
          ? { ...entry, status: 'uploaded', attachment, error: '' }
          : entry));
      }
    } catch (uploadError) {
      if (!removedIdsRef.current.has(item.clientId) && mountedRef.current) {
        setMaterials((current) => current.map((entry) => entry.clientId === item.clientId
          ? { ...entry, status: 'failed', error: uploadError.message || '上传失败，请重试。' }
          : entry));
      }
    } finally {
      uploadingIdsRef.current.delete(item.clientId);
      if (mountedRef.current) setActiveUploads((current) => Math.max(0, current - 1));
    }
  }, []);

  useEffect(() => {
    const available = MATERIAL_UPLOAD_CONCURRENCY - uploadingIdsRef.current.size;
    if (available <= 0) return;
    const queued = materials
      .filter((item) => item.status === 'queued' && !uploadingIdsRef.current.has(item.clientId))
      .slice(0, available);
    queued.forEach((item) => {
      uploadingIdsRef.current.add(item.clientId);
      setActiveUploads((current) => current + 1);
      setMaterials((current) => current.map((entry) => entry.clientId === item.clientId ? { ...entry, status: 'uploading', error: '' } : entry));
      void uploadMaterial(item);
    });
  }, [activeUploads, materials, uploadMaterial]);

  function update(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  function updateSubject(subject) {
    setDraft((current) => ({ ...current, subject, chapterTitle: '' }));
  }
  function addFiles(list) {
    const incoming = [...list];
    const accepted = incoming.map((file) => ({ file, type: materialMimeType(file) })).filter((item) => item.type);
    if (accepted.length !== incoming.length) setError('已忽略不支持的文件，请上传教材图片或 PDF。');
    else setError('');
    const nextItems = accepted.map(({ file, type }, index) => {
      const previewUrl = type.startsWith('image/') ? URL.createObjectURL(file) : '';
      if (previewUrl) previewUrlsRef.current.add(previewUrl);
      return {
        clientId: crypto.randomUUID?.() || `material-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
        file,
        name: file.name,
        type,
        size: file.size,
        previewUrl,
        status: 'queued',
        attachment: null,
        error: '',
      };
    });
    if (nextItems.length) setMaterials((current) => [...current, ...nextItems]);
  }

  async function removeMaterial(item) {
    removedIdsRef.current.add(item.clientId);
    if (item.status !== 'uploaded' || !item.attachment?.id) {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
      }
      setMaterials((current) => current.filter((entry) => entry.clientId !== item.clientId));
      return;
    }
    setMaterials((current) => current.map((entry) => entry.clientId === item.clientId ? { ...entry, status: 'deleting', error: '' } : entry));
    try {
      await api.deleteLessonMaterial(item.attachment.id);
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
      }
      setMaterials((current) => current.filter((entry) => entry.clientId !== item.clientId));
    } catch (deleteError) {
      removedIdsRef.current.delete(item.clientId);
      setMaterials((current) => current.map((entry) => entry.clientId === item.clientId
        ? { ...entry, status: 'uploaded', error: deleteError.message || '删除失败，请稍后重试。' }
        : entry));
      setError(deleteError.message || '教材删除失败，请稍后重试。');
    }
  }

  function retryMaterial(clientId) {
    setError('');
    setMaterials((current) => current.map((item) => item.clientId === clientId ? { ...item, status: 'queued', error: '' } : item));
  }

  async function clearMaterials() {
    const current = materials;
    current.forEach((item) => {
      removedIdsRef.current.add(item.clientId);
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
      }
    });
    setMaterials([]);
    if (fileInput.current) fileInput.current.value = '';
    const uploaded = current.filter((item) => item.attachment?.id).map((item) => api.deleteLessonMaterial(item.attachment.id));
    if (uploaded.length) {
      const results = await Promise.allSettled(uploaded);
      if (results.some((result) => result.status === 'rejected')) setError('部分教材未能从服务器删除，请稍后再试。');
    }
  }
  function next() {
    setError('');
    if (step === 1 && materials.length === 0) { setError('请至少上传一张教材图片或一个 PDF。'); return; }
    if (step === 1 && materials.some((item) => ['queued', 'uploading', 'deleting'].includes(item.status))) { setError('教材仍在上传，请等待全部上传完成后继续。'); return; }
    if (step === 1 && materials.some((item) => item.status === 'failed')) { setError('有教材上传失败，请重试或删除失败项后继续。'); return; }
    if (step < wizardSteps.length - 1) setStep((value) => value + 1);
  }
  function submit() {
    if (!rights) { setError('请先确认你有权将这些内容用于本次备课服务。'); return; }
    setError('');
    const attachments = materials.map((item) => ({
      ...item.attachment,
      id: item.attachment.id,
      name: item.name,
      type: item.type,
      size: item.size,
    }));
    pendingGeneration = { ...draft, attachments, createdAt: Date.now() };
    saveDraft({ ...draft, createdAt: Date.now() });
    preserveAttachmentsRef.current = true;
    navigate('/app/generating');
  }

  return (
    <TeacherShell path={path} title="创建新教案" subtitle="跟随四步向导，把教材和课堂要求说明清楚。" contentClass="create-shell">
      <div className="create-page">
        <ol className="wizard-steps">
          {wizardSteps.map((item, index) => <li key={item} aria-current={index === step ? 'step' : undefined} className={`${index === step ? 'active' : ''} ${index < step ? 'done' : ''}`}><span>{index < step ? <Check size={15} /> : index + 1}</span><b>{item}</b></li>)}
        </ol>
        <section className="wizard-panel">
          {step === 0 ? (
            <div className="wizard-section">
              <header><h2>这是一堂什么课？</h2><p>先填写最必要的信息，教材上传后系统会自动识别并补充。</p></header>
              <div className="form-grid">
                <Field label="学科"><select value={draft.subject} onChange={(e) => updateSubject(e.target.value)}><option>语文</option><option>数学</option><option>英语</option><option>物理</option><option>化学</option><option>生物</option><option>历史</option><option>地理</option><option>道德与法治</option></select></Field>
                <Field label="年级"><select value={draft.grade} onChange={(e) => update('grade', e.target.value)}><option>一年级</option><option>二年级</option><option>三年级</option><option>四年级</option><option>五年级</option><option>六年级</option><option>七年级</option><option>八年级</option><option>九年级</option><option>高一</option><option>高二</option><option>高三</option></select></Field>
                <Field label="教材版本"><input value={draft.edition} onChange={(e) => update('edition', e.target.value)} placeholder="如：人教版" /></Field>
                <Field label="章节名称"><input value={draft.chapterTitle} onChange={(e) => update('chapterTitle', e.target.value)} placeholder={chapterPlaceholder(draft.subject)} /></Field>
                <Field label="课型"><select value={draft.lessonType} onChange={(e) => update('lessonType', e.target.value)}><option>新授课</option><option>复习课</option><option>实验课</option><option>阅读课</option><option>习题课</option><option>综合实践课</option></select></Field>
                <Field label="单课时时长"><div className="input-suffix"><input type="number" min="20" max="120" value={draft.durationMinutes} onChange={(e) => update('durationMinutes', Number(e.target.value))} /><span>分钟</span></div></Field>
                <Field label="班级人数"><div className="input-suffix"><input type="number" min="1" max="100" value={draft.classSize} onChange={(e) => update('classSize', Number(e.target.value))} /><span>人</span></div></Field>
                <Field label="学生基础与班级特点" hint="可选" className="field-wide"><textarea value={draft.classProfile} onChange={(e) => update('classProfile', e.target.value)} placeholder="例如：学生愿意表达，但基础差异较大；对修辞辨析熟悉，对表达效果理解较弱。" /></Field>
                <Field label="教师补充要求" hint="可选" className="field-wide"><textarea value={draft.requirements} onChange={(e) => update('requirements', e.target.value)} placeholder="例如：希望结合本地文化；避免使用需要复杂设备的活动。" /></Field>
              </div>
            </div>
          ) : null}
          {step === 1 ? (
            <div className="wizard-section upload-step">
              <header><h2>上传本章节教材</h2><p>请上传章节完整内容。清晰、端正、无反光的图片会获得更好的识别结果。</p></header>
              <div className={`large-dropzone ${materials.length ? 'has-materials' : ''} ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}>
                <input ref={fileInput} type="file" multiple hidden accept="image/*,.pdf" onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
                {materials.length ? <>
                  <div className="upload-material-toolbar">
                    <p><b>本章节教材</b><span>{materials.length} 个文件{activeUploads ? ` · ${activeUploads} 个上传中` : ''}</span></p>
                    <div><button type="button" onClick={() => fileInput.current?.click()}><Plus size={15} /> 继续添加</button><button type="button" className="danger" onClick={() => void clearMaterials()}><Trash2 size={15} /> 清空</button></div>
                  </div>
                  <div className="upload-material-grid" role="list" aria-label="已选择的教材文件">
                    {materials.map((item) => <UploadMaterialCard item={item} key={item.clientId} onRemove={(entry) => void removeMaterial(entry)} onRetry={retryMaterial} />)}
                    <button type="button" className="upload-material-add" onClick={() => fileInput.current?.click()}><Upload size={20} /><span>继续添加图片或 PDF</span></button>
                  </div>
                </> : <button type="button" className="dropzone-empty" onClick={() => fileInput.current?.click()}>
                  <span><Upload size={27} /></span><h3>拖拽教材图片或 PDF 到这里</h3><p>可一次选择多张，系统会自动依次上传</p><b>选择文件</b>
                </button>}
              </div>
              <div className="upload-tips"><b>拍摄建议</b><span><Check size={15} /> 页面四角完整</span><span><Check size={15} /> 避免手指遮挡</span><span><Check size={15} /> 按页码顺序上传</span><span><Check size={15} /> 文字方向保持正向</span></div>
            </div>
          ) : null}
          {step === 2 ? (
            <div className="wizard-section preference-step">
              <header><h2>你希望这堂课怎么上？</h2><p>选择教学风格和内容深度，之后仍可在编辑器里随时修改。</p></header>
              <div className="preference-groups">
                <div><h3>教案详细程度</h3><div className="choice-row">{['精简', '标准', '详细'].map((item) => <button className={draft.detailLevel === item ? 'selected' : ''} onClick={() => update('detailLevel', item)} key={item}><b>{item}</b><small>{item === '精简' ? '提纲和关键提示' : item === '标准' ? '完整流程与活动' : '含逐段话术和应急方案'}</small></button>)}</div></div>
                <div><h3>教学风格</h3><div className="choice-row compact">{['启发式', '探究式', '情境式', '讲练结合'].map((item) => <button className={draft.style === item ? 'selected' : ''} onClick={() => update('style', item)} key={item}>{item}</button>)}</div></div>
                <div className="preference-two"><Field label="课堂互动密度"><select value={draft.interaction} onChange={(e) => update('interaction', e.target.value)}><option>适中</option><option>较多</option><option>高密度</option></select></Field><Field label="习题数量" hint="最低 10 题"><div className="input-suffix"><input type="number" min="10" max="30" value={draft.exerciseCount} onChange={(e) => update('exerciseCount', Math.max(10, Number(e.target.value)))} /><span>题</span></div></Field></div>
                <div><h3>教案包含内容</h3><div className="toggle-list"><label><div><b>逐段讲解话术</b><small>提供可以直接参考的教师语言</small></div><input type="checkbox" checked={draft.includeScript} onChange={(e) => update('includeScript', e.target.checked)} /></label><label><div><b>分层教学建议</b><small>为基础、标准和挑战层学生分别提供支架</small></div><input type="checkbox" checked={draft.includeDifferentiation} onChange={(e) => update('includeDifferentiation', e.target.checked)} /></label><label><div><b>课堂应急方案</b><small>预判冷场、超时和学生不理解时的替代策略</small></div><input type="checkbox" checked={draft.includeFallbacks} onChange={(e) => update('includeFallbacks', e.target.checked)} /></label></div></div>
              </div>
            </div>
          ) : null}
          {step === 3 ? (
            <div className="wizard-section confirm-step">
              <header><h2>确认后开始生成</h2><p>通常需要 1—3 分钟。生成完成前请保持此页面打开。</p></header>
              <div className="confirm-summary"><div><span><GraduationCap size={18} /></span><p><small>课程</small><b>{draft.grade}{draft.subject} · {draft.chapterTitle || '待识别章节'}</b></p></div><div><span><Clock3 size={18} /></span><p><small>课堂</small><b>{draft.durationMinutes} 分钟 · {draft.style} · 互动{draft.interaction}</b></p></div><div><span><FileText size={18} /></span><p><small>教材</small><b>{materials.length} 个文件 · 详细教案 · {draft.exerciseCount} 道习题</b></p></div><div><span><Sparkles size={18} /></span><p><small>预计消耗</small><b>1 次完整生成额度</b></p></div></div>
              <div className="consent-box"><label><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /><span><b>教材使用确认（必选）</b><small>我确认有权将上传内容用于本次个人备课服务，不会上传包含无关个人信息的内容。</small></span></label></div>
              <div className="charge-note"><ShieldCheck size={18} /><p><b>系统失败不扣额度</b><span>提交后先预占 1 次额度；生成成功才正式扣除，系统失败或取消成功会自动退回。</span></p></div>
            </div>
          ) : null}
          {error ? <p className="wizard-error">{error}</p> : null}
          <footer className="wizard-footer"><Button variant="ghost" onClick={() => step === 0 ? navigate('/app') : setStep((value) => value - 1)}>{step === 0 ? '取消' : '上一步'}</Button>{step < wizardSteps.length - 1 ? <Button onClick={next}>下一步 <ChevronRight size={16} /></Button> : <Button icon={Sparkles} onClick={submit}>确认并开始生成</Button>}</footer>
        </section>
      </div>
    </TeacherShell>
  );
}

const processingSteps = [
  { key: 'security', label: '文件安全检查', detail: '检查文件格式、大小和页面完整性' },
  { key: 'ocr', label: '识别教材内容', detail: '理解正文、例题、插图和章节结构' },
  { key: 'plan', label: '规划课堂流程', detail: '拆解目标、重点难点与分钟级教学环节' },
  { key: 'write', label: '生成教案与习题', detail: '补充教师话术、课堂互动和至少 10 道习题' },
  { key: 'quality', label: '质量与结构检查', detail: '检查时间总和、答案解析和内容完整性' },
];

export function GeneratingPage({ path }) {
  const [active, setActive] = useState(0);
  const [state, setState] = useState('running');
  const [error, setError] = useState('');
  const started = useRef(false);

  async function run() {
    if (started.current) return;
    started.current = true;
    setState('running'); setError(''); setActive(0);
    const draft = pendingGeneration || readDraft();
    const timer = setInterval(() => setActive((value) => Math.min(value + 1, processingSteps.length - 1)), 1700);
    try {
      if (!draft.attachments?.length) throw new Error('没有找到待处理的教材文件，请返回创建页面重新上传。');
      const attachmentIds = draft.attachments.map((file) => file.id || file.attachmentId).filter(Boolean);
      if (attachmentIds.length !== draft.attachments.length) throw new Error('部分教材没有上传完成，请返回创建页面重新上传。');
      const response = await api.generateLesson({
        subject: draft.subject,
        grade: draft.grade,
        textbookEdition: draft.edition,
        chapterTitle: draft.chapterTitle,
        lessonType: draft.lessonType,
        durationMinutes: draft.durationMinutes,
        classProfile: draft.classProfile,
        requirements: `${draft.requirements || ''}\n教学风格：${draft.style}；详细程度：${draft.detailLevel}；互动密度：${draft.interaction}；习题数量：${draft.exerciseCount}。`,
        attachmentIds,
      });
      const lesson = response.data?.lessonPlan || response.lessonPlan;
      if (!lesson) throw new Error('模型返回了空教案，请稍后重试。');
      const generatedId = `lesson-${Date.now()}`;
      const storedLesson = {
        ...lesson,
        id: generatedId,
        source_files: draft.attachments.map((file) => ({ name: file.name, type: file.type, size: file.size })),
        updated_at: '刚刚',
      };
      localStorage.setItem('current-lesson', JSON.stringify(storedLesson));
      localStorage.setItem('current-lesson-canonical', JSON.stringify(lesson));
      localStorage.setItem('current-lesson-rights-confirmed', 'true');
      persistCurrentLessonSummary(storedLesson);
      pendingGeneration = null;
      setActive(processingSteps.length); setState('done');
      setTimeout(() => navigate(`/app/lesson/${generatedId}`), 650);
    } catch (requestError) {
      setState('failed'); setError(requestError.message);
    } finally {
      clearInterval(timer);
    }
  }

  useEffect(() => { run(); }, []);

  return (
    <TeacherShell path={path} title="AI 正在准备教案" subtitle="请保持页面打开，系统会在完成后自动进入教案编辑器。" contentClass="generating-shell">
      <section className="generating-page">
        <div className="generation-visual"><div className={`orbital ${state}`}><BookOpen size={29} /><i /><i /></div><h2>{state === 'failed' ? '本次生成未完成' : state === 'done' ? '教案已经准备好' : '正在理解教材，组织这堂课'}</h2><p>{state === 'running' ? '通常需要 1—3 分钟，章节页数较多时会更久。' : state === 'done' ? '正在打开教案编辑器…' : error}</p></div>
        <div className="processing-list">
          {processingSteps.map((item, index) => {
            const done = state === 'done' || index < active;
            const current = state === 'running' && index === active;
            return <div key={item.key} className={`${done ? 'done' : ''} ${current ? 'current' : ''}`}><span>{done ? <Check size={16} /> : current ? <LoaderCircle className="spin" size={17} /> : index + 1}</span><p><b>{item.label}</b><small>{item.detail}</small></p>{current ? <em>处理中</em> : done ? <em>已完成</em> : null}</div>;
          })}
        </div>
        {state === 'failed' ? <div className="generation-actions"><Button variant="secondary" icon={RotateCcw} onClick={() => { started.current = false; run(); }}>重新尝试</Button><Button onClick={() => navigate('/app/create')}>返回检查教材</Button></div> : null}
        <div className="generation-note"><WandSparkles size={18} /><p><b>教师仍是最终审核者</b><span>AI 会检查结构完整性和习题数量，但知识准确性、学情适配与课堂安全仍需由教师确认。</span></p></div>
      </section>
    </TeacherShell>
  );
}

export function PlansPage({ path }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('全部');
  const [toast, setToast] = useState(null);
  const [lessonItems, setLessonItems] = useState(loadLessonLibrary);
  const [pendingDelete, setPendingDelete] = useState(null);
  const lessons = useMemo(() => lessonItems.filter((lesson) => (
    (filter === '全部' || lesson.status === filter)
    && `${lesson.title} ${lesson.meta}`.toLowerCase().includes(query.toLowerCase())
  )), [lessonItems, query, filter]);

  useEffect(() => {
    localStorage.setItem(LESSON_LIBRARY_KEY, JSON.stringify(lessonItems));
  }, [lessonItems]);

  function deleteLesson() {
    if (!pendingDelete) return;
    setLessonItems((items) => items.filter((lesson) => lesson.id !== pendingDelete.id));
    setPendingDelete(null);
    setToast('已从当前浏览器的教案列表移除');
  }

  return (
    <TeacherShell path={path} title="我的教案" subtitle="查看和管理保存在当前设备上的教案。">
      <>
        <div className="page-toolbar"><div className="search-box"><Search size={17} /><input aria-label="搜索教案" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索教案名称、学科或章节" /></div><div className="filter-tabs" aria-label="教案状态筛选">{['全部', '已完成', '生成中', '草稿'].map((item) => <button key={item} aria-pressed={filter === item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div><Button icon={Plus} onClick={() => navigate('/app/create')}>创建教案</Button></div>
        <p className="plans-local-note"><ShieldCheck size={15} /> 教案当前保存在这台设备上。更换设备或清理浏览器数据前，请先导出需要保留的教案。</p>
        <section className="plans-table"><div className="plans-row plans-head"><span>教案</span><span>课程</span><span>更新时间</span><span>状态</span><span>操作</span></div>{lessons.map((lesson) => <div className="plans-row" key={lesson.id}><button className="plan-title" onClick={() => navigate(`/app/lesson/${lesson.id}`)}><span><FileText size={18} /></span><div><b>{lesson.title}</b><small>{lesson.duration || 45} 分钟 · {lesson.exerciseCount || 0} 道习题</small></div></button><span>{lesson.meta}</span><span>{lesson.updated}</span><span><Status>{lesson.status}</Status></span><div className="row-actions"><button title="删除教案" aria-label={`删除${lesson.title}`} onClick={() => setPendingDelete(lesson)}><Trash2 size={16} /></button></div></div>)}</section>
        {!lessons.length ? <EmptyState title="没有找到教案" text="换一个关键词或筛选条件试试。" /> : null}
      </>
      <Modal open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} title="删除教案" description="删除后，这台设备上的教案记录将无法恢复。" footer={<><Button variant="ghost" onClick={() => setPendingDelete(null)}>取消</Button><Button variant="danger" onClick={deleteLesson}>确认删除</Button></>}>
        <p>确定删除“{pendingDelete?.title}”吗？</p>
      </Modal>
      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </TeacherShell>
  );
}

export function QuotaPage({ path }) {
  const account = useAccount();
  const credits = Number(account?.credits || 0);
  return (
    <TeacherShell path={path} title="点数使用记录" subtitle="查看账户余额与使用规则。">
      <section className="quota-summary-card">
        <div><CircleDollarSign size={24} /><p><small>当前余额</small><strong>{credits}</strong><span> 点</span></p></div>
        <div className="quota-summary-copy"><b>当前使用免费体验额度</b><p>完整教案生成成功后扣 1 点；模型或结构校验失败不会正式扣除，AI 对话修改不重复扣点。</p></div>
        <Button variant="secondary" onClick={() => navigate('/app/membership')}>查看套餐说明</Button>
      </section>
      <EmptyState icon={ReceiptText} title="暂无点数变动记录" text="后续产生的生成、购买或退回记录会显示在这里。" />
    </TeacherShell>
  );
}

const MEMBERSHIP_PERIODS = Object.freeze([
  ['month', '月付'], ['quarter', '季付'], ['half_year', '半年付'], ['year', '年付'],
]);

export function MembershipPage({ path }) {
  const [period, setPeriod] = useState('month');
  const account = useAccount();
  const credits = Number(account?.credits || 0);
  const [catalog, setCatalog] = useState({ loading: true, plans: [], providers: [], verificationRequired: false, error: '' });
  const [checkout, setCheckout] = useState(null);

  useEffect(() => {
    let active = true;
    api.getPaymentPlans().then((response) => {
      if (!active) return;
      setCatalog({
        loading: false,
        plans: Array.isArray(response.data?.plans) ? response.data.plans : [],
        providers: Array.isArray(response.data?.providers) ? response.data.providers : [],
        verificationRequired: Boolean(response.data?.checkoutVerificationRequired),
        error: '',
      });
    }).catch((error) => {
      if (active) setCatalog((current) => ({ ...current, loading: false, error: error.message || '套餐目录读取失败' }));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!checkout?.order?.id || checkout.order.status !== 'PENDING') return undefined;
    let active = true;
    const poll = async () => {
      try {
        const response = await api.getPaymentOrder(checkout.order.id);
        if (!active) return;
        const order = response.data?.order;
        if (!order) return;
        setCheckout((current) => current ? { ...current, order } : current);
        if (order.status === 'PAID' && order.fulfillment?.status === 'FULFILLED') {
          window.setTimeout(() => window.location.reload(), 1_200);
        }
      } catch (error) {
        if (active) setCheckout((current) => current ? { ...current, error: `订单状态查询失败：${error.message}` } : current);
      }
    };
    const timer = window.setInterval(poll, 3_000);
    poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [checkout?.order?.id, checkout?.order?.status]);

  const freePlan = catalog.plans.find((plan) => plan.kind === 'free' || plan.purchasable === false || Number(plan.amountCents) === 0);
  const paidPlans = catalog.plans.filter((plan) => plan.billingPeriod === period && plan.saleable && plan !== freePlan && plan.purchasable !== false);
  const enabledProviders = catalog.providers.filter((provider) => provider.enabled);
  const currentMembership = account?.membership;
  const activePromotion = paidPlans.find((plan) => plan.promotion?.active)?.promotion;

  function openCheckout(plan) {
    if (!enabledProviders.length) return;
    setCheckout({
      plan,
      provider: enabledProviders[0].provider,
      verificationCode: '',
      verificationId: '',
      codeSent: false,
      sendingCode: false,
      busy: false,
      error: '',
      order: null,
      qrDataUrl: '',
    });
  }

  async function sendCheckoutCode() {
    if (!checkout || checkout.sendingCode) return;
    setCheckout((current) => ({ ...current, sendingCode: true, error: '' }));
    try {
      const response = await api.sendVerificationCode({ identifier: account.account, purpose: 'checkout' });
      setCheckout((current) => ({
        ...current,
        sendingCode: false,
        codeSent: true,
        verificationId: response.data?.verificationId || '',
      }));
    } catch (error) {
      setCheckout((current) => ({ ...current, sendingCode: false, error: error.message }));
    }
  }

  async function createCheckoutOrder() {
    if (!checkout || checkout.busy || checkout.order) return;
    if (catalog.verificationRequired && !/^\d{6}$/.test(checkout.verificationCode)) {
      setCheckout((current) => ({ ...current, error: '请先获取并填写 6 位支付验证码' }));
      return;
    }
    setCheckout((current) => ({ ...current, busy: true, error: '' }));
    try {
      const randomPart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const response = await api.createPaymentOrder({
        provider: checkout.provider,
        planId: checkout.plan.planId,
        amountCents: checkout.plan.amountCents,
        verificationCode: checkout.verificationCode,
        verificationId: checkout.verificationId,
      }, `checkout:${randomPart}`);
      const order = response.data?.order;
      if (!order?.checkout) throw new Error('支付订单缺少官方收银台信息');
      if (order.checkout.type === 'alipay_page_form') {
        submitAlipayForm(order.checkout);
        setCheckout((current) => ({ ...current, busy: false, order }));
        return;
      }
      if (order.checkout.type !== 'wechat_native_qr' || !order.checkout.codeUrl) throw new Error('微信支付二维码信息无效');
      const { default: QRCode } = await import('qrcode');
      const qrDataUrl = await QRCode.toDataURL(order.checkout.codeUrl, { width: 260, margin: 1, errorCorrectionLevel: 'M' });
      setCheckout((current) => ({ ...current, busy: false, order, qrDataUrl }));
    } catch (error) {
      setCheckout((current) => ({ ...current, busy: false, error: error.message || '创建支付订单失败' }));
    }
  }

  return (
    <TeacherShell path={path} title="会员中心" subtitle="查看会员权益并选择适合的套餐。">
      <section className="membership-hero"><div><Crown size={26} /><p><small>当前账户</small><h2>{membershipTierName(currentMembership?.tier)}</h2><span>{currentMembership?.expiresAt ? `有效期至 ${formatMembershipDate(currentMembership.expiresAt)}` : '当前没有付费会员；所有套餐均为一次性购买，不会自动续费'}</span></p></div><div className="membership-usage"><p><span>剩余点数</span><b>{credits} 次</b></p><div className="progress-track"><i style={{ width: `${Math.min(100, credits / Math.max(credits, 20) * 100)}%` }} /></div><button onClick={() => navigate('/app/quota')}>查看额度规则 <ChevronRight size={15} /></button></div></section>
      {activePromotion ? <div className="membership-offer"><PartyPopper size={22} /><div><b>{activePromotion.label}</b><p>优惠结束后恢复原价，下单前请确认实际支付金额。</p></div><span>进行中</span></div> : null}
      <div className="plans-heading"><div><h2>在售会员套餐</h2><p>{catalog.loading ? '正在读取套餐…' : enabledProviders.length ? '所有价格均为本次实际支付总额，一次性购买，不会自动续费。' : '套餐可以正常查看，支付方式暂不可用。'}</p></div><div className="billing-switch" aria-label="选择付费周期">{MEMBERSHIP_PERIODS.map(([value, label]) => <button type="button" aria-pressed={period === value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)} key={value}>{label}</button>)}</div></div>
      {catalog.error ? <div className="membership-payment-error" role="alert">{catalog.error}</div> : null}
      <div className="member-plan-grid">
        <article className={!currentMembership ? 'active' : ''}><header><h3>{freePlan?.name || '免费版'}</h3>{!currentMembership ? <span>当前账户</span> : null}</header><div className="member-price"><b>¥0</b><span>长期</span></div><p>{freePlan ? `注册赠送 ${freePlan.credits} 次教案生成点数` : '注册赠送体验点数'}</p><ul>{(freePlan?.features?.length ? freePlan.features : ['基础教案生成', 'AI 修改与结构化导出', '点数余额查询']).map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul><Button variant="secondary" disabled>{!currentMembership ? '当前账户' : '基础权益保留'}</Button></article>
        {paidPlans.map((plan) => {
          const isCurrent = currentMembership?.planId === plan.planId;
          return <article key={plan.planId} className={isCurrent ? 'active' : ''}><header><h3>{plan.name}</h3>{isCurrent ? <span>当前套餐</span> : plan.promotion?.active ? <span>{plan.promotion.label}</span> : null}</header><div className="member-price"><b>{formatCny(plan.amountCents)}</b><span>本次支付</span>{plan.promotion?.active ? <del>{formatCny(plan.regularAmountCents)}</del> : null}</div><p>{plan.credits} 次教案生成点数 · 有效 {plan.durationDays} 天</p><ul>{plan.features.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul><Button variant={isCurrent ? 'secondary' : 'primary'} disabled={!enabledProviders.length || catalog.loading} title={!enabledProviders.length ? '当前暂不可支付' : ''} onClick={() => openCheckout(plan)}>{!enabledProviders.length ? '暂不可购买' : isCurrent ? '继续购买并顺延' : `购买${plan.name}`}</Button></article>;
        })}
        {!catalog.loading && !paidPlans.length ? <EmptyState title="当前周期暂无在售套餐" text="可以切换其他付费周期查看。" /> : null}
      </div>
      <Modal open={Boolean(checkout)} onClose={() => setCheckout(null)} title={checkout?.order ? '完成支付' : `确认购买${checkout?.plan?.name || ''}`} description="支付成功后，会员有效期和点数会自动到账。" width="md" footer={checkout?.order ? <Button variant="secondary" onClick={() => setCheckout(null)}>稍后查看</Button> : <><Button variant="ghost" onClick={() => setCheckout(null)}>取消</Button><Button onClick={createCheckoutOrder} disabled={checkout?.busy}>{checkout?.busy ? '正在创建订单…' : '进入官方支付'}</Button></>}>
        {checkout ? <div className="membership-checkout">
          <div className="membership-checkout-summary"><span>{checkout.plan.name}</span><b>{formatCny(checkout.plan.amountCents)}</b><small>{checkout.plan.credits} 点 · {checkout.plan.durationDays} 天 · 不自动续费{currentMembership ? ' · 从现有付费权益到期后顺延' : ''}</small></div>
          {!checkout.order ? <>
            <fieldset><legend>选择支付方式</legend>{enabledProviders.map((provider) => <label key={provider.provider}><input type="radio" name="payment-provider" value={provider.provider} checked={checkout.provider === provider.provider} onChange={() => setCheckout((current) => ({ ...current, provider: provider.provider, error: '' }))} /><span>{provider.provider === 'wechat' ? '微信支付（Native 扫码）' : '支付宝（电脑网站支付）'}</span></label>)}</fieldset>
            {catalog.verificationRequired ? <label className="membership-code-field"><span>支付验证码</span><div><input inputMode="numeric" maxLength={6} value={checkout.verificationCode} onChange={(event) => setCheckout((current) => ({ ...current, verificationCode: event.target.value.replace(/\D/g, '').slice(0, 6), error: '' }))} placeholder="请输入 6 位验证码" /><button type="button" onClick={sendCheckoutCode} disabled={checkout.sendingCode}>{checkout.sendingCode ? '发送中…' : checkout.codeSent ? '重新发送' : '获取验证码'}</button></div><small>验证码发送到当前绑定账号 {maskAccount(account?.account)}，用于确认本次支付。</small></label> : null}
          </> : checkout.order.checkout?.type === 'wechat_native_qr' ? <div className="membership-wechat-qr">{checkout.qrDataUrl ? <img src={checkout.qrDataUrl} alt="微信支付二维码" /> : <LoaderCircle className="spin" size={26} />}<b>请使用微信扫码支付</b><p>{paymentOrderMessage(checkout.order)}</p></div> : <div className="membership-alipay-forward"><LoaderCircle className="spin" size={26} /><b>正在前往支付宝官方收银台</b><p>若页面没有跳转，请关闭窗口后重新发起，禁止重复付款。</p></div>}
          {checkout.error ? <p className="membership-payment-error" role="alert">{checkout.error}</p> : null}
        </div> : null}
      </Modal>
    </TeacherShell>
  );
}

function formatCny(cents) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(Number(cents || 0) / 100);
}

function membershipTierName(tier) {
  return ({ pro: '专业版会员', research: '教研版会员' })[tier] || '免费体验账户';
}

function formatMembershipDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN') : '—';
}

function submitAlipayForm(checkout) {
  const form = document.createElement('form');
  form.method = checkout.method === 'GET' ? 'GET' : 'POST';
  form.action = checkout.action;
  for (const [name, value] of Object.entries(checkout.fields || {})) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function paymentOrderMessage(order) {
  if (order.status === 'PAID' && order.fulfillment?.status === 'FULFILLED') return '支付成功，会员与点数已到账，页面即将刷新。';
  if (order.status === 'PAID') return '付款已经确认，会员权益正在安全发放，请勿重复付款。';
  if (['CLOSED', 'FAILED', 'CANCELED'].includes(order.status)) return '订单未完成，请关闭后重新确认套餐状态。';
  return '等待支付结果；请勿关闭微信支付页面或重复创建订单。';
}

export function SettingsPage({ path }) {
  const account = useAccount();
  const [tab, setTab] = useState('profile');
  const [toast, setToast] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const displayName = accountDisplayName(account);
  const avatarText = displayName.trim().slice(0, 1) || '师';

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await api.logout();
      navigate('/login', { replace: true });
    } catch (requestError) {
      setToast(requestError.message || '退出失败，请稍后重试');
      setLoggingOut(false);
    }
  }

  return (
    <TeacherShell path={path} title="账号设置" subtitle="查看个人资料、账号安全和订单信息。">
      <div className="settings-layout"><nav aria-label="账号设置分类">{[['profile', UserRound, '个人资料'], ['security', LockKeyhole, '账号安全'], ['orders', ReceiptText, '订单与账单']].map(([key, Icon, label]) => <button aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}><Icon size={17} />{label}</button>)}</nav><section className="settings-panel">
        {tab === 'profile' ? <><header><h2>个人资料</h2><p>你的账号基本信息。</p></header><div className="profile-avatar"><span className="avatar avatar-teacher">{avatarText}</span><div><b>{displayName}</b><p>{maskAccount(account?.account || account?.identifier)}</p></div></div><div className="form-grid"><Field label="显示名称"><input value={displayName} readOnly /></Field><Field label="登录账号"><input value={account?.account || account?.identifier || ''} readOnly /></Field><Field label="主要学科"><input value={account?.subject || '尚未填写'} readOnly /></Field></div></> : null}
        {tab === 'security' ? <><header><h2>账号安全</h2><p>管理登录密码和当前会话。</p></header><div className="settings-list"><div><span><b>登录账号</b><small>{maskAccount(account?.account || account?.identifier)}</small></span></div><div><span><b>登录密码</b><small>通过注册手机号或邮箱验证身份后重设密码</small></span><Button size="sm" variant="secondary" onClick={() => navigate('/forgot-password')}>重设密码</Button></div><div><span><b>退出当前账号</b><small>退出后需要重新登录才能继续备课</small></span><Button size="sm" variant="danger" icon={LogOut} disabled={loggingOut} onClick={logout}>{loggingOut ? '正在退出…' : '退出登录'}</Button></div></div></> : null}
        {tab === 'orders' ? <><header><h2>订单与账单</h2><p>查看会员购买记录。</p></header><EmptyState icon={ReceiptText} title="暂无订单记录" text="完成会员购买后，订单信息会显示在这里。" /></> : null}
      </section></div>
      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </TeacherShell>
  );
}

export function NotFoundAppPage({ path }) {
  return <TeacherShell path={path}><EmptyState title="页面不存在" text="你访问的页面可能已移动或地址有误。" action={<Button onClick={() => navigate('/app')}>返回工作台</Button>} /></TeacherShell>;
}
