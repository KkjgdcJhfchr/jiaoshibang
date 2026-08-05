import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboardSource = readFileSync(new URL('./DashboardPages.jsx', import.meta.url), 'utf8');
const editorSource = readFileSync(new URL('./LessonEditor.jsx', import.meta.url), 'utf8');
const workflowSource = readFileSync(new URL('./WorkflowPages.jsx', import.meta.url), 'utf8');
const publicSource = readFileSync(new URL('./PublicPages.jsx', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../lib/api.js', import.meta.url), 'utf8');

test('teacher lesson surfaces never fall back to the bundled spring sample', () => {
  assert.doesNotMatch(editorSource, /sampleLesson|current-lesson/);
  assert.doesNotMatch(workflowSource, /sampleLesson|current-lesson/);
  assert.doesNotMatch(publicSource, /lesson-spring-001/);
});

test('lesson list and generation delivery no longer use browser-local lesson records', () => {
  assert.doesNotMatch(dashboardSource, /LESSON_LIBRARY_KEY|teacher-helper\.lesson-library|current-lesson/);
  assert.match(dashboardSource, /useLessonList\(\)/);
  assert.match(dashboardSource, /job\.data\?\.lessonId/);
});

test('draft and pending generation state are rejected when the owner changes', () => {
  assert.match(dashboardSource, /String\(stored\.ownerRef \|\| ''\) !== String\(ownerRef\)/);
  assert.match(dashboardSource, /pendingGenerationForOwner\(ownerRef\)/);
  assert.match(dashboardSource, /pendingGeneration = \{ \.\.\.draft, ownerRef,/);
  assert.match(dashboardSource, /saveDraft\(\{ \.\.\.draft, createdAt: Date\.now\(\) \}, ownerRef\)/);
});

test('review workflow uses authenticated server storage and explicit lesson routes', () => {
  assert.doesNotMatch(workflowSource, /localStorage|pending-team-paper|teacher-helper\.team-reviews/);
  assert.match(workflowSource, /api\.getReviews\(\)/);
  assert.match(workflowSource, /api\.createReview\(/);
  assert.match(workflowSource, /api\.updateReview\(/);
  assert.match(editorSource, /navigate\(`\/app\/papers\/\$\{lessonId\}`\)/);
  assert.match(editorSource, /navigate\(`\/app\/lesson\/\$\{lessonId\}\/knowledge`\)/);
});

test('public landing page no longer contains the bundled spring marketing sample', () => {
  assert.doesNotMatch(publicSource, /合作品读：把春天读出画面|“春景图”/);
});

test('frontend exposes authenticated server lesson CRUD methods', () => {
  assert.match(apiSource, /getLessons: \(\) => request\('\/api\/app\/lessons'/);
  assert.match(apiSource, /getLesson: \(lessonId\) => request\(`\/api\/app\/lessons\/\$\{encodeURIComponent\(lessonId\)\}`/);
  assert.match(apiSource, /updateLesson: \(lessonId, body\)/);
  assert.match(apiSource, /deleteLesson: \(lessonId\)/);
  assert.match(apiSource, /getReviews: \(\) => request\('\/api\/app\/reviews'/);
  assert.match(apiSource, /createReview: \(body\) => request\('\/api\/app\/reviews'/);
  assert.match(apiSource, /updateReview: \(reviewId, body\)/);
});
