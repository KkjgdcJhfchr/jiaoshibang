import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileDown,
  FileText,
  History,
  GripVertical,
  LoaderCircle,
  MessageSquarePlus,
  Network,
  Pencil,
  Plus,
  RotateCcw,
  ScrollText,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { sampleLesson } from '../data/sampleLesson.js';
import { formatStructuredBoard, isAnnotationPathAllowed, mergeAnnotationTargets, synchronizeAnnotationDerivedFields } from '../lib/annotationPatch.js';
import { api } from '../lib/api.js';
import { normalizeLesson } from '../lib/lessonAdapter.js';
import { completeRevisionTransition, confirmVersionRestore, exitAnnotationSession, selectVersionPreview } from '../lib/lessonEditorSession.js';
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
const documentSectionTitles = {
  objectives: '教学目标',
  learner: '学情分析',
  keypoints: '教学重点',
  preparation: '教学准备',
  timeline: '教学过程',
  interaction: '课堂互动与分层评价',
  board: '板书设计',
  homework: '课后作业',
  exercises: '习题与答案',
};

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

function loadLesson(isDemo) {
  if (isDemo) return { ...normalizeLesson(sampleLesson), custom_sections: [], section_order: [] };
  try {
    const raw = JSON.parse(localStorage.getItem('current-lesson')) || sampleLesson;
    return {
      ...normalizeLesson(raw),
      source_files: raw.source_files || [],
      custom_sections: Array.isArray(raw.custom_sections) ? raw.custom_sections : [],
      section_order: Array.isArray(raw.section_order) ? raw.section_order : [],
    };
  } catch {
    return { ...normalizeLesson(sampleLesson), custom_sections: [], section_order: [] };
  }
}

function saveLesson(lesson, isDemo) {
  if (!isDemo) localStorage.setItem('current-lesson', JSON.stringify(lesson));
}

function loadCanonicalLesson() {
  try { return JSON.parse(localStorage.getItem('current-lesson-canonical')); } catch { return null; }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
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

function SectionHeading({ number, title, editable = false, onCommit, annotationPath }) {
  return <div className="section-heading-row" data-annotation-path={annotationPath || undefined}><span className="section-number">{number}</span>{editable ? <EditableText as="h2" value={title} editable onCommit={onCommit} multiline={false} /> : <h2>{title}</h2>}</div>;
}

export function LessonEditor({ path }) {
  const { siteName } = useSiteConfig();
  const isDemo = path === '/app/lesson/lesson-spring-001';
  const [lesson, setLesson] = useState(() => loadLesson(isDemo));
  const lessonRef = useRef(lesson);
  const lessonVersionRef = useRef(0);
  const [selected, setSelected] = useState('timeline');
  const [manualEditing, setManualEditing] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const annotationsRef = useRef([]);
  const [annotationDraft, setAnnotationDraft] = useState(null);
  const [annotationPointer, setAnnotationPointer] = useState(null);
  const [draggedOutlineKey, setDraggedOutlineKey] = useState(null);
  const [dragOverOutlineKey, setDragOverOutlineKey] = useState(null);
  const pointerDraggedOutlineRef = useRef(null);
  const pointerDropOutlineRef = useRef(null);
  const cancelledOutlineEditRef = useRef(false);
  const [feedback, setFeedback] = useState('');
  const [revising, setRevising] = useState(false);
  const [revisionStage, setRevisionStage] = useState('idle');
  const [revisionElapsed, setRevisionElapsed] = useState(0);
  const [retryRevision, setRetryRevision] = useState(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState('');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState('');
  const [outlineDrawerOpen, setOutlineDrawerOpen] = useState(false);
  const [editingOutlineKey, setEditingOutlineKey] = useState(null);
  const [editingOutlineValue, setEditingOutlineValue] = useState('');
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [regenerateFeedback, setRegenerateFeedback] = useState('');
  const [historySelection, setHistorySelection] = useState(null);
  const [toast, setToast] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const candidateSubmitted = useRef(false);
  const historyRef = useRef([]);
  const redoRef = useRef([]);
  const revisionRunRef = useRef(0);
  const revisionInFlightRef = useRef(false);
  const revisionAbortRef = useRef(null);
  const activeRevisionRef = useRef(null);
  const title = lesson.metadata?.title || `${lesson.metadata?.chapter || '新教案'}教学设计`;
  const customOutline = (lesson.custom_sections || []).map((item) => [`custom:${item.id}`, item.title]);
  const availableOutline = [
    ...baseOutline.map(([key, label]) => [key, lesson.section_titles?.[key] || label]),
    ...customOutline,
  ];
  const outlineLabelMap = new Map(availableOutline);
  const savedOutlineKeys = Array.isArray(lesson.section_order) ? lesson.section_order : [];
  const fullOutline = [
    ...savedOutlineKeys.filter((key, index) => outlineLabelMap.has(key) && savedOutlineKeys.indexOf(key) === index).map((key) => [key, outlineLabelMap.get(key)]),
    ...availableOutline.filter(([key]) => !savedOutlineKeys.includes(key)),
  ];
  const outlineOrderMap = new Map(fullOutline.map(([key], index) => [key, index]));
  const normalizedOutlineKeys = fullOutline.map(([key]) => key);
  const normalizedOutlineSignature = normalizedOutlineKeys.join('\u0000');
  const storedOutlineSignature = savedOutlineKeys.join('\u0000');
  const currentCustomIds = (lesson.custom_sections || []).map((item) => item.id);
  const revisionScopeSignature = currentCustomIds.join('\u0000');
  const exerciseCount = lesson.exercises?.length || 0;
  const currentVersion = lessonVersionRef.current + 1;
  const sourceItems = isDemo
    ? [{ name: '教材《春》原文', detail: '图片 · 6 页', mark: '书' }, { name: '七年级语文课程标准', detail: 'PDF', mark: '纲' }]
    : (lesson.source_files || []).map((file) => ({ name: file.name, detail: `${file.type || '文件'} · 本次使用`, mark: '源' }));
  const totalMinutes = useMemo(() => (lesson.timeline || []).reduce((sum, item) => sum + Number(item.duration_minutes || 0), 0), [lesson.timeline]);

  function replaceAnnotations(updater) {
    const current = annotationsRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    annotationsRef.current = next;
    setAnnotations(next);
    return next;
  }

  function clearAnnotationSession() {
    const cleared = exitAnnotationSession();
    replaceAnnotations(cleared.annotations);
    setAssistantEnabled(cleared.assistantEnabled);
    setAnnotationDraft(cleared.annotationDraft);
    setAnnotationPointer(cleared.annotationPointer);
    setFeedback(cleared.feedback);
    setRetryRevision(cleared.retryRevision);
  }

  function sectionHeadingTitle(key, fallback = documentSectionTitles[key] || outlineLabelMap.get(key) || '') {
    return lesson.section_titles?.[key] || fallback;
  }

  function displayedSectionNumber(sectionKey) {
    const index = outlineOrderMap.get(sectionKey) ?? 0;
    return ['一', '二', '三', '四', '五', '六', '七', '八', '九'][index] || String(index + 1);
  }

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
    setRetryRevision((current) => {
      if (current?.mode !== 'resume' || !current.request) return current;
      return isRevisionRequestScopeValid(current.request, {
        standardKeys: standardRevisionKeys,
        customIds: currentCustomIds,
      }) ? current : { mode: 'resubmit', request: current.request };
    });
    replaceAnnotations((items) => items.filter((item) => standardRevisionKeys.includes(item.sectionKey) || (item.sectionKey.startsWith('custom:') && currentCustomIds.includes(item.sectionKey.slice(7)))));
  }, [revisionScopeSignature]);

  useEffect(() => {
    if (storedOutlineSignature === normalizedOutlineSignature) return;
    updateLesson((current) => ({ ...current, section_order: normalizedOutlineKeys }), { recordHistory: false });
  }, [storedOutlineSignature, normalizedOutlineSignature]);

  useEffect(() => {
    if (!manualEditing) return undefined;
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA'].includes(target.tagName))) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [manualEditing, revising]);

  function updateLesson(updater, { recordHistory = true } = {}) {
    const current = lessonRef.current;
    const next = typeof updater === 'function' ? updater(current) : updater;
    if (recordHistory) historyRef.current = [...historyRef.current.slice(-19), { lesson: structuredClone(current), version: lessonVersionRef.current + 1, createdAt: Date.now() }];
    redoRef.current = [];
    lessonRef.current = next;
    lessonVersionRef.current += 1;
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
    redoRef.current.push({ lesson: structuredClone(lessonRef.current), version: lessonVersionRef.current + 1, createdAt: Date.now() });
    const restored = structuredClone(previous.lesson);
    lessonRef.current = restored;
    lessonVersionRef.current += 1;
    setLesson(restored);
    saveLesson(restored, isDemo);
    setHistoryVersion((value) => value + 1);
    setToast('已撤销上一步编辑');
  }

  function redo() {
    const next = redoRef.current.pop();
    if (!next) return;
    historyRef.current.push({ lesson: structuredClone(lessonRef.current), version: lessonVersionRef.current + 1, createdAt: Date.now() });
    const restored = structuredClone(next.lesson);
    lessonRef.current = restored;
    lessonVersionRef.current += 1;
    setLesson(restored);
    saveLesson(restored, isDemo);
    setHistoryVersion((value) => value + 1);
    setToast('已重做上一步编辑');
  }

  function selectHistorySnapshot(snapshot, version) {
    const selection = selectVersionPreview([snapshot], 0);
    setHistorySelection(selection ? { snapshot: selection.preview, version } : null);
  }

  function restoreSelectedHistory() {
    if (!historySelection?.snapshot || revising) return;
    const restored = confirmVersionRestore({ preview: historySelection.snapshot });
    if (!restored) return;
    updateLesson(restored.currentLesson);
    setHistorySelection(null);
    setVersionsOpen(false);
    setManualEditing(true);
    setAssistantEnabled(false);
    clearAnnotationSession();
    setToast(`已恢复 v${historySelection.version}.0，并进入编辑模式`);
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
    mutateLesson((next) => {
      next.custom_sections = [...(next.custom_sections || []), { id, title: sectionTitle, content: '请直接编辑本模块内容，或进入注释模式后点击这里说明修改要求。' }];
      const availableKeys = fullOutline.map(([key]) => key);
      const savedKeys = Array.isArray(next.section_order) ? next.section_order.filter((key, index) => availableKeys.includes(key) && next.section_order.indexOf(key) === index) : [];
      const currentOrder = [...savedKeys, ...availableKeys.filter((key) => !savedKeys.includes(key))];
      next.section_order = [...currentOrder, `custom:${id}`];
    });
    setNewSectionTitle('');
    setNewSectionOpen(false);
    setTimeout(() => scrollTo(`custom:${id}`), 0);
    setToast(`已新增“${sectionTitle}”模块`);
  }

  function scrollTo(key) {
    setSelected(key);
    setOutlineDrawerOpen(false);
    document.getElementById(`lesson-${key.replace(':', '-')}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function reorderOutline(targetKey, sourceKey = draggedOutlineKey) {
    if (!sourceKey || sourceKey === targetKey || revising) return;
    const orderedKeys = fullOutline.map(([key]) => key);
    const fromIndex = orderedKeys.indexOf(sourceKey);
    const toIndex = orderedKeys.indexOf(targetKey);
    if (fromIndex < 0 || toIndex < 0) return;
    orderedKeys.splice(toIndex, 0, orderedKeys.splice(fromIndex, 1)[0]);
    applyOutlineOrder(orderedKeys);
    setDraggedOutlineKey(null);
    setDragOverOutlineKey(null);
  }

  function beginOutlinePointerDrag(event, key) {
    if (revising) return;
    event.preventDefault();
    pointerDraggedOutlineRef.current = key;
    pointerDropOutlineRef.current = key;
    setDraggedOutlineKey(key);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moveOutlinePointerDrag(event) {
    if (!pointerDraggedOutlineRef.current) return;
    event.preventDefault();
    const targetKey = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-outline-key]')?.dataset.outlineKey;
    if (!targetKey || !outlineLabelMap.has(targetKey)) return;
    pointerDropOutlineRef.current = targetKey;
    setDragOverOutlineKey(targetKey);
  }

  function finishOutlinePointerDrag(event, cancelled = false) {
    const sourceKey = pointerDraggedOutlineRef.current;
    const targetKey = pointerDropOutlineRef.current;
    pointerDraggedOutlineRef.current = null;
    pointerDropOutlineRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!cancelled && sourceKey && targetKey) reorderOutline(targetKey, sourceKey);
    setDraggedOutlineKey(null);
    setDragOverOutlineKey(null);
  }

  function applyOutlineOrder(orderedKeys) {
    mutateLesson((next) => { next.section_order = orderedKeys; });
    setRetryRevision(null);
    setToast('教案大纲与正文顺序已更新');
  }

  function beginOutlineTitleEdit(event, key, label) {
    if (revising) return;
    event.preventDefault();
    event.stopPropagation();
    cancelledOutlineEditRef.current = false;
    setEditingOutlineKey(key);
    setEditingOutlineValue(label);
  }

  function cancelOutlineTitleEdit() {
    cancelledOutlineEditRef.current = true;
    setEditingOutlineKey(null);
    setEditingOutlineValue('');
  }

  function commitOutlineTitleEdit(key) {
    if (cancelledOutlineEditRef.current) {
      cancelledOutlineEditRef.current = false;
      return;
    }
    if (editingOutlineKey !== key) return;
    const nextTitle = editingOutlineValue.trim();
    const currentTitle = outlineLabelMap.get(key) || '';
    setEditingOutlineKey(null);
    setEditingOutlineValue('');
    if (!nextTitle || nextTitle === currentTitle) return;
    mutateLesson((next) => {
      if (key.startsWith('custom:')) {
        const customId = key.slice(7);
        const item = (next.custom_sections || []).find((section) => section.id === customId);
        if (item) item.title = nextTitle;
        return;
      }
      next.section_titles = { ...(next.section_titles || {}), [key]: nextTitle };
    });
    setToast(`模块标题已修改为“${nextTitle}”`);
  }

  function toggleAnnotationMode() {
    if (revising) return;
    const next = !assistantEnabled;
    clearAnnotationSession();
    setAssistantEnabled(next);
    if (next) setManualEditing(false);
    setOutlineDrawerOpen(false);
  }

  function annotationSectionFromTarget(target) {
    const section = target instanceof Element ? target.closest('.lesson-section-order > .document-section[data-section-key]') : null;
    const sectionKey = section?.dataset.sectionKey;
    return sectionKey && outlineLabelMap.has(sectionKey) ? { section, sectionKey } : null;
  }

  function nearbyAnnotationTarget(target, section, clientX, clientY) {
    const selector = '[data-annotation-path]';
    let block = target instanceof Element ? target.closest(selector) : null;
    if (!block || !section.contains(block)) {
      const candidates = [...section.querySelectorAll(selector)].filter((item) => item.textContent?.trim());
      block = candidates.reduce((nearest, item) => {
        const rect = item.getBoundingClientRect();
        const distance = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
        return !nearest || distance < nearest.distance ? { item, distance } : nearest;
      }, null)?.item || section;
    }
    if (!block?.dataset.annotationPath) return null;
    return {
      targetPath: block.dataset.annotationPath,
      quote: String(block.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 240),
    };
  }

  function moveAnnotationPointer(event) {
    if (!assistantEnabled || revising || manualEditing || event.target.closest('.annotation-pin')) {
      setAnnotationPointer(null);
      return;
    }
    const target = annotationSectionFromTarget(event.target);
    setAnnotationPointer(target ? { x: event.clientX + 12, y: event.clientY + 12 } : null);
  }

  function startAnnotation(event) {
    if (!assistantEnabled || revising || manualEditing || event.target.closest('.annotation-pin')) return;
    const target = annotationSectionFromTarget(event.target);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const annotationTarget = nearbyAnnotationTarget(event.target, target.section, event.clientX, event.clientY);
    if (!annotationTarget || !isAnnotationPathAllowed(target.sectionKey, annotationTarget.targetPath, lessonRef.current)) {
      setToast('请选择教案正文中的具体内容');
      return;
    }
    const selection = window.getSelection?.();
    const selectedQuote = selection && !selection.isCollapsed && target.section.contains(selection.anchorNode)
      ? selection.toString().replace(/\s+/g, ' ').trim().slice(0, 240)
      : '';
    const quote = selectedQuote || annotationTarget.quote;
    const order = target.section.closest('.lesson-section-order');
    const orderRect = order.getBoundingClientRect();
    setAnnotationDraft({
      id: null,
      sectionKey: target.sectionKey,
      label: outlineLabelMap.get(target.sectionKey),
      quote,
      targetPath: annotationTarget.targetPath,
      instruction: '',
      anchorX: Math.max(1, Math.min(99, ((event.clientX - orderRect.left) / orderRect.width) * 100)),
      anchorY: Math.max(0, Math.min(100, ((event.clientY - orderRect.top) / orderRect.height) * 100)),
      x: Math.max(12, Math.min(event.clientX + 14, window.innerWidth - 334)),
      y: Math.max(80, Math.min(event.clientY + 14, window.innerHeight - 230)),
    });
    setAnnotationPointer(null);
  }

  function editAnnotation(annotation, event) {
    if (revising) return;
    setAnnotationDraft({
      ...annotation,
      x: Math.max(12, Math.min((event?.clientX || window.innerWidth / 2) + 12, window.innerWidth - 334)),
      y: Math.max(80, Math.min((event?.clientY || window.innerHeight / 2) + 12, window.innerHeight - 230)),
    });
  }

  function saveAnnotationDraft() {
    if (!annotationDraft || revising) return;
    const instruction = annotationDraft.instruction.trim();
    if (!instruction) {
      setToast('请先填写修改要求');
      return;
    }
    const nextAnnotation = {
      id: annotationDraft.id || `annotation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      sectionKey: annotationDraft.sectionKey,
      label: outlineLabelMap.get(annotationDraft.sectionKey),
      quote: annotationDraft.quote || '',
      targetPath: annotationDraft.targetPath,
      instruction,
      anchorX: annotationDraft.anchorX,
      anchorY: annotationDraft.anchorY,
      status: 'pending',
    };
    replaceAnnotations((items) => annotationDraft.id
      ? items.map((item) => item.id === annotationDraft.id ? nextAnnotation : { ...item, status: 'pending' })
      : [...items.map((item) => ({ ...item, status: 'pending' })), nextAnnotation]);
    setRetryRevision(null);
    setAnnotationDraft(null);
    window.getSelection?.()?.removeAllRanges?.();
  }

  function removeAnnotation(id) {
    replaceAnnotations((items) => items.filter((item) => item.id !== id).map((item) => ({ ...item, status: 'pending' })));
    if (annotationDraft?.id === id) setAnnotationDraft(null);
    setRetryRevision(null);
  }

  function pendingAnnotations() {
    return annotationsRef.current.filter((item) => item.status !== 'review');
  }

  function buildAnnotationRevisionRequest() {
    const pending = pendingAnnotations();
    if (!pending.length || pending.some((item) => !item.instruction.trim() || !outlineLabelMap.has(item.sectionKey) || !isAnnotationPathAllowed(item.sectionKey, item.targetPath, lessonRef.current))) return null;
    const sectionKeys = [...new Set(pending.map((item) => item.sectionKey))];
    const instruction = [
      '请仅修改下列批注对应的教案内容，保持未批注模块不变。',
      ...pending.map((item, index) => `${index + 1}.【${outlineLabelMap.get(item.sectionKey)}｜${item.targetPath}】针对原文“${item.quote}”：${item.instruction.trim()}`),
      ...(feedback.trim() ? [`整体说明：${feedback.trim()}`] : []),
    ].join('\n');
    return buildRevisionRequest(instruction, sectionKeys, pending.map((item) => item.id), pending.map((item) => item.targetPath));
  }

  function submitAnnotations() {
    if (revising) return;
    const pending = pendingAnnotations();
    if (!pending.length) {
      setToast('当前没有待发送的批注');
      return;
    }
    if (pending.some((item) => !item.instruction.trim())) {
      setToast('请填写全部待发送批注后再统一发送');
      return;
    }
    const request = buildAnnotationRevisionRequest();
    if (!request) {
      setToast('批注对应的教案模块已变化，请重新选择修改位置');
      return;
    }
    void runRevision(request);
  }

  function buildRevisionRequest(instruction, selectedKeys = [], annotationIds = [], targetPaths = [], mode = 'targeted') {
    const currentLesson = lessonRef.current;
    const currentCustomSectionIds = (currentLesson.custom_sections || []).map((item) => item.id);
    const safeSelectedKeys = filterRevisionSelection(selectedKeys, {
      standardKeys: standardRevisionKeys,
      customIds: currentCustomSectionIds,
    });
    const standardKeys = safeSelectedKeys.filter((key) => !key.startsWith('custom:'));
    const customIds = safeSelectedKeys.filter((key) => key.startsWith('custom:')).map((key) => key.slice(7));
    return {
      instruction,
      standardKeys,
      customIds,
      annotationIds,
      targetPaths: [...new Set(targetPaths.filter((path) => typeof path === 'string'))],
      mode,
      clientVersion: lessonVersionRef.current,
      idempotencyKey: revisionIdempotencyKey(),
      body: {
        lessonPlan: toCanonicalLesson({ ...currentLesson, custom_sections: [] }, loadCanonicalLesson()),
        sectionKeys: standardKeys,
        customSections: (currentLesson.custom_sections || []).filter((item) => customIds.includes(item.id)),
        feedback: instruction,
      },
    };
  }

  function rebuildRevisionRequest(request) {
    return buildRevisionRequest(
      request.instruction,
      [...(request.standardKeys || []), ...(request.customIds || []).map((id) => `custom:${id}`)],
      request.annotationIds || [],
      request.targetPaths || [],
      request.mode || 'targeted',
    );
  }

  function submitFullRegeneration() {
    if (revising) return;
    const requirement = regenerateFeedback.trim();
    if (!requirement) {
      setToast('请先说明当前教案不满意的地方');
      return;
    }
    const allKeys = fullOutline.map(([key]) => key);
    const instruction = [
      '请根据下列反馈重新生成整份教案。保留课程基本信息与教材事实，全面重写所有教学模块；内容要可直接用于真实课堂，习题不少于十道。',
      `教师反馈：${requirement}`,
    ].join('\n');
    const request = buildRevisionRequest(instruction, allKeys, [], [], 'full');
    setRegenerateOpen(false);
    setRegenerateFeedback('');
    clearAnnotationSession();
    setAssistantEnabled(false);
    setManualEditing(false);
    void runRevision(request);
  }

  async function runRevision(request) {
    if (revisionInFlightRef.current) return;
    revisionInFlightRef.current = true;
    const runId = revisionRunRef.current + 1;
    revisionRunRef.current = runId;
    const abortController = new AbortController();
    revisionAbortRef.current = abortController;
    let trackedRequest = { ...request, jobId: request.jobId || null };
    activeRevisionRef.current = trackedRequest;
    setRetryRevision(null);
    setRevisionStage('submitting');
    setRevising(true);
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
      if (request.clientVersion !== lessonVersionRef.current) {
        throw new Error('教案内容已发生变化，为避免覆盖新编辑，请按当前内容重新提交批注。');
      }
      const latestLesson = lessonRef.current;
      const latestCustomIds = (latestLesson.custom_sections || []).map((item) => item.id);
      if (!isRevisionRequestScopeValid(request, {
        standardKeys: standardRevisionKeys,
        customIds: latestCustomIds,
      })) {
        throw new Error('原修改任务对应的模块已发生变化，请按当前选区重新提交。');
      }
      const result = revisionJobResult(job);
      let revisedSource = structuredClone(latestLesson);
      if (request.standardKeys.length) {
        if (!result.lessonPlan) throw new Error('修改任务已完成，但没有返回教案内容。');
        revisedSource = mergeSelectedSections(revisedSource, normalizeLesson(result.lessonPlan), request.standardKeys);
      }
      if (request.customIds.length) {
        if (!Array.isArray(result.customSections)) throw new Error('修改任务已完成，但没有返回自定义模块内容。');
        const missingCustomIds = missingRevisionCustomSectionIds(request.customIds, result.customSections);
        if (missingCustomIds.length) {
          throw new Error('修改任务已完成，但返回的自定义模块不完整，请重新提交。');
        }
        revisedSource.custom_sections = (revisedSource.custom_sections || []).map((item) => {
          const changed = result.customSections.find((update) => update.id === item.id);
          return changed ? { ...item, title: changed.title || item.title, content: changed.content || item.content } : item;
        });
      }
      let candidateLesson;
      if (request.mode === 'full') {
        candidateLesson = {
          ...revisedSource,
          id: latestLesson.id,
          metadata: { ...(latestLesson.metadata || {}), ...(revisedSource.metadata || {}) },
          source_files: latestLesson.source_files || [],
          section_order: latestLesson.section_order || [],
          section_titles: latestLesson.section_titles || {},
          updated_at: '刚刚',
        };
      } else {
        const targetPaths = [...new Set(request.targetPaths || [])];
        const requestScopeKeys = [...request.standardKeys, ...request.customIds.map((id) => `custom:${id}`)];
        if (!targetPaths.length || targetPaths.some((path) => !requestScopeKeys.some((sectionKey) => isAnnotationPathAllowed(sectionKey, path, latestLesson)))) {
          throw new Error('批注目标已失效，请重新选择具体内容。');
        }
        candidateLesson = {
          ...synchronizeAnnotationDerivedFields(mergeAnnotationTargets(latestLesson, revisedSource, targetPaths), targetPaths),
          id: latestLesson.id,
          updated_at: '刚刚',
        };
      }
      const transition = completeRevisionTransition({}, candidateLesson);
      updateLesson(transition.lesson);
      replaceAnnotations(transition.annotations);
      setFeedback(transition.feedback);
      setRetryRevision(transition.retryRevision);
      setAnnotationDraft(transition.annotationDraft);
      setAnnotationPointer(transition.annotationPointer);
      setAssistantEnabled(transition.assistantEnabled);
      setManualEditing(transition.manualEditing);
      setToast(request.mode === 'full' ? '整份教案已重新生成，已进入编辑模式' : '修改版已生成，已进入编辑模式');
      setRetryRevision(null);
    } catch (error) {
      if (revisionRunRef.current !== runId) return;
      const message = error?.message || '本次修改未完成，请稍后重试。';
      const mode = revisionRetryMode(error, { completedJobReceived });
      setRetryRevision(mode === 'resume'
        ? { mode, request: trackedRequest }
        : { mode: 'resubmit', request: { ...trackedRequest, jobId: null, idempotencyKey: revisionIdempotencyKey() } });
      setToast(`本次修改未完成：${message}`);
    } finally {
      if (revisionRunRef.current === runId) {
        revisionInFlightRef.current = false;
        setRevising(false);
        setRevisionStage('idle');
        revisionAbortRef.current = null;
        activeRevisionRef.current = null;
      }
    }
  }

  function stopRevisionWait() {
    if (!revising) return;
    const request = activeRevisionRef.current;
    revisionRunRef.current += 1;
    revisionAbortRef.current?.abort();
    revisionAbortRef.current = null;
    activeRevisionRef.current = null;
    revisionInFlightRef.current = false;
    setRevising(false);
    setRevisionStage('idle');
    if (request) {
      setRetryRevision({ mode: 'resume', request });
    }
    setToast('已停止等待，后台任务可能仍在运行，可继续查询结果');
  }

  function retryRevisionRequest() {
    if (!retryRevision || revising) return;
    const previousRequest = retryRevision.request;
    if (previousRequest?.annotationIds?.length) {
      if (retryRevision.mode === 'resume' && previousRequest.clientVersion === lessonVersionRef.current) {
        void runRevision(previousRequest);
        return;
      }
      const currentAnnotationRequest = buildAnnotationRevisionRequest();
      if (!currentAnnotationRequest) {
        setToast('请确认所有待发送批注仍存在且已填写完整');
        return;
      }
      void runRevision(currentAnnotationRequest);
      return;
    }
    if (retryRevision.mode === 'resume' && previousRequest && previousRequest.clientVersion === lessonVersionRef.current) {
      void runRevision(previousRequest);
      return;
    }
    if (previousRequest) {
      void runRevision(rebuildRevisionRequest(previousRequest));
      return;
    }
    setToast('原批注已变化，请重新发送当前批注');
  }

  async function submitTrainingCandidate() {
    if (isDemo || candidateSubmitted.current) return;
    try {
      await api.submitTrainingCandidate({ lessonPlan: toCanonicalLesson(lessonRef.current, loadCanonicalLesson()), rightsConfirmed: localStorage.getItem('current-lesson-rights-confirmed') === 'true' });
      candidateSubmitted.current = true;
    } catch {
      // 归档失败不影响教师保存与导出。
    }
  }

  function saveCurrent() {
    saveLesson(lessonRef.current, isDemo);
    setToast('教案已保存');
    void submitTrainingCandidate();
  }

  function toggleManualEditing() {
    if (revising) return;
    if (manualEditing) {
      setManualEditing(false);
      saveCurrent();
      setToast('手动编辑已完成并保存');
      return;
    }
    clearAnnotationSession();
    setManualEditing(true);
    setAssistantEnabled(false);
  }

  async function exportLesson(format) {
    if (exportingFormat) return;
    const isPdf = format === 'pdf';
    const label = isPdf ? 'PDF' : 'Word';
    setExportingFormat(format);
    try {
      const exported = isPdf
        ? await api.exportLessonPdf(lessonRef.current)
        : await api.exportLessonDocx(lessonRef.current);
      downloadBlob(exported.blob, exported.filename);
      setExportOpen(false);
      setToast(`${label} 教案已下载`);
      void submitTrainingCandidate();
    } catch (error) {
      setToast(`${label} 导出失败：${error?.message || '请稍后重试'}`);
    } finally {
      setExportingFormat('');
    }
  }

  const editable = manualEditing && !revising;
  const pendingAnnotationItems = pendingAnnotations();
  const allPendingAnnotationsReady = pendingAnnotationItems.length > 0 && pendingAnnotationItems.every((item) => item.instruction.trim() && outlineLabelMap.has(item.sectionKey) && isAnnotationPathAllowed(item.sectionKey, item.targetPath, lesson));

  return (
    <div className="editor-shell">
      <header className="editor-topbar">
        <div className="editor-top-left"><button className="icon-button" onClick={() => navigate('/app')} aria-label="返回工作台"><ArrowLeft size={18} /></button><span className="editor-brand"><BookOpen size={18} /> {siteName}</span><i /></div>
        <div className="editor-history-tools"><button title="根据反馈重新生成整份教案" onClick={() => setRegenerateOpen(true)} disabled={revising}><RotateCcw size={17} /><span>重新生成</span></button></div>
        <div className="editor-top-actions"><button className="outline-drawer-trigger" onClick={() => setOutlineDrawerOpen(true)} aria-label="打开教案大纲"><FileText size={17} /><span>大纲</span></button><button className={`annotation-mode-button${assistantEnabled ? ' is-active' : ''}`} onClick={toggleAnnotationMode} disabled={revising} aria-pressed={assistantEnabled} aria-label={assistantEnabled ? '退出注释模式' : '进入注释模式'}><MessageSquarePlus size={17} /><span>{assistantEnabled ? '正在注释' : '注释'}</span></button><button className={`editor-mode-button${manualEditing ? ' is-active' : ''}`} onClick={toggleManualEditing} disabled={revising} aria-pressed={manualEditing} aria-label={manualEditing ? '完成手动编辑' : '编辑教案'}><Pencil size={17} /><span>{manualEditing ? '完成编辑' : '编辑'}</span></button><button onClick={() => { setHistorySelection(null); setVersionsOpen(true); }} disabled={revising} aria-label="版本历史" title="版本历史"><History size={17} /><span>版本历史</span></button><button className="editor-save-button" onClick={saveCurrent} disabled={revising} aria-label="保存教案"><CheckCircle2 size={17} /><span>保存</span></button><Button icon={Download} onClick={() => setExportOpen(true)} disabled={revising}>导出教案</Button></div>
      </header>

      <div className="editor-layout">
        <aside className={`editor-leftbar ${outlineDrawerOpen ? 'is-open' : ''}`}>
          <header><button onClick={() => navigate('/app')} aria-label="返回工作台"><ArrowLeft size={17} /></button><b>教案大纲</b><button aria-label="新增教案模块" title="新增教案模块" onClick={() => { setOutlineDrawerOpen(false); setNewSectionOpen(true); }} disabled={revising}><Plus size={18} /></button><button className="outline-drawer-close" onClick={() => setOutlineDrawerOpen(false)} aria-label="关闭教案大纲"><X size={18} /></button></header>
          <div className="mobile-editor-tools"><button type="button" onClick={() => { setOutlineDrawerOpen(false); setRegenerateOpen(true); }} disabled={revising}><RotateCcw size={16} />重新生成</button><button type="button" className={`annotation-mode-button${assistantEnabled ? ' is-active' : ''}`} onClick={toggleAnnotationMode} disabled={revising} aria-pressed={assistantEnabled}><MessageSquarePlus size={16} />{assistantEnabled ? '正在注释' : '注释教案'}</button><button type="button" className={`editor-mode-button${manualEditing ? ' is-active' : ''}`} onClick={toggleManualEditing} disabled={revising} aria-pressed={manualEditing}><Pencil size={16} />{manualEditing ? '完成编辑' : '编辑教案'}</button><button type="button" onClick={() => { setOutlineDrawerOpen(false); setVersionsOpen(true); setHistorySelection(null); }} disabled={revising}><History size={16} />版本历史</button><button type="button" onClick={() => { saveCurrent(); setOutlineDrawerOpen(false); }} disabled={revising}><CheckCircle2 size={16} />保存教案</button></div>
          <nav aria-label="教案章节">{fullOutline.map(([key, label], index) => <div className="outline-sort-row" key={key}><div data-outline-key={key} draggable={!revising && editingOutlineKey !== key} role="button" tabIndex={0} aria-current={selected === key ? 'location' : undefined} className={`outline-sort-item${selected === key ? ' active' : ''}${draggedOutlineKey === key ? ' is-dragging' : ''}${dragOverOutlineKey === key && draggedOutlineKey !== key ? ' is-drag-over' : ''}`} onDragStart={(event) => { setDraggedOutlineKey(key); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', key); }} onDragOver={(event) => { event.preventDefault(); setDragOverOutlineKey(key); event.dataTransfer.dropEffect = 'move'; }} onDrop={(event) => { event.preventDefault(); reorderOutline(key); }} onDragEnd={() => { setDraggedOutlineKey(null); setDragOverOutlineKey(null); }} onClick={() => { if (editingOutlineKey !== key) scrollTo(key); }} onDoubleClick={(event) => beginOutlineTitleEdit(event, key, label)} onKeyDown={(event) => { if (editingOutlineKey === key) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); scrollTo(key); } }} title="拖动排序；双击标题可修改"><GripVertical className="outline-drag-handle" size={15} aria-hidden="true" onPointerDown={(event) => beginOutlinePointerDrag(event, key)} onPointerMove={moveOutlinePointerDrag} onPointerUp={(event) => finishOutlinePointerDrag(event)} onPointerCancel={(event) => finishOutlinePointerDrag(event, true)} /><span className="outline-index">{index + 1}</span>{editingOutlineKey === key ? <input className="outline-title-input" autoFocus value={editingOutlineValue} maxLength={30} aria-label={`修改${label}标题`} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()} onChange={(event) => setEditingOutlineValue(event.target.value)} onBlur={() => commitOutlineTitleEdit(key)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') cancelOutlineTitleEdit(); }} /> : <span className="outline-title" onDoubleClick={(event) => beginOutlineTitleEdit(event, key, label)}>{label}</span>}<Check size={14} /></div></div>)}</nav>
          <div className="source-materials"><button onClick={() => setSourcesOpen((value) => !value)} aria-expanded={sourcesOpen}><b>素材来源（{sourceItems.length}）</b><ChevronDown size={16} className={sourcesOpen ? 'open' : ''} /></button>{sourcesOpen ? <div className="source-material-list">{sourceItems.map((file, index) => <article key={`${file.name}-${index}`}><span className="source-thumb guide">{file.mark}</span><p><b title={file.name}>{file.name}</b><small>{file.detail}</small></p></article>)}{!sourceItems.length ? <p className="source-empty">当前教案没有素材记录。</p> : null}</div> : null}</div>
        </aside>

        <main className={`document-workspace${assistantEnabled ? ' is-annotation-mode' : ''}`}>
          <div className={`document-comparison${assistantEnabled ? ' is-active' : ''}`}>
          <section className="comparison-pane comparison-original">
            {assistantEnabled ? <header className="comparison-pane-header"><span>原版教案</span><small>点击左侧教案正文添加注释</small></header> : null}
          <article className="lesson-document">
            <header className="document-header"><div><div className="document-title-line"><EditableText as="h1" value={title} editable={editable} multiline={false} aria-label="教案标题" onCommit={(value) => mutateLesson((next) => { next.metadata.title = value; })} />{editable ? <Pencil size={16} /> : null}</div><p><span>年级：<EditableText value={lesson.metadata?.grade} editable={editable} multiline={false} aria-label="年级" onCommit={(value) => mutateLesson((next) => { next.metadata.grade = value; })} /></span><span>学科：<EditableText value={lesson.metadata?.subject} editable={editable} multiline={false} aria-label="学科" onCommit={(value) => mutateLesson((next) => { next.metadata.subject = value; })} /></span><span>课时：<EditableText value={String(lesson.metadata?.duration_minutes || 45)} editable={editable} multiline={false} aria-label="课时分钟数" onCommit={(value) => mutateLesson((next) => { next.metadata.duration_minutes = Math.max(1, Number.parseInt(value, 10) || 45); })} /> 分钟</span></p><p className="document-meta-extra"><span>教材版本：<EditableText value={lesson.metadata?.textbook_edition || ''} editable={editable} multiline={false} aria-label="教材版本" onCommit={(value) => mutateLesson((next) => { next.metadata.textbook_edition = value; })} /></span><span>章节：<EditableText value={lesson.metadata?.chapter || ''} editable={editable} multiline={false} aria-label="章节名称" onCommit={(value) => mutateLesson((next) => { next.metadata.chapter = value; })} /></span></p></div></header>
            <nav className="lesson-workflow-nav" aria-label="教案知识点组卷工作流"><span className="active"><FileText size={16} /><b>1. 教案设计</b><small>当前步骤</small></span><button onClick={() => navigate(`/app/lesson/${lesson.id || 'current'}/knowledge`)}><Network size={16} /><b>2. 知识点图谱</b><small>提取与校验</small></button><button onClick={() => navigate('/app/papers')}><ScrollText size={16} /><b>3. 智能组卷</b><small>选题与导出</small></button></nav>

            <div className={`lesson-section-order${assistantEnabled ? ' is-annotating' : ''}`} style={{ display: 'flex', flexDirection: 'column' }} onMouseMove={moveAnnotationPointer} onMouseLeave={() => setAnnotationPointer(null)} onClick={startAnnotation}>
            <section id="lesson-objectives" data-section-key="objectives" className="document-section" style={{ order: outlineOrderMap.get('objectives') }}>
              <SectionHeading number={displayedSectionNumber('objectives')} title={sectionHeadingTitle('objectives')} />
              <div className="teaching-field-block" data-annotation-path="source_summary"><b>章节内容概述</b><EditableText as="p" value={lesson.source_summary || ''} editable={editable} aria-label="章节内容概述" onCommit={(value) => mutateLesson((next) => { next.source_summary = value; })} /></div>
              <div className="teaching-field-block" data-annotation-path="core_competencies"><b>核心素养</b><EditableList items={lesson.core_competencies || []} editable={editable} emptyText="当前教案暂未单列核心素养" onCommit={(index, value) => editArray('core_competencies', index, value)} /></div>
              <ol className="objective-list">{(lesson.learning_objectives || []).map((item, index) => <li data-annotation-path={`learning_objectives[${index}]`} key={`${item.type}-${index}`}>
                <EditableText as="span" value={objectiveTypeLabel(item.type)} editable={editable} multiline={false} aria-label={`第 ${index + 1} 项目标类型`} onCommit={(value) => mutateLesson((next) => { next.learning_objectives[index].type = value; })} />
                <div><EditableText as="p" value={item.content} editable={editable} aria-label={`教学目标 ${index + 1}`} onCommit={(value) => mutateLesson((next) => { next.learning_objectives[index].content = value; })} /><p className="evidence-line"><b>达成证据</b><EditableText value={item.measurable_evidence || ''} editable={editable} aria-label={`第 ${index + 1} 项目标达成证据`} onCommit={(value) => mutateLesson((next) => { next.learning_objectives[index].measurable_evidence = value; })} /></p><SourceReferences references={item.source_refs} /></div>
              </li>)}</ol>
            </section>

            <section id="lesson-learner" data-section-key="learner" className="document-section" style={{ order: outlineOrderMap.get('learner') }}>
              <SectionHeading number={displayedSectionNumber('learner')} title={sectionHeadingTitle('learner')} />
              <div className="teaching-field-block" data-annotation-path="metadata.class_profile"><b>班级整体情况</b><EditableText as="p" value={lesson.metadata?.class_profile || ''} editable={editable} aria-label="班级整体情况" onCommit={(value) => mutateLesson((next) => { next.metadata.class_profile = value; })} /></div>
              <div className="teaching-field-block" data-annotation-path="learner_analysis.class_characteristics"><b>班级学习特征</b><EditableText as="p" value={lesson.learner_analysis?.class_characteristics || ''} editable={editable} aria-label="班级学习特征" onCommit={(value) => mutateLesson((next) => { next.learner_analysis = next.learner_analysis || {}; next.learner_analysis.class_characteristics = value; })} /></div>
              <div className="analysis-strip">{[['known', '已有基础'], ['challenge', '学习挑战'], ['strategy', '教学策略']].map(([key, label]) => <div data-annotation-path={`learner_analysis.${key}`} key={key}><b>{label}</b><EditableText as="p" value={lesson.learner_analysis?.[key] || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.learner_analysis = next.learner_analysis || {}; next.learner_analysis[key] = value; })} /></div>)}</div>
            </section>

            <section id="lesson-keypoints" data-section-key="keypoints" className="document-section two-column-section" style={{ order: outlineOrderMap.get('keypoints') }}><div data-annotation-path="key_points"><SectionHeading number={displayedSectionNumber('keypoints')} title={sectionHeadingTitle('keypoints')} /><ul>{(lesson.key_points || []).map((item, index) => <EditableText as="li" key={index} value={item} editable={editable} onCommit={(value) => editArray('key_points', index, value)} />)}</ul></div><div data-annotation-path="difficult_points"><div className="section-heading-spacer" /><h2>教学难点</h2><ul>{(lesson.difficult_points || []).map((item, index) => <EditableText as="li" key={index} value={item} editable={editable} onCommit={(value) => editArray('difficult_points', index, value)} />)}</ul></div></section>

            <section id="lesson-preparation" data-section-key="preparation" className="document-section" style={{ order: outlineOrderMap.get('preparation') }}>
              <SectionHeading number={displayedSectionNumber('preparation')} title={sectionHeadingTitle('preparation')} />
              <div className="preparation-grid">{[['teacher', '教师准备'], ['students', '学生准备'], ['materials', '材料']].map(([key, label]) => <div data-annotation-path={`preparation.${key}`} key={key}><b>{label}</b><EditableList items={lesson.preparation?.[key] || []} editable={editable} onCommit={(index, value) => editNestedArray('preparation', key, index, value)} /></div>)}</div>
              <div className="teaching-field-block" data-annotation-path="safety_and_inclusion"><b>课堂安全与包容</b><EditableList items={lesson.safety_and_inclusion || []} editable={editable} emptyText="当前教案暂无额外安全与包容提示" onCommit={(index, value) => editArray('safety_and_inclusion', index, value)} /></div>
            </section>

            <section id="lesson-timeline" data-section-key="timeline" className="document-section" style={{ order: outlineOrderMap.get('timeline') }}>
              <div className="timeline-heading"><SectionHeading number={displayedSectionNumber('timeline')} title={sectionHeadingTitle('timeline')} /><span><Clock3 size={14} /> 共 {totalMinutes} 分钟</span></div>
              <div className="timeline-table"><div className="timeline-row timeline-head"><span>教学环节</span><span>时间</span><span>教师活动、讲解与提问</span><span>学生活动与学习反馈</span><span>参与目标与评价</span></div>{(lesson.timeline || []).map((item, index) => <div className="timeline-row" data-annotation-path={`timeline[${index}]`} key={item.id || `${item.stage}-${index}`}>
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

            <section id="lesson-interaction" data-section-key="interaction" className="document-section" style={{ order: outlineOrderMap.get('interaction') }}>
              <SectionHeading number={displayedSectionNumber('interaction')} title={sectionHeadingTitle('interaction')} />
              <div className="interaction-grid">{[['support', '基础支持'], ['standard', '常规任务'], ['challenge', '拓展挑战']].map(([key, label]) => <div data-annotation-path={`differentiation.${key}`} key={key}><b>{label}</b><EditableList items={lesson.differentiation?.[key] || []} editable={editable} onCommit={(index, value) => editNestedArray('differentiation', key, index, value)} /></div>)}</div>
              <h3 className="document-subheading">学习评价方案</h3>
              <div className="assessment-grid">{[['diagnostic', '课前诊断'], ['formative', '过程评价'], ['summative', '总结评价'], ['success_criteria', '达成标准']].map(([key, label]) => <div data-annotation-path={`assessment_plan.${key}`} key={key}><b>{label}</b><EditableList items={lesson.assessment_plan?.[key] || []} editable={editable} emptyText="暂未单列" onCommit={(index, value) => mutateLesson((next) => { next.assessment_plan = next.assessment_plan || {}; next.assessment_plan[key] = next.assessment_plan[key] || []; next.assessment_plan[key][index] = value; })} /></div>)}</div>
            </section>

            <section id="lesson-board" data-section-key="board" className="document-section" style={{ order: outlineOrderMap.get('board') }}>
              <SectionHeading number={displayedSectionNumber('board')} title={sectionHeadingTitle('board')} />
              {lesson.board_design_structured && (lesson.board_design_structured.layout_description || lesson.board_design_structured.sections?.length) ? <div className="structured-board">
                <div className="teaching-field-block" data-annotation-path="board_design_structured.layout_description"><b>整体布局</b><EditableText as="p" value={lesson.board_design_structured.layout_description || ''} editable={editable} onCommit={(value) => editStructuredBoard((board) => { board.layout_description = value; })} /></div>
                <div className="board-section-grid">{(lesson.board_design_structured.sections || []).map((section, index) => <article data-annotation-path={`board_design_structured.sections[${index}]`} key={index}><p><b>区域标题</b><EditableText value={section.title || ''} editable={editable} multiline={false} onCommit={(value) => editStructuredBoard((board) => { board.sections[index].title = value; })} /></p><p><b>位置</b><EditableText value={section.position || ''} editable={editable} multiline={false} onCommit={(value) => editStructuredBoard((board) => { board.sections[index].position = value; })} /></p><EditableText as="div" className="board-section-content" value={section.content || ''} editable={editable} onCommit={(value) => editStructuredBoard((board) => { board.sections[index].content = value; })} /></article>)}</div>
              </div> : <EditableText as="pre" className="board-preview" data-annotation-path="board_design" value={lesson.board_design || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.board_design = value; })} />}
            </section>

            <section id="lesson-homework" data-section-key="homework" className="document-section" style={{ order: outlineOrderMap.get('homework') }}>
              <SectionHeading number={displayedSectionNumber('homework')} title={sectionHeadingTitle('homework')} />
              <div className="homework-list">{(lesson.homework || []).map((item, index) => <div data-annotation-path={`homework[${index}]`} key={item.id || index}>
                <EditableText as="span" value={item.level || '课后任务'} editable={editable} multiline={false} onCommit={(value) => mutateLesson((next) => { next.homework[index].level = value; })} />
                <div className="homework-content"><EditableText as="p" value={item.content} editable={editable} onCommit={(value) => mutateLesson((next) => { next.homework[index].content = value; })} /><div className="homework-meta"><p><b>建议用时</b><EditableText value={String(item.estimated_minutes || '')} editable={editable} multiline={false} aria-label={`第 ${index + 1} 项作业建议用时`} onCommit={(value) => mutateLesson((next) => { next.homework[index].estimated_minutes = Math.max(1, Number.parseInt(value, 10) || 1); })} /> 分钟</p><p><b>完成指导</b><EditableText value={item.answer_guidance || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.homework[index].answer_guidance = value; })} /></p></div><SourceReferences references={item.source_refs} /></div>
              </div>)}</div>
              <div className="teaching-field-block" data-annotation-path="reflection_prompts"><b>课后反思提示</b><EditableList items={lesson.reflection_prompts || []} editable={editable} emptyText="当前教案暂未设置课后反思提示" onCommit={(index, value) => editArray('reflection_prompts', index, value)} /></div>
            </section>

            <section id="lesson-exercises" data-section-key="exercises" className="document-section exercises-section" style={{ order: outlineOrderMap.get('exercises') }}>
              <div className="exercises-heading"><SectionHeading number={displayedSectionNumber('exercises')} title={sectionHeadingTitle('exercises')} /><span>{exerciseCount} 道 · 含答案、解析与评分标准</span></div>
              {(lesson.exercises || []).map((item, index) => <details className="exercise-item" data-annotation-path={`exercises[${index}]`} key={item.id || index}><summary><span>{index + 1}</span><div><EditableText as="b" value={item.stem} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].stem = value; })} /><small><EditableText value={questionTypeLabel(item.type)} editable={editable} multiline={false} aria-label={`第 ${index + 1} 题题型`} onCommit={(value) => mutateLesson((next) => { next.exercises[index].type = value; })} /> · 难度 <EditableText value={String(item.difficulty || 1)} editable={editable} multiline={false} aria-label={`第 ${index + 1} 题难度`} onCommit={(value) => mutateLesson((next) => { next.exercises[index].difficulty = Math.min(5, Math.max(1, Number.parseInt(value, 10) || 1)); })} />/5 · 建议 <EditableText value={String(item.estimated_minutes || '')} editable={editable} multiline={false} aria-label={`第 ${index + 1} 题建议用时`} onCommit={(value) => mutateLesson((next) => { next.exercises[index].estimated_minutes = Math.max(1, Number.parseInt(value, 10) || 1); })} /> 分钟 · 知识点：<EditableText value={(item.knowledge_points || []).join('、')} editable={editable} multiline={false} aria-label={`第 ${index + 1} 题知识点`} onCommit={(value) => mutateLesson((next) => { next.exercises[index].knowledge_points = value.split(/[、,，]/).map((entry) => entry.trim()).filter(Boolean); })} /></small></div><ChevronDown size={17} /></summary><div className="exercise-answer">
                {item.options?.length ? <div className="exercise-options"><b>选项</b><ol type="A">{item.options.map((option, optionIndex) => <EditableText as="li" key={optionIndex} value={option} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].options[optionIndex] = value; })} />)}</ol></div> : null}
                <p><b>参考答案</b><EditableText value={item.answer} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].answer = value; })} /></p>
                <p><b>解析</b><EditableText value={item.explanation} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].explanation = value; })} /></p>
                <p><b>评分标准</b><EditableText value={item.scoring_rubric || ''} editable={editable} onCommit={(value) => mutateLesson((next) => { next.exercises[index].scoring_rubric = value; })} /></p>
                <SourceReferences references={item.source_refs} />
              </div></details>)}
            </section>

            {(lesson.custom_sections || []).map((item, index) => { const sectionKey = `custom:${item.id}`; return <section id={`lesson-custom-${item.id}`} data-section-key={sectionKey} className="document-section custom-document-section" style={{ order: outlineOrderMap.get(sectionKey) }} key={item.id}><SectionHeading number={displayedSectionNumber(sectionKey)} title={item.title} editable={editable} annotationPath={`custom_sections[${index}].title`} onCommit={(value) => mutateLesson((next) => { next.custom_sections[index].title = value; })} /><EditableText as="div" className="custom-section-content" data-annotation-path={`custom_sections[${index}].content`} value={item.content} editable={editable} onCommit={(value) => mutateLesson((next) => { next.custom_sections[index].content = value; })} /></section>; })}
            {annotations.map((item, index) => <button key={item.id} type="button" className="annotation-pin" style={{ left: `${item.anchorX || 50}%`, top: `${item.anchorY || 0}%` }} onClick={(event) => { event.preventDefault(); event.stopPropagation(); editAnnotation(item, event); }} aria-label={`编辑注释 ${index + 1}`} title={`注释 ${index + 1}：${item.instruction}`}><MessageSquarePlus size={12} /><span>{index + 1}</span></button>)}
            </div>
            <footer className="document-footer"><span>{totalMinutes} 分钟课堂流程 · {exerciseCount} 道习题</span><span>最后保存：{lesson.updated_at || '刚刚'}</span></footer>
          </article>
          </section>
          {assistantEnabled ? <section className="comparison-pane comparison-revised"><header className="comparison-pane-header"><span>修改版</span><small>{revising ? '正在按注释生成完整修改版' : '发送注释后在这里生成，完成后自动进入编辑'}</small></header><div className={`revision-preview-empty${revising ? ' is-processing' : ''}`}>{revising ? <LoaderCircle className="spin" size={28} /> : <MessageSquarePlus size={28} />}<b>{revising ? '正在生成修改版' : '等待生成修改版'}</b><p>{revising ? '完成后会自动保存为当前教案，并进入可编辑状态。' : '在左侧教案正文添加一个或多个注释，然后从底部发送。'}</p></div></section> : null}
          </div>
        </main>

        {outlineDrawerOpen ? <button className="outline-drawer-scrim" aria-label="关闭教案大纲" onClick={() => setOutlineDrawerOpen(false)} /> : null}
      </div>

      {assistantEnabled && annotationPointer && !annotationDraft ? <span className="annotation-pointer" style={{ left: annotationPointer.x, top: annotationPointer.y }} aria-hidden="true"><MessageSquarePlus size={15} /></span> : null}

      {assistantEnabled && annotationDraft ? <div className="annotation-popover" style={{ left: annotationDraft.x, top: annotationDraft.y }} role="dialog" aria-label={`编辑${annotationDraft.label}注释`} onClick={(event) => event.stopPropagation()}>
        <header><span><MessageSquarePlus size={15} />{annotationDraft.id ? '编辑注释' : '添加注释'}</span><div className="annotation-popover-actions">{annotationDraft.id ? <button className="annotation-delete" type="button" onClick={() => removeAnnotation(annotationDraft.id)} aria-label="删除这条注释"><Trash2 size={14} /></button> : null}<button type="button" onClick={() => setAnnotationDraft(null)} aria-label="取消注释"><X size={15} /></button></div></header>
        <p>{annotationDraft.label}{annotationDraft.quote ? ` · “${annotationDraft.quote}”` : ''}</p>
        <div><textarea autoFocus value={annotationDraft.instruction} maxLength={800} placeholder="说明这里要怎样修改…" onChange={(event) => setAnnotationDraft((current) => ({ ...current, instruction: event.target.value }))} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') saveAnnotationDraft(); }} /><button type="button" onClick={saveAnnotationDraft} disabled={!annotationDraft.instruction.trim()} aria-label="保存注释"><Check size={14} /></button></div>
      </div> : null}

      {assistantEnabled ? <div className="annotation-composer-stack">
        {revising ? <div className="annotation-process-status" aria-live="polite"><LoaderCircle className="spin" size={16} /><span>{revisionStageLabels[revisionStage] || '正在生成修改版'} · {revisionElapsed} 秒</span><button type="button" onClick={stopRevisionWait}>停止</button></div> : null}
        <div className="annotation-dock" aria-label="注释发送栏">
          {annotations.length ? <span className="annotation-count"><MessageSquarePlus size={13} />已添加 {annotations.length} 条注释</span> : null}
          {!revising && retryRevision ? <button type="button" className="annotation-retry" onClick={retryRevisionRequest}><RotateCcw size={15} />{retryRevision.mode === 'resume' ? '继续查询' : '重试'}</button> : null}
          <input value={feedback} maxLength={500} placeholder={annotations.length ? '补充整体要求（选填）' : '先点击左侧教案内容添加注释'} disabled={!annotations.length || revising} onChange={(event) => setFeedback(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && allPendingAnnotationsReady && !revising) submitAnnotations(); }} />
          <button type="button" className="annotation-send" onClick={submitAnnotations} disabled={revising || !allPendingAnnotationsReady} aria-label="发送全部注释"><Send size={17} /></button>
        </div>
      </div> : null}

      {!assistantEnabled && (revising || retryRevision) ? <div className={`global-revision-status${retryRevision && !revising ? ' is-error' : ''}`} aria-live="polite">{revising ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}<span>{revising ? `${revisionStageLabels[revisionStage] || '正在重新生成整份教案'} · ${revisionElapsed} 秒` : '重新生成未完成，可继续尝试'}</span>{revising ? <button type="button" onClick={stopRevisionWait}>停止</button> : <button type="button" onClick={retryRevisionRequest}>重试</button>}</div> : null}

      <Modal open={newSectionOpen} onClose={() => { if (!revising) setNewSectionOpen(false); }} title="新增教案模块" description="新模块会加入教案大纲和教案正文，也可以像其他内容一样添加注释。" footer={<><Button variant="ghost" onClick={() => setNewSectionOpen(false)} disabled={revising}>取消</Button><Button icon={Plus} onClick={addCustomSection} disabled={revising || !newSectionTitle.trim()}>添加模块</Button></>}><label className="new-section-field"><span>模块名称</span><input value={newSectionTitle} disabled={revising} onChange={(event) => setNewSectionTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !revising) addCustomSection(); }} placeholder="例如：跨学科拓展" maxLength={30} /></label></Modal>

      <Modal open={regenerateOpen} onClose={() => { if (!revising) setRegenerateOpen(false); }} title="重新生成整份教案" description="告诉系统当前版本哪里不合适。重新生成会保留课程和教材信息，并根据你的反馈全面重写教案。" footer={<><Button variant="ghost" onClick={() => setRegenerateOpen(false)} disabled={revising}>取消</Button><Button icon={RotateCcw} onClick={submitFullRegeneration} disabled={revising || !regenerateFeedback.trim()}>开始重新生成</Button></>}>
        <label className="regenerate-field"><span>需要改进的地方</span><textarea autoFocus value={regenerateFeedback} maxLength={1000} onChange={(event) => setRegenerateFeedback(event.target.value)} placeholder="例如：教学过程不够具体，课堂互动偏少，习题难度层次不明显。请增加可直接照着讲的课堂话术，并把习题按基础、提高、拓展分层。" /><small>{regenerateFeedback.length}/1000</small></label>
      </Modal>

      <Modal open={versionsOpen} onClose={() => { setVersionsOpen(false); setHistorySelection(null); }} title="版本历史" description="点击历史版本只会选中预览；只有点击“恢复此版本”才会替换当前教案。" footer={<><Button variant="ghost" onClick={() => { setVersionsOpen(false); setHistorySelection(null); }}>取消</Button><Button icon={RotateCcw} onClick={restoreSelectedHistory} disabled={!historySelection || revising}>恢复此版本</Button></>}>
        <div className="version-list"><button className="current" type="button" disabled><span>v{currentVersion}.0</span><div><b>当前版本</b><p>{title}</p><small>正在使用 · 当前教师</small></div><CheckCircle2 size={18} /></button>{[...historyRef.current].reverse().map((entry, index) => { const version = entry.version || Math.max(1, currentVersion - index - 1); const snapshot = entry.lesson || entry; const selectedVersion = historySelection?.version === version; return <button type="button" className={selectedVersion ? 'is-selected' : ''} key={`${historyVersion}-${version}-${entry.createdAt || index}`} onClick={() => selectHistorySnapshot(snapshot, version)} disabled={revising}><span>v{version}.0</span><div><b>{selectedVersion ? '已选中' : '历史版本'}</b><p>{snapshot.metadata?.title || snapshot.metadata?.chapter || '教案快照'}</p><small>{snapshot.metadata?.grade || '年级待补充'} · {snapshot.metadata?.subject || '学科待补充'}{entry.createdAt ? ` · ${new Date(entry.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : ''}</small></div>{selectedVersion ? <CheckCircle2 size={18} /> : <History size={17} />}</button>; })}{!historyRef.current.length ? <p className="version-empty">当前会话还没有历史修改。开始编辑或重新生成后，原版本会保存在这里。</p> : null}</div>
        {historySelection ? <div className="version-selection-summary"><span>将恢复 v{historySelection.version}.0</span><p>{historySelection.snapshot.metadata?.title || historySelection.snapshot.metadata?.chapter || '所选教案版本'}</p><small>当前版本会先自动保留在历史记录中，因此仍可恢复。</small></div> : null}
      </Modal>

      <Modal open={exportOpen} onClose={() => { if (!exportingFormat) setExportOpen(false); }} title="导出教案" description={`下载当前完整版本 v${currentVersion}.0，文件由服务端完整排版生成。`} footer={<Button variant="ghost" onClick={() => setExportOpen(false)} disabled={Boolean(exportingFormat)}>取消</Button>}>
        <div className="export-options" aria-busy={Boolean(exportingFormat)}>
          <button type="button" className={exportingFormat === 'docx' ? 'is-exporting' : ''} onClick={() => void exportLesson('docx')} disabled={Boolean(exportingFormat)}>
            <FileText size={22} />
            <div><b>{exportingFormat === 'docx' ? '正在生成 Word…' : 'Word 文档（DOCX）'}</b><p>可直接继续编辑，完整保留教案模块、正文、习题答案与解析。</p></div>
            {exportingFormat === 'docx' ? <LoaderCircle className="spin" size={18} /> : <FileDown size={18} />}
          </button>
          <button type="button" className={exportingFormat === 'pdf' ? 'is-exporting' : ''} onClick={() => void exportLesson('pdf')} disabled={Boolean(exportingFormat)}>
            <FileDown size={22} />
            <div><b>{exportingFormat === 'pdf' ? '正在生成 PDF…' : 'PDF 文档'}</b><p>直接下载正式 PDF 文件，无打印对话框、浏览器页眉、网址或裁切。</p></div>
            {exportingFormat === 'pdf' ? <LoaderCircle className="spin" size={18} /> : <Download size={18} />}
          </button>
        </div>
      </Modal>

      {toast ? <Toast message={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
