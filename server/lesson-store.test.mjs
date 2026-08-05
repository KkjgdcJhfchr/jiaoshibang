import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDataStore } from './data-store.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-lesson-store-'));

try {
  let timestamp = new Date('2026-08-05T00:00:00.000Z');
  const first = createDataStore(dataDir, { now: () => timestamp });
  const ownerA = register(first, 'owner-a@example.com');
  const ownerB = register(first, 'owner-b@example.com');
  const sharedId = 'lesson-legacy-shared-id';

  const ownerALesson = first.createLesson(ownerA.id, {
    id: sharedId,
    lessonPlan: lessonPlan('Mathematics lesson'),
    customSections: [{ id: 'extension', title: 'Extension', content: 'Owner A extension' }],
    sectionOrder: ['objectives', 'custom:extension'],
    sectionTitles: { objectives: 'Objectives', 'custom:extension': 'Extension' },
    sourceFiles: [{ name: 'math.png', type: 'image/png', size: 128 }],
    title: 'Owner A lesson',
    subject: 'Mathematics',
    grade: 'Grade 7',
  });
  assert.equal(ownerALesson.userId, ownerA.id);

  const ownerBLesson = first.createLesson(ownerB.id, {
    id: sharedId,
    lessonPlan: lessonPlan('Language lesson'),
    title: 'Owner B lesson',
    subject: 'Language',
    grade: 'Grade 7',
  });
  assert.equal(ownerBLesson.id, sharedId, 'legacy ids may overlap between isolated users');
  assert.throws(
    () => first.createLesson(ownerA.id, {
      id: sharedId,
      lessonPlan: lessonPlan('Duplicate'),
      title: 'Duplicate',
    }),
    (error) => error.code === 'LESSON_ID_CONFLICT',
  );

  const initialCharge = first.reserveGeneration(ownerA.id);
  assert.equal(initialCharge.ok, true);
  assert.equal(first.commitGeneration(initialCharge, 'gen_durable_charge').credits, 2);
  const repeatedCharge = first.reserveGeneration(ownerA.id);
  assert.equal(repeatedCharge.ok, true);
  assert.equal(first.commitGeneration(repeatedCharge, 'gen_durable_charge').credits, 2);
  assert.equal(first.findUserById(ownerA.id).generationCount, 1);

  first.saveGenerationJob({
    id: 'gen_00000000-0000-4000-8000-000000000001',
    userId: ownerA.id,
    idempotencyKey: 'lesson-store-test-key',
    requestHash: 'hash',
    requestId: 'request',
    status: 'queued',
    phase: 'queued',
    input: { subject: 'Mathematics' },
    attachmentIds: [],
    sourceFiles: [],
    reservation: { private: true },
  });

  timestamp = new Date('2026-08-05T01:00:00.000Z');
  const reopened = createDataStore(dataDir, { now: () => timestamp });
  assert.equal(reopened.findLesson(ownerA.id, sharedId).title, 'Owner A lesson');
  assert.equal(reopened.findLesson(ownerB.id, sharedId).title, 'Owner B lesson');
  assert.equal(reopened.findLesson('usr_unknown', sharedId), null);
  const repeatedChargeAfterRestart = reopened.reserveGeneration(ownerA.id);
  assert.equal(repeatedChargeAfterRestart.ok, true);
  assert.equal(reopened.commitGeneration(repeatedChargeAfterRestart, 'gen_durable_charge').credits, 2);
  assert.equal(reopened.findUserById(ownerA.id).generationCount, 1);
  assert.deepEqual(reopened.findLesson(ownerA.id, sharedId).sourceFiles, [
    { name: 'math.png', type: 'image/png', size: 128 },
  ]);
  assert.deepEqual(reopened.listLessons(ownerA.id)[0], {
    id: sharedId,
    title: 'Owner A lesson',
    subject: 'Mathematics',
    grade: 'Grade 7',
    chapterTitle: 'Chapter 1',
    durationMinutes: 45,
    exerciseCount: 2,
    createdAt: '2026-08-05T00:00:00.000Z',
    updatedAt: '2026-08-05T00:00:00.000Z',
  });
  const durableJobs = reopened.listGenerationJobs();
  assert.equal(durableJobs.length, 1);
  assert.equal(durableJobs[0].status, 'queued');
  assert.equal(durableJobs[0].reservation, null, 'quota reservations are process-local only');

  reopened.updateLesson(ownerA.id, sharedId, { title: 'Owner A lesson updated' });
  assert.equal(reopened.deleteLesson(ownerA.id, sharedId).title, 'Owner A lesson updated');
  assert.equal(reopened.findLesson(ownerA.id, sharedId), null);
  assert.equal(reopened.findLesson(ownerB.id, sharedId).title, 'Owner B lesson');
  reopened.deleteGenerationJob(durableJobs[0].id);

  const reopenedAgain = createDataStore(dataDir);
  assert.equal(reopenedAgain.findLesson(ownerA.id, sharedId), null);
  assert.equal(reopenedAgain.findLesson(ownerB.id, sharedId).title, 'Owner B lesson');
  assert.equal(reopenedAgain.listGenerationJobs().length, 0);

  console.log(JSON.stringify({ ok: true, lessonPersistenceAcrossRestart: true }));
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

function register(store, account) {
  return store.registerUser({
    account,
    accountKey: account,
    displayName: account,
    subject: '',
    password: { algorithm: 'test' },
    credits: 3,
    trainingConsent: false,
    verifiedAt: new Date().toISOString(),
    verifiedChannel: 'email',
  });
}

function lessonPlan(title) {
  return {
    metadata: {
      lessonTitle: title,
      chapterTitle: 'Chapter 1',
      subject: 'Mathematics',
      grade: 'Grade 7',
      durationMinutes: 45,
    },
    exercises: [{ id: 'one' }, { id: 'two' }],
  };
}
