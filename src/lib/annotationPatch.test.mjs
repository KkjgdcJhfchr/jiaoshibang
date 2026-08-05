import assert from 'node:assert/strict';
import { isAnnotationPathAllowed, mergeAnnotationTargets, synchronizeAnnotationDerivedFields } from './annotationPatch.js';

const base = {
  learning_objectives: [{ content: '目标一' }, { content: '目标二' }],
  exercises: [{ stem: '题一', difficulty: 1 }, { stem: '题二', difficulty: 2 }],
  learner_analysis: { known: '原基础', challenge: '原挑战' },
  board_design: '旧版板书字符串',
  board_design_structured: { layout_description: '原布局', sections: [{ position: '左侧', title: '原区域', content: '原内容' }] },
  custom_sections: [{ id: 'a', title: '原标题', content: '原内容' }, { id: 'b', title: '其它', content: '保持' }],
};
const revised = {
  learning_objectives: [{ content: '改目标一' }, { content: '改目标二' }],
  exercises: [{ stem: '改题一', difficulty: 5 }, { stem: '改题二', difficulty: 5 }],
  learner_analysis: { known: '改基础', challenge: '改挑战' },
  board_design: '模型返回的板书字符串',
  board_design_structured: { layout_description: '新布局', sections: [{ position: '中央', title: '新区域', content: '新内容' }] },
  custom_sections: [{ id: 'a', title: '改标题', content: '改内容' }, { id: 'b', title: '改其它', content: '污染' }],
};

const oneExercise = mergeAnnotationTargets(base, revised, ['exercises[1]']);
assert.deepEqual(oneExercise.exercises[0], base.exercises[0], '同一模块的未选题目必须保持不变');
assert.deepEqual(oneExercise.exercises[1], revised.exercises[1], '只复制被批注的题目');
assert.deepEqual(oneExercise.learning_objectives, base.learning_objectives, '其它模块不得污染');

const oneObjective = mergeAnnotationTargets(base, revised, ['learning_objectives[0]']);
assert.deepEqual(oneObjective.learning_objectives[0], revised.learning_objectives[0]);
assert.deepEqual(oneObjective.learning_objectives[1], base.learning_objectives[1], '同一数组的未选目标必须保持不变');

const oneField = mergeAnnotationTargets(base, revised, ['learner_analysis.known']);
assert.equal(oneField.learner_analysis.known, '改基础');
assert.equal(oneField.learner_analysis.challenge, '原挑战', '同一对象内未选字段必须保持不变');

const boardCandidate = synchronizeAnnotationDerivedFields(
  mergeAnnotationTargets(base, revised, ['board_design_structured.sections[0]']),
  ['board_design_structured.sections[0]'],
);
assert.equal(boardCandidate.board_design_structured.layout_description, '原布局', '未批注的板书布局说明必须保持不变');
assert.deepEqual(boardCandidate.board_design_structured.sections[0], revised.board_design_structured.sections[0]);
assert.match(boardCandidate.board_design, /【中央】 新区域：新内容/, '结构化板书变化后必须重算兼容字符串');
assert.doesNotMatch(boardCandidate.board_design, /旧版板书字符串/);

const customContent = mergeAnnotationTargets(base, revised, ['custom_sections[0].content']);
assert.equal(customContent.custom_sections[0].content, '改内容');
assert.equal(customContent.custom_sections[0].title, '原标题', '只批注正文时不得修改自定义标题');
assert.deepEqual(customContent.custom_sections[1], base.custom_sections[1], '其它自定义模块不得污染');

const customTitle = mergeAnnotationTargets(base, revised, ['custom_sections[0].title']);
assert.equal(customTitle.custom_sections[0].title, '改标题');
assert.equal(customTitle.custom_sections[0].content, '原内容', '只批注标题时不得修改自定义正文');

assert.equal(isAnnotationPathAllowed('exercises', 'exercises[1]'), true);
assert.equal(isAnnotationPathAllowed('exercises', 'exercises[9]', base), false);
assert.equal(isAnnotationPathAllowed('exercises', 'metadata.title'), false);
assert.equal(isAnnotationPathAllowed('custom:a', 'custom_sections[0].content', base), true);
assert.equal(isAnnotationPathAllowed('custom:a', 'custom_sections[1].content', base), false, '自定义模块不得越界复制其它模块');
assert.equal(isAnnotationPathAllowed('custom:a', '__proto__.polluted'), false);
assert.equal(isAnnotationPathAllowed('learner', '.learner_analysis.known'), false);
assert.equal(isAnnotationPathAllowed('learner', 'learner_analysis..known'), false);

console.log('批注目标合并测试通过');
