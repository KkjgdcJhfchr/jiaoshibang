import { useEffect, useMemo, useRef, useState } from 'react';
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
  FileText,
  History,
  LoaderCircle,
  Network,
  Pencil,
  Plus,
  Printer,
  Redo2,
  RotateCcw,
  ScrollText,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import { sampleLesson } from '../data/sampleLesson.js';
import { api } from '../lib/api.js';
import { normalizeLesson } from '../lib/lessonAdapter.js';
import { navigate } from '../lib/navigation.jsx';
import {
  filterRevisionSelection,
  isRevisionRequestScopeValid,
  missingRevisionCustomSectionIds,
  pollRevisionJob,
  revisionJobResult,
  revisionRetryMode,
  unwrapRevisionJob,
} from '../lib/revisionJob.js';
import { useSiteConfig } from '../lib/site-config.jsx';
import { toCanonicalLesson } from '../lib/trainingAdapter.js';
import { Button, Modal, Toast } from './components.jsx';

const baseOutline = [
  ['objectives', '教学目标'], ['learner', '学情分析'], ['keypoints', '重点难点'], ['preparation', '教学准备'],
  ['timeline', '教学过程'], ['interaction', '课堂互动'], ['board', '板书设计'], ['homework', '课后作业'], ['exercises', '习题与答案'],
];
const standardRevisionKeys = baseOutline.map(([key]) => key);

const sectionFields = {
  objectives: ['source_summary', 'core_competencies', 'learning_objectives'],
  learner: ['learner_analysis'],
  keypoints: ['key_points', 'difficult_points'],
  preparation: ['preparation', 'safety_and_inclusion'],
  timeline: ['timeline'],
  interaction: ['differentiation', 'assessment_plan'],
  board: ['board_design', 'board_design_structured'],
  homework: ['homework', 'reflection_prompts'],
  exercises: ['exercises'],
};

const goalTypeLabels = {
  knowledge: '知识目标', 知识: '知识目标',
  thinking: '思维目标', 思维: '思维目标',
  skill: '能力目标', 能力: '能力目标',
  attitude: '情感态度', 态度: '情感态度',
  core_competency: '核心素养', coreCompetency: '核心素养', 核心素养: '核心素养',
};

const questionTypeLabels = {
  single_choice: '单项选择题', multiple_choice: '多项选择题', true_false: '判断题', fill_blank: '填空题', short_answer: '简答题',
  choice: '选择题', select: '选择题', judgment: '判断题', essay: '论述题', writing: '写作题',
  calculation: '计算题', inquiry: '探究题', practice: '实践题',
  选择: '选择题', 填空: '填空题', 简答: '简答题', 赏析: '赏析题', 探究: '探究题', 仿写: '仿写题', 微写作: '微写作题',
};

const revisionStageLabels = {
  submitting: '正在提交修改任务',
  queued: '任务已提交，正在排队',
  processing: '模型正在处理所选模块',
  applying: '正在校验并应用修改',
};

function revisionIdempotencyKey() {
  return crypto.randomUUID?.() || `revision-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function hasChineseText(value) {
  return /[\u3400-\u9fff]/.test(String(value || ''));
}

function objectiveTypeLabel(value) {
  return goalTypeLabels[value] || (hasChineseText(value) ? String(value) : '其他目标');
}

function questionTypeLabel(value) {
  return questionTypeLabels[value] || (hasChineseText(value) ? String(value) : '其他题型');
}

function sourceReferenceLabel(reference) {
  if (!reference || typeof reference !== 'object') return '';
  const location = Number(reference.page) > 0 ? `教材第 ${reference.page} 页` : '已关联教材来源';
  const excerpt = typeof reference.excerpt === 'string' ? reference.excerpt.trim() : '';
  return excerpt ? `${location}：${excerpt}` : location;
}

function htmlSourceRefs(references = []) {
  const labels = references.map(sourceReferenceLabel).filter(Boolean);
  return labels.length ? `<div class="sources"><b>教材依据：</b>${htmlList(labels)}</div>` : '';
}

function formatStructuredBoard(board) {
  if (!board || typeof board !== 'object') return '';
  const lines = [];
  if (board.layout_description) lines.push(`整体布局：${board.layout_description}`);
  for (const section of board.sections || []) {
    const heading = [section.position ? `【${section.position}】` : '', section.title || '板书区域'].filter(Boolean).join(' ');
    lines.push(`${heading}${heading && section.content ? '：' : ''}${section.content || ''}`);
  }
  return lines.filter(Boolean).join('\n');
}

function loadLesson(isDemo) {
  if (isDemo) return { ...normalizeLesson(sampleLesson), custom_sections: [] };
  try {
    const raw = JSON.parse(localStorage.getItem('current-lesson')) || sampleLesson;
    return {
      ...normalizeLesson(raw),
      source_files: raw.source_files || [],
      custom_sections: Array.isArray(raw.custom_sections) ? raw.custom_sections : [],
    };
  } catch {
    return { ...normalizeLesson(sampleLesson), custom_sections: [] };
  }
}

function saveLesson(lesson, isDemo) {
  if (!isDemo) localStorage.setItem('current-lesson', JSON.stringify(lesson));
}

function loadCanonicalLesson() {
  try { return JSON.parse(localStorage.getItem('current-lesson-canonical')); } catch { return null; }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function htmlList(items = []) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function formatExerciseMeta(item) {
  const type = questionTypeLabel(item.type);
  const difficulty = item.difficulty ? `难度 ${item.difficulty}/5` : '';
  const knowledge = (item.knowledge_points || []).length ? `知识点：${item.knowledge_points.join('、')}` : '';
  const estimatedMinutes = item.estimated_minutes ? `建议用时 ${item.estimated_minutes} 分钟` : '';
  return [type, difficulty, knowledge, estimatedMinutes].filter(Boolean).join(' · ');
}

function lessonToHtml(lesson) {
  const title = lesson.metadata?.title || `${lesson.metadata?.chapter || ''}教学设计`;
  const objectives = (lesson.learning_objectives || []).map((item) => `<li><b>${escapeHtml(objectiveTypeLabel(item.type))}：</b>${escapeHtml(item.content)}${item.measurable_evidence ? `<p><b>达成证据：</b>${escapeHtml(item.measurable_evidence)}</p>` : ''}${htmlSourceRefs(item.source_refs)}</li>`).join('');
  const timeline = (lesson.timeline || []).map((item) => {
    const teacherActions = (item.teacher_actions || []).length ? `<p><b>教师活动：</b>${escapeHtml(item.teacher_actions.join('；'))}</p>` : '';
    const questionDetails = (item.question_details || []).map((question, index) => `<div class="question-detail"><b>课堂提问 ${index + 1}：</b>${escapeHtml(question.prompt)}${question.purpose ? `<p><b>提问目的：</b>${escapeHtml(question.purpose)}</p>` : ''}${question.expected_response ? `<p><b>预期回答：</b>${escapeHtml(question.expected_response)}</p>` : ''}${question.follow_up ? `<p><b>追问：</b>${escapeHtml(question.follow_up)}</p>` : ''}${htmlSourceRefs(question.source_refs)}</div>`).join('');
    const questions = questionDetails || ((item.questions || []).length ? `<div><b>课堂提问：</b>${htmlList(item.questions)}</div>` : '');
    const expectedResponses = (item.expected_responses || []).length ? `<div><b>预期回应：</b>${htmlList(item.expected_responses)}</div>` : '';
    const misconceptions = (item.misconceptions || []).length ? `<div><b>常见误区：</b>${htmlList(item.misconceptions)}</div>` : '';
    const assessment = item.formative_assessment ? `<p><b>形成性评价：</b>${escapeHtml(item.formative_assessment)}</p>` : '';
    const fallback = item.fallback_strategy ? `<p><b>备用方案：</b>${escapeHtml(item.fallback_strategy)}</p>` : '';
    return `<div class="stage"><h3>${escapeHtml(item.stage)}</h3><p><b>时间：</b>第 ${Number(item.start_minute || 0)} 分钟开始，共 ${Number(item.duration_minutes || 0)} 分钟</p><p><b>参与目标：</b>${escapeHtml(item.engagement_goal)}</p>${teacherActions}<p><b>讲解话术：</b>${escapeHtml(item.teacher_script)}</p><div><b>学生活动：</b>${htmlList(item.student_actions || [])}</div>${questions}${expectedResponses}${misconceptions}${assessment}${fallback}${htmlSourceRefs(item.source_refs)}</div>`;
  }).join('');
  const assessmentPlan = lesson.assessment_plan || {};
  const assessments = [
    ['课前诊断', assessmentPlan.diagnostic],
    ['过程评价', assessmentPlan.formative],
    ['总结评价', assessmentPlan.summative],
    ['达成标准', assessmentPlan.success_criteria],
  ].map(([label, items]) => (items || []).length ? `<div><b>${label}：</b>${htmlList(items)}</div>` : '').join('');
  const board = lesson.board_design_structured;
  const structuredBoard = board && (board.layout_description || board.sections?.length)
    ? `<p><b>整体布局：</b>${escapeHtml(board.layout_description || '')}</p>${(board.sections || []).map((section) => `<div><b>${escapeHtml(section.title || '板书区域')}${section.position ? `（${escapeHtml(section.position)}）` : ''}：</b>${escapeHtml(section.content)}</div>`).join('')}`
    : `<pre>${escapeHtml(lesson.board_design || '')}</pre>`;
  const homework = (lesson.homework || []).map((item) => `<li><b>${escapeHtml(item.level || '课后任务')}：</b>${escapeHtml(item.content)}${item.estimated_minutes ? `<p><b>建议用时：</b>${item.estimated_minutes} 分钟</p>` : ''}${item.answer_guidance ? `<p><b>完成指导：</b>${escapeHtml(item.answer_guidance)}</p>` : ''}${htmlSourceRefs(item.source_refs)}</li>`).join('');
  const exercises = (lesson.exercises || []).map((item, index) => `<div class="question"><b>${index + 1}. ${escapeHtml(item.stem)}</b><p class="question-meta">${escapeHtml(formatExerciseMeta(item))}</p>${item.options?.length ? htmlList(item.options) : ''}<p><b>参考答案：</b>${escapeHtml(item.answer)}</p><p><b>解析：</b>${escapeHtml(item.explanation)}</p>${item.scoring_rubric ? `<p><b>评分标准：</b>${escapeHtml(item.scoring_rubric)}</p>` : ''}${htmlSourceRefs(item.source_refs)}</div>`).join('');
  const customSections = (lesson.custom_sections || []).map((item, index) => `<h2>${index + 10}、${escapeHtml(item.title)}</h2><p>${escapeHtml(item.content).replace(/\n/g, '<br>')}</p>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:'Microsoft YaHei',sans-serif;max-width:900px;margin:40px auto;color:#1a2522;line-height:1.75}h1{text-align:center}h2{border-bottom:1px solid #ccc;padding-bottom:8px;margin-top:32px}h3{margin:0 0 8px}.question,.stage{page-break-inside:avoid;margin:16px 0;padding:14px;border:1px solid #d6dedb;border-radius:6px}.question-detail{margin:10px 0;padding:10px;background:#f6f8f7}.meta{text-align:center;color:#666}.sources{color:#66736f;font-size:12px}.sources ul{margin-top:4px}pre{white-space:pre-wrap}</style></head><body><h1>${escapeHtml(title)}</h1><p class="meta">${escapeHtml(lesson.metadata?.grade)} · ${escapeHtml(lesson.metadata?.subject)} · ${escapeHtml(lesson.metadata?.textbook_edition || '')} · ${lesson.metadata?.duration_minutes || 45}分钟</p><p><b>章节：</b>${escapeHtml(lesson.metadata?.chapter || '')}</p><h2>一、教学目标</h2><p><b>章节内容概述：</b>${escapeHtml(lesson.source_summary || '')}</p><div><b>核心素养：</b>${htmlList(lesson.core_competencies || [])}</div><ol>${objectives}</ol><h2>二、学情分析</h2><p><b>班级整体情况：</b>${escapeHtml(lesson.metadata?.class_profile || '')}</p><p><b>班级学习特征：</b>${escapeHtml(lesson.learner_analysis?.class_characteristics || '')}</p><p><b>已有基础：</b>${escapeHtml(lesson.learner_analysis?.known)}</p><p><b>学习挑战：</b>${escapeHtml(lesson.learner_analysis?.challenge)}</p><p><b>教学策略：</b>${escapeHtml(lesson.learner_analysis?.strategy)}</p><h2>三、重点难点</h2><p><b>重点：</b>${escapeHtml((lesson.key_points || []).join('；'))}</p><p><b>难点：</b>${escapeHtml((lesson.difficult_points || []).join('；'))}</p><h2>四、教学准备</h2><p><b>教师：</b>${escapeHtml((lesson.preparation?.teacher || []).join('；'))}</p><p><b>学生：</b>${escapeHtml((lesson.preparation?.students || []).join('；'))}</p><p><b>材料：</b>${escapeHtml((lesson.preparation?.materials || []).join('；'))}</p><div><b>课堂安全与包容：</b>${htmlList(lesson.safety_and_inclusion || [])}</div><h2>五、教学过程</h2>${timeline}<h2>六、课堂互动与评价</h2><p><b>基础支持：</b>${escapeHtml((lesson.differentiation?.support || []).join('；'))}</p><p><b>常规任务：</b>${escapeHtml((lesson.differentiation?.standard || []).join('；'))}</p><p><b>拓展挑战：</b>${escapeHtml((lesson.differentiation?.challenge || []).join('；'))}</p>${assessments}<h2>七、板书设计</h2>${structuredBoard}<h2>八、课后作业</h2><ol>${homework}</ol><div><b>课后反思提示：</b>${htmlList(lesson.reflection_prompts || [])}</div><h2>九、习题与答案</h2>${exercises}${customSections}</body></html>`;
}

function downloadBlob(contents, type, name) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function editableTextValue(element, multiline) {
  const value = multiline ? (element.innerText ?? element.textContent ?? '') : (element.textContent ?? '');
  return String(value).replace(/\u00a0/g, ' ').replace(/\r\n?/g, '\n').trim();
}

function EditableText({ as: Tag = 'span', value, editable, onCommit, className, multiline = true, ...props }) {
  return <Tag {...props} className={`${className || ''}${editable ? ' editable-content' : ''}`} contentEditable={editable} role={editable ? 'textbox' : undefined} aria-multiline={editable ? multiline : undefined} suppressContentEditableWarning onKeyDown={(event) => { if (!multiline && event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} onBlur={(event) => { const next = editableTextValue(event.currentTarget, multiline); const previous = String(value ?? '').replace(/\r\n?/g, '\n').trim(); if (editable && next !== previous) onCommit(next); }}>{value}</Tag>;
}

function EditableList({ items = [], editable, onCommit, emptyText = '暂无内容' }) {
  if (!items.length) return <p className="empty-teaching-field">{emptyText}</p>;
  return <ul>{items.map((item, index) => <EditableText as="li" key={index} value={item} editable={editable} onCommit={(value) => onCommit(index, value)} />)}</ul>;
}

function SourceReferences({ references = [] }) {
  const labels = references.map(sourceReferenceLabel).filter(Boolean);
  if (!labels.length) return null;
  return <div className="teaching-source-refs"><b>教材依据</b><ul>{labels.map((label, index) => <li key={index}>{label}</li>)}</ul></div>;
}

function mergeSelectedSections(current, revised, selectedKeys) {
  const next = structuredClone(current);
  for (const key of selectedKeys) {
    if (key === 'learner' && revised.metadata?.class_profile !== undefined) {
      next.metadata = { ...next.metadata, class_profile: revised.metadata.class_profile };
    }
    for (const field of sectionFields[key] || []) {
      if (revised[field] !== undefined) {
        next[field] = structuredClone(revised[field]);
      }
    }
  }
  return next;
}

function SectionHeading({ number, title, editable = false, onCommit }) {
  return <div className="section-heading-row"><span className="section-number">{number}</span>{editable ? <EditableText as="h2" value={title} editable onCommit={onCommit} multiline={false} /> : <h2>{title}</h2>}</div>;
}

export function LessonEditor({ path }) {
  const { siteName } = useSiteConfig();
  const isDemo = path === '/app/lesson/lesson-spring-001';
  const [lesson, setLesson] = useState(() => loadLesson(isDemo));
  const [selected, setSelected] = useState('timeline');
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [assistantSections, setAssistantSections] = useState(() => new Set(['timeline']));
  const [feedback, setFeedback] = useState('');
  const [revising, setRevising] = useState(false);
  const [revisionStage, setRevisionStage] = useState('idle');
  const [revisionElapsed, setRevisionElapsed] = useState(0);
  const [retryRevision, setRetryRevision] = useState(null);
  const [chat, setChat] = useState([{ role: 'assistant', text: '请选择要调整的一个或多个模块，再写下具体要求。未开启助教时，可直接在左侧教案正文中编辑。' }]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [assistantDrawerOpen, setAssistantDrawerOpen] = useState(false);
  const [outlineDrawerOpen, setOutlineDrawerOpen] = useState(false);
  const [returnSnapshot, setReturnSnapshot] = useState(null);
  const [toast, setToast] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const candidateSubmitted = useRef(false);
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const revisionRunRef = useRef(0);
  const revisionAbortRef = useRef(null);
  const activeRevisionRef = useRef(null);
  const title = lesson.metadata?.title || `${lesson.metadata?.chapter || '新教案'}教学设计`;
  const customOutline = (lesson.custom_sections || []).map((item) => [`custom:${item.id}`, item.title]);
  const fullOutline = [...baseOutline, ...customOutline];
  const currentCustomIds = (lesson.custom_sections || []).map((item) => item.id);
  const revisionScopeSignature = currentCustomIds.join('\u0000');
  const effectiveAssistantSections = useMemo(() => new Set(filterRevisionSelection(
    assistantSections,
    { standardKeys: standardRevisionKeys, customIds: currentCustomIds },
  )), [assistantSections, revisionScopeSignature]);
  const hasEffectiveAssistantSections = effectiveAssistantSections.size > 0;
  const exerciseCount = lesson.exercises?.length || 0;
  const currentVersion = historyRef.current.length + 1;
  const sourceItems = isDemo
    ? [{ name: '教材《春》原文', detail: '图片 · 6 页', mark: '书' }, { name: '七年级语文课程标准', detail: 'PDF', mark: '纲' }]
    : (lesson.source_files || []).map((file) => ({ name: file.name, detail: `${file.type || '文件'} · 本次使用`, mark: '源' }));
  const totalMinutes = useMemo(() => (lesson.timeline || []).reduce((sum, item) => sum + Number(item.duration_minutes || 0), 0), [lesson.timeline]);

  useEffect(() => {
    if (!revising) return undefined;
    const startedAt = Date.now();
    setRevisionElapsed(0);
    const timer = setInterval(() => setRevisionElapsed(Math.floor((Date.now() - startedAt) / 1_000)), 1_000);
    return () => clearInterval(timer);
  }, [revising]);

  useEffect(() => () => {
    revisionRunRef.current += 1;
    revisionAbortRef.current?.abort();
  }, []);

  useEffect(() => {
    setAssistantSections((current) => {
      const filtered = filterRevisionSelection(current, {
        standardKeys: standardRevisionKeys,
        customIds: currentCustomIds,
      });
      if (filtered.length === current.size && filtered.every((key) => current.has(key))) return current;
      return new Set(filtered);
    });
    setRetryRevision((current) => {
      if (current?.mode !== 'resume' || !current.request) return current;
      return isRevisionRequestScopeValid(current.request, {
        standardKeys: standardRevisionKeys,
        customIds: currentCustomIds,
      }) ? current : { mode: 'resubmit' };
    });
  }, [revisionScopeSignature]);

  function updateLesson(updater, { recordHistory = true } = {}) {
    const current = lesson;
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (recordHistory) historyRef.current = [...historyRef.current.slice(-19), structuredClone(current)];
    redoRef.current = [];
    setLesson(next);
    setHistoryVersion((value) => value + 1);
    saveLesson(next, isDemo);
  }

  function mutateLesson(mutator) {
    updateLesson((current) => {
      const next = structuredClone(current);
      mutator(next);
      next.updated_at = '刚刚';
      return next;
    });
  }

  function editArray(field, index, value) {
    mutateLesson((next) => { next[field][index] = value; });
  }

  function editNestedArray(field, child, index, value) {
    mutateLesson((next) => { next[field][child][index] = value; });
  }

  function editStructuredBoard(mutator) {
    mutateLesson((next) => {
      next.board_design_structured = next.board_design_structured || { layout_description: '', sections: [] };
      mutator(next.board_design_structured);
      next.board_design = formatStructuredBoard(next.board_design_structured);
    });
  }

  function undo() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    redoRef.current.push(structuredClone(lesson));
    setLesson(previous);
    saveLesson(previous, isDemo);
    setHistoryVersion((value) => value + 1);
    setToast('已撤销上一步编辑');
  }

  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push(structuredClone(lesson));
    setLesson(next);
    saveLesson(next, isDemo);
    setHistoryVersion((value) => value + 1);
    setToast('已重做上一步编辑');
  }

  function restoreSnapshot(snapshot) {
    if (!returnSnapshot) setReturnSnapshot(structuredClone(lesson));
    const restored = structuredClone(snapshot);
    setLesson(restored);
    setVersionsOpen(false);
    setHistoryVersion((value) => value + 1);
    setToast('已打开所选历史版本；未编辑或保存前不会替换当前版本');
  }

  function returnToCurrentSnapshot() {
    if (!returnSnapshot) return;
    const restored = structuredClone(returnSnapshot);
    setLesson(restored);
    saveLesson(restored, isDemo);
    setReturnSnapshot(null);
    setVersionsOpen(false);
    setHistoryVersion((value) => value + 1);
    setToast('已返回打开历史版本前的教案');
  }

  function addStage() {
    mutateLesson((next) => {
      next.timeline = [...(next.timeline || []), {
        id: `stage-${Date.now()}`,
        start_minute: (next.timeline || []).reduce((sum, item) => sum + Number(item.duration_minutes || 0), 0),
        stage: `补充环节 ${next.timeline.length + 1}`,
        duration_minutes: 5,
        engagement_goal: '请补充本环节的学生参与目标。',
        teacher_actions: ['请补充教师活动'],
        teacher_script: '请补充教师活动与可直接使用的讲解话术。',
        student_actions: ['请补充学生活动'],
        question_details: [],
        expected_responses: [],
        misconceptions: [],
        formative_assessment: '请补充即时评价方式',
        questions: [],
        fallback_strategy: '请补充备用方案。',
        source_refs: [],
      }];
    });
    setToast('已新增教学环节');
  }

  function addCustomSection() {
    if (revising) return;
    const sectionTitle = newSectionTitle.trim();
    if (!sectionTitle) return;
    const id = `custom-${Date.now()}`;
    mutateLesson((next) => { next.custom_sections = [...(next.custom_sections || []), { id, title: sectionTitle, content: '请直接编辑本模块内容，或开启助教后选择本模块并说明要求。' }]; });
    setNewSectionTitle('');
    setNewSectionOpen(false);
    setAssistantSections((items) => new Set([...items, `custom:${id}`]));
    setTimeout(() => scrollTo(`custom:${id}`), 0);
    setToast(`已新增“${sectionTitle}”模块`);
  }

  function scrollTo(key) {
    setSelected(key);
    setOutlineDrawerOpen(false);
    document.getElementById(`lesson-${key.replace(':', '-')}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function toggleAssistantSection(key) {
    setRetryRevision((current) => current?.mode === 'resume' ? { mode: 'resubmit' } : current);
    setAssistantSections((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function buildRevisionRequest(instruction) {
    const standardKeys = [...effectiveAssistantSections].filter((key) => !key.startsWith('custom:'));
    const customIds = [...effectiveAssistantSections].filter((key) => key.startsWith('custom:')).map((key) => key.slice(7));
    return {
      instruction,
      standardKeys,
      customIds,
      idempotencyKey: revisionIdempotencyKey(),
      body: {
        lessonPlan: toCanonicalLesson({ ...lesson, custom_sections: [] }, loadCanonicalLesson()),
        sectionKeys: standardKeys,
        customSections: (lesson.custom_sections || []).filter((item) => customIds.includes(item.id)),
        feedback: instruction,
      },
    };
  }

  async function runRevision(request, { appendUser = true } = {}) {
    const runId = revisionRunRef.current + 1;
    revisionRunRef.current = runId;
    const abortController = new AbortController();
    revisionAbortRef.current = abortController;
    let trackedRequest = { ...request, jobId: request.jobId || null };
    activeRevisionRef.current = trackedRequest;
    setFeedback('');
    setRetryRevision(null);
    setRevisionStage('submitting');
    setRevising(true);
    setChat((items) => [
      ...items.filter((item) => item.role !== 'loading'),
      ...(appendUser ? [{ role: 'user', text: request.instruction }] : []),
      { role: 'loading', text: '正在处理修改任务' },
    ]);
    let completedJobReceived = false;
    try {
      let createdJob;
      let firstResponse = null;
      if (trackedRequest.jobId) {
        createdJob = { id: trackedRequest.jobId };
        setRevisionStage('processing');
      } else {
        const createdResponse = await api.createRevisionJob(request.body, request.idempotencyKey);
        if (revisionRunRef.current !== runId || abortController.signal.aborted) return;
        createdJob = unwrapRevisionJob(createdResponse);
        trackedRequest = { ...trackedRequest, jobId: createdJob.id };
        activeRevisionRef.current = trackedRequest;
        firstResponse = { data: { job: createdJob } };
      }
      const job = await pollRevisionJob({
        jobId: createdJob.id,
        signal: abortController.signal,
        getJob: async (jobId) => {
          if (firstResponse) {
            const response = firstResponse;
            firstResponse = null;
            return response;
          }
          return api.getRevisionJob(jobId);
        },
        onStatus: (stage) => {
          if (revisionRunRef.current !== runId) return;
          if (stage === 'queued') setRevisionStage('queued');
          if (stage === 'processing') setRevisionStage('processing');
          if (stage === 'applying') setRevisionStage('applying');
          if (stage === 'completed') setRevisionStage('applying');
        },
      });
      completedJobReceived = true;
      if (revisionRunRef.current !== runId || abortController.signal.aborted) return;
      setRevisionStage('applying');
      if (!isRevisionRequestScopeValid(request, {
        standardKeys: standardRevisionKeys,
        customIds: currentCustomIds,
      })) {
        throw new Error('原修改任务对应的模块已发生变化，请按当前选区重新提交。');
      }
      const result = revisionJobResult(job);
      let revisedLesson = structuredClone(lesson);
      if (request.standardKeys.length) {
        if (!result.lessonPlan) throw new Error('修改任务已完成，但没有返回教案内容。');
        revisedLesson = mergeSelectedSections(revisedLesson, normalizeLesson(result.lessonPlan), request.standardKeys);
      }
      if (request.customIds.length) {
        if (!Array.isArray(result.customSections)) throw new Error('修改任务已完成，但没有返回自定义模块内容。');
        const missingCustomIds = missingRevisionCustomSectionIds(request.customIds, result.customSections);
        if (missingCustomIds.length) {
          throw new Error('修改任务已完成，但返回的自定义模块不完整，请重新提交。');
        }
        revisedLesson.custom_sections = (revisedLesson.custom_sections || []).map((item) => {
          const changed = result.customSections.find((update) => update.id === item.id);
          return changed ? { ...item, title: changed.title || item.title, content: changed.content || item.content } : item;
        });
      }
      updateLesson({ ...revisedLesson, id: lesson.id, updated_at: '刚刚' });
      setChat((items) => [...items.filter((item) => item.role !== 'loading'), { role: 'assistant', text: '所选模块已按要求修改，其余模块保持不变。' }]);
      setToast('所选模块已修改并保存');
      setRetryRevision(null);
    } catch (error) {
      if (revisionRunRef.current !== runId) return;
      const message = error?.message || '本次修改未完成，请稍后重试。';
      const mode = revisionRetryMode(error, { completedJobReceived });
      setFeedback(trackedRequest.instruction);
      setRetryRevision(mode === 'resume'
        ? { mode, request: trackedRequest }
        : { mode: 'resubmit' });
      setChat((items) => [...items.filter((item) => item.role !== 'loading'), { role: 'error', text: `本次修改未完成：${message}` }]);
    } finally {
      if (revisionRunRef.current === runId) {
        setRevising(false);
        setRevisionStage('idle');
        revisionAbortRef.current = null;
        activeRevisionRef.current = null;
      }
    }
  }

  function revise() {
    const instruction = feedback.trim();
    if (!instruction || revising || !hasEffectiveAssistantSections) return;
    void runRevision(buildRevisionRequest(instruction));
  }

  function stopRevisionWait() {
    if (!revising) return;
    const request = activeRevisionRef.current;
    revisionRunRef.current += 1;
    revisionAbortRef.current?.abort();
    revisionAbortRef.current = null;
    activeRevisionRef.current = null;
    setRevising(false);
    setRevisionStage('idle');
    if (request) {
      setFeedback(request.instruction);
      setRetryRevision({ mode: 'resume', request });
    }
    const message = '已停止在本页面等待，后台任务可能仍在运行。可点击“继续查询”获取结果。';
    setChat((items) => [...items.filter((item) => item.role !== 'loading'), { role: 'assistant', text: message }]);
  }

  function retryRevisionRequest() {
    if (!retryRevision || revising) return;
    if (retryRevision.mode === 'resume' && retryRevision.request) {
      void runRevision(retryRevision.request, { appendUser: false });
      return;
    }
    const instruction = feedback.trim();
    if (!instruction || !hasEffectiveAssistantSections) return;
    void runRevision(buildRevisionRequest(instruction));
  }

  async function submitTrainingCandidate() {
    if (isDemo || candidateSubmitted.current) return;
    try {
      await api.submitTrainingCandidate({ lessonPlan: toCanonicalLesson(lesson, loadCanonicalLesson()), rightsConfirmed: localStorage.getItem('current-lesson-rights-confirmed') === 'true' });
      candidateSubmitted.current = true;
    } catch {
      // 归档失败不影响教师保存与导出。
    }
  }

  function saveCurrent() {
    saveLesson(lesson, isDemo);
    setReturnSnapshot(null);
    setToast('教案已保存');
    void submitTrainingCandidate();
  }

  function exportDoc() {
    downloadBlob(lessonToHtml(lesson), 'application/msword;charset=utf-8', `${title}.doc`);
    setExportOpen(false);
    setToast('DOC 文档已开始下载');
    void submitTrainingCandidate();
  }

  function exportPrint() {
    setExportOpen(false);
    setTimeout(() => {
      const details = [...document.querySelectorAll('.lesson-document details.exercise-item')];
      const previousStates = details.map((item) => item.open);
      details.forEach((item) => { item.open = true; });
      // 强制浏览器在打开打印对话框前完成展开后的版面计算。
      void document.body.offsetHeight;
      try {
        window.print();
      } finally {
        details.forEach((item, index) => { item.open = previousStates[index]; });
      }
    }, 100);
    void submitTrainingCandidate();
  }

  const editable = !assistantEnabled && !revising;

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <div className="editor-top-left"><button className="icon-button" onClick={() => navigate('/app')} aria-label="返回工作台"><ArrowLeft size={18} /></button><span className="editor-brand"><BookOpen size={18} /> {siteName}</span><i /></div>
        <div className="editor-history-tools"><button title="撤销上一步编辑" onClick={undo} disabled={revising || !historyRef.current.length}><Undo2 size={17} /><span>撤销</span></button><button title="恢复刚才撤销的编辑" onClick={redo} disabled={revising || !redoRef.current.length}><Redo2 size={17} /><span>重做编辑</span></button></div>
        <div className="editor-top-actions"><button className="outline-drawer-trigger" onClick={() => { setAssistantDrawerOpen(false); setOutlineDrawerOpen(true); }} aria-label="打开教案大纲"><FileText size={17} /><span>大纲</span></button><button className="assistant-drawer-trigger" onClick={() => { setOutlineDrawerOpen(false); setAssistantDrawerOpen(true); }} aria-label="打开助教"><Bot size={17} /><span>助教</span></button><button onClick={() => setVersionsOpen(true)} disabled={revising} aria-label="版本历史" title="版本历史"><History size={17} /><span>版本历史</span></button><button className="editor-save-button" onClick={saveCurrent} disabled={revising} aria-label="保存教案"><CheckCircle2 size={17} /><span>保存</span></button><Button icon={Download} onClick={() => setExportOpen(true)} disabled={revising}>导出教案</Button></div>
      </header>

      <div className="editor-layout">
        <aside className={`editor-leftbar ${outlineDrawerOpen ? 'is-open' : ''}`}>
          <header><button onClick={() => navigate('/app')} aria-label="返回工作台"><ArrowLeft size={17} /></button><b>教案大纲</b><button aria-label="新增教案模块" title="新增教案模块" onClick={() => { setOutlineDrawerOpen(false); setNewSectionOpen(true); }} disabled={revising}><Plus size={18} /></button><button className="outline-drawer-close" onClick={() => setOutlineDrawerOpen(false)} aria-label="关闭教案大纲"><X size={18} /></button></header>
          <div className="mobile-editor-tools"><button type="button" onClick={undo} disabled={revising || !historyRef.current.length}><Undo2 size={16} />撤销</button><button type="button" onClick={redo} disabled={revising || !redoRef.current.length}><Redo2 size={16} />重做编辑</button><button type="button" onClick={() => { setOutlineDrawerOpen(false); setVersionsOpen(true); }} disabled={revising}><History size={16} />版本历史</button><button type="button" onClick={() => { saveCurrent(); setOutlineDrawerOpen(false); }} disabled={revising}><CheckCircle2 size={16} />保存教案</button></div>
          <nav aria-label="教案章节">{fullOutline.map(([key, label], index) => <button key={key} aria-current={selected === key ? 'location' : undefined} className={selected === key ? 'active' : ''} onClick={() => scrollTo(key)}><span>{index + 1}</span>{label}<Check size={14} /></button>)}</nav>
          <div className="source-materials"><button onClick={() => setSourcesOpen((value) => !value)} aria-expanded={sourcesOpen}><b>素材来源（{sourceItems.length}）</b><ChevronDown size={16} className={sourcesOpen ? 'open' : ''} /></button>{sourcesOpen ? <div className="source-material-list">{sourceItems.map((file, index) => <article key={`${file.name}-${index}`}><span className="source-thumb guide">{file.mark}</span><p><b title={file.name}>{file.name}</b><small>{file.detail}</small></p></article>)}{!sourceItems.length ? <p className="source-empty">当前教案没有素材记录。</p> : null}</div> : null}</div>
        </aside>

        <main className="document-workspace">
          <article className="lesson-document">
            <header className="document-header"><div><div className="document-title-line"><EditableText as="h1" value={title} editable={editable} multiline={false} aria-label="教案标题" onCommit={(value) => mutateLesson((next) => { next.metadata.title = value; })} /><Pencil size={16} /></div><p><span>年级：<EditableText value={lesson.metadata?.grade} editable={editable} multiline={false} aria-label="年级" onCommit={(value) => mutateLesson((next) => { next.metadata.grade = value; })} /></span><span>学科：<EditableText value={lesson.metadata?.subject} editable={editable} multiline={false} aria-label="学科" onCommit={(value) => mutateLesson((next) => { next.metadata.subject = value; })} /></span><span>课时：<EditableText value={String(lesson.metadata?.duration_minutes || 45)} editable={editable} multiline={false} aria-label="课时分钟数" onCommit={(value) => mutateLesson((next) => { next.metadata.duration_minutes = Math.max(1, Number.parseInt(value, 10) || 45); })} /> 分钟</span></p><p className="document-meta-extra"><span>教材版本：<EditableText value={lesson.metadata?.textbook_edition || ''} editable={editable} multiline={false} aria-label="教材版本" onCommit={(value) => mutateLesson((next) => { next.metadata.textbook_edition = value; })} /></span><span>章节：<EditableText value={lesson.metadata?.chapter || ''} editable={editable} multiline={false} aria-label="章节名称" onCommit={(value) => mutateLesson((next) => { next.metadata.chapter = value; })} /></span></p></div></header>
            <nav className="lesson-workflow-nav" aria-label="教案知识点组卷工作流"><span className="active"><FileText size={16} /><b>1. 教案设计</b><small>当前步骤</small></span><button onClick={() => navigate(`/app/lesson/${lesson.id || 'current'}/knowledge`)}><Network size={16} /><b>2. 知识点图谱</b><small>提取与校验</small></button><button onClick={() => navigate('/app/papers')}><ScrollText size={16} /><b>3. 智能组卷</b><small>选题与导出</small></button></nav>

            <section id="lesson-objectives" className="document-section">
              <SectionHeading number="一" title="教学目标" />
              <div className="teaching-field-block"><b>章节内容概述</b><EditableText as="p" value={lesson.source_summary || ''} editable={editable} aria-label="章节内容概述" onCommit={(value) => mutateLesson((next) => { next.source_summary = value; })} /></div>
              <div className="teaching-field-block"><b>核心素养</b><EditableList items={lesson.core_competencies || []} editable={editable} emptyText="当前教案暂未单列核心素养" onCommit={(index, value) => editArray('core_competencies', index, value)} /></div>
              <ol className="objective-list">{(lesson.learning_objectives || []).map((item, index) => <li key={`${item.type}-${index}`}>
                <EditableText as="span" value={objectiveTypeLabel(item.type)} editable={editable} multiline={false} aria-label={`第 ${index + 1} 项目标类型`} onCommit={(value) => mutateLesson((next) => { next.learning_objectives[index].type = value; })} />
                <div><EditableText as="p" value={item.content} editable={editable} aria-label={`教学目标 ${index + 1}`} onCommit={(value) => mutateLesson((next) => { next.learning_objectives[index].content = value; })} /><p className="evidence-line"><b>达成证据</b><EditableText value={item.measurable_evidence || ''} editable={editable} aria-label={`第 ${index + 1} 项目标达成证据`} onCommit={(value) => mutateLesson((next) => { next.learning_objectives[index].measurable_evidence = value; })} /></p><SourceReferences references={item.source_refs} /></div>
              </li>)}</ol>
            </section>

            <section id="lesson-learner" className="document-section">
              <SectionHeading number="二" title="学情分析" />
              <div className="teaching-field-block"><b>班级整体情况</b><EditableText as="p" value={lesson.metadata?.class_profile || ''} editable={editable} aria-label="班级整体情况" onCommit={(value) => mutateLesson((next) => { next.metadata.class_profile = value; })} /></div>
              <div className="teaching-field-block"><b>班级学习特征</b><EditableText as="p" value={lesson.learner_analysis?.class_characteristics || ''} editable={editable} aria-label="班级学习特征" onCommit={(value) => mutateLesson((next) => { next.learner_analysis = next.learner_analysis || {}; next.learner_analysis.class_characteristics = value; })} /></div>
              <div className="analysis-strip">{[['known', '已有基础'], ['challenge', '学习挑战'], ['strategy', '教学策略']].map(([key, label]) => <div key={key}><b>{label}</b><EditableText as="p" value={lesson.learner_analysis?.[key] || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.learner_analysis = next.learner_analysis || {}; next.learner_analysis[key] = value; })} /></div>)}</div>
            </section>

            <section id="lesson-keypoints" className="document-section two-column-section"><div><SectionHeading number="三" title="教学重点" /><ul>{(lesson.key_points || []).map((item, index) => <EditableText as="li" key={index} value={item} editable={editable} onCommit={(value) => editArray('key_points', index, value)} />)}</ul></div><div><div className="section-heading-spacer" /><h2>教学难点</h2><ul>{(lesson.difficult_points || []).map((item, index) => <EditableText as="li" key={index} value={item} editable={editable} onCommit={(value) => editArray('difficult_points', index, value)} />)}</ul></div></section>

            <section id="lesson-preparation" className="document-section">
              <SectionHeading number="四" title="教学准备" />
              <div className="preparation-grid">{[['teacher', '教师准备'], ['students', '学生准备'], ['materials', '材料']].map(([key, label]) => <div key={key}><b>{label}</b><EditableList items={lesson.preparation?.[key] || []} editable={editable} onCommit={(index, value) => editNestedArray('preparation', key, index, value)} /></div>)}</div>
              <div className="teaching-field-block"><b>课堂安全与包容</b><EditableList items={lesson.safety_and_inclusion || []} editable={editable} emptyText="当前教案暂无额外安全与包容提示" onCommit={(index, value) => editArray('safety_and_inclusion', index, value)} /></div>
            </section>

            <section id="lesson-timeline" className="document-section">
              <div className="timeline-heading"><SectionHeading number="五" title="教学过程" /><span><Clock3 size={14} /> 共 {totalMinutes} 分钟</span></div>
              <div className="timeline-table"><div className="timeline-row timeline-head"><span>教学环节</span><span>时间</span><span>教师活动、讲解与提问</span><span>学生活动与学习反馈</span><span>参与目标与评价</span></div>{(lesson.timeline || []).map((item, index) => <div className="timeline-row" key={item.id || `${item.stage}-${index}`}>
                <span><EditableText as="b" value={item.stage} editable={editable} multiline={false} onCommit={(value) => mutateLesson((next) => { next.timeline[index].stage = value; })} /></span>
                <span><small>第 <EditableText value={String(item.start_minute ?? 0)} editable={editable} multiline={false} aria-label={`${item.stage}开始分钟`} onCommit={(value) => mutateLesson((next) => { next.timeline[index].start_minute = Math.max(0, Number.parseInt(value, 10) || 0); })} /> 分钟开始</small><EditableText value={String(item.duration_minutes)} editable={editable} multiline={false} aria-label={`${item.stage}持续分钟`} onCommit={(value) => mutateLesson((next) => { next.timeline[index].duration_minutes = Math.max(1, Number.parseInt(value, 10) || 1); })} /> 分钟</span>
                <span>
                  <b className="timeline-detail-label">教师活动</b><EditableList items={item.teacher_actions || []} editable={editable} onCommit={(actionIndex, value) => mutateLesson((next) => { next.timeline[index].teacher_actions[actionIndex] = value; })} />
                  <b className="timeline-detail-label">讲解话术</b><EditableText as="p" value={item.teacher_script || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.timeline[index].teacher_script = value; })} />
                  {(item.question_details || []).length ? (item.question_details || []).map((question, questionIndex) => <div className="timeline-question-detail" key={questionIndex}>
                    <b>课堂提问 {questionIndex + 1}</b><EditableText as="p" value={question.prompt || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.timeline[index].question_details[questionIndex].prompt = value; if (Array.isArray(next.timeline[index].questions)) next.timeline[index].questions[questionIndex] = value; })} />
                    <p><b>提问目的</b><EditableText value={question.purpose || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.timeline[index].question_details[questionIndex].purpose = value; })} /></p>
                    <p><b>预期回答</b><EditableText value={question.expected_response || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.timeline[index].question_details[questionIndex].expected_response = value; })} /></p>
                    <p><b>继续追问</b><EditableText value={question.follow_up || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.timeline[index].question_details[questionIndex].follow_up = value; })} /></p>
                    <SourceReferences references={question.source_refs} />
                  </div>) : (item.questions || []).map((question, questionIndex) => <EditableText as="em" key={questionIndex} value={`课堂提问 ${questionIndex + 1}：${question}`} editable={editable} onCommit={(value) => mutateLesson((next) => { next.timeline[index].questions[questionIndex] = value.replace(new RegExp(`^课堂提问\\s*${questionIndex + 1}[：:]\\s*`), ''); })} />)}
                  <SourceReferences references={item.source_refs} />
                </span>
                <span>
                  <b className="timeline-detail-label">学生活动</b><EditableList items={item.student_actions || []} editable={editable} onCommit={(actionIndex, value) => mutateLesson((next) => { next.timeline[index].student_actions[actionIndex] = value; })} />
                  <b className="timeline-detail-label">预期回应</b><EditableList items={item.expected_responses || []} editable={editable} emptyText="暂无单列预期回应" onCommit={(responseIndex, value) => mutateLesson((next) => { next.timeline[index].expected_responses[responseIndex] = value; })} />
                  <b className="timeline-detail-label">常见误区</b><EditableList items={item.misconceptions || []} editable={editable} emptyText="暂无常见误区" onCommit={(misconceptionIndex, value) => mutateLesson((next) => { next.timeline[index].misconceptions[misconceptionIndex] = value; })} />
                </span>
                <span>
                  <b className="timeline-detail-label">参与目标</b><EditableText as="p" value={item.engagement_goal || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.timeline[index].engagement_goal = value; })} />
                  <b className="timeline-detail-label">形成性评价</b><EditableText as="p" value={item.formative_assessment || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.timeline[index].formative_assessment = value; })} />
                  <b className="timeline-detail-label">备用策略</b><EditableText as="p" value={item.fallback_strategy || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.timeline[index].fallback_strategy = value; })} />
                </span>
              </div>)}</div>
              {editable ? <button className="add-stage" onClick={addStage}><span>+</span> 添加教学环节</button> : null}
            </section>

            <section id="lesson-interaction" className="document-section">
              <SectionHeading number="六" title="课堂互动与分层评价" />
              <div className="interaction-grid">{[['support', '基础支持'], ['standard', '常规任务'], ['challenge', '拓展挑战']].map(([key, label]) => <div key={key}><b>{label}</b><EditableList items={lesson.differentiation?.[key] || []} editable={editable} onCommit={(index, value) => editNestedArray('differentiation', key, index, value)} /></div>)}</div>
              <h3 className="document-subheading">学习评价方案</h3>
              <div className="assessment-grid">{[['diagnostic', '课前诊断'], ['formative', '过程评价'], ['summative', '总结评价'], ['success_criteria', '达成标准']].map(([key, label]) => <div key={key}><b>{label}</b><EditableList items={lesson.assessment_plan?.[key] || []} editable={editable} emptyText="暂未单列" onCommit={(index, value) => mutateLesson((next) => { next.assessment_plan = next.assessment_plan || {}; next.assessment_plan[key] = next.assessment_plan[key] || []; next.assessment_plan[key][index] = value; })} /></div>)}</div>
            </section>

            <section id="lesson-board" className="document-section">
              <SectionHeading number="七" title="板书设计" />
              {lesson.board_design_structured && (lesson.board_design_structured.layout_description || lesson.board_design_structured.sections?.length) ? <div className="structured-board">
                <div className="teaching-field-block"><b>整体布局</b><EditableText as="p" value={lesson.board_design_structured.layout_description || ''} editable={editable} onCommit={(value) => editStructuredBoard((board) => { board.layout_description = value; })} /></div>
                <div className="board-section-grid">{(lesson.board_design_structured.sections || []).map((section, index) => <article key={index}><p><b>区域标题</b><EditableText value={section.title || ''} editable={editable} multiline={false} onCommit={(value) => editStructuredBoard((board) => { board.sections[index].title = value; })} /></p><p><b>位置</b><EditableText value={section.position || ''} editable={editable} multiline={false} onCommit={(value) => editStructuredBoard((board) => { board.sections[index].position = value; })} /></p><EditableText as="div" className="board-section-content" value={section.content || ''} editable={editable} onCommit={(value) => editStructuredBoard((board) => { board.sections[index].content = value; })} /></article>)}</div>
              </div> : <EditableText as="pre" className="board-preview" value={lesson.board_design || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.board_design = value; })} />}
            </section>

            <section id="lesson-homework" className="document-section">
              <SectionHeading number="八" title="课后作业" />
              <div className="homework-list">{(lesson.homework || []).map((item, index) => <div key={item.id || index}>
                <EditableText as="span" value={item.level || '课后任务'} editable={editable} multiline={false} onCommit={(value) => mutateLesson((next) => { next.homework[index].level = value; })} />
                <div className="homework-content"><EditableText as="p" value={item.content} editable={editable} onCommit={(value) => mutateLesson((next) => { next.homework[index].content = value; })} /><div className="homework-meta"><p><b>建议用时</b><EditableText value={String(item.estimated_minutes || '')} editable={editable} multiline={false} aria-label={`第 ${index + 1} 项作业建议用时`} onCommit={(value) => mutateLesson((next) => { next.homework[index].estimated_minutes = Math.max(1, Number.parseInt(value, 10) || 1); })} /> 分钟</p><p><b>完成指导</b><EditableText value={item.answer_guidance || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.homework[index].answer_guidance = value; })} /></p></div><SourceReferences references={item.source_refs} /></div>
              </div>)}</div>
              <div className="teaching-field-block"><b>课后反思提示</b><EditableList items={lesson.reflection_prompts || []} editable={editable} emptyText="当前教案暂未设置课后反思提示" onCommit={(index, value) => editArray('reflection_prompts', index, value)} /></div>
            </section>

            <section id="lesson-exercises" className="document-section exercises-section">
              <div className="exercises-heading"><SectionHeading number="九" title="习题与答案" /><span>{exerciseCount} 道 · 含答案、解析与评分标准</span></div>
              {(lesson.exercises || []).map((item, index) => <details className="exercise-item" key={item.id || index}><summary><span>{index + 1}</span><div><EditableText as="b" value={item.stem} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].stem = value; })} /><small><EditableText value={questionTypeLabel(item.type)} editable={editable} multiline={false} aria-label={`第 ${index + 1} 题题型`} onCommit={(value) => mutateLesson((next) => { next.exercises[index].type = value; })} /> · 难度 <EditableText value={String(item.difficulty || 1)} editable={editable} multiline={false} aria-label={`第 ${index + 1} 题难度`} onCommit={(value) => mutateLesson((next) => { next.exercises[index].difficulty = Math.min(5, Math.max(1, Number.parseInt(value, 10) || 1)); })} />/5 · 建议 <EditableText value={String(item.estimated_minutes || '')} editable={editable} multiline={false} aria-label={`第 ${index + 1} 题建议用时`} onCommit={(value) => mutateLesson((next) => { next.exercises[index].estimated_minutes = Math.max(1, Number.parseInt(value, 10) || 1); })} /> 分钟 · 知识点：<EditableText value={(item.knowledge_points || []).join('、')} editable={editable} multiline={false} aria-label={`第 ${index + 1} 题知识点`} onCommit={(value) => mutateLesson((next) => { next.exercises[index].knowledge_points = value.split(/[、,，]/).map((entry) => entry.trim()).filter(Boolean); })} /></small></div><ChevronDown size={17} /></summary><div className="exercise-answer">
                {item.options?.length ? <div className="exercise-options"><b>选项</b><ol type="A">{item.options.map((option, optionIndex) => <EditableText as="li" key={optionIndex} value={option} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].options[optionIndex] = value; })} />)}</ol></div> : null}
                <p><b>参考答案</b><EditableText value={item.answer} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].answer = value; })} /></p>
                <p><b>解析</b><EditableText value={item.explanation} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].explanation = value; })} /></p>
                <p><b>评分标准</b><EditableText value={item.scoring_rubric || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].scoring_rubric = value; })} /></p>
                <SourceReferences references={item.source_refs} />
              </div></details>)}
            </section>

            {(lesson.custom_sections || []).map((item, index) => <section id={`lesson-custom-${item.id}`} className="document-section custom-document-section" key={item.id}><SectionHeading number={String(index + 10)} title={item.title} editable={editable} onCommit={(value) => mutateLesson((next) => { next.custom_sections[index].title = value; })} /><EditableText as="div" className="custom-section-content" value={item.content} editable={editable} onCommit={(value) => mutateLesson((next) => { next.custom_sections[index].content = value; })} /></section>)}
            <footer className="document-footer"><span>{totalMinutes} 分钟课堂流程 · {exerciseCount} 道习题</span><span>最后保存：{lesson.updated_at || '刚刚'}</span></footer>
          </article>
        </main>

        <aside className={`ai-panel ${assistantDrawerOpen ? 'is-open' : ''}`} aria-label="助教面板">
          <header><div><Bot size={18} /><b>AI 助教</b></div><div className="assistant-panel-actions"><label className="assistant-toggle"><input type="checkbox" checked={assistantEnabled} disabled={revising} onChange={(event) => setAssistantEnabled(event.target.checked)} /><span aria-hidden="true" /><em>{assistantEnabled ? '已开启' : '已关闭'}</em></label><button className="assistant-panel-close" onClick={() => setAssistantDrawerOpen(false)} aria-label="关闭助教面板"><X size={18} /></button></div></header>
          {assistantEnabled ? <>
            <section className="assistant-section-picker"><b>选择要修改的模块</b><div>{fullOutline.map(([key, label]) => <label key={key}><input type="checkbox" checked={assistantSections.has(key)} disabled={revising} onChange={() => toggleAssistantSection(key)} /><span>{label}</span></label>)}</div></section>
            <div className="chat-thread" aria-live="polite">{chat.map((item, index) => <div key={index} className={`chat-message ${item.role}`}><span>{item.role === 'user' ? '我' : item.role === 'loading' ? <LoaderCircle className="spin" size={16} /> : <Bot size={16} />}</span><div>{item.role === 'loading' ? <div className="revision-progress"><b>{revisionStageLabels[revisionStage] || '正在处理修改任务'}</b><p>已等待 {revisionElapsed} 秒，页面会在任务完成后自动应用结果。</p><button type="button" onClick={stopRevisionWait}>停止等待</button></div> : <p>{item.text}</p>}</div></div>)}</div>
            <div className="ai-composer"><textarea value={feedback} disabled={revising} onChange={(event) => { setFeedback(event.target.value); setRetryRevision((current) => current?.mode === 'resume' ? { mode: 'resubmit' } : current); }} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') revise(); }} placeholder="写下对所选模块的修改要求…" maxLength={800} /><div>{retryRevision && !revising ? <Button variant="ghost" size="sm" icon={RotateCcw} onClick={retryRevisionRequest} disabled={retryRevision.mode === 'resubmit' && (!feedback.trim() || !hasEffectiveAssistantSections)}>{retryRevision.mode === 'resume' ? '继续查询' : '重新提交'}</Button> : null}<span>{feedback.length}/800</span><Button size="sm" icon={Send} onClick={revise} disabled={!feedback.trim() || revising || !hasEffectiveAssistantSections}>发送</Button></div></div>
          </> : <div className="manual-edit-hint"><Pencil size={20} /><b>当前为手动编辑模式</b><p>点击教案正文中的文字即可直接修改。需要定向调整内容时，再开启助教并选择对应模块。</p></div>}
        </aside>
        {assistantDrawerOpen ? <button className="assistant-drawer-scrim" aria-label="关闭助教面板" onClick={() => setAssistantDrawerOpen(false)} /> : null}
        {outlineDrawerOpen ? <button className="outline-drawer-scrim" aria-label="关闭教案大纲" onClick={() => setOutlineDrawerOpen(false)} /> : null}
      </div>

      <Modal open={newSectionOpen} onClose={() => { if (!revising) setNewSectionOpen(false); }} title="新增教案模块" description="新模块会加入教案大纲、正文和助教模块选择。" footer={<><Button variant="ghost" onClick={() => setNewSectionOpen(false)} disabled={revising}>取消</Button><Button icon={Plus} onClick={addCustomSection} disabled={revising || !newSectionTitle.trim()}>添加模块</Button></>}><label className="new-section-field"><span>模块名称</span><input value={newSectionTitle} disabled={revising} onChange={(event) => setNewSectionTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !revising) addCustomSection(); }} placeholder="例如：跨学科拓展" maxLength={30} /></label></Modal>

      <Modal open={versionsOpen} onClose={() => setVersionsOpen(false)} title="版本历史" description="选择历史版本只会打开预览，不会新增版本；确认保存前也不会替换原来的当前版本。">
        <div className="version-list"><button className="current" type="button" disabled><span>v{currentVersion}.0</span><div><b>{returnSnapshot ? '正在预览' : '当前版本'}</b><p>{title}</p><small>刚刚 · 当前教师</small></div><CheckCircle2 size={18} /></button>{returnSnapshot ? <button type="button" className="return-version" onClick={returnToCurrentSnapshot} disabled={revising}><span>返回</span><div><b>打开历史版本前的版本</b><p>{returnSnapshot.metadata?.title || returnSnapshot.metadata?.chapter || '之前的教案版本'}</p><small>始终保留 · 点击返回</small></div><RotateCcw size={17} /></button> : null}{[...historyRef.current].reverse().map((snapshot, index) => <button type="button" key={`${historyVersion}-${index}`} onClick={() => restoreSnapshot(snapshot)} disabled={revising}><span>v{Math.max(1, currentVersion - index - 1)}.0</span><div><b>历史版本</b><p>{snapshot.metadata?.title || snapshot.metadata?.chapter || '教案快照'}</p><small>本次会话 · 点击打开</small></div><RotateCcw size={17} /></button>)}{!historyRef.current.length && !returnSnapshot ? <p className="version-empty">当前会话还没有历史修改。</p> : null}</div>
      </Modal>

      <Modal open={exportOpen} onClose={() => setExportOpen(false)} title="导出教案" description={`导出当前完整版本 v${currentVersion}.0。`} footer={<><Button variant="ghost" onClick={() => setExportOpen(false)}>取消</Button><Button icon={FileDown} onClick={exportDoc}>导出 DOC</Button></>}>
        <div className="export-options"><button className="selected" onClick={exportDoc}><FileText size={22} /><div><b>Word 文档</b><p>包含全部标准模块、自定义模块、习题答案与解析，可继续编辑。</p></div><CheckCircle2 size={18} /></button><button onClick={exportPrint}><Printer size={22} /><div><b>打印 / PDF</b><p>使用浏览器打印，可保存为 PDF 文件。</p></div></button></div>
      </Modal>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
