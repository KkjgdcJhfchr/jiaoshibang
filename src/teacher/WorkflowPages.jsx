import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Filter,
  GitBranch,
  ListChecks,
  MessageSquareText,
  Network,
  Plus,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Shuffle,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import { sampleLesson } from '../data/sampleLesson.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/navigation.jsx';
import { Button, Status, TeacherShell, Toast } from './components.jsx';

function readCurrentLesson() {
  try {
    return JSON.parse(localStorage.getItem('current-lesson')) || sampleLesson;
  } catch {
    return sampleLesson;
  }
}

function readStoredLesson() {
  try {
    return JSON.parse(localStorage.getItem('current-lesson')) || null;
  } catch {
    return null;
  }
}

function lessonTitle(lesson) {
  return lesson.metadata?.title || `${lesson.metadata?.chapter || '当前章节'}教学设计`;
}

function knowledgeList(lesson) {
  const map = new Map();
  const remember = (name, difficulty = 2, questionId = '') => {
    if (!name) return;
    const current = map.get(name) || { name, questionIds: [], difficultyTotal: 0 };
    if (questionId && !current.questionIds.includes(questionId)) current.questionIds.push(questionId);
    current.difficultyTotal += Number(difficulty || 2);
    map.set(name, current);
  };
  (lesson.key_points || lesson.keyPoints || []).forEach((name) => remember(name));
  (lesson.difficult_points || lesson.difficultPoints || []).forEach((name) => remember(name, 3));
  (lesson.exercises || []).forEach((question, index) => {
    const questionId = question.id || `q${index + 1}`;
    (question.knowledge_points || question.knowledgePoints || []).forEach((name) => remember(name, question.difficulty, questionId));
  });
  return [...map.values()].map((point, index) => {
    const average = point.questionIds.length ? point.difficultyTotal / Math.max(point.questionIds.length, 1) : 2;
    return {
      ...point,
      id: `kp-${index + 1}`,
      cognitive: average <= 1.5 ? '记忆' : average <= 2.5 ? '理解' : average <= 3.5 ? '应用' : '创新',
      phase: average <= 1.5 ? '新课导入' : average <= 3 ? '巩固练习' : '课后作业',
      confidence: Math.min(98, 78 + point.questionIds.length * 4),
    };
  });
}

function graphLayout(points, questions) {
  const shownPoints = points.slice(0, 7);
  const shownQuestions = questions.slice(0, 8);
  const pointNodes = shownPoints.map((point, index) => ({ ...point, x: 43, y: 13 + index * (74 / Math.max(shownPoints.length - 1, 1)) }));
  const questionNodes = shownQuestions.map((question, index) => ({
    ...question,
    id: question.id || `q${index + 1}`,
    x: 79,
    y: 10 + index * (80 / Math.max(shownQuestions.length - 1, 1)),
  }));
  return { pointNodes, questionNodes };
}

export function KnowledgeMapPage({ path }) {
  const lesson = useMemo(readCurrentLesson, []);
  const points = useMemo(() => knowledgeList(lesson), [lesson]);
  const questions = lesson.exercises || [];
  const { pointNodes, questionNodes } = useMemo(() => graphLayout(points, questions), [points, questions]);
  const [selected, setSelected] = useState(points[0] || null);
  const [view, setView] = useState('graph');
  const [toast, setToast] = useState('');
  const [extracting, setExtracting] = useState(false);
  const linkedQuestions = selected ? questions.filter((question) => (question.knowledge_points || question.knowledgePoints || []).includes(selected.name)) : [];

  async function reextract() {
    if (extracting) return;
    setExtracting(true);
    try {
      const response = await api.buildKnowledgeMap({ lessonPlan: lesson });
      const count = response.data?.nodes?.length || response.data?.knowledgePoints?.length || points.length;
      setToast(`关系校验完成，共识别 ${count} 个关系节点`);
    } catch (requestError) {
      setToast(`重新提取失败：${requestError.message}`);
    } finally { setExtracting(false); }
  }

  return (
    <TeacherShell path={path} title="教学认知图谱" subtitle="把教案中的教学意图沉淀为可复用的知识点与题目关系">
      <div className="workflow-page knowledge-page">
        <section className="workflow-hero knowledge-hero">
          <div>
            <span className="workflow-icon"><Network size={25} /></span>
            <div><p>当前教案</p><h2>{lessonTitle(lesson)}</h2><small>{lesson.metadata?.grade} · {lesson.metadata?.subject} · 自动关联 {questions.length} 道题</small></div>
          </div>
          <div className="workflow-hero-actions"><Button variant="secondary" onClick={() => navigate(`/app/lesson/${lesson.id || 'lesson-spring-001'}`)}>返回教案</Button><Button icon={Sparkles} onClick={reextract} disabled={extracting}>{extracting ? '正在校验…' : '重新分析关系'}</Button></div>
        </section>

        <div className="knowledge-metrics">
          <article><span><GitBranch size={18} /></span><div><small>知识点节点</small><strong>{points.length}</strong><p>来自目标、重难点与习题标注</p></div></article>
          <article><span><ListChecks size={18} /></span><div><small>已关联题目</small><strong>{questions.length}</strong><p>题目均保留答案与解析</p></div></article>
          <article><span><ShieldCheck size={18} /></span><div><small>题目标注率</small><strong>{Math.round((questions.filter((item) => (item.knowledge_points || item.knowledgePoints || []).length).length / Math.max(questions.length, 1)) * 100)}%</strong><p>关联结果建议结合教材复核</p></div></article>
          <article><span><Clock3 size={18} /></span><div><small>教学环节</small><strong>{lesson.timeline?.length || 0}</strong><p>按课堂流程组织知识点关系</p></div></article>
        </div>

        <section className="knowledge-workbench">
          <header className="workflow-panel-head">
            <div><h3>教案—知识点—题目关系</h3><p>点击知识点查看认知层级、教学环节与关联习题。</p></div>
            <div className="view-switch"><button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}><Network size={15} /> 图谱</button><button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}><ListChecks size={15} /> 列表</button></div>
          </header>
          <div className="knowledge-body">
            {view === 'graph' ? (
              <div className="knowledge-canvas" role="img" aria-label="当前教案、知识点和题目的关联图">
                <div className="graph-column-label lesson">教案</div><div className="graph-column-label points">知识点</div><div className="graph-column-label questions">题目</div>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                  {pointNodes.map((point) => <line key={`lesson-${point.id}`} x1="17" y1="50" x2={point.x - 5} y2={point.y} />)}
                  {questionNodes.flatMap((question, index) => {
                    const names = question.knowledge_points || question.knowledgePoints || [];
                    const related = pointNodes.filter((point) => names.includes(point.name));
                    const fallbacks = related.length ? related : [pointNodes[index % Math.max(pointNodes.length, 1)]].filter(Boolean);
                    return fallbacks.map((point) => <line className="question-edge" key={`${point.id}-${question.id}`} x1={point.x + 5} y1={point.y} x2={question.x - 4} y2={question.y} />);
                  })}
                </svg>
                <button className="graph-node graph-lesson-node" style={{ left: '13%', top: '50%' }} onClick={() => setSelected(null)}><BookOpen size={18} /><span>{lesson.metadata?.chapter || '当前教案'}</span></button>
                {pointNodes.map((point) => <button className={`graph-node graph-point-node ${selected?.id === point.id ? 'selected' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} key={point.id} onClick={() => setSelected(point)}><span>{point.name}</span><small>{point.questionIds.length} 题 · {point.cognitive}</small></button>)}
                {questionNodes.map((question, index) => <button className="graph-node graph-question-node" style={{ left: `${question.x}%`, top: `${question.y}%` }} key={question.id || index} onClick={() => { const point = points.find((item) => (question.knowledge_points || question.knowledgePoints || []).includes(item.name)); if (point) setSelected(point); }}><span>{index + 1}</span><small>{question.type}</small></button>)}
                <div className="graph-legend"><span><i className="lesson-dot" />教案</span><span><i className="point-dot" />知识点</span><span><i className="question-dot" />题目</span></div>
              </div>
            ) : (
              <div className="knowledge-list-view">
                <div className="knowledge-list-row head"><span>知识点</span><span>认知层级</span><span>教学环节</span><span>关联题目</span><span>关联完整度</span></div>
                {points.map((point) => <button className={`knowledge-list-row ${selected?.id === point.id ? 'selected' : ''}`} key={point.id} onClick={() => setSelected(point)}><span><b>{point.name}</b><small>{lesson.metadata?.subject} · {lesson.metadata?.grade}</small></span><span>{point.cognitive}</span><span>{point.phase}</span><span>{point.questionIds.length} 道</span><span>{point.confidence}%</span></button>)}
              </div>
            )}
            <aside className="knowledge-detail">
              {selected ? <>
                <header><span><Network size={17} /></span><div><small>已选知识点</small><h3>{selected.name}</h3></div></header>
                <dl><div><dt>认知层级</dt><dd>{selected.cognitive}</dd></div><div><dt>适用环节</dt><dd>{selected.phase}</dd></div><div><dt>关联完整度</dt><dd>{selected.confidence}%</dd></div><div><dt>关联习题</dt><dd>{linkedQuestions.length} 道</dd></div></dl>
                <div className="knowledge-confidence"><p><span>关联完整度</span><b>{selected.confidence}%</b></p><i><span style={{ width: `${selected.confidence}%` }} /></i><small>依据教案目标、重难点与题目标注综合计算</small></div>
                <div className="linked-question-list"><h4>关联题目</h4>{linkedQuestions.slice(0, 4).map((question, index) => <button key={question.id || index} onClick={() => navigate('/app/papers')}><span>{question.id?.replace('q', '') || index + 1}</span><p><b>{question.stem}</b><small>{question.type} · 难度 {question.difficulty}/5</small></p><ArrowRight size={14} /></button>)}{!linkedQuestions.length ? <p className="empty-linked">暂无直接关联题目，建议人工确认后补充。</p> : null}</div>
                <Button icon={FileText} onClick={() => navigate('/app/papers')}>基于该知识点组卷</Button>
              </> : <div className="knowledge-detail-empty"><BookOpen size={27} /><h3>{lesson.metadata?.chapter}</h3><p>请选择一个知识点查看详情。</p></div>}
            </aside>
          </div>
        </section>
        <p className="workflow-disclosure"><ShieldCheck size={15} /> 图谱关系依据当前教案的目标、重难点与题目标注生成，请结合教材内容复核后使用。</p>
      </div>
      {toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}
    </TeacherShell>
  );
}

function paperQuestions(lesson) {
  return (lesson.exercises || []).map((question, index) => ({
    ...question,
    id: question.id || `q${index + 1}`,
    source: question.source || 'AI 生成题',
    recommendation: Math.min(98, 81 + (question.knowledge_points || question.knowledgePoints || []).length * 3 - Number(question.difficulty || 2)),
  }));
}

function htmlEscape(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function paperHtml(title, questions, includeAnswers) {
  const rows = questions.map((question, index) => `<section><h3>${index + 1}. [${htmlEscape(question.type)}] ${htmlEscape(question.stem)} <small>（10分）</small></h3>${question.options?.length ? `<ol type="A">${question.options.map((option) => `<li>${htmlEscape(option)}</li>`).join('')}</ol>` : '<p class="answer-space"></p>'}${includeAnswers ? `<div class="answer"><b>参考答案：</b>${htmlEscape(question.answer)}<br><b>解析：</b>${htmlEscape(question.explanation)}</div>` : ''}</section>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlEscape(title)}</title><style>body{font-family:'Microsoft YaHei',sans-serif;max-width:850px;margin:40px auto;color:#17231f;font-size:15px;line-height:1.75}h1{text-align:center;font-size:25px}.meta{text-align:center;color:#66736f;border-bottom:2px solid #243d35;padding-bottom:18px}section{page-break-inside:avoid;margin:24px 0}h3{font-size:15px;font-weight:500}h3 small{font-weight:400}.answer-space{height:64px;border-bottom:1px dashed #bbb}.answer{margin-top:12px;padding:12px 14px;background:#f2f7f4;border-left:4px solid #0d806e}@media print{body{margin:0}.answer{background:#fff}}</style></head><body><h1>${htmlEscape(title)}</h1><p class="meta">姓名：________　班级：________　得分：________　考试时间：45分钟　满分：${questions.length * 10}分</p>${rows}</body></html>`;
}

function downloadFile(content, name) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/msword;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

const TEAM_REVIEWS_KEY = 'teacher-helper.team-reviews.v2';
const MAX_REVIEW_ACTIVITIES = 30;

function reviewActivity(author, text) {
  return {
    id: `review-activity-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    author,
    text,
    time: '刚刚',
  };
}

export function PaperBuilderPage({ path }) {
  const lesson = useMemo(readCurrentLesson, []);
  const initialQuestions = useMemo(() => paperQuestions(lesson), [lesson]);
  const [questions, setQuestions] = useState(initialQuestions);
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialQuestions.slice(0, 10).map((item) => item.id)));
  const [difficulty, setDifficulty] = useState('全部难度');
  const [type, setType] = useState('全部题型');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(false);
  const [toast, setToast] = useState('');
  const selectedQuestions = questions.filter((question) => selectedIds.has(question.id));
  const types = ['全部题型', ...new Set(questions.map((question) => question.type))];
  const filtered = questions.filter((question) => {
    if (difficulty !== '全部难度' && Number(question.difficulty) !== Number(difficulty)) return false;
    if (type !== '全部题型' && question.type !== type) return false;
    if (query && !`${question.stem} ${(question.knowledge_points || question.knowledgePoints || []).join(' ')}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  const easy = selectedQuestions.filter((item) => item.difficulty <= 2).length;
  const medium = selectedQuestions.filter((item) => item.difficulty === 3).length;
  const hard = selectedQuestions.filter((item) => item.difficulty >= 4).length;
  const knowledgeCoverage = new Set(selectedQuestions.flatMap((item) => item.knowledge_points || item.knowledgePoints || [])).size;
  const normalizedStems = selectedQuestions.map((item) => String(item.stem || '').replace(/\s+/g, '').toLowerCase()).filter(Boolean);
  const duplicateCount = normalizedStems.length - new Set(normalizedStems).size;
  const answersComplete = selectedQuestions.length > 0 && selectedQuestions.every((item) => item.answer && item.explanation);

  function toggleQuestion(id) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function smartOrder() {
    setQuestions((current) => [...current].sort((left, right) => Number(left.difficulty) - Number(right.difficulty) || left.type.localeCompare(right.type, 'zh-CN')));
    setToast('已按难度由易到难排序；同难度题目按题型排列');
  }
  function move(id, direction) {
    setQuestions((current) => {
      const next = [...current];
      const index = next.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }
  const title = `${lesson.metadata?.chapter || '当前章节'}同步练习`;

  return (
    <TeacherShell path={path} title="智能组卷" subtitle="从教案意图和知识点出发，完成选题、排序、预览与双版本导出">
      <div className="workflow-page paper-page">
        <section className="workflow-hero paper-hero">
          <div><span className="workflow-icon"><FileCheck2 size={25} /></span><div><p>基于当前教案</p><h2>{title}</h2><small>{lesson.metadata?.grade} · {lesson.metadata?.subject} · {selectedQuestions.length} 道题 · {selectedQuestions.length * 10} 分</small></div></div>
          <div className="workflow-hero-actions"><Button variant="secondary" icon={Network} onClick={() => navigate('/app/knowledge')}>查看图谱</Button><Button icon={Shuffle} onClick={smartOrder}>智能排序</Button></div>
        </section>

        <div className="paper-builder-layout">
          <section className="question-bank-panel">
            <header className="workflow-panel-head"><div><h3>教案习题</h3><p>匹配值依据知识点标注、题目难度与答案完整性计算。</p></div><span className="mvp-badge"><Sparkles size={13} /> 教案规则匹配</span></header>
            <div className="question-filters">
              <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题干或知识点" /></label>
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} aria-label="筛选难度"><option>全部难度</option>{[1, 2, 3, 4, 5].map((item) => <option key={item} value={item}>难度 {item}/5</option>)}</select>
              <select value={type} onChange={(event) => setType(event.target.value)} aria-label="筛选题型">{types.map((item) => <option key={item}>{item}</option>)}</select>
              <button className="filter-button" onClick={() => { setDifficulty('全部难度'); setType('全部题型'); setQuery(''); setToast('筛选条件已重置'); }} aria-label="重置筛选" title="重置筛选"><Filter size={16} /></button>
            </div>
            <div className="question-card-list">
              {filtered.map((question) => {
                const selected = selectedIds.has(question.id);
                return <article className={`question-card ${selected ? 'selected' : ''}`} key={question.id}>
                  <div className="question-card-number">{question.id.replace(/\D/g, '') || questions.indexOf(question) + 1}</div>
                  <div className="question-card-copy"><div className="question-tags"><span>{question.type}</span><span>难度 {question.difficulty}/5</span><span>{question.source}</span><em>规则匹配 {question.recommendation}%</em></div><h4>{question.stem}</h4><p>{(question.knowledge_points || question.knowledgePoints || []).map((point) => <span key={point}>{point}</span>)}</p><small>匹配依据：当前教案知识点标注、题目难度与答案解析完整性。</small></div>
                  <div className="question-card-actions"><button onClick={() => move(question.id, -1)} aria-label="上移" disabled={questions.findIndex((item) => item.id === question.id) <= 0}><ArrowUp size={15} /></button><button onClick={() => move(question.id, 1)} aria-label="下移" disabled={questions.findIndex((item) => item.id === question.id) >= questions.length - 1}><ArrowDown size={15} /></button><button className={selected ? 'remove' : 'add'} onClick={() => toggleQuestion(question.id)}>{selected ? <><Check size={15} /> 已选</> : <><Plus size={15} /> 加入</>}</button></div>
                </article>;
              })}
            </div>
          </section>

          <aside className="paper-outline-panel">
            <header><div><small>试卷篮</small><h3>{title}</h3></div><span>{selectedQuestions.length}/30</span></header>
            <div className="paper-score"><div><strong>{selectedQuestions.length * 10}</strong><span>分</span></div><p><b>{selectedQuestions.length}</b> 道题 · 预计 <b>45</b> 分钟</p></div>
            <div className="difficulty-bars"><p><span>基础题</span><b>{easy} 道</b></p><i><span style={{ width: `${selectedQuestions.length ? easy / selectedQuestions.length * 100 : 0}%` }} /></i><p><span>提升题</span><b>{medium} 道</b></p><i><span style={{ width: `${selectedQuestions.length ? medium / selectedQuestions.length * 100 : 0}%` }} /></i><p><span>挑战题</span><b>{hard} 道</b></p><i><span style={{ width: `${selectedQuestions.length ? hard / selectedQuestions.length * 100 : 0}%` }} /></i></div>
            <dl className="paper-health"><div><dt>知识点覆盖</dt><dd>{knowledgeCoverage} 个</dd></div><div><dt>题干完全重复</dt><dd className={duplicateCount ? '' : 'healthy'}>{duplicateCount} 道</dd></div><div><dt>答案与解析</dt><dd className={answersComplete ? 'healthy' : ''}>{answersComplete ? '完整' : '需补充'}</dd></div><div><dt>人工审核</dt><dd>导出前确认</dd></div></dl>
            <div className="paper-outline-list"><h4>题目顺序</h4>{selectedQuestions.map((question, index) => <button key={question.id} onClick={() => toggleQuestion(question.id)}><span>{index + 1}</span><p><b>{question.type}</b><small>{question.stem}</small></p><X size={14} /></button>)}</div>
            <div className="paper-actions"><Button variant="secondary" icon={Eye} onClick={() => setPreview(true)}>预览试卷</Button><Button icon={Download} onClick={() => { downloadFile(paperHtml(title, selectedQuestions, true), `${title}-答案版.doc`); setToast('答案版 Word 已开始下载'); }}>导出答案版</Button></div>
            <button className="publish-team" onClick={() => { localStorage.setItem('pending-team-paper', JSON.stringify({ title, questions: selectedQuestions, createdAt: new Date().toISOString() })); navigate('/app/team'); }}><Share2 size={15} /> 保存为评审草稿</button>
          </aside>
        </div>
        <p className="workflow-disclosure"><ShieldCheck size={15} /> 当前题目均来自本教案的结构化习题，请在导出前核对题干、答案与难度是否符合本班学情。</p>
      </div>
      {preview ? <div className="paper-preview-layer"><button className="paper-preview-backdrop" onClick={() => setPreview(false)} aria-label="关闭预览" /><section className="paper-preview-modal" role="dialog" aria-modal="true" aria-label="试卷预览"><header><div><small>学生卷预览</small><h2>{title}</h2></div><button onClick={() => setPreview(false)} aria-label="关闭"><X size={20} /></button></header><div className="paper-sheet"><h1>{title}</h1><p className="paper-sheet-meta">姓名：________　班级：________　得分：________　时间：45分钟　满分：{selectedQuestions.length * 10}分</p>{selectedQuestions.map((question, index) => <section key={question.id}><h3>{index + 1}. [{question.type}] {question.stem} <small>（10分）</small></h3>{question.options?.length ? <ol type="A">{question.options.map((option) => <li key={option}>{option}</li>)}</ol> : <div className="paper-answer-space" />}</section>)}</div><footer><Button variant="secondary" onClick={() => setPreview(false)}>继续调整</Button><Button icon={Download} onClick={() => { downloadFile(paperHtml(title, selectedQuestions, false), `${title}-学生版.doc`); setToast('学生版 Word 已开始下载'); setPreview(false); }}>导出学生版</Button></footer></section></div> : null}
      {toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}
    </TeacherShell>
  );
}

function loadTeamReviews() {
  try {
    const stored = JSON.parse(localStorage.getItem(TEAM_REVIEWS_KEY));
    const reviews = Array.isArray(stored) ? stored : [];
    const pendingPaper = JSON.parse(localStorage.getItem('pending-team-paper'));
    if (pendingPaper?.title && !reviews.some((item) => item.title === pendingPaper.title)) {
      localStorage.removeItem('pending-team-paper');
      return [{ title: pendingPaper.title, owner: '当前教师', subject: '当前学科', reviewers: [], comments: 0, status: '草稿', updated: '刚刚', source: '试卷' }, ...reviews];
    }
    return reviews;
  } catch { return []; }
}

export function TeamWorkspacePage({ path }) {
  const lesson = useMemo(readStoredLesson, []);
  const [reviews, setReviews] = useState(loadTeamReviews);
  const reviewsRef = useRef(reviews);
  const [toast, setToast] = useState('');
  const [comment, setComment] = useState('');
  const [filter, setFilter] = useState('全部');
  const [selectedTitle, setSelectedTitle] = useState(() => loadTeamReviews()[0]?.title || '');
  const [activities, setActivities] = useState([]);
  const selectedReview = reviews.find((item) => item.title === selectedTitle) || reviews[0] || null;
  const visibleReviews = reviews.filter((review) => filter === '全部' || (filter === '待我处理' ? review.status === '待评审' : review.owner === '当前教师'));
  reviewsRef.current = reviews;

  function replaceReviews(updater) {
    const current = reviewsRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (next === current) return false;
    reviewsRef.current = next;
    localStorage.setItem(TEAM_REVIEWS_KEY, JSON.stringify(next));
    setReviews(next);
    return true;
  }
  function addActivity(activity) {
    setActivities((items) => [activity, ...items].slice(0, MAX_REVIEW_ACTIVITIES));
  }
  function startReview() {
    if (!lesson) {
      setToast('请先创建或打开一份教案，再发起评审');
      return;
    }
    const baseTitle = lessonTitle(lesson);
    const existing = reviewsRef.current.find((item) => item.title === baseTitle);
    if (existing) {
      setSelectedTitle(existing.title);
      setToast('当前教案已有评审任务');
      return;
    }
    const subject = [lesson.metadata?.grade, lesson.metadata?.subject].filter(Boolean).join(' · ') || '课程待确认';
    const review = { title: baseTitle, owner: '当前教师', subject, reviewers: [], comments: 0, status: '草稿', updated: '刚刚' };
    replaceReviews((items) => [review, ...items]);
    setSelectedTitle(review.title);
    setToast('评审草稿已保存');
  }
  function submitComment() {
    const value = comment.trim();
    if (!value || !selectedReview) return;
    replaceReviews((items) => items.map((item) => item.title === selectedReview.title ? { ...item, comments: Number(item.comments || 0) + 1, updated: '刚刚' } : item));
    addActivity(reviewActivity('当前教师', value));
    setComment('');
    setToast('评审意见已保存在当前浏览器');
  }
  function decide(status) {
    if (!selectedReview) return;
    const changed = replaceReviews((items) => {
      const current = items.find((item) => item.title === selectedReview.title);
      if (!current || current.status === status) return items;
      return items.map((item) => item.title === selectedReview.title ? { ...item, status, updated: '刚刚' } : item);
    });
    if (!changed) {
      setToast(status === '已通过' ? '当前任务已经是通过状态' : '当前任务已经是退回修改状态');
      return;
    }
    addActivity(reviewActivity('系统', status === '已通过' ? '评审已通过' : '已退回作者修改'));
    setToast(status === '已通过' ? '当前任务已标记为通过' : '当前任务已标记为退回修改');
  }
  return (
    <TeacherShell path={path} title="教案评审" subtitle="集中查看草稿、记录批注，让每次修改都有依据">
      <div className="workflow-page team-page">
        <section className="workflow-hero team-hero"><div><span className="workflow-icon"><UsersRound size={25} /></span><div><p>教案评审工作区</p><h2>通过评审记录持续打磨教学内容</h2><small>{reviews.length} 项评审任务 · {reviews.filter((item) => item.status === '待评审').length} 项等待处理</small></div></div><div className="workflow-hero-actions"><Button icon={FileCheck2} onClick={startReview}>创建评审草稿</Button></div></section>
        <div className="team-metrics"><article><span><FileText size={18} /></span><div><strong>{reviews.length}</strong><small>评审任务</small></div><p>保存在当前浏览器</p></article><article><span><MessageSquareText size={18} /></span><div><strong>{reviews.reduce((sum, item) => sum + Number(item.comments || 0), 0)}</strong><small>评审批注</small></div><p>随任务保留</p></article><article><span><CheckCircle2 size={18} /></span><div><strong>{reviews.filter((item) => item.status === '已通过').length}</strong><small>已通过</small></div><p>状态可追溯</p></article><article><span><FileCheck2 size={18} /></span><div><strong>{reviews.filter((item) => item.status === '草稿').length}</strong><small>待完善草稿</small></div><p>可继续补充批注</p></article></div>
        <div className="team-layout"><section className="review-queue"><header className="workflow-panel-head"><div><h3>评审队列</h3><p>可在当前浏览器中筛选任务、记录批注并更新评审状态。</p></div><div className="view-switch">{['全部', '待我处理', '我发起的'].map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div></header><div className="review-table"><div className="review-row head"><span>教案</span><span>发起人</span><span>评审人</span><span>批注</span><span>状态</span><span>更新</span></div>{visibleReviews.map((review) => <button className={`review-row ${selectedReview?.title === review.title ? 'selected' : ''}`} key={review.title} onClick={() => setSelectedTitle(review.title)}><span><b>{review.title}</b><small>{review.subject}</small></span><span>{review.owner}</span><span className="reviewer-stack">{review.reviewers.length ? review.reviewers.map((reviewer) => <i key={reviewer}>{reviewer}</i>) : <small>未分配</small>}</span><span>{review.comments} 条</span><span><Status>{review.status === '待评审' ? '审核中' : review.status === '已通过' ? '已完成' : review.status === '修改中' ? '修改中' : '草稿'}</Status></span><span>{review.updated}</span></button>)}{!visibleReviews.length ? <p className="review-empty">当前筛选下没有评审任务。</p> : null}</div></section>
          <aside className="team-activity"><header><div><h3>评审动态</h3><p>当前选中：{selectedReview?.title || '暂无任务'}</p></div><span>{selectedReview?.status || '—'}</span></header><div className="activity-stream">{activities.map((activity) => <article key={activity.id}><span className={activity.author === '系统' ? 'system' : ''}>{activity.author === '系统' ? <Clock3 size={15} /> : activity.author.slice(0, 1)}</span><div><p><b>{activity.author}</b></p><blockquote>{activity.text}</blockquote><small>{activity.time}</small></div></article>)}{!activities.length ? <article><span className="system"><Clock3 size={15} /></span><div><p><b>系统</b> 等待新的评审记录</p><small>当前会话</small></div></article> : null}</div><div className="team-comment"><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="写下具体、可执行的评审意见…" /><Button size="sm" icon={Send} disabled={!comment.trim() || !selectedReview} onClick={submitComment}>保存批注</Button></div><div className="review-decision"><button onClick={() => decide('修改中')} disabled={!selectedReview || selectedReview.status === '修改中'}>标记退回</button><button onClick={() => decide('已通过')} disabled={!selectedReview || selectedReview.status === '已通过'}><CheckCircle2 size={16} /> 标记通过</button></div></aside>
        </div>
        <p className="workflow-disclosure"><ShieldCheck size={15} /> 草稿、批注与评审状态保存在当前浏览器，请及时导出或备份重要内容。</p>
      </div>
      {toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}
    </TeacherShell>
  );
}
