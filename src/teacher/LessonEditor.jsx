import { useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bot,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileDown,
  FileJson,
  FileText,
  History,
  Lightbulb,
  LoaderCircle,
  MoreHorizontal,
  Network,
  Pencil,
  Printer,
  Redo2,
  RotateCcw,
  ScrollText,
  Send,
  Sparkles,
  Undo2,
  X,
} from 'lucide-react';
import { sampleLesson } from '../data/sampleLesson.js';
import { api } from '../lib/api.js';
import { normalizeLesson } from '../lib/lessonAdapter.js';
import { navigate } from '../lib/navigation.jsx';
import { useSiteConfig } from '../lib/site-config.jsx';
import { toCanonicalLesson } from '../lib/trainingAdapter.js';
import { Button, Modal, Toast } from './components.jsx';

const outline = [
  ['objectives', '教学目标'], ['learner', '学情分析'], ['keypoints', '重点难点'], ['preparation', '教学准备'],
  ['timeline', '教学过程'], ['interaction', '课堂互动'], ['board', '板书设计'], ['homework', '课后作业'], ['exercises', '习题与答案'],
];

function loadLesson(isDemo) {
  if (isDemo) return normalizeLesson(sampleLesson);
  try {
    const raw = JSON.parse(localStorage.getItem('current-lesson')) || sampleLesson;
    const normalized = normalizeLesson(raw);
    return { ...normalized, source_files: raw.source_files || normalized.source_files || [], finalized_at: raw.finalized_at || normalized.finalized_at };
  } catch { return normalizeLesson(sampleLesson); }
}

function saveLesson(lesson, isDemo) {
  if (isDemo) return;
  localStorage.setItem('current-lesson', JSON.stringify(lesson));
}

function loadCanonicalLesson() {
  try { return JSON.parse(localStorage.getItem('current-lesson-canonical')); } catch { return null; }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function lessonToHtml(lesson) {
  const title = lesson.metadata?.title || `${lesson.metadata?.chapter || ''}教学设计`;
  const objectives = (lesson.learning_objectives || []).map((item) => `<li>${escapeHtml(item.content)}</li>`).join('');
  const timeline = (lesson.timeline || []).map((item) => `<tr><td>${escapeHtml(item.stage)}</td><td>${item.duration_minutes || ''}分钟</td><td>${escapeHtml(item.teacher_script || (item.teacher_actions || []).join('；'))}</td><td>${escapeHtml((item.student_actions || []).join('；'))}</td><td>${escapeHtml(item.engagement_goal)}</td></tr>`).join('');
  const exercises = (lesson.exercises || []).map((item, index) => `<div class="question"><b>${index + 1}. [${escapeHtml(item.type)}] ${escapeHtml(item.stem)}</b><p>答案：${escapeHtml(item.answer)}</p><p>解析：${escapeHtml(item.explanation)}</p></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:'Microsoft YaHei',sans-serif;max-width:900px;margin:40px auto;color:#1a2522;line-height:1.75}h1{text-align:center}h2{border-bottom:1px solid #ccc;padding-bottom:8px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #aaa;padding:8px;vertical-align:top}.question{page-break-inside:avoid;margin:16px 0}.meta{text-align:center;color:#666}</style></head><body><h1>${escapeHtml(title)}</h1><p class="meta">${escapeHtml(lesson.metadata?.grade)} · ${escapeHtml(lesson.metadata?.subject)} · ${lesson.metadata?.duration_minutes || 45}分钟</p><h2>一、教学目标</h2><ol>${objectives}</ol><h2>二、学情分析</h2><p>${escapeHtml(lesson.metadata?.class_profile || lesson.learner_analysis?.challenge || '')}</p><h2>三、重点难点</h2><p><b>重点：</b>${escapeHtml((lesson.key_points || []).join('；'))}</p><p><b>难点：</b>${escapeHtml((lesson.difficult_points || []).join('；'))}</p><h2>四、教学过程</h2><table><thead><tr><th>环节</th><th>时间</th><th>教师活动 / 话术</th><th>学生活动</th><th>参与目标</th></tr></thead><tbody>${timeline}</tbody></table><h2>五、板书设计</h2><pre>${escapeHtml(lesson.board_design)}</pre><h2>六、习题与答案</h2>${exercises}</body></html>`;
}

function downloadBlob(contents, type, name) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function LessonEditor({ path }) {
  const { siteName } = useSiteConfig();
  const isDemo = path === '/app/lesson/lesson-spring-001';
  const [lesson, setLesson] = useState(() => loadLesson(isDemo));
  const [selected, setSelected] = useState('timeline');
  const [feedback, setFeedback] = useState('');
  const [revising, setRevising] = useState(false);
  const [revisionError, setRevisionError] = useState('');
  const [chat, setChat] = useState([{ role: 'assistant', text: '教案已生成并完成结构检查。你可以告诉我想改哪一部分，例如“把课堂导入改得更有感染力”。' }]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [toast, setToast] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const candidateSubmitted = useRef(false);
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const title = lesson.metadata?.title || `${lesson.metadata?.chapter || '新教案'}教学设计`;
  const exerciseCount = lesson.exercises?.length || 0;
  const currentVersion = historyRef.current.length + 1;
  const finalized = Boolean(lesson.finalized_at);
  const sourceItems = isDemo
    ? [{ name: '教材《春》原文', detail: '图片 · 6 页', mark: '春' }, { name: '七年级语文课程标准', detail: 'PDF', mark: '标' }]
    : (lesson.source_files || []).map((file) => ({ name: file.name, detail: `${file.type || '文件'} · 本次生成使用`, mark: '源' }));

  const totalMinutes = useMemo(() => (lesson.timeline || []).reduce((sum, item) => sum + Number(item.duration_minutes || 0), 0), [lesson.timeline]);

  function updateLesson(updater, preserveFinalized = false) {
    setLesson((current) => {
      const requested = typeof updater === 'function' ? updater(current) : updater;
      const next = preserveFinalized ? requested : { ...requested, finalized_at: undefined };
      historyRef.current = [...historyRef.current.slice(-19), structuredClone(current)];
      redoRef.current = [];
      setHistoryVersion((value) => value + 1);
      saveLesson(next, isDemo); return next;
    });
    setDirty(false);
  }
  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current.push(structuredClone(lesson));
    setLesson(previous);
    saveLesson(previous, isDemo);
    setDirty(false);
    setHistoryVersion((value) => value + 1);
    setToast('已撤销上一次修改');
  }
  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(structuredClone(lesson));
    setLesson(next);
    saveLesson(next, isDemo);
    setDirty(false);
    setHistoryVersion((value) => value + 1);
    setToast('已重做上一次修改');
  }
  function restoreSnapshot(snapshot) {
    updateLesson(structuredClone(snapshot));
    setVersionsOpen(false);
    setToast('已恢复所选历史版本，并保留当前版本用于撤销');
  }
  function addStage() {
    updateLesson((current) => ({
      ...current,
      timeline: [...(current.timeline || []), {
        stage: `补充环节 ${(current.timeline || []).length + 1}`,
        duration_minutes: 5,
        teacher_script: '请在这里补充教师活动与可直接使用的讲解话术。',
        teacher_actions: ['补充教师活动'],
        student_actions: ['补充学生活动'],
        engagement_goal: '明确本环节希望带动的学生参与状态。',
        formative_assessment: '补充即时评价方式',
        questions: [],
        fallback_strategy: '补充课堂冷场或时间不足时的替代方案。',
      }],
    }));
    setToast('已新增 5 分钟教学环节，可继续让 AI 完善具体内容');
  }
  function scrollTo(key) {
    setSelected(key);
    document.getElementById(`lesson-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  async function revise(instruction = feedback) {
    if (!instruction.trim() || revising) return;
    setFeedback(''); setRevisionError(''); setRevising(true);
    setChat((items) => [...items, { role: 'user', text: instruction }, { role: 'loading', text: '正在分析当前版本并修改…' }]);
    try {
      const result = await api.reviseLesson({ lessonPlan: lesson, feedback: instruction });
      const next = result.data?.lessonPlan || result.lessonPlan;
      if (!next) throw new Error('模型未返回修改后的教案。');
      localStorage.setItem('current-lesson-canonical', JSON.stringify(next));
      const updated = { ...normalizeLesson(next), id: lesson.id, updated_at: '刚刚' };
      const nextVersion = historyRef.current.length + 2;
      updateLesson(updated);
      setChat((items) => [...items.filter((item) => item.role !== 'loading'), { role: 'assistant', text: '修改完成，已创建新版本。你可以查看文档变化，或继续告诉我需要调整的地方。' }]);
      setToast(`修改已完成，并保存为版本 v${nextVersion}.0`);
    } catch (error) {
      setRevisionError(error.message);
      setChat((items) => [...items.filter((item) => item.role !== 'loading'), { role: 'error', text: `本次修改未完成：${error.message}` }]);
    } finally { setRevising(false); }
  }
  async function submitTrainingCandidate() {
    if (isDemo) return;
    if (candidateSubmitted.current) return;
    try {
      const canonicalLesson = toCanonicalLesson(lesson, loadCanonicalLesson());
      await api.submitTrainingCandidate({
        lessonPlan: canonicalLesson,
        rightsConfirmed: localStorage.getItem('current-lesson-rights-confirmed') === 'true',
      });
      candidateSubmitted.current = true;
    } catch {
      // 归档提交不影响教师当前的定稿与导出操作。
    }
  }
  function finalize() {
    updateLesson((current) => ({ ...current, finalized_at: new Date().toISOString() }), true);
    setToast('已在当前浏览器将这个版本标记为定稿；继续修改会自动取消定稿标记');
    void submitTrainingCandidate();
  }
  function exportDoc() {
    downloadBlob(lessonToHtml(lesson), 'application/msword;charset=utf-8', `${title}.doc`);
    setExportOpen(false);
    setToast('DOC 文档已开始下载');
    void submitTrainingCandidate();
  }
  function exportJson() {
    downloadBlob(JSON.stringify(lesson, null, 2), 'application/json', `${title}.json`);
    setExportOpen(false);
    setToast('结构化教案 JSON 已开始下载');
    void submitTrainingCandidate();
  }
  function exportPrint() {
    setExportOpen(false);
    setTimeout(() => window.print(), 100);
    void submitTrainingCandidate();
  }

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <div className="editor-top-left"><button className="icon-button" onClick={() => navigate('/app')} aria-label="返回工作台"><ArrowLeft size={18} /></button><span className="editor-brand"><BookOpen size={18} /> {siteName}</span><i /></div>
        <div className="save-state">{isDemo ? <><CheckCircle2 size={16} /> 参考教案 · 修改仅保留在当前页面</> : dirty ? <><span className="unsaved-dot" /> 有未保存修改</> : <><CheckCircle2 size={16} /> 已保存到当前浏览器</>}</div>
        <div className="editor-history-tools"><button title="撤销" onClick={undo} disabled={!historyRef.current.length}><Undo2 size={17} /><span>撤销</span></button><button title="重做" onClick={redo} disabled={!redoRef.current.length}><Redo2 size={17} /><span>重做</span></button></div>
        <div className="editor-top-actions"><button onClick={() => setVersionsOpen(true)}><History size={17} /><span>版本历史</span></button><button onClick={finalize} disabled={finalized}><CheckCircle2 size={17} /><span>{finalized ? '已定稿' : '定稿'}</span></button><Button icon={Download} onClick={() => setExportOpen(true)}>导出教案</Button></div>
      </header>
      <div className="editor-layout">
        <aside className="editor-leftbar">
          <header><button onClick={() => navigate('/app')} aria-label="返回工作台"><ArrowLeft size={17} /></button><b>教案大纲</b><button aria-label={sourcesOpen ? '收起素材来源' : '展开素材来源'} onClick={() => setSourcesOpen((value) => !value)}><MoreHorizontal size={17} /></button></header>
          <nav aria-label="教案章节">{outline.map(([key, label], index) => <button key={key} aria-current={selected === key ? 'location' : undefined} className={selected === key ? 'active' : ''} onClick={() => scrollTo(key)}><span>{index + 1}</span>{label}<Check size={14} /></button>)}</nav>
          <div className="source-materials"><button onClick={() => setSourcesOpen((value) => !value)}><b>素材来源（{sourceItems.length}）</b><ChevronDown size={16} className={sourcesOpen ? 'open' : ''} /></button>{sourcesOpen ? <div>{sourceItems.map((file) => <article key={file.name}><span className="source-thumb guide">{file.mark}</span><p><b>{file.name}</b><small>{file.detail}</small></p></article>)}{!sourceItems.length ? <p className="source-empty">当前教案没有可显示的源文件记录。</p> : null}</div> : null}</div>
        </aside>

        <main className="document-workspace">
          <article className="lesson-document">
            <header className="document-header"><div><div className="document-title-line"><h1 contentEditable role="textbox" aria-label="教案标题" suppressContentEditableWarning onInput={() => setDirty(true)} onBlur={(event) => updateLesson({ ...lesson, metadata: { ...lesson.metadata, title: event.currentTarget.textContent } })}>{title}</h1><Pencil size={16} /></div><p><span>年级：{lesson.metadata?.grade}</span><span>学科：{lesson.metadata?.subject}</span><span>课时：{lesson.metadata?.duration_minutes || 45} 分钟</span></p></div><span className="generated-label"><Sparkles size={14} /> {isDemo ? '参考教案' : `AI 生成 · v${currentVersion}.0`}</span></header>
            <nav className="lesson-workflow-nav" aria-label="教案知识点组卷工作流"><span className="active"><FileText size={16} /><b>1. 教案设计</b><small>当前步骤</small></span><button onClick={() => navigate(`/app/lesson/${lesson.id || 'current'}/knowledge`)}><Network size={16} /><b>2. 知识点图谱</b><small>提取与校验</small></button><button onClick={() => navigate('/app/papers')}><ScrollText size={16} /><b>3. 智能组卷</b><small>选题与导出</small></button></nav>
            <section id="lesson-objectives" className="document-section"><div className="section-number">一</div><h2>教学目标</h2><ol className="objective-list">{(lesson.learning_objectives || []).map((item, index) => <li key={`${item.type}-${index}`}><span>{item.type}</span><p contentEditable role="textbox" aria-label={`教学目标 ${index + 1}`} suppressContentEditableWarning onInput={() => setDirty(true)} onBlur={(event) => updateLesson((current) => ({ ...current, learning_objectives: current.learning_objectives.map((objective, i) => i === index ? { ...objective, content: event.currentTarget.textContent } : objective) }))}>{item.content}</p></li>)}</ol></section>
            <section id="lesson-learner" className="document-section"><div className="section-number">二</div><h2>学情分析</h2><p>{lesson.metadata?.class_profile || lesson.learner_analysis?.challenge || '请补充班级学情。'}</p><div className="analysis-strip"><div><b>已有基础</b><p>{lesson.learner_analysis?.known}</p></div><div><b>学习挑战</b><p>{lesson.learner_analysis?.challenge}</p></div><div><b>教学策略</b><p>{lesson.learner_analysis?.strategy}</p></div></div></section>
            <section id="lesson-keypoints" className="document-section two-column-section"><div><div className="section-number">三</div><h2>教学重点</h2><ul>{(lesson.key_points || []).map((item) => <li key={item}>{item}</li>)}</ul></div><div><h2>教学难点</h2><ul>{(lesson.difficult_points || []).map((item) => <li key={item}>{item}</li>)}</ul></div></section>
            <section id="lesson-preparation" className="document-section"><div className="section-number">四</div><h2>教学准备</h2><div className="preparation-grid"><div><b>教师准备</b><ul>{(lesson.preparation?.teacher || []).map((item) => <li key={item}>{item}</li>)}</ul></div><div><b>学生准备</b><ul>{(lesson.preparation?.students || []).map((item) => <li key={item}>{item}</li>)}</ul></div><div><b>材料</b><ul>{(lesson.preparation?.materials || []).map((item) => <li key={item}>{item}</li>)}</ul></div></div></section>
            <section id="lesson-timeline" className="document-section"><div className="timeline-heading"><div><div className="section-number">五</div><h2>教学过程</h2></div><span><Clock3 size={14} /> 共 {totalMinutes} 分钟</span></div><div className="timeline-table"><div className="timeline-row timeline-head"><span>教学环节</span><span>时间</span><span>教师活动与讲解话术</span><span>学生活动</span><span>参与目标</span></div>{(lesson.timeline || []).map((item, index) => <div className="timeline-row" key={`${item.stage}-${index}`}><span><b>{item.stage}</b><small>{item.formative_assessment}</small></span><span>{item.duration_minutes} 分钟</span><span><p>{item.teacher_script}</p>{item.questions?.length ? <em>核心问题：{item.questions[0]}</em> : null}</span><span><ul>{(item.student_actions || []).map((action) => <li key={action}>{action}</li>)}</ul></span><span><p>{item.engagement_goal}</p>{item.fallback_strategy ? <em>备选：{item.fallback_strategy}</em> : null}</span></div>)}</div><button className="add-stage" onClick={addStage}><span>+</span> 添加教学环节</button></section>
            <section id="lesson-interaction" className="document-section"><div className="section-number">六</div><h2>课堂参与与氛围设计</h2><div className="engagement-curve">{['好奇', '理解', '合作', '挑战', '获得感'].map((item, index) => <div key={item}><i style={{ height: `${22 + index * 7 + (index === 3 ? 8 : 0)}px` }} /><span>{item}</span></div>)}</div><div className="strategy-note"><Lightbulb size={17} /><p><b>课堂语言建议</b><span>用“我听到了什么证据”代替“谁能答对”，让学生的注意力从结果转向观察和表达。</span></p></div></section>
            <section id="lesson-board" className="document-section"><div className="section-number">七</div><h2>板书设计</h2><pre className="board-preview">{lesson.board_design}</pre></section>
            <section id="lesson-homework" className="document-section"><div className="section-number">八</div><h2>课后作业</h2><div className="homework-list">{(lesson.homework || []).map((item) => <div key={item.level}><span>{item.level}</span><p>{item.content}</p></div>)}</div></section>
            <section id="lesson-exercises" className="document-section exercises-section"><div className="exercises-heading"><div><div className="section-number">九</div><h2>习题与答案</h2></div><span>{exerciseCount} 道 · 含答案与解析</span></div>{(lesson.exercises || []).map((item, index) => <details className="exercise-item" key={item.id || index}><summary><span>{index + 1}</span><div><b>{item.stem}</b><small>{item.type} · 难度 {item.difficulty}/5 · {(item.knowledge_points || []).join('、')}</small></div><ChevronDown size={17} /></summary><div className="exercise-answer"><p><b>参考答案</b>{Array.isArray(item.options) && item.options.length ? <span>{item.options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join('　')}</span> : null}<span>{item.answer}</span></p><p><b>解析</b><span>{item.explanation}</span></p></div></details>)}</section>
            <footer className="document-footer"><span>{totalMinutes} 分钟课堂流程 · {exerciseCount} 道习题</span><span>{isDemo ? '参考内容' : `最后保存：${lesson.updated_at || '刚刚'}`}</span></footer>
          </article>
        </main>

        <aside className="ai-panel">
          <header><div><Bot size={18} /><b>AI 助教</b></div><button aria-label="查看 AI 修改历史" onClick={() => setVersionsOpen(true)}><History size={16} /></button></header>
          <div className="chat-thread" aria-live="polite">{chat.map((item, index) => <div key={index} className={`chat-message ${item.role}`}><span>{item.role === 'user' ? '我' : item.role === 'loading' ? <LoaderCircle className="spin" size={16} /> : <Bot size={16} />}</span><div>{item.role === 'loading' ? <><b>正在思考并修改中…</b><ul><li className="done">分析教案结构与修改范围</li><li className="active">重写相关教学环节</li><li>检查课堂时间与习题完整性</li></ul></> : <p>{item.text}</p>}</div></div>)}</div>
          <section className="suggestion-panel"><header><b>为你生成的修改建议</b><span>3 条</span></header>{['把导入改得更有感染力', '增加小组互动与评价支架', '补充课堂冷场时的过渡语'].map((item) => <button key={item} onClick={() => revise(item)} disabled={revising}><span>{item}</span><b>应用</b></button>)}</section>
          <div className="ai-composer"><textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') revise(); }} placeholder="说说你想修改的地方…" maxLength={800} /><div><span>{feedback.length}/800</span><Button size="sm" icon={Send} onClick={() => revise()} disabled={!feedback.trim() || revising}>发送</Button></div>{revisionError ? <p>{revisionError}</p> : null}</div>
          <small className="ai-disclaimer">内容由 AI 生成，请结合实际学情审核后使用</small>
        </aside>
      </div>

      <Modal open={versionsOpen} onClose={() => setVersionsOpen(false)} title="版本历史" description="当前编辑会话最多保留 20 个修改快照；刷新页面后不会继续保留这些快照。">
        <div className="version-list"><button className="current" type="button" disabled><span>v{currentVersion}.0</span><div><b>当前版本</b><p>{dirty ? '包含正在编辑、尚未失焦保存的内容' : isDemo ? '当前页面中的参考版本' : '已保存到当前浏览器'}</p><small>刚刚 · 当前教师</small></div><CheckCircle2 size={18} /></button>{[...historyRef.current].reverse().map((snapshot, index) => <button type="button" key={`${historyVersion}-${index}`} onClick={() => restoreSnapshot(snapshot)}><span>v{Math.max(1, currentVersion - index - 1)}.0</span><div><b>历史版本</b><p>{snapshot.metadata?.title || snapshot.metadata?.chapter || '教案快照'}</p><small>本次会话 · 可恢复</small></div><RotateCcw size={17} /></button>)}{!historyRef.current.length ? <p className="version-empty">当前会话还没有历史修改；完成编辑或 AI 修改后会自动生成快照。</p> : null}</div>
      </Modal>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="导出教案" description={`导出当前版本 v${currentVersion}.0。`} footer={<><Button variant="ghost" onClick={() => setExportOpen(false)}>取消</Button><Button icon={FileDown} onClick={exportDoc}>导出 DOC</Button></>}>
        <div className="export-options"><button className="selected" onClick={exportDoc}><FileText size={22} /><div><b>Word 文档</b><p>可继续编辑，包含完整教案和答案解析</p></div><CheckCircle2 size={18} /></button><button onClick={exportPrint}><Printer size={22} /><div><b>打印 / PDF</b><p>使用浏览器打印，可保存为 PDF 文件</p></div></button><button onClick={exportJson}><FileJson size={22} /><div><b>结构化 JSON</b><p>适合归档并保留完整的教案结构</p></div></button></div>
      </Modal>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
