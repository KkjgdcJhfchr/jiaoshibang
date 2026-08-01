import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudUpload,
  Copy,
  Crown,
  FileImage,
  FileText,
  Gift,
  GraduationCap,
  Image,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MoreHorizontal,
  PartyPopper,
  Plus,
  ReceiptText,
  RotateCcw,
  Search,
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
import { sampleLesson } from '../data/sampleLesson.js';
import { Button, EmptyState, Field, Modal, Status, TeacherShell, Toast, useAccount } from './components.jsx';

const LESSON_LIBRARY_KEY = 'teacher-helper.lesson-library.v2';

const draftDefaults = {
  subject: '语文', grade: '七年级', edition: '人教版', chapterTitle: '《春》', lessonType: '新授课',
  durationMinutes: 45, classSize: 42, classProfile: '', requirements: '', detailLevel: '详细', style: '启发式',
  interaction: '较多', exerciseCount: 10, includeScript: true, includeDifferentiation: true, includeFallbacks: true,
};

let pendingGeneration = null;

function safeRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

function saveDraft(draft) {
  sessionStorage.setItem('lesson-draft', JSON.stringify(draft));
}

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem('lesson-draft')) ?? draftDefaults; } catch { return draftDefaults; }
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

export function DashboardPage({ path }) {
  const account = useAccount();
  const displayName = account?.displayName || '教师用户';
  const credits = Number(account?.credits || 0);
  const lessons = loadLessonLibrary().slice(0, 5);
  const [quickDraft, setQuickDraft] = useState(() => ({
    subject: draftDefaults.subject,
    grade: draftDefaults.grade,
    durationMinutes: draftDefaults.durationMinutes,
  }));

  function startQuickCreate() {
    saveDraft({ ...draftDefaults, ...readDraft(), ...quickDraft });
    navigate('/app/create');
  }

  return (
    <TeacherShell path={path} title={`你好，${displayName}`} subtitle="今天也一起备好一堂课。">
      <div className="dashboard-layout">
        <div className="dashboard-main-column">
          <section className="quick-create-panel">
            <div className="quick-create-copy"><h2>从教材开始，备好一堂课</h2><p>上传教材章节图片或 PDF，AI 帮你生成贴合学情的详细教案。</p></div>
            <div className="quick-create-form">
              <button className="quick-upload" onClick={startQuickCreate}>
                <span><CloudUpload size={28} /></span><b>进入教材上传向导</b><small>下一步可选择或拖入 JPG / PNG / WEBP / PDF</small>
              </button>
              <div className="quick-fields">
                <Field label="学科"><select value={quickDraft.subject} onChange={(event) => setQuickDraft((current) => ({ ...current, subject: event.target.value }))}><option>语文</option><option>数学</option><option>英语</option><option>物理</option><option>化学</option></select></Field>
                <Field label="年级"><select value={quickDraft.grade} onChange={(event) => setQuickDraft((current) => ({ ...current, grade: event.target.value }))}><option>一年级</option><option>五年级</option><option>七年级</option><option>九年级</option><option>高一</option></select></Field>
                <Field label="课时时长"><select value={quickDraft.durationMinutes} onChange={(event) => setQuickDraft((current) => ({ ...current, durationMinutes: Number(event.target.value) }))}><option value="40">40 分钟</option><option value="45">45 分钟</option><option value="60">60 分钟</option><option value="90">90 分钟</option></select></Field>
              </div>
            </div>
            <Button size="lg" icon={Sparkles} onClick={startQuickCreate}>填写信息并上传教材</Button>
            <p className="privacy-line"><LockKeyhole size={14} /> 内容仅你可见，是否用于模型改进由你单独决定</p>
          </section>

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
          <section className="offer-card"><div><Gift size={18} /><b>优惠服务</b></div><h3>实际活动尚未发布</h3><p>优惠与结算接口接入后，这里会显示管理员发布的真实活动。</p><button onClick={() => navigate('/app/membership')}>查看接入状态 <ArrowRight size={15} /></button></section>
          <section className="membership-card"><div className="rail-card-title"><b>当前账户</b><Crown size={18} /></div><h3><BadgeCheck size={18} /> 免费体验账户</h3><p>剩余 {credits} 次完整生成额度</p><ul><li><Check size={15} /> 教案生成与 AI 修改</li><li><Check size={15} /> 结构化教案导出</li><li><Check size={15} /> 训练授权独立管理</li></ul><Button variant="secondary" onClick={() => navigate('/app/membership')}>查看套餐说明</Button></section>
        </aside>
      </div>
    </TeacherShell>
  );
}

const wizardSteps = ['课程信息', '上传教材', '生成偏好', '确认生成'];

export function CreateLessonPage({ path }) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => ({ ...draftDefaults, ...readDraft() }));
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [rights, setRights] = useState(false);
  const [trainingConsent, setTrainingConsent] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);

  function update(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  function addFiles(list) {
    const incoming = [...list];
    const accepted = incoming.filter((file) => {
      const supported = file.type.startsWith('image/') || file.type === 'application/pdf';
      const limit = file.type === 'application/pdf' ? 16 * 1024 * 1024 : 8 * 1024 * 1024;
      return supported && file.size <= limit;
    });
    if (accepted.length !== incoming.length) setError('已忽略不支持或过大的文件：图片不超过 8MB，PDF 不超过 16MB。');
    const selected = [];
    let totalBytes = 0;
    for (const file of [...files, ...accepted]) {
      if (selected.length >= 12) break;
      if (totalBytes + file.size > 18 * 1024 * 1024) continue;
      selected.push(file);
      totalBytes += file.size;
    }
    if (selected.length < files.length + accepted.length) setError('单次最多 12 个文件且总大小不超过 18MB，请压缩图片或分批上传。');
    setFiles(selected);
  }
  function next() {
    setError('');
    if (step === 1 && files.length === 0) { setError('请至少上传一张教材图片或一个 PDF。'); return; }
    if (step < wizardSteps.length - 1) setStep((value) => value + 1);
  }
  async function submit() {
    if (!rights) { setError('请先确认你有权将这些内容用于本次备课服务。'); return; }
    setError('');
    try {
      const attachments = await Promise.all(files.map(toAttachment));
      pendingGeneration = { ...draft, attachments, trainingConsent, createdAt: Date.now() };
      saveDraft({ ...draft, trainingConsent, createdAt: Date.now() });
      navigate('/app/generating');
    } catch {
      setError('读取上传文件失败，请移除后重新上传。');
    }
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
                <Field label="学科"><select value={draft.subject} onChange={(e) => update('subject', e.target.value)}><option>语文</option><option>数学</option><option>英语</option><option>物理</option><option>化学</option><option>生物</option><option>历史</option><option>地理</option><option>道德与法治</option></select></Field>
                <Field label="年级"><select value={draft.grade} onChange={(e) => update('grade', e.target.value)}><option>一年级</option><option>二年级</option><option>三年级</option><option>四年级</option><option>五年级</option><option>六年级</option><option>七年级</option><option>八年级</option><option>九年级</option><option>高一</option><option>高二</option><option>高三</option></select></Field>
                <Field label="教材版本"><input value={draft.edition} onChange={(e) => update('edition', e.target.value)} placeholder="如：人教版" /></Field>
                <Field label="章节名称"><input value={draft.chapterTitle} onChange={(e) => update('chapterTitle', e.target.value)} placeholder="如：第二章 一元一次方程" /></Field>
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
              <button className={`large-dropzone ${dragging ? 'dragging' : ''}`} onClick={() => fileInput.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}>
                <input ref={fileInput} type="file" multiple hidden accept="image/*,.pdf" onChange={(e) => addFiles(e.target.files)} />
                <span><Upload size={27} /></span><h3>拖拽教材图片或 PDF 到这里</h3><p>最多 12 个文件、总计 18MB，支持 JPG、PNG、WEBP、PDF</p><b>选择文件</b>
              </button>
              {files.length ? <div className="upload-list"><header><b>已上传 {files.length} 个文件</b><button onClick={() => setFiles([])}><Trash2 size={15} /> 清空</button></header>{files.map((file, index) => <div key={`${file.name}-${index}`}><span className="file-type-icon">{file.type === 'application/pdf' ? <FileText size={18} /> : <FileImage size={18} />}</span><div><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(2)} MB · 等待识别</small></div><button onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} aria-label={`删除 ${file.name}`}><X size={16} /></button></div>)}</div> : null}
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
              <header><h2>确认后开始生成</h2><p>生成会在后台继续运行，即使离开本页，也可以在任务中心查看进度。</p></header>
              <div className="confirm-summary"><div><span><GraduationCap size={18} /></span><p><small>课程</small><b>{draft.grade}{draft.subject} · {draft.chapterTitle || '待识别章节'}</b></p></div><div><span><Clock3 size={18} /></span><p><small>课堂</small><b>{draft.durationMinutes} 分钟 · {draft.style} · 互动{draft.interaction}</b></p></div><div><span><FileText size={18} /></span><p><small>教材</small><b>{files.length} 个文件 · 详细教案 · {draft.exerciseCount} 道习题</b></p></div><div><span><Sparkles size={18} /></span><p><small>预计消耗</small><b>1 次完整生成额度</b></p></div></div>
              <div className="consent-box"><label><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} /><span><b>教材使用确认（必选）</b><small>我确认有权将上传内容用于本次个人备课服务，不会上传包含无关个人信息的内容。</small></span></label><label><input type="checkbox" checked={trainingConsent} onChange={(e) => setTrainingConsent(e.target.checked)} /><span><b>模型改进授权（可选，默认关闭）</b><small>在我定稿并导出后，允许平台将去标识化、通过版权和质量审核的教案作为训练候选。我可以随时撤回。</small></span></label></div>
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
      const response = await api.generateLesson({
        subject: draft.subject,
        grade: draft.grade,
        textbookEdition: draft.edition,
        chapterTitle: draft.chapterTitle,
        lessonType: draft.lessonType,
        durationMinutes: draft.durationMinutes,
        classProfile: draft.classProfile,
        trainingConsent: draft.trainingConsent === true,
        requirements: `${draft.requirements || ''}\n教学风格：${draft.style}；详细程度：${draft.detailLevel}；互动密度：${draft.interaction}；习题数量：${draft.exerciseCount}。`,
        images: draft.attachments.map((file) => file.dataUrl),
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
      localStorage.setItem('current-lesson-training-consent', draft.trainingConsent === true ? 'true' : 'false');
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
    <TeacherShell path={path} title="AI 正在准备教案" subtitle="当前生成接口需要保持本页打开；后台任务与完成通知将在任务队列接入后启用。" contentClass="generating-shell">
      <section className="generating-page">
        <div className="generation-visual"><div className={`orbital ${state}`}><BookOpen size={29} /><i /><i /></div><h2>{state === 'failed' ? '本次生成未完成' : state === 'done' ? '教案已经准备好' : '正在理解教材，组织这堂课'}</h2><p>{state === 'running' ? '通常需要 1—3 分钟，章节页数较多时会更久。' : state === 'done' ? '正在打开教案编辑器…' : error}</p></div>
        <div className="processing-list">
          {processingSteps.map((item, index) => {
            const done = state === 'done' || index < active;
            const current = state === 'running' && index === active;
            return <div key={item.key} className={`${done ? 'done' : ''} ${current ? 'current' : ''}`}><span>{done ? <Check size={16} /> : current ? <LoaderCircle className="spin" size={17} /> : index + 1}</span><p><b>{item.label}</b><small>{item.detail}</small></p>{current ? <em>处理中</em> : done ? <em>已完成</em> : null}</div>;
          })}
        </div>
        {state === 'failed' ? <div className="generation-actions"><Button variant="secondary" icon={RotateCcw} onClick={() => { started.current = false; run(); }}>重新尝试</Button><Button onClick={() => navigate('/app/create')}>返回检查教材</Button><button onClick={() => { localStorage.setItem('current-lesson', JSON.stringify(sampleLesson)); localStorage.removeItem('current-lesson-canonical'); localStorage.setItem('current-lesson-training-consent', 'false'); localStorage.setItem('current-lesson-rights-confirmed', 'false'); navigate('/app/lesson/lesson-spring-001'); }}>使用明确标注的演示教案查看编辑器</button></div> : <button className="leave-generation" disabled title="后台任务与完成通知尚未接入，请保持本页打开">离开后继续生成（待接入）</button>}
        <div className="generation-note"><WandSparkles size={18} /><p><b>教师仍是最终审核者</b><span>AI 会检查结构完整性和习题数量，但知识准确性、学情适配与课堂安全仍需由教师确认。</span></p></div>
      </section>
    </TeacherShell>
  );
}

export function PlansPage({ path, materials = false }) {
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
    <TeacherShell path={path} title={materials ? '教材资源库' : '我的教案'} subtitle={materials ? '管理、复用你上传过的教材章节。' : '所有草稿、生成任务与定稿版本都在这里。'}>
      {materials ? <MaterialsContent /> : <>
        <div className="page-toolbar"><div className="search-box"><Search size={17} /><input aria-label="搜索教案" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索教案名称、学科或章节" /></div><div className="filter-tabs" aria-label="教案状态筛选">{['全部', '已完成', '生成中', '草稿'].map((item) => <button key={item} aria-pressed={filter === item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div><Button icon={Plus} onClick={() => navigate('/app/create')}>创建教案</Button></div>
        <p className="plans-local-note"><ShieldCheck size={15} /> 当前仅在这个浏览器中保留最近生成的一份教案；云端多教案库与复制接口尚未接入。删除会真实更新本地目录。</p>
        <section className="plans-table"><div className="plans-row plans-head"><span>教案</span><span>课程</span><span>更新时间</span><span>状态</span><span>操作</span></div>{lessons.map((lesson) => <div className="plans-row" key={lesson.id}><button className="plan-title" onClick={() => navigate(`/app/lesson/${lesson.id}`)}><span><FileText size={18} /></span><div><b>{lesson.title}</b><small>{lesson.duration || 45} 分钟 · {lesson.exerciseCount || 0} 道习题 · 本地目录</small></div></button><span>{lesson.meta}</span><span>{lesson.updated}</span><span><Status>{lesson.status}</Status></span><div className="row-actions"><button title="教案内容分库尚未接入" aria-label={`复制${lesson.title}（待接入）`} disabled><Copy size={16} /></button><button title="从本地目录移除" aria-label={`删除${lesson.title}`} onClick={() => setPendingDelete(lesson)}><Trash2 size={16} /></button><button aria-label={`${lesson.title}更多操作尚未接入`} title="更多操作尚未接入" disabled><MoreHorizontal size={17} /></button></div></div>)}</section>
        {!lessons.length ? <EmptyState title="没有找到教案" text="换一个关键词或筛选条件试试。" /> : null}
      </>}
      <Modal open={Boolean(pendingDelete)} onClose={() => setPendingDelete(null)} title="移除本地教案" description="该操作只影响当前浏览器中的目录记录，不会声称已删除云端数据。" footer={<><Button variant="ghost" onClick={() => setPendingDelete(null)}>取消</Button><Button variant="danger" onClick={deleteLesson}>确认移除</Button></>}>
        <p>确定从本地目录移除“{pendingDelete?.title}”吗？</p>
      </Modal>
      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </TeacherShell>
  );
}

function MaterialsContent() {
  const [query, setQuery] = useState('');
  const materials = [
    { title: '朱自清《春》教材页', meta: '6 张图片 · 语文 · 七年级', date: '今天 09:42', auth: '仅用于服务' },
    { title: '一元一次方程', meta: '12 页 PDF · 数学 · 七年级', date: '07-29 16:18', auth: '训练已授权' },
    { title: '电路的组成与连接', meta: '8 张图片 · 物理 · 九年级', date: '07-28 11:06', auth: '仅用于服务' },
  ];
  const visible = materials.filter((item) => `${item.title} ${item.meta}`.toLowerCase().includes(query.toLowerCase()));
  return <><div className="page-toolbar"><div className="search-box"><Search size={17} /><input aria-label="搜索教材" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索教材或章节" /></div><Button icon={Upload} onClick={() => navigate('/app/create')}>上传并创建教案</Button></div><p className="plans-local-note"><ShieldCheck size={15} /> 当前资源卡片为演示目录；素材持久化、删除和授权变更接口尚未接入。</p><div className="material-grid">{visible.map((item, index) => <article key={item.title}><div className="material-preview"><Image size={25} /><span>{index === 1 ? 'PDF' : `${index + 4}P`}</span></div><h3>{item.title}</h3><p>{item.meta}</p><footer><span>{item.date}</span><b>{item.auth}</b></footer></article>)}</div>{!visible.length ? <EmptyState title="没有找到教材" text="换一个关键词继续搜索。" /> : null}<div className="material-privacy"><ShieldCheck size={20} /><div><b>服务授权与训练授权会分开管理</b><p>真实素材库接口接入后，每份素材都会显示独立授权状态；当前不会假装已完成删除或授权变更。</p></div></div></>;
}

export function QuotaPage({ path }) {
  const account = useAccount();
  const credits = Number(account?.credits || 0);
  return (
    <TeacherShell path={path} title="点数使用记录" subtitle="查看真实账户余额与额度规则。">
      <section className="quota-summary-card">
        <div><CircleDollarSign size={24} /><p><small>服务端真实余额</small><strong>{credits}</strong><span> 点</span></p></div>
        <div className="quota-summary-copy"><b>当前使用免费体验额度</b><p>完整教案生成成功后扣 1 点；模型或结构校验失败不会正式扣除，AI 对话修改不重复扣点。</p></div>
        <Button variant="secondary" onClick={() => navigate('/app/membership')}>查看套餐说明</Button>
      </section>
      <div className="settings-capability-note quota-capability"><ShieldCheck size={17} /><span>额度余额已接真实用户接口；逐笔额度流水查询接口尚未接入，因此不再展示虚构明细。</span></div>
      <EmptyState icon={ReceiptText} title="额度流水待接入" text="服务端提供真实流水接口后，这里会显示生成、扣除、退回和发放记录。" />
    </TeacherShell>
  );
}

export function MembershipPage({ path }) {
  const [annual, setAnnual] = useState(true);
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

  const period = annual ? 'year' : 'month';
  const paidPlans = catalog.plans.filter((plan) => plan.billingPeriod === period && plan.saleable);
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
    <TeacherShell path={path} title="会员中心" subtitle="查看服务端真实套餐、账户权益并通过官方支付通道购买。">
      <section className="membership-hero"><div><Crown size={26} /><p><small>当前账户</small><h2>{membershipTierName(currentMembership?.tier)}</h2><span>{currentMembership?.expiresAt ? `有效期至 ${formatMembershipDate(currentMembership.expiresAt)}` : '当前没有付费会员；所有套餐均为一次性购买，不会自动续费'}</span></p></div><div className="membership-usage"><p><span>真实剩余额度</span><b>{credits} 次</b></p><div className="progress-track"><i style={{ width: `${Math.min(100, credits / Math.max(credits, 20) * 100)}%` }} /></div><button onClick={() => navigate('/app/quota')}>查看额度规则 <ChevronRight size={15} /></button></div><Button variant="secondary" disabled title="当前套餐为一次性购买，不会自动续费">无自动续费</Button></section>
      {activePromotion ? <div className="membership-offer"><PartyPopper size={22} /><div><b>{activePromotion.label}</b><p>限时优惠已经由服务端校验；结束后会自动恢复原价，下单金额以确认页为准。</p></div><span>进行中</span></div> : <div className="membership-offer membership-offer-pending"><PartyPopper size={22} /><div><b>当前没有生效中的限时优惠</b><p>管理员可在支付设置中为单个套餐设置优惠价和有效期；独立优惠码规则仍待接入。</p></div><span>实时报价</span></div>}
      <div className="plans-heading"><div><h2>在售会员套餐</h2><p>{catalog.loading ? '正在读取服务端套餐目录…' : enabledProviders.length ? '价格和点数由服务端确认，浏览器无法修改成交金额。' : '套餐目录可查看；管理员启用正式商户通道后才可下单。'}</p></div><div className="billing-switch"><button className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>按月购买</button><button className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>按年购买</button></div></div>
      {catalog.error ? <div className="membership-payment-error" role="alert">{catalog.error}</div> : null}
      <div className="member-plan-grid">
        <article className={!currentMembership ? 'active' : ''}><header><h3>免费版</h3>{!currentMembership ? <span>当前账户</span> : null}</header><div className="member-price"><b>¥0</b><span>长期</span></div><p>注册赠送体验点数</p><ul>{['基础教案生成', 'AI 修改与结构化导出', '训练授权独立管理'].map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul><Button variant="secondary" disabled>{!currentMembership ? '当前账户' : '基础权益保留'}</Button></article>
        {paidPlans.map((plan) => {
          const isCurrent = currentMembership?.planId === plan.planId;
          return <article key={plan.planId} className={isCurrent ? 'active' : ''}><header><h3>{plan.name}</h3>{isCurrent ? <span>当前套餐</span> : plan.promotion?.active ? <span>{plan.promotion.label}</span> : null}</header><div className="member-price"><b>{formatCny(plan.amountCents)}</b><span>/ {plan.billingPeriod === 'year' ? '年' : '月'}</span>{plan.promotion?.active ? <del>{formatCny(plan.regularAmountCents)}</del> : null}</div><p>{plan.credits} 次教案生成点数 · 有效 {plan.durationDays} 天</p><ul>{plan.features.map((item) => <li key={item}><Check size={15} />{item}</li>)}</ul><Button variant={isCurrent ? 'secondary' : 'primary'} disabled={!enabledProviders.length || catalog.loading} title={!enabledProviders.length ? '微信支付和支付宝尚未由管理员配置并启用' : ''} onClick={() => openCheckout(plan)}>{!enabledProviders.length ? '支付通道尚未启用' : isCurrent ? '继续购买并顺延' : `购买${plan.name}`}</Button></article>;
        })}
      </div>
      <section className="coupon-section"><div><Gift size={20} /><h3>优惠码</h3><p>服务端优惠校验与领取接口尚未接入。</p></div><div><input value="" placeholder="优惠服务尚未配置" disabled /><Button variant="secondary" disabled>验证（待接入）</Button></div></section>
      <Modal open={Boolean(checkout)} onClose={() => setCheckout(null)} title={checkout?.order ? '完成支付' : `确认购买${checkout?.plan?.name || ''}`} description="成交价来自服务端套餐目录；支付成功后系统按订单号幂等发放会员与点数。" width="md" footer={checkout?.order ? <Button variant="secondary" onClick={() => setCheckout(null)}>稍后查看</Button> : <><Button variant="ghost" onClick={() => setCheckout(null)}>取消</Button><Button onClick={createCheckoutOrder} disabled={checkout?.busy}>{checkout?.busy ? '正在创建订单…' : '进入官方支付'}</Button></>}>
        {checkout ? <div className="membership-checkout">
          <div className="membership-checkout-summary"><span>{checkout.plan.name}</span><b>{formatCny(checkout.plan.amountCents)}</b><small>{checkout.plan.credits} 点 · {checkout.plan.durationDays} 天 · 不自动续费{currentMembership ? ' · 从现有付费权益到期后顺延' : ''}</small></div>
          {!checkout.order ? <>
            <fieldset><legend>选择支付方式</legend>{enabledProviders.map((provider) => <label key={provider.provider}><input type="radio" name="payment-provider" value={provider.provider} checked={checkout.provider === provider.provider} onChange={() => setCheckout((current) => ({ ...current, provider: provider.provider, error: '' }))} /><span>{provider.provider === 'wechat' ? '微信支付（Native 扫码）' : '支付宝（电脑网站支付）'}</span></label>)}</fieldset>
            {catalog.verificationRequired ? <label className="membership-code-field"><span>支付验证码</span><div><input inputMode="numeric" maxLength={6} value={checkout.verificationCode} onChange={(event) => setCheckout((current) => ({ ...current, verificationCode: event.target.value.replace(/\D/g, '').slice(0, 6), error: '' }))} placeholder="请输入 6 位验证码" /><button type="button" onClick={sendCheckoutCode} disabled={checkout.sendingCode}>{checkout.sendingCode ? '发送中…' : checkout.codeSent ? '重新发送' : '获取验证码'}</button></div><small>验证码发送到当前绑定账号 {maskAccount(account?.account)}，用于确认本次支付。</small></label> : <p className="membership-checkout-policy"><ShieldCheck size={15} /> 当前部署未强制支付验证码；生产环境默认开启。</p>}
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
  const [training, setTraining] = useState(Boolean(account?.trainingConsent));
  const [privacyBusy, setPrivacyBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const displayName = account?.displayName || '教师用户';
  const avatarText = displayName.trim().slice(0, 1) || '师';

  useEffect(() => {
    setTraining(Boolean(account?.trainingConsent));
  }, [account?.trainingConsent]);

  async function changeTrainingConsent(nextValue) {
    if (privacyBusy) return;
    const previous = training;
    setTraining(nextValue);
    setPrivacyBusy(true);
    try {
      const response = await api.updateTrainingConsent(nextValue);
      const savedValue = response.data?.user?.trainingConsent;
      setTraining(typeof savedValue === 'boolean' ? savedValue : nextValue);
      const revoked = Number(response.data?.revokedCandidates || 0);
      setToast(nextValue ? '训练候选授权已开启' : `训练候选授权已关闭${revoked ? `，已撤回 ${revoked} 条候选` : ''}`);
    } catch (requestError) {
      setTraining(previous);
      setToast(`授权设置未保存：${requestError.message}`);
    } finally {
      setPrivacyBusy(false);
    }
  }

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
    <TeacherShell path={path} title="账号设置" subtitle="管理个人资料、账号安全与数据授权。">
      <div className="settings-layout"><nav aria-label="账号设置分类">{[['profile', UserRound, '个人资料'], ['security', LockKeyhole, '账号安全'], ['privacy', ShieldCheck, '数据与隐私'], ['orders', ReceiptText, '订单与账单']].map(([key, Icon, label]) => <button aria-current={tab === key ? 'page' : undefined} className={tab === key ? 'active' : ''} onClick={() => setTab(key)} key={key}><Icon size={17} />{label}</button>)}</nav><section className="settings-panel">
        {tab === 'profile' ? <><header><h2>个人资料</h2><p>当前仅展示注册接口真实返回的账号资料。</p></header><div className="settings-capability-note"><ShieldCheck size={17} /><span>资料编辑、学校/学段和头像上传接口尚未接入，以下字段暂为只读。</span></div><div className="profile-avatar"><span className="avatar avatar-teacher">{avatarText}</span><div><Button size="sm" variant="secondary" disabled>更换头像（待接入）</Button><p>头像上传服务尚未配置</p></div></div><div className="form-grid"><Field label="显示名称"><input value={displayName} disabled /></Field><Field label="登录账号"><input value={account?.account || account?.identifier || ''} disabled /></Field><Field label="主要学科"><input value={account?.subject || '尚未填写'} disabled /></Field><Field label="学校 / 学段"><input value="尚未接入资料字段" disabled /></Field></div><Button disabled title="个人资料更新接口尚未接入">保存修改（待接入）</Button></> : null}
        {tab === 'security' ? <><header><h2>账号安全</h2><p>登录、密码和设备管理。</p></header><div className="settings-capability-note"><ShieldCheck size={17} /><span>当前仅登录和退出为真实接口；换绑、两步验证与设备管理仍待后端接入。</span></div><div className="settings-list"><div><span><b>登录账号</b><small>{maskAccount(account?.account || account?.identifier)}</small></span><Button size="sm" variant="secondary" disabled>更换（待接入）</Button></div><div><span><b>登录密码</b><small>在线修改和找回服务尚未配置</small></span><Button size="sm" variant="secondary" onClick={() => navigate('/forgot-password')}>查看找回方式</Button></div><div><span><b>两步验证</b><small>认证器与备用码接口尚未配置</small></span><Button size="sm" disabled>开启（待接入）</Button></div><div><span><b>登录设备</b><small>设备会话列表接口尚未配置</small></span><Button size="sm" variant="secondary" disabled>管理（待接入）</Button></div><div><span><b>退出当前账号</b><small>退出后需要重新登录才能继续备课</small></span><Button size="sm" variant="danger" icon={LogOut} disabled={loggingOut} onClick={logout}>{loggingOut ? '正在退出…' : '退出登录'}</Button></div></div></> : null}
        {tab === 'privacy' ? <><header><h2>数据与隐私</h2><p>服务必需的数据处理与模型训练授权分别管理。</p></header><div className="privacy-setting"><div><h3>允许最终教案进入训练候选池</h3><p>这是已接入服务端的真实授权开关。只有定稿并主动提交的教案，经过脱敏、版权和质量审核后才可能进入版本化数据集。</p></div><label className="switch"><input type="checkbox" checked={training} disabled={privacyBusy} onChange={(e) => changeTrainingConsent(e.target.checked)} /><span /></label></div><div className="settings-list"><div><span><b>上传素材保留期</b><small>保留期策略接口尚未配置</small></span><Button size="sm" variant="secondary" disabled>设置（待接入）</Button></div><div><span><b>导出我的数据</b><small>账号数据导出任务接口尚未配置</small></span><Button size="sm" variant="secondary" disabled>申请导出（待接入）</Button></div><div><span><b>删除账号和全部内容</b><small>注销、二次验证与冷静期流程尚未配置</small></span><Button size="sm" variant="danger" disabled>申请注销（待接入）</Button></div></div></> : null}
        {tab === 'orders' ? <><header><h2>订单与账单</h2><p>真实订单、退款和发票记录将在支付系统接入后显示。</p></header><div className="settings-capability-note"><ReceiptText size={17} /><span>订单查询接口尚未接入，因此这里不再展示虚构订单。</span></div><EmptyState icon={ReceiptText} title="暂无可查询的订单" text="支付与订单服务接入后，会在这里显示真实记录。" /></> : null}
      </section></div>
      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </TeacherShell>
  );
}

export function NotFoundAppPage({ path }) {
  return <TeacherShell path={path}><EmptyState title="页面正在准备中" text="这个功能已经纳入产品结构，本轮演示先聚焦教案生成与管理闭环。" action={<Button onClick={() => navigate('/app')}>返回工作台</Button>} /></TeacherShell>;
}
