import assert from 'node:assert/strict';
import {
  completeRevisionTransition,
  confirmVersionRestore,
  exitAnnotationSession,
  selectVersionPreview,
} from './lessonEditorSession.js';

const activeSession = {
  assistantEnabled: true,
  annotations: [{ id: 'note-1', instruction: '提高题目难度' }],
  annotationDraft: { instruction: '待完成' },
  annotationPointer: { x: 18, y: 28 },
  retryRevision: { mode: 'resume', request: { id: 'revision-1' } },
  revisionPreview: { candidateLesson: { metadata: { title: '修改版' } } },
  feedback: '整体更有挑战性',
  manualEditing: false,
  unrelatedState: 'must survive',
};

const exited = exitAnnotationSession(activeSession);
assert.equal(exited.assistantEnabled, false);
assert.deepEqual(exited.annotations, []);
assert.equal(exited.annotationDraft, null);
assert.equal(exited.annotationPointer, null);
assert.equal(exited.retryRevision, null);
assert.equal(exited.revisionPreview, null);
assert.equal(exited.feedback, '');
assert.equal(exited.unrelatedState, 'must survive');
assert.equal(activeSession.assistantEnabled, true, '退出函数不得修改传入状态');
assert.equal(activeSession.annotations.length, 1, '退出函数不得清空原数组');

const candidateLesson = {
  metadata: { title: '更有挑战性的《春》教学设计' },
  exercises: [{ stem: '改写后的题目', difficulty: 5 }],
};
const completed = completeRevisionTransition(activeSession, candidateLesson);
assert.equal(completed.assistantEnabled, false);
assert.equal(completed.manualEditing, true, '生成完成后应直接进入编辑模式');
assert.equal(completed.revising, false);
assert.equal(completed.revisionStage, 'completed');
assert.deepEqual(completed.annotations, []);
assert.equal(completed.revisionPreview, null);
assert.deepEqual(completed.lesson, candidateLesson);
assert.notEqual(completed.lesson, candidateLesson, '工作教案必须与模型返回对象隔离');
completed.lesson.exercises[0].stem = '本地编辑';
assert.equal(candidateLesson.exercises[0].stem, '改写后的题目');
assert.throws(() => completeRevisionTransition({}, null), /candidateLesson/);

const history = [
  { metadata: { title: 'v1' }, exercises: [{ stem: '第一版' }] },
  { metadata: { title: 'v2' }, exercises: [{ stem: '第二版' }] },
];
const historyBeforeSelection = structuredClone(history);
const selection = selectVersionPreview(history, 0);
assert.deepEqual(history, historyBeforeSelection, '选择历史版本不得修改历史记录');
assert.equal('currentLesson' in selection, false, '预览选择不得产生新的当前版本');
assert.equal(selection.preview.metadata.title, 'v1');
selection.preview.exercises[0].stem = '预览中的临时变化';
assert.equal(history[0].exercises[0].stem, '第一版', '预览必须与历史快照隔离');
assert.equal(selectVersionPreview(history, -1), null);
assert.equal(selectVersionPreview(history, 99), null);

const restored = confirmVersionRestore(selection);
assert.equal(restored.currentLesson.metadata.title, 'v1');
assert.equal(restored.currentLesson.exercises[0].stem, '预览中的临时变化');
assert.equal(restored.selectedIndex, null);
assert.notEqual(restored.currentLesson, selection.preview, '恢复后的当前版本必须是独立副本');
assert.deepEqual(history, historyBeforeSelection, '只有调用方确认保存时才应自行记录新的历史项');
assert.equal(confirmVersionRestore(null), null);

console.log('lesson editor session checks passed');
