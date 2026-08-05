import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  LoaderCircle,
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
import { api } from '../lib/api.js';
import { navigate } from '../lib/navigation.jsx';
import { Button, EmptyState, Status, TeacherShell, Toast } from './components.jsx';
import { useLessonRecord } from './useLessonRecords.js';

function lessonTitle(lesson) {
  return lesson.metadata?.title || `${lesson.metadata?.chapter || '当前章节'}教学设计`;
}

const QUESTION_TYPE_LABELS = Object.freeze({
  single_choice: '单选题',
  multiple_choice: '多选题',
  true_false: '判断题',
  fill_blank: '填空题',
  short_answer: '简答题',
  essay: '论述题',
  writing: '写作题',
  calculation: '计算题',
  inquiry: '探究题',
  practice: '实践题',
  matching: '匹配题',
  ordering: '排序题',
  选择: '选择题',
  填空: '填空题',
  简答: '简答题',
  赏析: '赏析题',
  探究: '探究题',
  仿写: '仿写题',
  微写作: '微写作题',
});

function questionTypeLabel(type) {
  const raw = String(type || '').trim();
  if (!raw) return '题目';
  if (QUESTION_TYPE_LABELS[raw]) return QUESTION_TYPE_LABELS[raw];
  if (/^[\u3400-\u9fff]/u.test(raw)) return raw;
  const normalized = raw.toLocaleLowerCase('en-US').replace(/[\s-]+/g, '_');
  return QUESTION_TYPE_LABELS[normalized] || '其他题型';
}

function questionSourceLabel(source) {
  const raw = String(source || '').trim();
  return !raw || /\bAI\b|人工智能|模型生成|智能生成/iu.test(raw) ? '当前教案' : raw;
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

const GRAPH_MIN_HEIGHT = 585;
const GRAPH_TOP_PADDING = 64;
const GRAPH_BOTTOM_PADDING = 68;
const GRAPH_POINT_GAP = 72;
const GRAPH_QUESTION_GAP = 54;

function graphAxis(count, canvasHeight) {
  if (!count) return [];
  if (count === 1) return [canvasHeight / 2];
  const usableHeight = canvasHeight - GRAPH_TOP_PADDING - GRAPH_BOTTOM_PADDING;
  return Array.from({ length: count }, (_, index) => GRAPH_TOP_PADDING + (usableHeight * index) / (count - 1));
}

function graphLayout(points, questions) {
  const pointHeight = Math.max(points.length - 1, 0) * GRAPH_POINT_GAP;
  const questionHeight = Math.max(questions.length - 1, 0) * GRAPH_QUESTION_GAP;
  const canvasHeight = Math.max(GRAPH_MIN_HEIGHT, GRAPH_TOP_PADDING + GRAPH_BOTTOM_PADDING + Math.max(pointHeight, questionHeight));
  const pointPositions = graphAxis(points.length, canvasHeight);
  const questionPositions = graphAxis(questions.length, canvasHeight);
  const pointNodes = points.map((point, index) => ({ ...point, x: 43, y: pointPositions[index] }));
  const questionNodes = questions.map((question, index) => ({
    ...question,
    id: question.id || `q${index + 1}`,
    x: 84,
    y: questionPositions[index],
  }));
  return { canvasHeight, pointNodes, questionNodes };
}

function LessonWorkflowState({ path, title, loading, error, onRetry }) {
  return (
    <TeacherShell path={path} title={title} subtitle="内容只会基于当前账户实际生成并保存的教案显示。">
      <EmptyState
        icon={loading ? LoaderCircle : BookOpen}
        title={loading ? '正在读取教案' : error ? '教案暂时无法读取' : '还没有可用教案'}
        text={loading ? '正在从你的账户同步教案，请稍候。' : error || '请先创建并完成一份教案，再使用此功能。'}
        action={!loading ? <Button onClick={error ? onRetry : () => navigate('/app/create')}>{error ? '重新加载' : '创建教案'}</Button> : null}
      />
    </TeacherShell>
  );
}

export function KnowledgeMapPage({ path }) {
  const state = useLessonRecord(path);
  if (!state.lesson) return <LessonWorkflowState path={path} title="教学认知图谱" loading={state.loading} error={state.error} onRetry={() => void state.reload()} />;
  return <KnowledgeMapContent path={path} lesson={state.lesson} lessonId={state.lessonId} />;
}

function KnowledgeMapContent({ path, lesson, lessonId }) {
  const points = useMemo(() => knowledgeList(lesson), [lesson]);
  const questions = lesson.exercises || [];
  const { canvasHeight, pointNodes, questionNodes } = useMemo(() => graphLayout(points, questions), [points, questions]);
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
          <div className="workflow-hero-actions"><Button variant="secondary" onClick={() => navigate(`/app/lesson/${lessonId}`)}>返回教案</Button><Button icon={Sparkles} onClick={reextract} disabled={extracting}>{extracting ? '正在校验…' : '重新分析关系'}</Button></div>
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
              <div className="knowledge-canvas-scroll" role="region" aria-label={`当前教案、${pointNodes.length} 个知识点和 ${questionNodes.length} 道题目的关联图`} tabIndex={0}>
                <div className="knowledge-canvas" style={{ height: `${canvasHeight}px` }}>
                  <div className="graph-column-label lesson">教案</div><div className="graph-column-label points">知识点</div><div className="graph-column-label questions">题目</div>
                  <svg aria-hidden="true">
                    {pointNodes.map((point) => <line key={`lesson-${point.id}`} x1="17%" y1={canvasHeight / 2} x2={`${point.x - 5}%`} y2={point.y} />)}
                    {questionNodes.flatMap((question, index) => {
                      const names = question.knowledge_points || question.knowledgePoints || [];
                      const related = pointNodes.filter((point) => names.includes(point.name));
                      const fallbacks = related.length ? related : [pointNodes[index % Math.max(pointNodes.length, 1)]].filter(Boolean);
                      return fallbacks.map((point) => <line className="question-edge" key={`${point.id}-${question.id}`} x1={`${point.x + 5}%`} y1={point.y} x2={`${question.x - 4}%`} y2={question.y} />);
                    })}
                  </svg>
                  <button className="graph-node graph-lesson-node" style={{ left: '13%', top: `${canvasHeight / 2}px` }} onClick={() => setSelected(null)}><BookOpen size={18} /><span>{lesson.metadata?.chapter || '当前教案'}</span></button>
                  {pointNodes.map((point) => <button className={`graph-node graph-point-node ${selected?.id === point.id ? 'selected' : ''}`} style={{ left: `${point.x}%`, top: `${point.y}px` }} key={point.id} onClick={() => setSelected(point)}><span>{point.name}</span><small>{point.questionIds.length} 题 · {point.cognitive}</small></button>)}
                  {questionNodes.map((question, index) => <button className="graph-node graph-question-node" style={{ left: `${question.x}%`, top: `${question.y}px` }} key={question.id || index} title={`${index + 1}. ${questionTypeLabel(question.type)}`} onClick={() => { const point = points.find((item) => (question.knowledge_points || question.knowledgePoints || []).includes(item.name)); if (point) setSelected(point); }}><span>{index + 1}</span><small>{questionTypeLabel(question.type)}</small></button>)}
                  <div className="graph-legend"><span><i className="lesson-dot" />教案</span><span><i className="point-dot" />知识点</span><span><i className="question-dot" />题目</span></div>
                </div>
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
                <div className="linked-question-list"><h4>关联题目</h4>{linkedQuestions.map((question, index) => <button key={question.id || index} onClick={() => navigate(`/app/papers/${lessonId}`)}><span>{question.id?.replace('q', '') || index + 1}</span><p><b>{question.stem}</b><small>{questionTypeLabel(question.type)} · 难度 {question.difficulty}/5</small></p><ArrowRight size={14} /></button>)}{!linkedQuestions.length ? <p className="empty-linked">暂无直接关联题目，建议人工确认后补充。</p> : null}</div>
                <Button icon={FileText} onClick={() => navigate(`/app/papers/${lessonId}`)}>基于该知识点组卷</Button>
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
    source: questionSourceLabel(question.source),
    recommendation: Math.min(98, 81 + (question.knowledge_points || question.knowledgePoints || []).length * 3 - Number(question.difficulty || 2)),
  }));
}

function htmlEscape(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function paperHtml(title, questions, includeAnswers) {
  const rows = questions.map((question, index) => `<section><h3>${index + 1}. [${htmlEscape(questionTypeLabel(question.type))}] ${htmlEscape(question.stem)} <small>（10分）</small></h3>${question.options?.length ? `<ol type="A">${question.options.map((option) => `<li>${htmlEscape(option)}</li>`).join('')}</ol>` : '<p class="answer-space"></p>'}${includeAnswers ? `<div class="answer"><b>参考答案：</b>${htmlEscape(question.answer)}<br><b>解析：</b>${htmlEscape(question.explanation)}</div>` : ''}</section>`).join('');
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

const MAX_REVIEW_ACTIVITIES = 30;

function reviewActivity(author, text) {
  return {
    id: `review-activity-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    author,
    text,
    time: '刚刚',
  };
}

function reviewRecordFromResponse(response) {
  return response?.data?.review || response?.review || null;
}

function reviewRecordsFromResponse(response) {
  const reviews = response?.data?.reviews || response?.reviews;
  return Array.isArray(reviews) ? reviews : [];
}

function reviewUpdatedLabel(value) {
  const timestamp = new Date(value || '').getTime();
  if (!Number.isFinite(timestamp)) return '刚刚';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function normalizeReviewRecord(record) {
  const explicitUpdated = String(record?.updated || '');
  const explicitUpdatedTime = new Date(explicitUpdated).getTime();
  return {
    ...record,
    id: String(record?.id || ''),
    title: String(record?.title || '未命名评审'),
    owner: String(record?.owner || '当前教师'),
    subject: String(record?.subject || '课程待确认'),
    reviewers: Array.isArray(record?.reviewers) ? record.reviewers : [],
    comments: Number(record?.comments || 0),
    status: String(record?.status || '草稿'),
    source: String(record?.source || '教案'),
    questions: Array.isArray(record?.questions) ? record.questions : [],
    activities: Array.isArray(record?.activities) ? record.activities : [],
    updated: Number.isFinite(explicitUpdatedTime)
      ? reviewUpdatedLabel(explicitUpdated)
      : (explicitUpdated || reviewUpdatedLabel(record?.updatedAt || record?.createdAt)),
  };
}

export function PaperBuilderPage({ path }) {
  const state = useLessonRecord(path);
  if (!state.lesson) return <LessonWorkflowState path={path} title="智能组卷" loading={state.loading} error={state.error} onRetry={() => void state.reload()} />;
  return <PaperBuilderContent path={path} lesson={state.lesson} lessonId={state.lessonId} />;
}

function PaperBuilderContent({ path, lesson, lessonId }) {
  const initialQuestions = useMemo(() => paperQuestions(lesson), [lesson]);
  const [questions, setQuestions] = useState(initialQuestions);
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialQuestions.slice(0, 10).map((item) => item.id)));
  const [difficulty, setDifficulty] = useState('全部难度');
  const [type, setType] = useState('全部题型');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState(false);
  const [toast, setToast] = useState('');
  const [publishingReview, setPublishingReview] = useState(false);
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

  async function publishReviewDraft() {
    if (publishingReview) return;
    setPublishingReview(true);
    try {
      await api.createReview({
        title,
        subject: [lesson.metadata?.grade, lesson.metadata?.subject].filter(Boolean).join(' · ') || '课程待确认',
        reviewers: [],
        comments: 0,
        status: '草稿',
        source: '试卷',
        questions: selectedQuestions,
        activities: [],
      });
      navigate('/app/team');
    } catch (error) {
      setToast(error.message || '评审草稿保存失败，请稍后重试。');
    } finally {
      setPublishingReview(false);
    }
  }

  return (
    <TeacherShell path={path} title="智能组卷" subtitle="从教案意图和知识点出发，完成选题、排序、预览与双版本导出">
      <div className="workflow-page paper-page">
        <section className="workflow-hero paper-hero">
          <div><span className="workflow-icon"><FileCheck2 size={25} /></span><div><p>基于当前教案</p><h2>{title}</h2><small>{lesson.metadata?.grade} · {lesson.metadata?.subject} · {selectedQuestions.length} 道题 · {selectedQuestions.length * 10} 分</small></div></div>
          <div className="workflow-hero-actions"><Button variant="secondary" icon={Network} onClick={() => navigate(`/app/lesson/${lessonId}/knowledge`)}>查看图谱</Button><Button icon={Shuffle} onClick={smartOrder}>智能排序</Button></div>
        </section>

        <div className="paper-builder-layout">
          <section className="question-bank-panel">
            <header className="workflow-panel-head"><div><h3>教案习题</h3><p>匹配值依据知识点标注、题目难度与答案完整性计算。</p></div><span className="mvp-badge"><Sparkles size={13} /> 教案规则匹配</span></header>
            <div className="question-filters">
              <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索题干或知识点" /></label>
              <select value={difficulty} onChange={(event) => setDifficulty(event.target.value)} aria-label="筛选难度"><option>全部难度</option>{[1, 2, 3, 4, 5].map((item) => <option key={item} value={item}>难度 {item}/5</option>)}</select>
              <select value={type} onChange={(event) => setType(event.target.value)} aria-label="筛选题型">{types.map((item) => <option key={item} value={item}>{item === '全部题型' ? item : questionTypeLabel(item)}</option>)}</select>
              <button className="filter-button" onClick={() => { setDifficulty('全部难度'); setType('全部题型'); setQuery(''); setToast('筛选条件已重置'); }} aria-label="重置筛选" title="重置筛选"><Filter size={16} /></button>
            </div>
            <div className="question-card-list">
              {filtered.map((question) => {
                const selected = selectedIds.has(question.id);
                return <article className={`question-card ${selected ? 'selected' : ''}`} key={question.id}>
                  <div className="question-card-number">{question.id.replace(/\D/g, '') || questions.indexOf(question) + 1}</div>
                  <div className="question-card-copy"><div className="question-tags"><span>{questionTypeLabel(question.type)}</span><span>难度 {question.difficulty}/5</span><span>{question.source}</span><em>规则匹配 {question.recommendation}%</em></div><h4>{question.stem}</h4><p>{(question.knowledge_points || question.knowledgePoints || []).map((point) => <span key={point}>{point}</span>)}</p><small>匹配依据：当前教案知识点标注、题目难度与答案解析完整性。</small></div>
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
            <div className="paper-outline-list"><h4>题目顺序</h4>{selectedQuestions.map((question, index) => <button key={question.id} onClick={() => toggleQuestion(question.id)}><span>{index + 1}</span><p><b>{questionTypeLabel(question.type)}</b><small>{question.stem}</small></p><X size={14} /></button>)}</div>
            <div className="paper-actions"><Button variant="secondary" icon={Eye} onClick={() => setPreview(true)}>预览试卷</Button><Button icon={Download} onClick={() => { downloadFile(paperHtml(title, selectedQuestions, true), `${title}-答案版.doc`); setToast('答案版 Word 已开始下载'); }}>导出答案版</Button></div>
            <button className="publish-team" onClick={() => void publishReviewDraft()} disabled={publishingReview}><Share2 size={15} /> {publishingReview ? '正在保存…' : '保存为评审草稿'}</button>
          </aside>
        </div>
        <p className="workflow-disclosure"><ShieldCheck size={15} /> 当前题目均来自本教案的结构化习题，请在导出前核对题干、答案与难度是否符合本班学情。</p>
      </div>
      {preview ? <div className="paper-preview-layer"><button className="paper-preview-backdrop" onClick={() => setPreview(false)} aria-label="关闭预览" /><section className="paper-preview-modal" role="dialog" aria-modal="true" aria-label="试卷预览"><header><div><small>学生卷预览</small><h2>{title}</h2></div><button onClick={() => setPreview(false)} aria-label="关闭"><X size={20} /></button></header><div className="paper-sheet"><h1>{title}</h1><p className="paper-sheet-meta">姓名：________　班级：________　得分：________　时间：45分钟　满分：{selectedQuestions.length * 10}分</p>{selectedQuestions.map((question, index) => <section key={question.id}><h3>{index + 1}. [{questionTypeLabel(question.type)}] {question.stem} <small>（10分）</small></h3>{question.options?.length ? <ol type="A">{question.options.map((option) => <li key={option}>{option}</li>)}</ol> : <div className="paper-answer-space" />}</section>)}</div><footer><Button variant="secondary" onClick={() => setPreview(false)}>继续调整</Button><Button icon={Download} onClick={() => { downloadFile(paperHtml(title, selectedQuestions, false), `${title}-学生版.doc`); setToast('学生版 Word 已开始下载'); setPreview(false); }}>导出学生版</Button></footer></section></div> : null}
      {toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}
    </TeacherShell>
  );
}

export function TeamWorkspacePage({ path }) {
  const { lesson } = useLessonRecord(path);
  const [reviews, setReviews] = useState([]);
  const reviewsRef = useRef(reviews);
  const [toast, setToast] = useState('');
  const [comment, setComment] = useState('');
  const [filter, setFilter] = useState('全部');
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [reviewError, setReviewError] = useState('');
  const [savingReview, setSavingReview] = useState(false);
  const selectedReview = reviews.find((item) => item.id === selectedReviewId) || reviews[0] || null;
  const activities = selectedReview?.activities || [];
  const visibleReviews = reviews.filter((review) => filter === '全部' || (filter === '待我处理' ? review.status === '待评审' : review.owner === '当前教师'));
  reviewsRef.current = reviews;

  const loadReviews = useCallback(async () => {
    setLoadingReviews(true);
    setReviewError('');
    try {
      const response = await api.getReviews();
      const records = reviewRecordsFromResponse(response).map(normalizeReviewRecord).filter((item) => item.id);
      reviewsRef.current = records;
      setReviews(records);
      setSelectedReviewId((current) => (records.some((item) => item.id === current) ? current : (records[0]?.id || '')));
    } catch (error) {
      setReviewError(error.message || '评审任务暂时无法读取，请稍后重试。');
      reviewsRef.current = [];
      setReviews([]);
      setSelectedReviewId('');
    } finally {
      setLoadingReviews(false);
    }
  }, []);

  useEffect(() => { void loadReviews(); }, [loadReviews]);

  function replaceReview(record) {
    const normalized = normalizeReviewRecord(record);
    const current = reviewsRef.current;
    const next = current.some((item) => item.id === normalized.id)
      ? current.map((item) => (item.id === normalized.id ? normalized : item))
      : [normalized, ...current];
    reviewsRef.current = next;
    setReviews(next);
    setSelectedReviewId(normalized.id);
    return normalized;
  }

  async function startReview() {
    if (!lesson) {
      setToast('请先创建或打开一份教案，再发起评审');
      return;
    }
    const baseTitle = lessonTitle(lesson);
    const existing = reviewsRef.current.find((item) => item.title === baseTitle);
    if (existing) {
      setSelectedReviewId(existing.id);
      setToast('当前教案已有评审任务');
      return;
    }
    const subject = [lesson.metadata?.grade, lesson.metadata?.subject].filter(Boolean).join(' · ') || '课程待确认';
    setSavingReview(true);
    try {
      const response = await api.createReview({ title: baseTitle, subject, reviewers: [], comments: 0, status: '草稿', source: '教案', questions: [], activities: [] });
      const review = reviewRecordFromResponse(response);
      if (!review) throw new Error('服务器没有返回评审任务。');
      replaceReview(review);
      setToast('评审草稿已保存到当前账户');
    } catch (error) {
      setToast(error.message || '评审草稿保存失败，请稍后重试。');
    } finally {
      setSavingReview(false);
    }
  }

  async function submitComment() {
    const value = comment.trim();
    if (!value || !selectedReview || savingReview) return;
    setSavingReview(true);
    const activity = reviewActivity('当前教师', value);
    try {
      const response = await api.updateReview(selectedReview.id, {
        comments: Number(selectedReview.comments || 0) + 1,
        activities: [activity, ...activities].slice(0, MAX_REVIEW_ACTIVITIES),
      });
      const review = reviewRecordFromResponse(response);
      if (!review) throw new Error('服务器没有返回更新后的评审任务。');
      replaceReview(review);
      setComment('');
      setToast('评审意见已保存到当前账户');
    } catch (error) {
      setToast(error.message || '评审意见保存失败，请稍后重试。');
    } finally {
      setSavingReview(false);
    }
  }

  async function decide(status) {
    if (!selectedReview || savingReview) return;
    if (selectedReview.status === status) {
      setToast(status === '已通过' ? '当前任务已经是通过状态' : '当前任务已经是退回修改状态');
      return;
    }
    setSavingReview(true);
    const activity = reviewActivity('系统', status === '已通过' ? '评审已通过' : '已退回作者修改');
    try {
      const response = await api.updateReview(selectedReview.id, {
        status,
        activities: [activity, ...activities].slice(0, MAX_REVIEW_ACTIVITIES),
      });
      const review = reviewRecordFromResponse(response);
      if (!review) throw new Error('服务器没有返回更新后的评审任务。');
      replaceReview(review);
      setToast(status === '已通过' ? '当前任务已标记为通过' : '当前任务已标记为退回修改');
    } catch (error) {
      setToast(error.message || '评审状态保存失败，请稍后重试。');
    } finally {
      setSavingReview(false);
    }
  }
  return (
    <TeacherShell path={path} title="教案评审" subtitle="集中查看草稿、记录批注，让每次修改都有依据">
      <div className="workflow-page team-page">
        <section className="workflow-hero team-hero"><div><span className="workflow-icon"><UsersRound size={25} /></span><div><p>教案评审工作区</p><h2>通过评审记录持续打磨教学内容</h2><small>{reviews.length} 项评审任务 · {reviews.filter((item) => item.status === '待评审').length} 项等待处理</small></div></div><div className="workflow-hero-actions"><Button icon={FileCheck2} onClick={() => void startReview()} disabled={savingReview}>{savingReview ? '正在保存…' : '创建评审草稿'}</Button></div></section>
        <div className="team-metrics"><article><span><FileText size={18} /></span><div><strong>{reviews.length}</strong><small>评审任务</small></div><p>保存在当前账户</p></article><article><span><MessageSquareText size={18} /></span><div><strong>{reviews.reduce((sum, item) => sum + Number(item.comments || 0), 0)}</strong><small>评审批注</small></div><p>跨设备同步</p></article><article><span><CheckCircle2 size={18} /></span><div><strong>{reviews.filter((item) => item.status === '已通过').length}</strong><small>已通过</small></div><p>状态可追溯</p></article><article><span><FileCheck2 size={18} /></span><div><strong>{reviews.filter((item) => item.status === '草稿').length}</strong><small>待完善草稿</small></div><p>可继续补充批注</p></article></div>
        <div className="team-layout"><section className="review-queue"><header className="workflow-panel-head"><div><h3>评审队列</h3><p>任务、批注和状态会保存在当前账户并跨设备同步。</p></div><div className="view-switch">{['全部', '待我处理', '我发起的'].map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>)}</div></header><div className="review-table"><div className="review-row head"><span>教案</span><span>发起人</span><span>评审人</span><span>批注</span><span>状态</span><span>更新</span></div>{visibleReviews.map((review) => <button className={`review-row ${selectedReview?.id === review.id ? 'selected' : ''}`} key={review.id} onClick={() => setSelectedReviewId(review.id)}><span><b>{review.title}</b><small>{review.subject}</small></span><span>{review.owner}</span><span className="reviewer-stack">{review.reviewers.length ? review.reviewers.map((reviewer) => <i key={reviewer}>{reviewer}</i>) : <small>未分配</small>}</span><span>{review.comments} 条</span><span><Status>{review.status === '待评审' ? '审核中' : review.status === '已通过' ? '已完成' : review.status === '修改中' ? '修改中' : '草稿'}</Status></span><span>{review.updated}</span></button>)}{loadingReviews ? <p className="review-empty"><LoaderCircle className="spin" size={17} /> 正在读取评审任务…</p> : null}{!loadingReviews && reviewError ? <p className="review-empty">{reviewError} <button type="button" onClick={() => void loadReviews()}>重新加载</button></p> : null}{!loadingReviews && !reviewError && !visibleReviews.length ? <p className="review-empty">当前筛选下没有评审任务。</p> : null}</div></section>
          <aside className="team-activity"><header><div><h3>评审动态</h3><p>当前选中：{selectedReview?.title || '暂无任务'}</p></div><span>{selectedReview?.status || '—'}</span></header><div className="activity-stream">{activities.map((activity) => <article key={activity.id}><span className={activity.author === '系统' ? 'system' : ''}>{activity.author === '系统' ? <Clock3 size={15} /> : activity.author.slice(0, 1)}</span><div><p><b>{activity.author}</b></p><blockquote>{activity.text}</blockquote><small>{activity.time}</small></div></article>)}{!activities.length ? <article><span className="system"><Clock3 size={15} /></span><div><p><b>系统</b> 等待新的评审记录</p><small>当前任务</small></div></article> : null}</div><div className="team-comment"><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="写下具体、可执行的评审意见…" disabled={savingReview} /><Button size="sm" icon={Send} disabled={!comment.trim() || !selectedReview || savingReview} onClick={() => void submitComment()}>{savingReview ? '保存中…' : '保存批注'}</Button></div><div className="review-decision"><button onClick={() => void decide('修改中')} disabled={!selectedReview || selectedReview.status === '修改中' || savingReview}>标记退回</button><button onClick={() => void decide('已通过')} disabled={!selectedReview || selectedReview.status === '已通过' || savingReview}><CheckCircle2 size={16} /> 标记通过</button></div></aside>
        </div>
        <p className="workflow-disclosure"><ShieldCheck size={15} /> 草稿、批注与评审状态仅保存在当前账户，其他用户无法查看。</p>
      </div>
      {toast ? <Toast message={toast} onClose={() => setToast('')} /> : null}
    </TeacherShell>
  );
}
