import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createReviewStore } from './review-store.mjs';

test('review records are isolated by user and persist across restart', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-review-store-'));
  const ownerA = { id: 'usr_00000000-0000-4000-8000-000000000001', displayName: 'Teacher A' };
  const ownerB = { id: 'usr_00000000-0000-4000-8000-000000000002', displayName: 'Teacher B' };
  let timestamp = new Date('2026-08-06T01:00:00.000Z');
  let sequence = 1;
  const createId = () => `review-00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}`;

  try {
    const store = createReviewStore({ dataDir, now: () => timestamp, createId });
    const first = store.createReview(ownerA, {
      title: 'Mathematics unit review',
      owner: 'spoofed owner',
      subject: 'Grade 7 Mathematics',
      reviewers: ['Teacher Chen'],
      comments: 1,
      status: '待评审',
      source: '试卷',
      questions: [{ id: 'q1', stem: '1 + 1 = ?', options: ['1', '2'], answer: '2' }],
      activities: [{ id: 'activity-one', author: 'Teacher A', text: 'Please verify the difficulty.', time: '刚刚' }],
    });
    assert.equal(first.owner, '当前教师', 'owner is always server-owned');
    assert.equal('userId' in first, false, 'public records do not expose internal ownership ids');
    assert.equal(first.updated, '2026-08-06T01:00:00.000Z');

    const second = store.createReview(ownerB, {
      title: 'Language unit review',
      subject: 'Grade 8 Language',
      reviewers: [],
      comments: 0,
      status: '草稿',
      source: '教案',
      questions: [],
      activities: [],
    });
    assert.deepEqual(store.listReviews(ownerA.id).map((review) => review.id), [first.id]);
    assert.deepEqual(store.listReviews(ownerB.id).map((review) => review.id), [second.id]);
    assert.equal(store.findReview(ownerB.id, first.id), null);
    assert.equal(store.updateReview(ownerB.id, first.id, { status: '已通过' }), null);
    assert.equal(store.deleteReview(ownerB.id, first.id), null);

    timestamp = new Date('2026-08-06T02:00:00.000Z');
    const updated = store.updateReview(ownerA.id, first.id, {
      ...first,
      owner: 'another spoofed owner',
      comments: 2,
      status: '已通过',
      activities: [
        ...first.activities,
        { id: 'activity-two', author: '系统', text: 'Review approved.', time: '刚刚' },
      ],
    });
    assert.equal(updated.owner, '当前教师');
    assert.equal(updated.status, '已通过');
    assert.equal(updated.comments, 2);
    assert.equal(updated.updatedAt, '2026-08-06T02:00:00.000Z');

    const reopened = createReviewStore({ dataDir });
    assert.equal(reopened.listReviews(ownerA.id)[0].status, '已通过');
    assert.equal(reopened.listReviews(ownerA.id)[0].activities.length, 2);
    assert.equal(reopened.listReviews(ownerB.id)[0].title, 'Language unit review');
    assert.equal(reopened.deleteUserReviews([ownerA.id]), 1);
    assert.equal(reopened.listReviews(ownerA.id).length, 0);
    assert.equal(reopened.listReviews(ownerB.id).length, 1);

    const reopenedAgain = createReviewStore({ dataDir });
    assert.equal(reopenedAgain.listReviews(ownerA.id).length, 0);
    assert.equal(reopenedAgain.listReviews(ownerB.id).length, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('review input validation rejects unsupported and unsafe fields', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-review-validation-'));
  const owner = { id: 'usr_00000000-0000-4000-8000-000000000003' };
  const store = createReviewStore({ dataDir });
  const valid = {
    title: 'Review',
    subject: '',
    reviewers: [],
    comments: 0,
    status: '草稿',
    source: '教案',
    questions: [],
    activities: [],
  };

  try {
    assert.throws(
      () => store.createReview(owner, { ...valid, unexpected: true }),
      (error) => error.status === 400 && error.code === 'REVIEW_FIELD_UNKNOWN',
    );
    assert.throws(
      () => store.createReview(owner, { ...valid, title: '   ' }),
      (error) => error.status === 422 && error.code === 'REVIEW_TITLE_REQUIRED',
    );
    assert.throws(
      () => store.createReview(owner, { ...valid, status: 'arbitrary' }),
      (error) => error.status === 422 && error.code === 'REVIEW_STATUS_INVALID',
    );
    assert.throws(
      () => store.createReview(owner, { ...valid, reviewers: ['same', 'same'] }),
      (error) => error.status === 422 && error.code === 'REVIEW_REVIEWERS_DUPLICATED',
    );
    assert.throws(
      () => store.createReview(owner, { ...valid, questions: Array.from({ length: 101 }, () => ({})) }),
      (error) => error.status === 422 && error.code === 'REVIEW_QUESTIONS_INVALID',
    );
    const created = store.createReview(owner, valid);
    assert.throws(
      () => store.updateReview(owner.id, created.id, { id: created.id, owner: '当前教师' }),
      (error) => error.status === 400 && error.code === 'REVIEW_UPDATE_EMPTY',
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
