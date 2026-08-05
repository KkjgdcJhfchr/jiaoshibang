import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSessionToken, hashPassword } from './security.mjs';

const root = new URL('..', import.meta.url);

test('review CRUD routes enforce authentication, ownership, limits, and user cleanup', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-review-routes-'));
  const staticDir = mkdtempSync(join(tmpdir(), 'teacher-helper-review-static-'));
  const sessionSecret = 'review-route-session-secret'.padEnd(64, 's');
  const safetySalt = 'review-route-safety-salt'.padEnd(64, 'p');
  const adminUsername = 'review-owner';
  const ownerA = 'usr_00000000-0000-4000-8000-000000000101';
  const ownerB = 'usr_00000000-0000-4000-8000-000000000102';
  const timestamp = new Date().toISOString();

  writeFileSync(join(staticDir, 'index.html'), '<!doctype html><html><body>teacher</body></html>', 'utf8');
  writeJson(join(dataDir, 'admin.json'), {
    version: 1,
    username: adminUsername,
    role: 'super_admin',
    password: hashPassword('ReviewOwnerPassword1!'),
    updatedAt: timestamp,
  });
  writeJson(join(dataDir, 'users.json'), {
    version: 1,
    referrals: [],
    users: [
      userRecord(ownerA, 'owner-a@example.com'),
      userRecord(ownerB, 'owner-b@example.com'),
    ],
  });

  const port = await reservePort();
  const child = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: String(port),
      DATA_DIR: dataDir,
      STATIC_DIR: staticDir,
      SESSION_SECRET: sessionSecret,
      SAFETY_ID_SALT: safetySalt,
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      REGISTRATION_VERIFICATION_REQUIRED: 'false',
      AUTH_RATE_LIMIT_IP_MAX: '1000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });

  try {
    await waitForHealth(port, () => log);
    const origin = `http://127.0.0.1:${port}`;
    const ownerACookie = tokenCookie('teacher_helper_session', ownerA, 'user', sessionSecret);
    const ownerBCookie = tokenCookie('teacher_helper_session', ownerB, 'user', sessionSecret);
    const adminCookie = tokenCookie('teacher_helper_admin_session', adminUsername, 'admin', sessionSecret);

    assert.equal((await json(origin, '/api/app/reviews')).status, 401);
    assert.deepEqual((await json(origin, '/api/app/reviews', { cookie: ownerACookie })).body.data.reviews, []);

    const createdA = await json(origin, '/api/app/reviews', {
      method: 'POST',
      cookie: ownerACookie,
      body: {
        title: 'Algebra review',
        owner: 'forged',
        subject: 'Grade 7 Mathematics',
        reviewers: ['Teacher Chen'],
        comments: 0,
        status: '草稿',
        source: '教案',
        questions: [{ id: 'q1', stem: 'Solve x + 1 = 2', answer: 'x = 1' }],
        activities: [],
      },
    });
    assert.equal(createdA.status, 201);
    assert.equal(createdA.body.data.review.owner, '当前教师');
    assert.equal('userId' in createdA.body.data.review, false);
    const reviewA = createdA.body.data.review;

    const createdB = await json(origin, '/api/app/reviews', {
      method: 'POST',
      cookie: ownerBCookie,
      body: {
        title: 'Language review',
        subject: 'Grade 8 Language',
        reviewers: [],
        comments: 0,
        status: '草稿',
        source: '教案',
        questions: [],
        activities: [],
      },
    });
    assert.equal(createdB.status, 201);
    const reviewB = createdB.body.data.review;

    const listA = await json(origin, '/api/app/reviews', { cookie: ownerACookie });
    assert.deepEqual(listA.body.data.reviews.map((review) => review.id), [reviewA.id]);
    const listB = await json(origin, '/api/app/reviews', { cookie: ownerBCookie });
    assert.deepEqual(listB.body.data.reviews.map((review) => review.id), [reviewB.id]);

    assert.equal((await json(origin, `/api/app/reviews/${reviewA.id}`, {
      method: 'PUT', cookie: ownerBCookie, body: { status: '已通过' },
    })).status, 404);
    assert.equal((await json(origin, `/api/app/reviews/${reviewA.id}`, {
      method: 'DELETE', cookie: ownerBCookie, body: {},
    })).status, 404);

    const updated = await json(origin, `/api/app/reviews/${reviewA.id}`, {
      method: 'PUT',
      cookie: ownerACookie,
      body: {
        ...reviewA,
        owner: 'still forged',
        comments: 1,
        status: '待评审',
        activities: [{ id: 'activity-one', author: '当前教师', text: 'Please verify question 1.', time: '刚刚' }],
      },
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.review.owner, '当前教师');
    assert.equal(updated.body.data.review.comments, 1);
    assert.equal(updated.body.data.review.activities.length, 1);

    const unknownField = await json(origin, '/api/app/reviews', {
      method: 'POST', cookie: ownerACookie, body: { title: 'Invalid', unexpected: true },
    });
    assert.equal(unknownField.status, 400);
    assert.equal(unknownField.body.error.code, 'REVIEW_FIELD_UNKNOWN');
    const invalidStatus = await json(origin, `/api/app/reviews/${reviewA.id}`, {
      method: 'PUT', cookie: ownerACookie, body: { status: 'unknown' },
    });
    assert.equal(invalidStatus.status, 422);
    assert.equal(invalidStatus.body.error.code, 'REVIEW_STATUS_INVALID');

    const oversizedResponse = await fetch(`${origin}/api/app/reviews`, {
      method: 'POST',
      headers: { Cookie: ownerACookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Oversized', padding: 'x'.repeat(800 * 1024) }),
    });
    assert.equal(oversizedResponse.status, 413);
    assert.equal((await oversizedResponse.json()).error.code, 'BODY_TOO_LARGE');

    const deletedUser = await json(origin, `/api/admin/users/${ownerA}`, {
      method: 'DELETE', cookie: adminCookie, body: {},
    });
    assert.equal(deletedUser.status, 200);
    assert.equal(deletedUser.body.data.cleanup.removedReviews, 1);
    assert.equal((await json(origin, '/api/app/reviews', { cookie: ownerACookie })).status, 401);

    const persisted = JSON.parse(readFileSync(join(dataDir, 'reviews.json'), 'utf8'));
    assert.deepEqual(persisted.reviews.map((review) => review.id), [reviewB.id]);

    const deletedB = await json(origin, `/api/app/reviews/${reviewB.id}`, {
      method: 'DELETE', cookie: ownerBCookie, body: {},
    });
    assert.equal(deletedB.status, 200);
    assert.equal(deletedB.body.data.review.id, reviewB.id);
    assert.equal(deletedB.body.data.deletedId, reviewB.id);
    assert.deepEqual((await json(origin, '/api/app/reviews', { cookie: ownerBCookie })).body.data.reviews, []);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(staticDir, { recursive: true, force: true });
  }
});

function userRecord(id, account) {
  const timestamp = new Date().toISOString();
  return {
    id,
    account,
    accountKey: account.toLowerCase(),
    displayName: account.split('@')[0],
    subject: '',
    password: hashPassword('ReviewRouteUserPassword1!'),
    credits: 3,
    generationCount: 0,
    trainingConsent: false,
    trainingConsentAt: null,
    privacyAcceptedAt: timestamp,
    privacyPolicyUpdatedAt: null,
    verifiedAt: timestamp,
    verifiedChannel: 'email',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function tokenCookie(name, subject, role, secret) {
  const session = createSessionToken({ subject, role, secret, ttlSeconds: 3_600 });
  return `${name}=${session.token}`;
}

async function json(origin, path, { method = 'GET', cookie = '', body } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json(), headers: response.headers };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHealth(port, getLog) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${getLog()}`);
}
