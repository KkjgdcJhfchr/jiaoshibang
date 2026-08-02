import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createAdminMfaCoordinator, generateTotpCode } from './admin-mfa.mjs';

const root = new URL('..', import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-integration-'));
const firstRunDataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-admin-first-run-'));
const sessionSecret = 'integration-session-secret-'.padEnd(64, 's');
const safetySalt = 'integration-safety-salt-'.padEnd(64, 'p');
const adminPassword = 'integration-admin-password';
const lessonSchema = JSON.parse(readFileSync(new URL('../shared/lesson-plan.schema.json', import.meta.url), 'utf8'));
const trainingSchema = JSON.parse(readFileSync(new URL('../shared/training-sample.schema.json', import.meta.url), 'utf8'));
const baseLessonPlan = buildLessonPlan(lessonSchema);
const upstreamRequests = [];
const smtpMessages = [];
const smtpAuthentications = [];

assert.equal(
  generateTotpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', { timestamp: 59_000, digits: 8 }),
  '94287082',
  'TOTP 实现应通过 RFC 6238 SHA-1 测试向量',
);
let fakeMfaNow = 1_700_000_000_000;
const expiringMfa = createAdminMfaCoordinator({
  pepper: 'integration-mfa-expiry-pepper'.padEnd(64, 'x'),
  now: () => fakeMfaNow,
  emailTtlMs: 1_000,
  maxEmailIssues: 2,
});
const expiringCode = expiringMfa.issueEmailCode({
  purpose: 'login',
  username: 'expiry-admin',
  binding: 'expiry-device',
  destination: 'expiry@example.com',
});
fakeMfaNow += 1_001;
assert.throws(
  () => expiringMfa.verifyEmailCode(expiringCode.challenge.id, expiringCode.code, {
    purpose: 'login',
    binding: 'expiry-device',
  }),
  (error) => error.code === 'MFA_CHALLENGE_EXPIRED',
  '邮件验证码到期后必须失效',
);
expiringMfa.issueEmailCode({
  purpose: 'login',
  username: 'expiry-admin',
  binding: 'expiry-device',
  destination: 'expiry@example.com',
});
assert.throws(
  () => expiringMfa.issueEmailCode({
    purpose: 'login',
    username: 'expiry-admin',
    binding: 'expiry-device',
    destination: 'expiry@example.com',
  }),
  (error) => error.code === 'MFA_CODE_RATE_LIMITED',
  '邮件验证码发送次数必须限流',
);

const mockSmtp = createNetServer((socket) => {
  socket.setEncoding('utf8');
  socket.write('220 mock-smtp.local ESMTP ready\r\n');
  let buffer = '';
  let dataMode = false;
  let dataLines = [];
  socket.on('data', (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (dataMode) {
        if (line === '.') {
          smtpMessages.push(dataLines.join('\r\n').replace(/^\.\./gm, '.'));
          dataLines = [];
          dataMode = false;
          socket.write('250 2.0.0 message accepted\r\n');
        } else dataLines.push(line);
        continue;
      }
      if (/^EHLO\s/i.test(line)) socket.write('250-mock-smtp.local\r\n250-AUTH PLAIN LOGIN\r\n250 SIZE 1048576\r\n');
      else if (/^AUTH PLAIN\s/i.test(line)) {
        smtpAuthentications.push(Buffer.from(line.split(/\s+/)[2] || '', 'base64').toString('utf8'));
        socket.write('235 2.7.0 authenticated\r\n');
      } else if (/^(MAIL FROM|RCPT TO):/i.test(line)) socket.write('250 2.1.0 accepted\r\n');
      else if (line === 'DATA') {
        dataMode = true;
        socket.write('354 end with <CRLF>.<CRLF>\r\n');
      } else if (line === 'QUIT') {
        socket.write('221 2.0.0 bye\r\n');
        socket.end();
      } else socket.write('500 5.5.1 unsupported command\r\n');
    }
  });
});

const mockUpstream = createServer(async (request, response) => {
  if (request.method === 'GET' && request.url?.endsWith('/models')) {
    upstreamRequests.push({ authorization: request.headers.authorization, model: 'models-list', safetyIdentifier: null });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'environment-test-model' }, { id: 'stored-provider-model' }] }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const inputText = body.input?.[0]?.content?.find((item) => item.type === 'input_text')?.text || '';
  upstreamRequests.push({
    authorization: request.headers.authorization,
    model: body.model,
    safetyIdentifier: body.safety_identifier,
  });

  if (inputText.includes('FORCE_UPSTREAM_ERROR')) {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'mock_failure', message: '模拟上游失败' } }));
    return;
  }
  if (inputText.includes('DELAY_FOR_CONCURRENCY_TEST')) await delay(350);

  const requestedDuration = Number(inputText.match(/课时：(\d+) 分钟/)?.[1]) || 45;
  const lessonPlan = structuredClone(baseLessonPlan);
  lessonPlan.metadata.durationMinutes = requestedDuration;
  lessonPlan.timeline[0].durationMinutes = requestedDuration;
  lessonPlan.generationMeta.modelRouteId = body.model;
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    id: `resp_${upstreamRequests.length}`,
    status: 'completed',
    model: body.model,
    output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(lessonPlan) }] }],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
  }));
});

let appProcess;
let firstRunProcess;
try {
  const mockPort = await listenOnRandomPort(mockUpstream);
  const smtpPort = await listenOnRandomPort(mockSmtp);
  const appPort = await reservePort();
  const commonEnv = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(appPort),
    DATA_DIR: dataDir,
    SESSION_SECRET: sessionSecret,
    SAFETY_ID_SALT: safetySalt,
    OPENAI_API_KEY: 'integration-environment-key',
    OPENAI_BASE_URL: `http://127.0.0.1:${mockPort}/v1`,
    OPENAI_MODEL: 'environment-test-model',
    ALLOW_INSECURE_PROVIDER_URLS: 'true',
    ALLOW_PRIVATE_PROVIDER_NETWORKS: 'true',
    ALLOW_INSECURE_SMTP: 'true',
    AUTH_RATE_LIMIT_IP_MAX: '100',
    REGISTRATION_VERIFICATION_REQUIRED: 'false',
    AI_RATE_LIMIT_USER_MAX: '3',
    AI_RATE_LIMIT_IP_MAX: '100',
    AI_MAX_CONCURRENCY: '1',
  };

  const firstRunPort = await reservePort();
  const firstRunEnv = { ...commonEnv, PORT: String(firstRunPort), DATA_DIR: firstRunDataDir };
  firstRunProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: firstRunEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let firstRunLog = '';
  firstRunProcess.stdout.on('data', (chunk) => { firstRunLog += chunk; });
  firstRunProcess.stderr.on('data', (chunk) => { firstRunLog += chunk; });
  await waitForHealth(firstRunPort, () => firstRunLog);
  const firstRunClient = createClient(firstRunPort);

  const beforeInitialization = await firstRunClient.json('/api/admin/session');
  assert.equal(beforeInitialization.status, 200);
  assert.equal(beforeInitialization.body.data.initialized, false);
  assert.equal(beforeInitialization.body.data.authenticated, false);

  const crossOriginBootstrap = await firstRunClient.json('/api/admin/bootstrap', {
    method: 'POST',
    headers: { Origin: 'https://attacker.example' },
    body: { username: 'owner', password: 'FirstRun!2026Secure' },
  });
  assert.equal(crossOriginBootstrap.status, 403);
  assert.equal(crossOriginBootstrap.body.error.code, 'ADMIN_BOOTSTRAP_ORIGIN_DENIED');

  const weakBootstrap = await firstRunClient.json('/api/admin/bootstrap', {
    method: 'POST',
    body: { username: 'owner', password: 'weak-password' },
  });
  assert.equal(weakBootstrap.status, 400);
  assert.equal(weakBootstrap.body.error.code, 'WEAK_ADMIN_PASSWORD');

  const webAdminPassword = 'FirstRun!2026Secure';
  const initialized = await firstRunClient.json('/api/admin/bootstrap', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:5188' },
    body: { username: 'owner', password: webAdminPassword },
  });
  assert.equal(initialized.status, 201);
  assert.equal(initialized.body.data.initialized, true);
  assert.equal(initialized.body.data.authenticated, true);
  assert.equal(initialized.body.data.admin.username, 'owner');
  const initializedCookie = cookiePair(initialized.headers.get('set-cookie'));
  assert.match(initialized.headers.get('set-cookie'), /HttpOnly/);
  assert.match(initialized.headers.get('set-cookie'), /SameSite=Strict/);

  const storedAdmin = readFileSync(join(firstRunDataDir, 'admin.json'), 'utf8');
  assert.equal(storedAdmin.includes(webAdminPassword), false, '管理员密码不得明文落盘');
  assert.match(storedAdmin, /"algorithm": "scrypt"/);

  const authenticatedAdminSession = await firstRunClient.json('/api/admin/session', { cookie: initializedCookie });
  assert.equal(authenticatedAdminSession.status, 200);
  assert.equal(authenticatedAdminSession.body.data.authenticated, true);
  assert.equal(authenticatedAdminSession.body.data.admin.username, 'owner');

  const duplicateBootstrap = await firstRunClient.json('/api/admin/bootstrap', {
    method: 'POST',
    body: { username: 'another-owner', password: 'Another!2026Secure' },
  });
  assert.equal(duplicateBootstrap.status, 409);
  assert.equal(duplicateBootstrap.body.error.code, 'ADMIN_ALREADY_INITIALIZED');

  firstRunProcess.kill();
  firstRunProcess = undefined;
  await delay(100);

  await runProcess(['server/index.mjs', '--bootstrap-admin'], {
    env: { ...commonEnv, ADMIN_USERNAME: 'admin' },
    input: `${adminPassword}\n`,
  });

  appProcess = spawn(process.execPath, ['server/index.mjs'], {
    cwd: root,
    env: commonEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let appLog = '';
  appProcess.stdout.on('data', (chunk) => { appLog += chunk; });
  appProcess.stderr.on('data', (chunk) => { appLog += chunk; });
  await waitForHealth(appPort, () => appLog);

  const client = createClient(appPort);
  const initialSiteConfig = await client.json('/api/site-config');
  assert.equal(initialSiteConfig.status, 200);
  assert.equal(initialSiteConfig.body.data.registrationOpen, true);
  assert.ok(initialSiteConfig.body.data.privacyPolicy.content.length >= 100);
  assert.match(initialSiteConfig.body.data.privacyPolicy.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  let currentPrivacyPolicyUpdatedAt = initialSiteConfig.body.data.privacyPolicy.updatedAt;
  const publicPaymentPlans = await client.json('/api/payments/plans');
  assert.equal(publicPaymentPlans.status, 200);
  assert.equal(publicPaymentPlans.body.data.plans.length, 9);
  assert.deepEqual(
    [...new Set(publicPaymentPlans.body.data.plans.filter((plan) => plan.purchasable).map((plan) => plan.billingPeriod))].sort(),
    ['half_year', 'month', 'quarter', 'year'],
  );
  assert.equal(publicPaymentPlans.body.data.plans.filter((plan) => plan.tier === 'pro').length, 4);
  assert.equal(publicPaymentPlans.body.data.plans.filter((plan) => plan.tier === 'research').length, 4);
  assert.equal(publicPaymentPlans.body.data.freePlan.kind, 'free');
  assert.equal(publicPaymentPlans.body.data.freePlan.purchasable, false);
  assert.equal(publicPaymentPlans.body.data.freePlan.credits, 3);
  assert.equal(publicPaymentPlans.body.data.providers.every((provider) => provider.enabled === false), true);
  assert.equal(publicPaymentPlans.body.data.checkoutVerificationRequired, false);
  const unauthenticatedGeneration = await client.json('/api/ai/generate', {
    method: 'POST',
    body: generationBody('正常生成'),
  });
  assert.equal(unauthenticatedGeneration.status, 401);
  assert.equal(unauthenticatedGeneration.body.error.code, 'AUTH_REQUIRED');
  const unauthenticatedKnowledgeMap = await client.json('/api/workflow/knowledge-map', {
    method: 'POST',
    body: { lessonPlan: baseLessonPlan },
  });
  assert.equal(unauthenticatedKnowledgeMap.status, 401);
  assert.equal(unauthenticatedKnowledgeMap.body.error.code, 'AUTH_REQUIRED');

  const registration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'teacher@example.com',
      password: 'TeacherPass1',
      displayName: '集成测试教师',
      subject: '语文',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  assert.equal(registration.status, 201);
  assert.equal(registration.body.data.user.credits, 3);
  assert.ok(registration.body.data.user.privacyAcceptedAt);
  for (const internalField of ['trainingConsent', 'trainingConsentAt', 'role']) {
    assert.equal(Object.hasOwn(registration.body.data.user, internalField), false, `教师会话不得返回内部字段 ${internalField}`);
  }
  const registeredUserRecord = JSON.parse(readFileSync(join(dataDir, 'users.json'), 'utf8')).users
    .find((user) => user.account === 'teacher@example.com');
  assert.equal(registeredUserRecord.privacyPolicyUpdatedAt, currentPrivacyPolicyUpdatedAt);
  const userCookie = cookiePair(registration.headers.get('set-cookie'));
  assert.match(registration.headers.get('set-cookie'), /HttpOnly/);
  assert.match(registration.headers.get('set-cookie'), /SameSite=Strict/);

  const weakUserPassword = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'weak-password@example.com',
      password: 'passwordonly',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  assert.equal(weakUserPassword.status, 400);
  assert.equal(weakUserPassword.body.error.code, 'WEAK_PASSWORD');

  const concealedDeliveryFailure = await client.json('/api/auth/password-reset/request', {
    method: 'POST',
    body: { identifier: 'teacher@example.com' },
  });
  assert.equal(concealedDeliveryFailure.status, 202, '发信通道未配置时也不能通过状态码暴露账号存在性');
  assert.match(concealedDeliveryFailure.body.data.verificationId, /^vfy_/);

  const knownRegistrationProbe = await client.json('/api/auth/verification-codes', {
    method: 'POST',
    body: { identifier: 'teacher@example.com', purpose: 'register' },
  });
  const unknownRegistrationProbe = await client.json('/api/auth/verification-codes', {
    method: 'POST',
    body: { identifier: 'not-registered@example.com', purpose: 'register' },
  });
  assert.equal(knownRegistrationProbe.status, 202);
  assert.equal(unknownRegistrationProbe.status, 503, '新账号注册时通道故障必须明确失败，不能返回无法收到的验证码');
  assert.equal(unknownRegistrationProbe.body.error.code, 'VERIFICATION_DELIVERY_UNAVAILABLE');

  const tamperedCookie = `${userCookie.slice(0, -1)}x`;
  const tamperedSession = await client.json('/api/auth/session', { cookie: tamperedCookie });
  assert.equal(tamperedSession.status, 401);

  const failedGeneration = await client.json('/api/ai/generate', {
    method: 'POST',
    cookie: userCookie,
    body: generationBody('FORCE_UPSTREAM_ERROR'),
  });
  assert.equal(failedGeneration.status, 502);
  const afterFailure = await client.json('/api/auth/session', { cookie: userCookie });
  assert.equal(afterFailure.body.data.user.credits, 3, '失败的生成不得扣额度');

  const firstGeneration = await client.json('/api/ai/generate', {
    method: 'POST',
    cookie: userCookie,
    body: generationBody('正常生成'),
  });
  assert.equal(firstGeneration.status, 200);
  assert.equal(firstGeneration.body.data.creditsRemaining, 2);
  assert.equal(firstGeneration.body.data.providerId, 'environment-fallback');
  assert.equal(upstreamRequests.at(-1).model, 'environment-test-model');
  assert.equal(upstreamRequests.at(-1).authorization, 'Bearer integration-environment-key');
  assert.match(upstreamRequests.at(-1).safetyIdentifier, /^[a-f0-9]{64}$/);

  const knowledgeMap = await client.json('/api/workflow/knowledge-map', {
    method: 'POST',
    cookie: userCookie,
    body: { lessonPlan: firstGeneration.body.data.lessonPlan },
  });
  assert.equal(knowledgeMap.status, 200);
  assert.equal(knowledgeMap.body.data.schemaVersion, 'teaching-knowledge-map.v1');
  assert.ok(knowledgeMap.body.data.nodes.some((node) => node.kind === 'knowledge_point'));
  assert.ok(knowledgeMap.body.data.edges.some((edge) => edge.relation === '教授'));

  const recommendedPaper = await client.json('/api/workflow/papers/recommend', {
    method: 'POST',
    cookie: userCookie,
    body: { lessonPlan: firstGeneration.body.data.lessonPlan, questionCount: 10 },
  });
  assert.equal(recommendedPaper.status, 200);
  assert.equal(recommendedPaper.body.data.schemaVersion, 'recommended-paper.v1');
  assert.equal(recommendedPaper.body.data.questionCount, 10);
  assert.equal(recommendedPaper.body.data.strategy.humanReviewRequired, true);
  assert.match(recommendedPaper.body.data.strategy.formula, /0\.4/);

  const adminLogin = await client.json('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword },
  });
  assert.equal(adminLogin.status, 200);
  const adminCookie = cookiePair(adminLogin.headers.get('set-cookie'));

  const initialManagedContent = await client.json('/api/admin/content', { cookie: adminCookie });
  assert.equal(initialManagedContent.status, 200);
  assert.deepEqual(initialManagedContent.body.data.announcements, []);
  assert.equal(initialManagedContent.body.data.tutorial.enabled, false);

  const announcementCreated = await client.json('/api/admin/announcements', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      title: '欢迎公告',
      content: '欢迎使用完整的备课工作台。',
      enabled: true,
      startsAt: null,
      endsAt: null,
      priority: 80,
      displayPolicy: 'once_per_revision',
    },
  });
  assert.equal(announcementCreated.status, 201);
  const announcement = announcementCreated.body.data.announcement;
  assert.equal(announcement.revision, 1);

  const tutorialSaved = await client.json('/api/admin/tutorial', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      expectedUpdatedAt: null,
      title: '首次使用教程',
      enabled: true,
      steps: [
        { id: 'step_upload', title: '上传教材', content: '上传本章节图片或 PDF。', order: 1 },
        { id: 'step_generate', title: '生成教案', content: '确认学情后开始生成。', order: 2 },
      ],
    },
  });
  assert.equal(tutorialSaved.status, 200);
  const tutorial = tutorialSaved.body.data.tutorial;
  assert.equal(tutorial.enabled, true);
  assert.equal(tutorial.version, 1);

  const contentBootstrap = await client.json('/api/app/content/bootstrap', { cookie: userCookie });
  assert.equal(contentBootstrap.status, 200);
  assert.equal(contentBootstrap.body.data.announcements[0].id, announcement.id);
  assert.equal(contentBootstrap.body.data.tutorial.enabled, true);
  assert.equal(contentBootstrap.body.data.tutorial.progress.currentStepId, 'step_upload');

  const announcementAcknowledged = await client.json(`/api/app/announcements/${encodeURIComponent(announcement.id)}/acknowledge`, {
    method: 'POST',
    cookie: userCookie,
    body: { revision: announcement.revision },
  });
  assert.equal(announcementAcknowledged.status, 200);
  const tutorialProgress = await client.json('/api/app/tutorial/progress', {
    method: 'PUT',
    cookie: userCookie,
    body: { tutorialId: tutorial.id, version: tutorial.version, status: 'active', currentStepId: 'step_generate' },
  });
  assert.equal(tutorialProgress.status, 200);
  const resumedContent = await client.json('/api/app/content/bootstrap', { cookie: userCookie });
  assert.deepEqual(resumedContent.body.data.announcements, []);
  assert.equal(resumedContent.body.data.tutorial.progress.currentStepId, 'step_generate');
  const tutorialCompleted = await client.json('/api/app/tutorial/progress', {
    method: 'PUT',
    cookie: userCookie,
    body: { tutorialId: tutorial.id, version: tutorial.version, status: 'completed', currentStepId: 'step_generate' },
  });
  assert.equal(tutorialCompleted.status, 200);
  const completedContent = await client.json('/api/app/content/bootstrap', { cookie: userCookie });
  assert.equal(completedContent.body.data.tutorial, null);

  const announcementDeleted = await client.json(`/api/admin/announcements/${encodeURIComponent(announcement.id)}`, {
    method: 'DELETE',
    cookie: adminCookie,
    body: { expectedUpdatedAt: announcement.updatedAt },
  });
  assert.equal(announcementDeleted.status, 200);

  const adminTeacherLogin = await client.json('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'admin', password: adminPassword },
  });
  assert.equal(adminTeacherLogin.status, 200);
  assert.equal(adminTeacherLogin.body.data.user.account, 'admin');
  assert.equal(Object.hasOwn(adminTeacherLogin.body.data.user, 'role'), false);
  const adminTeacherCookie = cookiePair(adminTeacherLogin.headers.get('set-cookie'));
  assert.match(adminTeacherLogin.headers.get('set-cookie'), /^teacher_helper_session=/);
  const adminTeacherSession = await client.json('/api/auth/session', { cookie: adminTeacherCookie });
  assert.equal(adminTeacherSession.status, 200);
  assert.equal(Object.hasOwn(adminTeacherSession.body.data.user, 'role'), false);
  const adminApiDeniedForTeacherSession = await client.json('/api/admin/system/settings', {
    cookie: adminTeacherCookie,
  });
  assert.equal(adminApiDeniedForTeacherSession.status, 401);
  assert.equal(adminApiDeniedForTeacherSession.body.error.code, 'ADMIN_AUTH_REQUIRED');

  const unauthenticatedUsers = await client.json('/api/admin/users');
  assert.equal(unauthenticatedUsers.status, 401);
  assert.equal(unauthenticatedUsers.body.error.code, 'ADMIN_AUTH_REQUIRED');
  const adminUsersDeniedForTeacherSession = await client.json('/api/admin/users', {
    cookie: adminTeacherCookie,
  });
  assert.equal(adminUsersDeniedForTeacherSession.status, 401);
  assert.equal(adminUsersDeniedForTeacherSession.body.error.code, 'ADMIN_AUTH_REQUIRED');
  const firstAdminUsersPage = await client.json('/api/admin/users?offset=0&limit=1', {
    cookie: adminCookie,
  });
  assert.equal(firstAdminUsersPage.status, 200);
  assert.equal(firstAdminUsersPage.body.data.items.length, 1);
  assert.equal(firstAdminUsersPage.body.data.pagination.total, 2);
  assert.equal(firstAdminUsersPage.body.data.pagination.limit, 1);
  assert.equal(firstAdminUsersPage.body.data.summary.total, 2);
  assert.equal(firstAdminUsersPage.body.data.summary.verified, 1);
  assert.equal(firstAdminUsersPage.body.data.summary.creditsRemaining, 5);
  assert.equal(firstAdminUsersPage.body.data.summary.generations, 1);
  const serializedAdminUsers = JSON.stringify(firstAdminUsersPage.body.data);
  for (const privateField of ['password', 'accountKey', 'trainingConsent', 'trainingConsentAt', 'privacyAcceptedAt', 'privacyPolicyUpdatedAt', 'role']) {
    assert.equal(serializedAdminUsers.includes(`\"${privateField}\"`), false, `管理员用户列表不得返回 ${privateField}`);
  }
  const searchedAdminUsers = await client.json('/api/admin/users?query=teacher%40example.com&offset=0&limit=20', {
    cookie: adminCookie,
  });
  assert.equal(searchedAdminUsers.status, 200);
  assert.equal(searchedAdminUsers.body.data.pagination.total, 1);
  assert.equal(searchedAdminUsers.body.data.items[0].account, 'teacher@example.com');
  assert.equal(searchedAdminUsers.body.data.items[0].generationCount, 1);
  assert.equal(searchedAdminUsers.body.data.items[0].verified, false);
  assert.ok(searchedAdminUsers.body.data.items[0].lastLoginAt);
  assert.equal(searchedAdminUsers.body.data.items[0].loginCount, 1);
  assert.equal(searchedAdminUsers.body.data.items[0].onlineSeconds >= 0, true);

  const unauthenticatedSystemSettings = await client.json('/api/admin/system/settings');
  assert.equal(unauthenticatedSystemSettings.status, 401);
  assert.equal(unauthenticatedSystemSettings.body.error.code, 'ADMIN_AUTH_REQUIRED');
  const adminSystemSettings = await client.json('/api/admin/system/settings', { cookie: adminCookie });
  assert.equal(adminSystemSettings.status, 200);
  assert.equal(adminSystemSettings.body.data.settings.registrationOpen, true);
  assert.equal(
    adminSystemSettings.body.data.settings.privacyPolicyUpdatedAt,
    currentPrivacyPolicyUpdatedAt,
  );

  await delay(5);
  const updatedPrivacyPolicyContent = '教师帮仅为完成账号注册、安全验证、教案生成、导出与订单处理使用用户主动提交的信息，并采用访问控制和加密措施保护数据。'.repeat(4);
  const closedSystemSettings = await client.json('/api/admin/system/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      expectedUpdatedAt: adminSystemSettings.body.data.settings.updatedAt,
      siteName: '备课星集成测试站点',
      supportEmail: 'support@example.com',
      registrationOpen: false,
      registrationVerificationRequired: false,
      privacyPolicyTitle: '集成测试数据与隐私说明',
      privacyPolicyContent: updatedPrivacyPolicyContent,
    },
  });
  assert.equal(closedSystemSettings.status, 200);
  assert.equal(closedSystemSettings.body.data.settings.registrationOpen, false);
  assert.equal(closedSystemSettings.body.data.settings.updatedBy, 'admin');
  assert.notEqual(
    closedSystemSettings.body.data.settings.privacyPolicyUpdatedAt,
    currentPrivacyPolicyUpdatedAt,
  );

  const closedPublicSettings = await client.json('/api/site-config');
  assert.equal(closedPublicSettings.status, 200);
  assert.equal(closedPublicSettings.body.data.registrationOpen, false);
  assert.equal(closedPublicSettings.body.data.supportEmail, 'support@example.com');
  const brandedPrivacyPolicyContent = updatedPrivacyPolicyContent.replaceAll('教师帮', '备课星集成测试站点');
  assert.equal(closedPublicSettings.body.data.siteName, '备课星集成测试站点');
  assert.equal(closedPublicSettings.body.data.privacyPolicy.content, brandedPrivacyPolicyContent);
  assert.equal(closedPublicSettings.body.data.privacyPolicy.content.includes('教师帮'), false);
  const brandedHomePage = await client.text('/');
  assert.equal(brandedHomePage.status, 200);
  assert.match(brandedHomePage.body, /window\.__SITE_CONFIG__=/);
  assert.match(brandedHomePage.body, /备课星集成测试站点/);
  assert.equal(brandedHomePage.body.includes('教师帮'), false);
  assert.equal(
    closedPublicSettings.body.data.privacyPolicy.updatedAt,
    closedSystemSettings.body.data.settings.privacyPolicyUpdatedAt,
  );
  const closedRegistrationCode = await client.json('/api/auth/verification-codes', {
    method: 'POST',
    body: { identifier: 'closed-code@example.com', purpose: 'register' },
  });
  assert.equal(closedRegistrationCode.status, 403);
  assert.equal(closedRegistrationCode.body.error.code, 'REGISTRATION_CLOSED');
  const closedRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'closed@example.com',
      password: 'ClosedPass1',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: closedPublicSettings.body.data.privacyPolicy.updatedAt,
    },
  });
  assert.equal(closedRegistration.status, 403);
  assert.equal(closedRegistration.body.error.code, 'REGISTRATION_CLOSED');

  const staleSystemSettingsUpdate = await client.json('/api/admin/system/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      expectedUpdatedAt: adminSystemSettings.body.data.settings.updatedAt,
      registrationOpen: true,
    },
  });
  assert.equal(staleSystemSettingsUpdate.status, 409);
  assert.equal(staleSystemSettingsUpdate.body.error.code, 'SITE_SETTINGS_CONFLICT');
  const reopenedSystemSettings = await client.json('/api/admin/system/settings', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      expectedUpdatedAt: closedSystemSettings.body.data.settings.updatedAt,
      registrationOpen: true,
    },
  });
  assert.equal(reopenedSystemSettings.status, 200);
  assert.equal(reopenedSystemSettings.body.data.settings.registrationOpen, true);
  assert.equal(
    reopenedSystemSettings.body.data.settings.privacyPolicyUpdatedAt,
    closedSystemSettings.body.data.settings.privacyPolicyUpdatedAt,
    '只切换注册开关时不应改变隐私说明版本',
  );
  const reopenedPublicSettings = await client.json('/api/site-config');
  assert.equal(reopenedPublicSettings.body.data.registrationOpen, true);
  assert.equal(
    reopenedPublicSettings.body.data.privacyPolicy.updatedAt,
    reopenedSystemSettings.body.data.settings.privacyPolicyUpdatedAt,
  );
  const stalePrivacyRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'stale-policy@example.com',
      password: 'StalePolicyPass1',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  assert.equal(stalePrivacyRegistration.status, 409);
  assert.equal(stalePrivacyRegistration.body.error.code, 'PRIVACY_POLICY_CHANGED');
  currentPrivacyPolicyUpdatedAt = reopenedPublicSettings.body.data.privacyPolicy.updatedAt;

  const adminPlans = await client.json('/api/admin/payments/plans', { cookie: adminCookie });
  assert.equal(adminPlans.status, 200);
  const proMonthly = adminPlans.body.data.plans.find((plan) => plan.planId === 'pro-monthly');
  const updatedPlan = await client.json('/api/admin/payments/plans/pro-monthly', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      expectedUpdatedAt: proMonthly.updatedAt,
      name: proMonthly.name,
      amountCents: proMonthly.regularAmountCents,
      credits: 21,
      durationDays: proMonthly.durationDays,
      features: proMonthly.features,
      saleable: true,
      promotion: null,
    },
  });
  assert.equal(updatedPlan.status, 200);
  assert.equal(updatedPlan.body.data.plan.credits, 21);
  const publicUpdatedPlans = await client.json('/api/payments/plans');
  assert.equal(publicUpdatedPlans.body.data.plans.find((plan) => plan.planId === 'pro-monthly').credits, 21);

  const smtpPassword = 'smtp-integration-secret';
  const smtpSaved = await client.json('/api/admin/communication/smtp', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      host: '127.0.0.1',
      port: smtpPort,
      security: 'plain',
      username: 'smtp-user',
      password: smtpPassword,
      fromName: '备课星集成测试',
      fromEmail: 'noreply@example.com',
    },
  });
  assert.equal(smtpSaved.status, 200);
  assert.equal(smtpSaved.body.data.smtp.passwordConfigured, true);
  assert.equal(JSON.stringify(smtpSaved.body).includes(smtpPassword), false);
  const smtpFile = readFileSync(join(dataDir, 'smtp-config.json'), 'utf8');
  assert.equal(smtpFile.includes(smtpPassword), false, 'SMTP 密码不得明文落盘');
  assert.match(smtpFile, /aes-256-gcm/);

  const smtpPublic = await client.json('/api/admin/communication/smtp', { cookie: adminCookie });
  assert.equal(smtpPublic.status, 200);
  assert.equal(smtpPublic.body.data.smtp.passwordConfigured, true);
  assert.equal(Object.hasOwn(smtpPublic.body.data.smtp, 'encryptedPassword'), false);

  const smtpTest = await client.json('/api/admin/communication/smtp/test', {
    method: 'POST',
    cookie: adminCookie,
    body: { recipient: 'admin@example.com' },
  });
  assert.equal(smtpTest.status, 200);
  assert.equal(smtpTest.body.data.sent, true);
  assert.ok(smtpTest.body.data.smtp.testedAt);
  assert.equal(smtpMessages.length, 1);
  assert.equal(extractEmailSubject(smtpMessages[0]), '备课星集成测试站点发信验证邮件');
  assert.match(smtpMessages[0], /发信验证邮件/);
  assert.equal(smtpAuthentications.at(-1), `\0smtp-user\0${smtpPassword}`);

  const unchangedSmtp = await client.json('/api/admin/communication/smtp', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      host: '127.0.0.1', port: smtpPort, security: 'plain', username: 'smtp-user',
      fromName: '备课星集成测试', fromEmail: 'noreply@example.com',
    },
  });
  assert.ok(unchangedSmtp.body.data.smtp.testedAt, '未改动 SMTP 参数时应保留真实测试状态');
  const changedSmtp = await client.json('/api/admin/communication/smtp', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      host: '127.0.0.1', port: smtpPort, security: 'plain', username: 'smtp-user',
      fromName: '教师帮验证码', fromEmail: 'noreply@example.com',
    },
  });
  assert.equal(changedSmtp.body.data.smtp.testedAt, null, 'SMTP 参数变化后不得沿用旧的已测试状态');

  const smsSecret = 'sms-integration-secret';
  const smsSaved = await client.json('/api/admin/communication/sms', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      provider: 'aliyun',
      enabled: false,
      accessKeyId: 'integration-access-key',
      accessKeySecret: smsSecret,
      signName: '教师帮',
      templateCode: 'SMS_123456789',
    },
  });
  assert.equal(smsSaved.status, 200);
  assert.equal(smsSaved.body.data.sms.configured, true);
  assert.equal(smsSaved.body.data.sms.enabled, true);
  assert.equal(JSON.stringify(smsSaved.body).includes(smsSecret), false);
  const smsFile = readFileSync(join(dataDir, 'sms-settings.json'), 'utf8');
  assert.equal(smsFile.includes(smsSecret), false, '短信访问密钥不得明文落盘');
  assert.match(smsFile, /aes-256-gcm/);
  const smsPublic = await client.json('/api/admin/communication/sms', { cookie: adminCookie });
  assert.equal(smsPublic.status, 200);
  assert.equal(Object.hasOwn(smsPublic.body.data.sms, 'accessKeySecret'), false);
  const registrationCodeRequest = await client.json('/api/auth/verification-codes', {
    method: 'POST',
    body: { identifier: 'verified@example.com', purpose: 'register' },
  });
  assert.equal(registrationCodeRequest.status, 202);
  assert.match(registrationCodeRequest.body.data.verificationId, /^vfy_/);
  assert.equal(extractEmailSubject(smtpMessages.at(-1)), '备课星集成测试站点注册账号验证码');
  const registrationCode = extractEmailCode(smtpMessages.at(-1));
  const verifiedRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'verified@example.com',
      password: 'VerifiedPass1',
      verificationId: registrationCodeRequest.body.data.verificationId,
      verificationCode: registrationCode,
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  assert.equal(verifiedRegistration.status, 201);
  assert.equal(verifiedRegistration.body.data.user.verifiedChannel, 'email');
  assert.ok(verifiedRegistration.body.data.user.verifiedAt);
  const verifiedUserRecord = JSON.parse(readFileSync(join(dataDir, 'users.json'), 'utf8')).users
    .find((user) => user.account === 'verified@example.com');
  assert.equal(verifiedUserRecord.privacyPolicyUpdatedAt, currentPrivacyPolicyUpdatedAt);
  assert.ok(verifiedUserRecord.privacyAcceptedAt);

  const codeLoginRequest = await client.json('/api/auth/verification-codes', {
    method: 'POST',
    body: { identifier: 'verified@example.com', purpose: 'login' },
  });
  assert.equal(codeLoginRequest.status, 202);
  const loginCode = extractEmailCode(smtpMessages.at(-1));
  const codeLogin = await client.json('/api/auth/login/code', {
    method: 'POST',
    body: {
      identifier: 'verified@example.com',
      verificationId: codeLoginRequest.body.data.verificationId,
      code: loginCode,
    },
  });
  assert.equal(codeLogin.status, 200);
  const sessionBeforePasswordReset = cookiePair(codeLogin.headers.get('set-cookie'));

  const resetRequest = await client.json('/api/auth/password-reset/request', {
    method: 'POST',
    body: { identifier: 'verified@example.com' },
  });
  assert.equal(resetRequest.status, 202);
  const resetCode = extractEmailCode(smtpMessages.at(-1));
  const resetConfirm = await client.json('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: {
      identifier: 'verified@example.com',
      verificationId: resetRequest.body.data.verificationId,
      code: resetCode,
      newPassword: 'ChangedPass2',
    },
  });
  assert.equal(resetConfirm.status, 200);
  const reusedResetCode = await client.json('/api/auth/password-reset/confirm', {
    method: 'POST',
    body: {
      identifier: 'verified@example.com',
      verificationId: resetRequest.body.data.verificationId,
      code: resetCode,
      newPassword: 'AnotherPass3',
    },
  });
  assert.equal(reusedResetCode.status, 400);
  assert.equal(reusedResetCode.body.error.code, 'VERIFICATION_CODE_INVALID');
  const staleSessionAfterReset = await client.json('/api/auth/session', { cookie: sessionBeforePasswordReset });
  assert.equal(staleSessionAfterReset.status, 401, '重置密码后所有此前签发的用户会话必须失效');
  const oldPasswordLogin = await client.json('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'verified@example.com', password: 'VerifiedPass1' },
  });
  assert.equal(oldPasswordLogin.status, 401);
  const newPasswordLogin = await client.json('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'verified@example.com', password: 'ChangedPass2' },
  });
  assert.equal(newPasswordLogin.status, 200);

  const messagesBeforeUnknownReset = smtpMessages.length;
  const unknownReset = await client.json('/api/auth/password-reset/request', {
    method: 'POST',
    body: { identifier: 'missing@example.com' },
  });
  assert.equal(unknownReset.status, 202);
  assert.equal(smtpMessages.length, messagesBeforeUnknownReset, '不存在的账号不应触发发信，但响应不得暴露账号状态');

  const totpEnrollment = await client.json('/api/admin/security/mfa/totp/enroll', {
    method: 'POST',
    cookie: adminCookie,
    body: { currentPassword: adminPassword },
  });
  assert.equal(totpEnrollment.status, 201);
  const { enrollmentId, secret: totpSecret, qrCodeDataUrl, otpauthUri } = totpEnrollment.body.data.enrollment;
  assert.match(qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.match(otpauthUri, /^otpauth:\/\/totp\//);
  const enrollmentCode = generateTotpCode(totpSecret);
  const totpConfirmed = await client.json('/api/admin/security/mfa/totp/confirm', {
    method: 'POST',
    cookie: adminCookie,
    body: { enrollmentId, code: enrollmentCode },
  });
  assert.equal(totpConfirmed.status, 200);
  assert.equal(totpConfirmed.body.data.mfa.enabled, true);
  assert.equal(totpConfirmed.body.data.mfa.methods.totp.enabled, true);
  assert.equal(totpConfirmed.body.data.recoveryCodes.length, 10);
  const firstRecoveryCode = totpConfirmed.body.data.recoveryCodes[0];
  const adminAfterTotp = readFileSync(join(dataDir, 'admin.json'), 'utf8');
  assert.equal(adminAfterTotp.includes(totpSecret), false, 'TOTP 密钥不得明文落盘');
  assert.equal(adminAfterTotp.includes(firstRecoveryCode), false, '恢复码不得明文落盘');
  assert.match(adminAfterTotp, /aes-256-gcm/);

  const passwordStage = await client.json('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword },
  });
  assert.equal(passwordStage.status, 202);
  assert.equal(passwordStage.body.data.mfaRequired, true);
  assert.equal(passwordStage.body.data.challenge.channel, 'totp');
  assert.match(passwordStage.headers.get('set-cookie'), /Max-Age=0/);
  const totpLoginChallenge = passwordStage.body.data.challenge.id;
  const nextTotpCode = generateTotpCode(totpSecret, { timestamp: Date.now() + 30_000 });
  const invalidTotpCode = `${nextTotpCode.slice(0, -1)}${(Number(nextTotpCode.at(-1)) + 1) % 10}`;
  const invalidTotp = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: { challengeId: totpLoginChallenge, code: invalidTotpCode },
  });
  assert.equal(invalidTotp.status, 401);
  assert.equal(invalidTotp.body.error.code, 'MFA_CODE_INVALID');
  const totpLogin = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: { challengeId: totpLoginChallenge, code: nextTotpCode },
  });
  assert.equal(totpLogin.status, 200);
  const mfaAdminCookie = cookiePair(totpLogin.headers.get('set-cookie'));
  assert.match(totpLogin.headers.get('set-cookie'), /HttpOnly/);
  const challengeReplay = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: { challengeId: totpLoginChallenge, code: nextTotpCode },
  });
  assert.equal(challengeReplay.status, 409);
  assert.equal(challengeReplay.body.error.code, 'MFA_CHALLENGE_USED');

  const replayPasswordStage = await client.json('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword },
  });
  const replayChallengeId = replayPasswordStage.body.data.challenge.id;
  const totpReplay = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: { challengeId: replayChallengeId, code: nextTotpCode },
  });
  assert.equal(totpReplay.status, 401, '同一 TOTP 时间步不得重复使用');
  const recoveryLogin = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: { challengeId: replayChallengeId, code: firstRecoveryCode },
  });
  assert.equal(recoveryLogin.status, 200);
  const recoveryPasswordStage = await client.json('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword },
  });
  const recoveryReplay = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: { challengeId: recoveryPasswordStage.body.data.challenge.id, code: firstRecoveryCode },
  });
  assert.equal(recoveryReplay.status, 401, '恢复码只能使用一次');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const repeatedInvalid = await client.json('/api/admin/mfa/verify', {
      method: 'POST',
      body: { challengeId: recoveryPasswordStage.body.data.challenge.id, code: firstRecoveryCode },
    });
    assert.equal(repeatedInvalid.status, 401);
  }
  const lockedChallenge = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: { challengeId: recoveryPasswordStage.body.data.challenge.id, code: firstRecoveryCode },
  });
  assert.equal(lockedChallenge.status, 429);
  assert.equal(lockedChallenge.body.error.code, 'MFA_CHALLENGE_LOCKED');

  const emailEnrollment = await client.json('/api/admin/security/mfa/email/enroll', {
    method: 'POST',
    cookie: mfaAdminCookie,
    body: { currentPassword: adminPassword, email: 'security@example.com' },
  });
  assert.equal(emailEnrollment.status, 201);
  assert.equal(emailEnrollment.body.data.enrollment.channel, 'email');
  const emailEnrollmentCode = extractEmailCode(smtpMessages.at(-1));
  const emailConfirmed = await client.json('/api/admin/security/mfa/email/confirm', {
    method: 'POST',
    cookie: mfaAdminCookie,
    body: { enrollmentId: emailEnrollment.body.data.enrollment.id, code: emailEnrollmentCode },
  });
  assert.equal(emailConfirmed.status, 200);
  assert.equal(emailConfirmed.body.data.mfa.methods.email.enabled, true);
  assert.equal(emailConfirmed.body.data.mfa.methods.email.destination, 'se******@example.com');

  const preferredEmail = await client.json('/api/admin/security/mfa/preferred', {
    method: 'POST',
    cookie: mfaAdminCookie,
    body: { method: 'email' },
  });
  assert.equal(preferredEmail.status, 200);
  assert.equal(preferredEmail.body.data.mfa.preferredMethod, 'email');
  const emailPasswordStage = await client.json('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword },
  });
  assert.equal(emailPasswordStage.status, 202);
  assert.equal(emailPasswordStage.body.data.challenge.channel, 'email');
  assert.equal(emailPasswordStage.body.data.challenge.destination, 'se******@example.com');
  const emailLoginCode = extractEmailCode(smtpMessages.at(-1));
  const emailLogin = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: { challengeId: emailPasswordStage.body.data.challenge.id, code: emailLoginCode },
  });
  assert.equal(emailLogin.status, 200);
  const emailAdminCookie = cookiePair(emailLogin.headers.get('set-cookie'));
  const emailReplay = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: { challengeId: emailPasswordStage.body.data.challenge.id, code: emailLoginCode },
  });
  assert.equal(emailReplay.status, 409);

  const settingsEmailCode = await client.json('/api/admin/security/mfa/email/code', {
    method: 'POST',
    cookie: emailAdminCookie,
    body: { currentPassword: adminPassword },
  });
  assert.equal(settingsEmailCode.status, 201);
  const disableEmailCode = extractEmailCode(smtpMessages.at(-1));
  const emailDisabled = await client.json('/api/admin/security/mfa/disable', {
    method: 'POST',
    cookie: emailAdminCookie,
    body: {
      currentPassword: adminPassword,
      method: 'email',
      challengeId: settingsEmailCode.body.data.challenge.id,
      code: disableEmailCode,
    },
  });
  assert.equal(emailDisabled.status, 200);
  assert.equal(emailDisabled.body.data.mfa.methods.email.enabled, false);
  assert.equal(emailDisabled.body.data.mfa.methods.totp.enabled, true);

  const regeneratedRecovery = await client.json('/api/admin/security/mfa/recovery/regenerate', {
    method: 'POST',
    cookie: emailAdminCookie,
    body: { currentPassword: adminPassword, code: totpConfirmed.body.data.recoveryCodes[1] },
  });
  assert.equal(regeneratedRecovery.status, 200);
  assert.equal(regeneratedRecovery.body.data.recoveryCodes.length, 10);
  const mfaDisabled = await client.json('/api/admin/security/mfa/disable', {
    method: 'POST',
    cookie: emailAdminCookie,
    body: {
      currentPassword: adminPassword,
      method: 'all',
      code: regeneratedRecovery.body.data.recoveryCodes[0],
    },
  });
  assert.equal(mfaDisabled.status, 200);
  assert.equal(mfaDisabled.body.data.mfa.enabled, false);
  const passwordOnlyAgain = await client.json('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword },
  });
  assert.equal(passwordOnlyAgain.status, 200, '关闭二次验证后账号密码应直接登录');

  const providerDenied = await client.json('/api/admin/providers');
  assert.equal(providerDenied.status, 401);
  assert.equal(providerDenied.body.error.code, 'ADMIN_AUTH_REQUIRED');

  const configuredProviders = await client.json('/api/admin/providers', { cookie: adminCookie });
  assert.equal(configuredProviders.status, 200);
  const environmentProvider = configuredProviders.body.data.providers.find((provider) => provider.id === 'environment-fallback');
  assert.equal(environmentProvider.readonly, true);
  assert.deepEqual(environmentProvider.capabilities, ['lesson_generation', 'lesson_revision', 'multimodal_input']);
  assert.equal(environmentProvider.apiKeyMasked.startsWith('••••'), true);
  assert.equal(JSON.stringify(environmentProvider).includes('integration-environment-key'), false);
  const environmentProviderTest = await client.json('/api/admin/providers/environment-fallback/test', {
    method: 'POST',
    cookie: adminCookie,
    body: {},
  });
  assert.equal(environmentProviderTest.status, 200);
  assert.equal(environmentProviderTest.body.data.result.modelAvailable, true);

  const providerKey = 'integration-provider-key';
  const providerCreated = await client.json('/api/admin/providers', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: '本地模拟通道',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: providerKey,
      model: 'stored-provider-model',
      capabilities: ['lesson_generation', 'lesson_revision', 'multimodal_input'],
      priority: 1,
    },
  });
  assert.equal(providerCreated.status, 201);
  assert.equal(providerCreated.body.data.provider.keyLastFour, '-key');
  assert.deepEqual(providerCreated.body.data.provider.capabilities, ['lesson_generation', 'lesson_revision', 'multimodal_input']);
  assert.equal(JSON.stringify(providerCreated.body).includes(providerKey), false);
  const providerId = providerCreated.body.data.provider.id;
  const channelFile = readFileSync(join(dataDir, 'model-channels.json'), 'utf8');
  assert.equal(channelFile.includes(providerKey), false, '模型密钥不得明文落盘');
  assert.match(channelFile, /aes-256-gcm/);

  const secondGeneration = await client.json('/api/ai/generate', {
    method: 'POST',
    cookie: userCookie,
    body: generationBody('使用存储通道'),
  });
  assert.equal(secondGeneration.status, 200);
  assert.equal(secondGeneration.body.data.providerId, providerId);
  assert.equal(secondGeneration.body.data.creditsRemaining, 1);
  assert.equal(upstreamRequests.at(-1).model, 'stored-provider-model');
  assert.equal(upstreamRequests.at(-1).authorization, `Bearer ${providerKey}`);

  const candidateCreated = await client.json('/api/training/candidates', {
    method: 'POST',
    cookie: userCookie,
    body: {
      lessonPlan: secondGeneration.body.data.lessonPlan,
      rightsConfirmed: true,
    },
  });
  assert.equal(candidateCreated.status, 201);
  assert.equal(candidateCreated.body.data.candidate.status, 'pending_review');
  assert.equal(candidateCreated.body.data.existing, false);
  assert.equal(candidateCreated.body.data.onlineTrainingTriggered, false);
  const duplicateCandidate = await client.json('/api/training/candidates', {
    method: 'POST',
    cookie: userCookie,
    body: {
      lessonPlan: secondGeneration.body.data.lessonPlan,
      rightsConfirmed: true,
    },
  });
  assert.equal(duplicateCandidate.status, 200);
  assert.equal(duplicateCandidate.body.data.existing, true);
  assert.equal(duplicateCandidate.body.data.candidate.sampleId, candidateCreated.body.data.candidate.sampleId);
  const candidateFile = readFileSync(join(dataDir, 'training-candidates.json'), 'utf8');
  assert.equal(candidateFile.includes('teacher@example.com'), false, '候选文件不得保存用户直接标识符');
  const storedCandidate = JSON.parse(candidateFile).candidates[0];
  assert.equal(storedCandidate.sample.schemaVersion, 'training-sample.v1');
  assert.equal(storedCandidate.sample.candidateStatus, 'pending');
  assert.equal(storedCandidate.sample.eligibility.eligible, false);
  const schemaErrors = validateSchema(storedCandidate.sample, trainingSchema, trainingSchema, '$');
  assert.deepEqual(schemaErrors, [], `训练候选不符合 shared schema：${schemaErrors.join('；')}`);

  const trainingStats = await client.json('/api/admin/training/stats', { cookie: adminCookie });
  assert.equal(trainingStats.status, 200);
  assert.deepEqual(trainingStats.body.data.summary, {
    total: 1,
    pendingReview: 1,
    approved: 0,
    rejected: 0,
    revoked: 0,
  });
  const trainingList = await client.json('/api/admin/training/candidates?limit=10&offset=0', { cookie: adminCookie });
  assert.equal(trainingList.body.data.items.length, 1);
  assert.equal(trainingList.body.data.items[0].status, 'pending_review');

  const secondRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'second@example.com',
      password: 'SecondPass1',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  const secondCookie = cookiePair(secondRegistration.headers.get('set-cookie'));
  const slowRevision = client.json('/api/ai/revise', {
    method: 'POST',
    cookie: secondCookie,
    body: { lessonPlan: secondGeneration.body.data.lessonPlan, feedback: 'DELAY_FOR_CONCURRENCY_TEST' },
  });
  await delay(50);
  const busyRevision = await client.json('/api/ai/revise', {
    method: 'POST',
    cookie: secondCookie,
    body: { lessonPlan: secondGeneration.body.data.lessonPlan, feedback: '并发请求' },
  });
  assert.equal(busyRevision.status, 503);
  assert.equal(busyRevision.body.error.code, 'AI_BUSY');
  assert.equal((await slowRevision).status, 200);

  const thirdRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'third@example.com',
      password: 'ThirdPass1',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  const thirdCookie = cookiePair(thirdRegistration.headers.get('set-cookie'));
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const revision = await client.json('/api/ai/revise', {
      method: 'POST',
      cookie: thirdCookie,
      body: { lessonPlan: secondGeneration.body.data.lessonPlan, feedback: `限流测试 ${attempt}` },
    });
    assert.equal(revision.status, 200);
  }
  const rateLimited = await client.json('/api/ai/revise', {
    method: 'POST',
    cookie: thirdCookie,
    body: { lessonPlan: secondGeneration.body.data.lessonPlan, feedback: '超过限流' },
  });
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.body.error.code, 'AI_USER_RATE_LIMITED');
  assert.ok(rateLimited.body.error.details.retryAfterSeconds >= 1);

  const providerDisabled = await client.json(`/api/admin/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { enabled: false },
  });
  assert.equal(providerDisabled.status, 200);
  assert.equal(providerDisabled.body.data.provider.enabled, false);

  const logout = await client.json('/api/auth/logout', { method: 'POST', cookie: userCookie, body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

  console.log(JSON.stringify({
    ok: true,
    checks: {
      authAndSignedCookies: true,
      aiRequiresLogin: true,
      successOnlyQuotaDeduction: true,
      encryptedProviderRouting: true,
      globalConcurrency: true,
      perUserAndIpRateLimit: true,
      consentGatedPendingTrainingCandidate: true,
      firstRunAdminInitialization: true,
      lessonKnowledgePaperWorkflow: true,
      adminMfaAndEncryptedSmtp: true,
      encryptedSmsConfiguration: true,
      userVerificationLoginAndPasswordReset: true,
      verificationEnumerationAndSingleUseProtection: true,
      adminStatsAndList: true,
      authoritativeMembershipCatalog: true,
      adminTeacherSessionIsolation: true,
      secureAdminUserManagement: true,
      systemSettingsRegistrationAndPrivacyVersioning: true,
      verificationEmailSubject: true,
    },
  }));
} finally {
  firstRunProcess?.kill();
  appProcess?.kill();
  mockUpstream.close();
  mockSmtp.close();
  await delay(100);
  rmSync(firstRunDataDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
}

function generationBody(requirements) {
  return {
    subject: '语文',
    grade: '七年级',
    chapterTitle: '测试章节',
    durationMinutes: 45,
    sourceText: '这是一段用于集成测试的章节文字。',
    requirements,
  };
}

function extractEmailCode(message) {
  const code = String(message || '').match(/验证码是：(\d{6})/)?.[1];
  assert.match(code || '', /^\d{6}$/, '测试邮件中应包含 6 位验证码');
  return code;
}

function extractEmailSubject(message) {
  const header = String(message || '').match(/^Subject:\s*(.+)$/mi)?.[1]?.trim() || '';
  const encoded = header.match(/^=\?UTF-8\?B\?([^?]+)\?=$/i);
  return encoded ? Buffer.from(encoded[1], 'base64').toString('utf8') : header;
}

function createClient(port) {
  return {
    async text(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (options.cookie) headers.Cookie = options.cookie;
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: options.method || 'GET',
        headers,
      });
      return { status: response.status, headers: response.headers, body: await response.text() };
    },
    async json(path, options = {}) {
      const headers = {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      };
      if (options.cookie) headers.Cookie = options.cookie;
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
      const body = await response.json().catch(() => ({}));
      return { status: response.status, headers: response.headers, body };
    },
  };
}

function cookiePair(setCookie) {
  assert.ok(setCookie, '响应缺少 Set-Cookie');
  return setCookie.split(';', 1)[0];
}

async function runProcess(args, { env, input }) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  child.stdin.end(input);
  const code = await new Promise((resolve) => child.on('exit', resolve));
  if (code !== 0) throw new Error(`子进程退出码 ${code}: ${output}`);
}

async function waitForHealth(port, getLog) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {
      // Continue until the bounded deadline.
    }
    await delay(100);
  }
  throw new Error(`应用未就绪：${getLog()}`);
}

async function reservePort() {
  const server = createServer();
  const port = await listenOnRandomPort(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function listenOnRandomPort(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

function buildLessonPlan(schema) {
  const plan = materialize(schema, schema);
  plan.metadata.durationMinutes = 45;
  plan.timeline[0].startMinute = 0;
  plan.timeline[0].durationMinutes = 45;
  plan.generationMeta.generatedBy = 'ai';
  plan.generationMeta.promptVersion = 'lesson-plan.v1';
  plan.generationMeta.modelRouteId = 'integration';
  plan.generationMeta.generatedAt = new Date(0).toISOString();
  return plan;
}

function materialize(node, rootSchema) {
  if (node.$ref) {
    const name = node.$ref.split('/').at(-1);
    return materialize(rootSchema.$defs[name], rootSchema);
  }
  if (node.const !== undefined) return structuredClone(node.const);
  if (node.enum?.length) return structuredClone(node.enum[0]);
  const type = Array.isArray(node.type) ? node.type.find((item) => item !== 'null') : node.type;
  if (type === 'object') {
    return Object.fromEntries(Object.entries(node.properties || {}).map(([key, child]) => [key, materialize(child, rootSchema)]));
  }
  if (type === 'array') {
    const count = Math.max(Number(node.minItems || 0), 0);
    return Array.from({ length: count }, () => materialize(node.items || {}, rootSchema));
  }
  if (type === 'integer' || type === 'number') return Number(node.minimum ?? 1);
  if (type === 'boolean') return false;
  return '测试内容';
}

function validateSchema(value, schema, rootSchema, path, errors = []) {
  if (!schema || typeof schema !== 'object') return errors;
  if (schema.$ref) {
    const target = schema.$ref.startsWith('#/$defs/')
      ? rootSchema.$defs[schema.$ref.split('/').at(-1)]
      : schema.$ref.startsWith('lesson-plan.schema.json')
        ? lessonSchema
        : null;
    if (!target) errors.push(`${path}: 无法解析引用 ${schema.$ref}`);
    else validateSchema(value, target, schema.$ref.startsWith('lesson-plan') ? lessonSchema : rootSchema, path, errors);
    return errors;
  }
  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) errors.push(`${path}: const 不匹配`);
  if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) errors.push(`${path}: enum 不匹配`);

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => matchesType(value, type))) {
    errors.push(`${path}: 类型不匹配`);
    return errors;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) errors.push(`${path}.${required}: 缺少必填字段`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) errors.push(`${path}.${key}: 额外字段`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validateSchema(value[key], childSchema, rootSchema, `${path}.${key}`, errors);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: 数组过短`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: 数组过长`);
    value.forEach((item, index) => validateSchema(item, schema.items || {}, rootSchema, `${path}[${index}]`, errors));
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: 字符串过短`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: 字符串过长`);
    if (schema.pattern && !(new RegExp(schema.pattern)).test(value)) errors.push(`${path}: pattern 不匹配`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: 小于 minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: 大于 maximum`);
  }
  for (const condition of schema.allOf || []) {
    const conditionErrors = validateSchema(value, condition.if || {}, rootSchema, path, []);
    if (conditionErrors.length === 0 && condition.then) validateSchema(value, condition.then, rootSchema, path, errors);
    if (conditionErrors.length > 0 && condition.else) validateSchema(value, condition.else, rootSchema, path, errors);
  }
  return errors;
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
}
