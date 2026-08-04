import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createAdminMfaCoordinator, generateTotpCode } from './admin-mfa.mjs';
import { hashPassword, verifyPassword } from './security.mjs';

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
const transientProbeModels = new Set();
const echoAuthorizationModels = new Set();
const targetedRevisionAttempts = new Map();
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
    upstreamRequests.push({ authorization: request.headers.authorization, model: 'models-list', safetyIdentifier: null, endpoint: 'models' });
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'environment-test-model' }, { id: 'deepseek-v4-pro' }] }));
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const isChatCompletions = request.url?.endsWith('/chat/completions');
  const userContent = isChatCompletions
    ? body.messages?.filter((item) => item.role === 'user').at(-1)?.content
    : body.input?.[0]?.content;
  const inputText = Array.isArray(userContent)
    ? userContent.find((item) => ['text', 'input_text'].includes(item.type))?.text || ''
    : typeof userContent === 'string' ? userContent : typeof body.input === 'string' ? body.input : '';
  const inputKinds = Array.isArray(userContent) ? userContent.map((item) => item.type) : ['text'];
  const clientRequestId = String(request.headers['x-client-request-id'] || '');
  const targetedAttempt = inputText.includes('[TARGETED_LESSON_REVISION]')
    ? (targetedRevisionAttempts.get(clientRequestId) || 0) + 1
    : 0;
  if (targetedAttempt) targetedRevisionAttempts.set(clientRequestId, targetedAttempt);
  upstreamRequests.push({
    authorization: request.headers.authorization,
    model: body.model,
    safetyIdentifier: body.safety_identifier,
    endpoint: isChatCompletions ? 'chat/completions' : 'responses',
    thinking: body.thinking?.type || null,
    inputKinds,
    responseFormat: body.response_format?.type || body.text?.format?.type || null,
    strictSchema: body.text?.format?.strict === true,
    reasoningEffort: body.reasoning?.effort || null,
    hasInstructions: typeof body.instructions === 'string',
    targetedRevision: inputText.includes('[TARGETED_LESSON_REVISION]'),
    targetedStandardFields: body.text?.format?.schema?.properties?.standardPatch?.required || null,
    targetedRepair: inputText.includes('[TARGETED_LESSON_REVISION_REPAIR]'),
    targetedAttempt,
    clientRequestId,
  });

  if (transientProbeModels.has(body.model)) {
    response.writeHead(429, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'rate_limited', message: '模拟瞬时限流' } }));
    return;
  }
  if (echoAuthorizationModels.has(body.model)) {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'credential_echo', message: `模拟回显 ${request.headers.authorization}` } }));
    return;
  }

  if (body.model === 'deepseek-v4-pro' && inputKinds.some((kind) => ['image_url', 'file', 'input_image', 'input_file'].includes(kind))) {
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'unsupported_input', message: '该模拟模型仅支持文字输入' } }));
    return;
  }

  if (inputText.includes('FORCE_UPSTREAM_ERROR')) {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: { code: 'mock_failure', message: '模拟上游失败' } }));
    return;
  }
  if (inputText.includes('DELAY_FOR_CONCURRENCY_TEST')) await delay(350);
  if (inputText.includes('DELAY_HEADERS_WITHIN_CONFIGURED_TIMEOUT')) await delay(500);
  if (inputText.includes('DELAY_EACH_TARGETED_ATTEMPT')) await delay(500);

  const requestedDuration = Number(inputText.match(/课时：(\d+) 分钟/)?.[1]) || 45;
  const lessonPlan = structuredClone(baseLessonPlan);
  lessonPlan.metadata.durationMinutes = requestedDuration;
  lessonPlan.timeline[0].durationMinutes = requestedDuration;
  lessonPlan.generationMeta.modelRouteId = body.model;
  const capabilityProbeText = inputText.includes('唯一一行') && inputKinds.some((kind) => ['image_url', 'input_image'].includes(kind))
    ? 'BKX7319'
    : inputText.includes('唯一一行') && inputKinds.some((kind) => ['file', 'input_file'].includes(kind))
      ? 'BKX-PROBE'
      : inputText.includes('"ok"') ? '{"ok":"OK"}' : null;
  const customSectionsMatch = inputText.match(/待处理大类：\n([\s\S]*?)\n\n现有教案（仅供上下文参考）：/);
  const requestedCustomSections = inputText.includes('[CUSTOM_SECTION_REVISION]') && customSectionsMatch
    ? JSON.parse(customSectionsMatch[1])
    : null;
  const targetedFieldsMatch = inputText.match(/允许返回的标准字段：(\[[^\n]*\])/);
  const targetedCustomMatch = inputText.match(/选中的自定义模块：(\[[^\n]*\])/);
  const targetedRevisionFields = inputText.includes('[TARGETED_LESSON_REVISION]') && targetedFieldsMatch
    ? JSON.parse(targetedFieldsMatch[1])
    : null;
  const targetedCustomSections = targetedRevisionFields && targetedCustomMatch
    ? JSON.parse(targetedCustomMatch[1])
    : [];
  const targetedStandardPatch = targetedRevisionFields
    ? Object.fromEntries(targetedRevisionFields.map((field) => {
        if (field === 'metadata') return [field, { classProfile: '已按教师要求定向修改班级学情。' }];
        const value = structuredClone(lessonPlan[field]);
        if (field === 'sourceSummary') return [field, '已按教师要求定向修改章节概述。'];
        return [field, value];
      }))
    : null;
  const forceInvalidTargetedOutput = targetedRevisionFields && (
    inputText.includes('FORCE_TARGETED_INVALID_ALWAYS')
    || (inputText.includes('FORCE_TARGETED_INVALID_ONCE') && targetedAttempt === 1)
  );
  if (forceInvalidTargetedOutput) targetedStandardPatch.unexpectedField = '不允许返回的字段';
  let modelOutput = targetedRevisionFields
    ? JSON.stringify({
        standardPatch: targetedStandardPatch,
        customSections: targetedCustomSections.map((section) => ({
          id: section.id,
          title: section.title,
          content: `已按教师要求定向修改“${section.title}”的中文教学内容。`,
        })),
      })
    : requestedCustomSections
    ? JSON.stringify({
        sections: requestedCustomSections.map((section) => ({
          id: section.id,
          title: section.title,
          content: `已按教师要求完整修改“${section.title}”的中文教学内容。`,
        })),
      })
    : capabilityProbeText || JSON.stringify(lessonPlan);
  if (targetedRevisionFields && inputText.includes('RETURN_DOUBLE_ENCODED_JSON')) {
    modelOutput = JSON.stringify(modelOutput);
  } else if (targetedRevisionFields && inputText.includes('RETURN_FENCED_JSON')) {
    modelOutput = `模型说明前缀\n\`\`\`json\n${modelOutput}\n\`\`\`\n模型说明后缀`;
  } else if (targetedRevisionFields && inputText.includes('RETURN_BALANCED_JSON')) {
    modelOutput = `模型说明前缀 ${modelOutput} 模型说明后缀`;
  }
  const responseBody = isChatCompletions
    ? {
        id: `chatcmpl_${upstreamRequests.length}`,
        model: body.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: modelOutput },
          finish_reason: inputText.includes('FORCE_CHAT_LENGTH')
            ? 'length'
            : inputText.includes('FORCE_CHAT_CONTENT_FILTER') ? 'content_filter' : 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }
    : {
        id: `resp_${upstreamRequests.length}`,
        status: 'completed',
        model: body.model,
        output: [{ type: 'message', content: [{ type: 'output_text', text: modelOutput }] }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      };
  response.writeHead(200, { 'Content-Type': 'application/json' });
  if (inputText.includes('DELAY_BODY_AFTER_HEADERS')) {
    response.flushHeaders();
    await delay(1_200);
    if (!response.destroyed && !response.writableEnded) response.end(JSON.stringify(responseBody));
    return;
  }
  response.end(JSON.stringify(responseBody));
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
    AI_RATE_LIMIT_USER_MAX: '5',
    AI_RATE_LIMIT_IP_MAX: '100',
    AI_MAX_CONCURRENCY: '1',
    AI_REQUEST_TIMEOUT_MS: '750',
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

  const legacyAdminShadowPassword = 'legacy-shadow-password';
  const legacyAdminShadowCreatedAt = new Date().toISOString();
  writeFileSync(join(dataDir, 'users.json'), `${JSON.stringify({
    version: 1,
    users: [{
      id: 'usr_legacy_admin_teacher',
      account: 'admin',
      accountKey: 'admin',
      displayName: '平台管理员',
      subject: '',
      password: hashPassword(legacyAdminShadowPassword),
      credits: 3,
      generationCount: 0,
      verifiedAt: legacyAdminShadowCreatedAt,
      verifiedChannel: 'admin_credentials',
      createdAt: legacyAdminShadowCreatedAt,
      updatedAt: legacyAdminShadowCreatedAt,
    }],
  }, null, 2)}\n`, 'utf8');

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
  const reservedAdminRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'admin',
      password: 'ReservedAdmin1',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  assert.equal(reservedAdminRegistration.status, 409, '管理员标识必须在教师端注册系统中预留');
  assert.equal(reservedAdminRegistration.body.error.code, 'ACCOUNT_EXISTS');
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
  const unauthenticatedCustomSectionRevision = await client.json('/api/ai/revise-custom-sections', {
    method: 'POST',
    body: {
      lessonPlan: baseLessonPlan,
      sections: [{ id: 'custom_1', title: '拓展阅读', content: '' }],
      instruction: '生成详细内容',
    },
  });
  assert.equal(unauthenticatedCustomSectionRevision.status, 401);
  assert.equal(unauthenticatedCustomSectionRevision.body.error.code, 'AUTH_REQUIRED');
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
  assert.equal(adminLogin.body.data.admin.username, 'admin');
  const adminCookie = cookiePair(adminLogin.headers.get('set-cookie'));

  const staleAdminTeacherLogin = await client.json('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'admin', password: legacyAdminShadowPassword },
  });
  assert.equal(staleAdminTeacherLogin.status, 401, '前台不得信任陈旧的管理员教师镜像密码');
  assert.equal(staleAdminTeacherLogin.body.error.code, 'INVALID_CREDENTIALS');

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
  assert.equal(adminTeacherLogin.body.data.user.displayName, 'admin');
  assert.equal(Object.hasOwn(adminTeacherLogin.body.data.user, 'role'), false);
  const synchronizedAdminTeacher = JSON.parse(readFileSync(join(dataDir, 'users.json'), 'utf8')).users
    .find((user) => user.accountKey === 'admin');
  assert.equal(synchronizedAdminTeacher.role, 'admin_teacher');
  assert.equal(synchronizedAdminTeacher.verifiedChannel, 'admin_credentials');
  assert.equal(verifyPassword(adminPassword, synchronizedAdminTeacher.password), true);
  assert.equal(verifyPassword(legacyAdminShadowPassword, synchronizedAdminTeacher.password), false);
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

  const unauthenticatedCreditResets = await client.json('/api/admin/credit-resets');
  assert.equal(unauthenticatedCreditResets.status, 401);
  assert.equal(unauthenticatedCreditResets.body.error.code, 'ADMIN_AUTH_REQUIRED');
  const creditResetUserId = searchedAdminUsers.body.data.items[0].id;
  const originalCreditBalance = searchedAdminUsers.body.data.items[0].credits;
  const immediateCreditReset = await client.json('/api/admin/credit-resets', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      userIds: [creditResetUserId],
      credits: 7,
      reason: '集成测试立即重置',
      executeAt: new Date(Date.now() - 1_000).toISOString(),
      idempotencyKey: 'integration-credit-reset-immediate-0001',
    },
  });
  assert.equal(immediateCreditReset.status, 201);
  assert.equal(immediateCreditReset.body.data.job.status, 'completed');
  assert.equal(immediateCreditReset.body.data.job.result.updatedCount, 1);
  const userAfterCreditReset = await client.json('/api/admin/users?query=teacher%40example.com&offset=0&limit=20', {
    cookie: adminCookie,
  });
  assert.equal(userAfterCreditReset.body.data.items[0].credits, 7);

  const restoredCreditBalance = await client.json('/api/admin/credit-resets', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      userIds: [creditResetUserId],
      credits: originalCreditBalance,
      reason: '集成测试恢复额度',
      executeAt: new Date(Date.now() - 1_000).toISOString(),
      idempotencyKey: 'integration-credit-reset-restore-0001',
    },
  });
  assert.equal(restoredCreditBalance.status, 201);
  assert.equal(restoredCreditBalance.body.data.job.status, 'completed');

  const scheduledCreditReset = await client.json('/api/admin/credit-resets', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      userIds: [creditResetUserId],
      credits: 30,
      reason: '集成测试定时重置',
      executeAt: '2099-09-10T00:00:00.000Z',
      idempotencyKey: 'integration-credit-reset-scheduled-0001',
    },
  });
  assert.equal(scheduledCreditReset.status, 201);
  assert.equal(scheduledCreditReset.body.data.job.status, 'pending');
  const cancelledCreditReset = await client.json(`/api/admin/credit-resets/${scheduledCreditReset.body.data.job.id}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(cancelledCreditReset.status, 200);
  assert.equal(cancelledCreditReset.body.data.job.status, 'cancelled');
  const creditResetList = await client.json('/api/admin/credit-resets', { cookie: adminCookie });
  assert.equal(creditResetList.status, 200);
  assert.equal(creditResetList.body.data.jobs.some((job) => job.id === immediateCreditReset.body.data.job.id && job.status === 'completed'), true);
  assert.equal(creditResetList.body.data.jobs.some((job) => job.id === scheduledCreditReset.body.data.job.id && job.status === 'cancelled'), true);

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
  assert.match(brandedHomePage.body, /<meta name="teacher-helper-site-config" content="/);
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

  const asyncJobRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'async-job@example.com',
      password: 'AsyncJobPass1',
      displayName: '异步任务测试教师',
      subject: '语文',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  assert.equal(asyncJobRegistration.status, 201);
  const asyncJobCookie = cookiePair(asyncJobRegistration.headers.get('set-cookie'));

  const missingIdempotencyKey = await client.json('/api/ai/generation-jobs', {
    method: 'POST',
    cookie: asyncJobCookie,
    body: generationBody('异步生成缺少幂等键'),
  });
  assert.equal(missingIdempotencyKey.status, 400);
  assert.equal(missingIdempotencyKey.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

  const inlineSourceRejected = await client.json('/api/ai/generation-jobs', {
    method: 'POST',
    cookie: asyncJobCookie,
    headers: { 'Idempotency-Key': 'async-inline-source-0001' },
    body: {
      ...generationBody('异步接口不允许内联教材'),
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII='],
    },
  });
  assert.equal(inlineSourceRejected.status, 400);
  assert.equal(inlineSourceRejected.body.error.code, 'ASYNC_INLINE_SOURCES_UNSUPPORTED');

  const asyncMaterialUpload = await client.json('/api/app/material-uploads', {
    method: 'POST',
    cookie: asyncJobCookie,
    body: {
      name: 'async-material.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=',
    },
  });
  assert.equal(asyncMaterialUpload.status, 201);
  const asyncAttachmentId = asyncMaterialUpload.body.data.attachment.id;

  const successfulJobBody = {
    ...generationBody('异步生成正常完成'),
    attachmentIds: [asyncAttachmentId],
  };
  const successfulJobCreated = await client.json('/api/ai/generation-jobs', {
    method: 'POST',
    cookie: asyncJobCookie,
    headers: { 'Idempotency-Key': 'async-success-request-0001' },
    body: successfulJobBody,
  });
  assert.equal(successfulJobCreated.status, 202);
  assert.equal(successfulJobCreated.body.data.job.status, 'queued');
  assert.equal(successfulJobCreated.body.data.job.pollAfterMs, 1_000);
  assert.match(successfulJobCreated.body.data.job.id, /^gen_[0-9a-f-]{36}$/);
  for (const privateField of ['userId', 'idempotencyKey', 'requestHash', 'input', 'normalized', 'reservation', 'attachmentIds']) {
    assert.equal(Object.hasOwn(successfulJobCreated.body.data.job, privateField), false, `生成任务不得公开 ${privateField}`);
  }
  const successfulJobId = successfulJobCreated.body.data.job.id;

  const successfulJobReplay = await client.json('/api/ai/generation-jobs', {
    method: 'POST',
    cookie: asyncJobCookie,
    headers: { 'Idempotency-Key': 'async-success-request-0001' },
    body: { ...successfulJobBody },
  });
  assert.equal(successfulJobReplay.status, 202);
  assert.equal(successfulJobReplay.body.data.job.id, successfulJobId, '相同用户和幂等键必须重放原任务');

  const successfulJobConflict = await client.json('/api/ai/generation-jobs', {
    method: 'POST',
    cookie: asyncJobCookie,
    headers: { 'Idempotency-Key': 'async-success-request-0001' },
    body: generationBody('同一幂等键但参数不同'),
  });
  assert.equal(successfulJobConflict.status, 409);
  assert.equal(successfulJobConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const hiddenFromOtherUser = await client.json(`/api/ai/generation-jobs/${successfulJobId}`, {
    cookie: userCookie,
  });
  assert.equal(hiddenFromOtherUser.status, 404);
  assert.equal(hiddenFromOtherUser.body.error.code, 'GENERATION_JOB_NOT_FOUND');

  const successfulJob = await waitForGenerationJob(client, asyncJobCookie, successfulJobId);
  assert.equal(successfulJob.status, 'completed');
  assert.equal(successfulJob.pollAfterMs, 0);
  assert.equal(successfulJob.data.creditsRemaining, 2);
  assert.equal(successfulJob.data.providerId, 'environment-fallback');
  assert.equal(successfulJob.data.lessonPlan.schemaVersion, 'lesson-plan.v1');
  const removedAsyncMaterial = await client.json(`/api/app/material-uploads/${encodeURIComponent(asyncAttachmentId)}`, {
    cookie: asyncJobCookie,
  });
  assert.equal(removedAsyncMaterial.status, 404, '异步生成成功后应删除教材暂存附件');
  const completedJobReplay = await client.json('/api/ai/generation-jobs', {
    method: 'POST',
    cookie: asyncJobCookie,
    headers: { 'Idempotency-Key': 'async-success-request-0001' },
    body: successfulJobBody,
  });
  assert.equal(completedJobReplay.status, 202);
  assert.equal(completedJobReplay.body.data.job.id, successfulJobId, '附件清理后仍应重放已完成的幂等任务');
  assert.equal(completedJobReplay.body.data.job.status, 'completed');

  const delayedHeadersStartedAt = Date.now();
  const delayedHeadersJobCreated = await client.json('/api/ai/generation-jobs', {
    method: 'POST',
    cookie: asyncJobCookie,
    headers: { 'Idempotency-Key': 'async-delayed-headers-0001' },
    body: generationBody('DELAY_HEADERS_WITHIN_CONFIGURED_TIMEOUT'),
  });
  assert.equal(delayedHeadersJobCreated.status, 202);
  const delayedHeadersJob = await waitForGenerationJob(
    client,
    asyncJobCookie,
    delayedHeadersJobCreated.body.data.job.id,
    { timeoutMs: 3_000 },
  );
  assert.equal(delayedHeadersJob.status, 'completed', '配置时限内的响应头延迟不应被底层 HTTP 客户端提前终止');
  assert.equal(delayedHeadersJob.data.creditsRemaining, 1);
  assert.equal(Date.now() - delayedHeadersStartedAt >= 450, true, '测试请求应真实等待延迟响应头');

  const retainedMaterialUpload = await client.json('/api/app/material-uploads', {
    method: 'POST',
    cookie: asyncJobCookie,
    body: {
      name: 'retained-after-failure.png',
      type: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII=',
    },
  });
  assert.equal(retainedMaterialUpload.status, 201);
  const retainedAttachmentId = retainedMaterialUpload.body.data.attachment.id;
  const timeoutJobStartedAt = Date.now();
  const timeoutJobCreated = await client.json('/api/ai/generation-jobs', {
    method: 'POST',
    cookie: asyncJobCookie,
    headers: { 'Idempotency-Key': 'async-timeout-request-0001' },
    body: {
      ...generationBody('DELAY_BODY_AFTER_HEADERS'),
      attachmentIds: [retainedAttachmentId],
    },
  });
  assert.equal(timeoutJobCreated.status, 202);
  const timeoutJob = await waitForGenerationJob(
    client,
    asyncJobCookie,
    timeoutJobCreated.body.data.job.id,
    { timeoutMs: 5_000 },
  );
  assert.equal(timeoutJob.status, 'failed');
  assert.equal(timeoutJob.error.code, 'AI_TIMEOUT', '收到响应头后正文迟延仍必须受 AI 超时控制');
  assert.equal(timeoutJob.error.details, null);
  assert.match(timeoutJob.error.requestId, /^[a-f0-9]{16}$/);
  assert.equal(Date.now() - timeoutJobStartedAt < 2_000, true, '正文读取应在 AI 超时后及时终止');
  const asyncUserAfterTimeout = await client.json('/api/auth/session', { cookie: asyncJobCookie });
  assert.equal(asyncUserAfterTimeout.body.data.user.credits, 1, '异步生成失败不得扣除额度');
  const retainedMaterial = await client.json(`/api/app/material-uploads/${encodeURIComponent(retainedAttachmentId)}`, {
    cookie: asyncJobCookie,
  });
  assert.equal(retainedMaterial.status, 200, '异步生成失败后应保留教材附件供用户重试');
  const retainedMaterialCleanup = await client.json(`/api/app/material-uploads/${encodeURIComponent(retainedAttachmentId)}`, {
    method: 'DELETE',
    cookie: asyncJobCookie,
  });
  assert.equal(retainedMaterialCleanup.status, 200);
  await delay(20);
  assert.match(appLog, /"event":"ai_generation_job_failed"/);
  assert.equal(appLog.includes('DELAY_BODY_AFTER_HEADERS'), false, '任务失败日志不得包含教材或生成要求');
  assert.equal(appLog.includes('integration-environment-key'), false, '任务失败日志不得包含模型密钥');

  const revisionJobRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'revision-job@example.com',
      password: 'RevisionJobPass1',
      displayName: '修改任务测试教师',
      subject: '语文',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  assert.equal(revisionJobRegistration.status, 201);
  const revisionJobCookie = cookiePair(revisionJobRegistration.headers.get('set-cookie'));
  const revisionJobBody = {
    lessonPlan: structuredClone(baseLessonPlan),
    sectionKeys: ['objectives'],
    customSections: [{ id: 'custom_reading', title: '拓展阅读', content: '原有拓展内容。' }],
    feedback: '把目标写得更可测量，并补充拓展阅读任务。',
  };
  const revisionCreated = await client.json('/api/ai/revision-jobs', {
    method: 'POST',
    cookie: revisionJobCookie,
    headers: { 'Idempotency-Key': 'revision-success-request-0001' },
    body: revisionJobBody,
  });
  assert.equal(revisionCreated.status, 202);
  assert.equal(revisionCreated.body.data.job.status, 'queued');
  assert.equal(revisionCreated.body.data.job.phase, 'queued');
  assert.equal(revisionCreated.body.data.job.pollAfterMs, 1_000);
  assert.match(revisionCreated.body.data.job.id, /^rev_[0-9a-f-]{36}$/);
  for (const privateField of ['userId', 'idempotencyKey', 'requestHash', 'input']) {
    assert.equal(Object.hasOwn(revisionCreated.body.data.job, privateField), false, `修改任务不得公开 ${privateField}`);
  }
  const revisionJobId = revisionCreated.body.data.job.id;

  const revisionReplay = await client.json('/api/ai/revision-jobs', {
    method: 'POST',
    cookie: revisionJobCookie,
    headers: { 'Idempotency-Key': 'revision-success-request-0001' },
    body: structuredClone(revisionJobBody),
  });
  assert.equal(revisionReplay.status, 202);
  assert.equal(revisionReplay.body.data.job.id, revisionJobId);

  const revisionConflict = await client.json('/api/ai/revision-jobs', {
    method: 'POST',
    cookie: revisionJobCookie,
    headers: { 'Idempotency-Key': 'revision-success-request-0001' },
    body: { ...structuredClone(revisionJobBody), feedback: '同一幂等键的不同参数' },
  });
  assert.equal(revisionConflict.status, 409);
  assert.equal(revisionConflict.body.error.code, 'IDEMPOTENCY_CONFLICT');

  const revisionHiddenFromOtherUser = await client.json(`/api/ai/revision-jobs/${revisionJobId}`, {
    cookie: userCookie,
  });
  assert.equal(revisionHiddenFromOtherUser.status, 404);
  assert.equal(revisionHiddenFromOtherUser.body.error.code, 'REVISION_JOB_NOT_FOUND');

  const completedRevision = await waitForRevisionJob(client, revisionJobCookie, revisionJobId);
  assert.equal(completedRevision.status, 'completed');
  assert.equal(completedRevision.phase, 'completed');
  assert.equal(completedRevision.pollAfterMs, 0);
  assert.equal(completedRevision.data.providerId, 'environment-fallback');
  assert.deepEqual(completedRevision.data.changedSections, ['objectives', 'custom:custom_reading']);
  assert.equal(completedRevision.data.lessonPlan.sourceSummary, '已按教师要求定向修改章节概述。');
  assert.deepEqual(completedRevision.data.lessonPlan.timeline, baseLessonPlan.timeline, '未选中的标准模块必须保持不变');
  assert.equal(completedRevision.data.customSections[0].id, 'custom_reading');
  assert.match(completedRevision.data.customSections[0].content, /已按教师要求定向修改/);
  const targetedUpstreamRequest = [...upstreamRequests].reverse().find((item) => item.targetedRevision);
  assert.ok(targetedUpstreamRequest, '异步修改必须真实调用模型上游');
  assert.deepEqual(
    targetedUpstreamRequest.targetedStandardFields,
    ['sourceSummary', 'coreCompetencies', 'learningObjectives'],
    '模型结构化输出只能包含选中模块对应的标准字段',
  );

  const failedRevisionCreated = await client.json('/api/ai/revision-jobs', {
    method: 'POST',
    cookie: revisionJobCookie,
    headers: { 'Idempotency-Key': 'revision-failure-request-0001' },
    body: {
      lessonPlan: structuredClone(baseLessonPlan),
      sectionKeys: ['timeline'],
      customSections: [],
      feedback: 'FORCE_UPSTREAM_ERROR',
    },
  });
  assert.equal(failedRevisionCreated.status, 202);
  const failedRevision = await waitForRevisionJob(
    client,
    revisionJobCookie,
    failedRevisionCreated.body.data.job.id,
  );
  assert.equal(failedRevision.status, 'failed');
  assert.equal(failedRevision.phase, 'failed');
  assert.equal(failedRevision.error.code, 'AI_UPSTREAM_ERROR');
  assert.equal(failedRevision.error.message.includes('integration-environment-key'), false);
  assert.match(failedRevision.error.requestId, /^[a-f0-9]{16}$/);

  const slowGenerationCreated = await client.json('/api/ai/generation-jobs', {
    method: 'POST',
    cookie: revisionJobCookie,
    headers: { 'Idempotency-Key': 'unified-queue-generation-0001' },
    body: generationBody('DELAY_FOR_CONCURRENCY_TEST'),
  });
  assert.equal(slowGenerationCreated.status, 202);
  const queuedBehindGeneration = await client.json('/api/ai/revision-jobs', {
    method: 'POST',
    cookie: revisionJobCookie,
    headers: { 'Idempotency-Key': 'unified-queue-revision-0001' },
    body: {
      lessonPlan: structuredClone(baseLessonPlan),
      sectionKeys: ['keypoints'],
      customSections: [],
      feedback: '调整重点难点。',
    },
  });
  assert.equal(queuedBehindGeneration.status, 202);
  assert.equal(queuedBehindGeneration.body.data.job.status, 'queued');
  const slowGeneration = await waitForGenerationJob(
    client,
    revisionJobCookie,
    slowGenerationCreated.body.data.job.id,
    { timeoutMs: 3_000 },
  );
  assert.equal(slowGeneration.status, 'completed');
  const revisionAfterSlotRelease = await waitForRevisionJob(
    client,
    revisionJobCookie,
    queuedBehindGeneration.body.data.job.id,
    { timeoutMs: 3_000 },
  );
  assert.equal(revisionAfterSlotRelease.status, 'completed', '生成任务释放 AI 槽后，排队修改任务必须继续执行');

  const repairRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'revision-repair@example.com',
      password: 'RevisionRepairPass1',
      displayName: '修改修复测试教师',
      subject: '语文',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  assert.equal(repairRegistration.status, 201);
  const repairCookie = cookiePair(repairRegistration.headers.get('set-cookie'));
  const repairedJobCreated = await client.json('/api/ai/revision-jobs', {
    method: 'POST',
    cookie: repairCookie,
    headers: { 'Idempotency-Key': 'revision-repair-success-0001' },
    body: {
      lessonPlan: structuredClone(baseLessonPlan),
      sectionKeys: ['objectives'],
      customSections: [],
      feedback: 'FORCE_TARGETED_INVALID_ONCE RETURN_BALANCED_JSON 保留教师修改意图。',
    },
  });
  assert.equal(repairedJobCreated.status, 202);
  const repairedJob = await waitForRevisionJob(
    client,
    repairCookie,
    repairedJobCreated.body.data.job.id,
  );
  assert.equal(repairedJob.status, 'completed', '首次结构无效时应在同一任务内修复成功');
  const repairedRequestId = repairedJobCreated.headers.get('x-request-id');
  assert.ok(repairedRequestId, '结构修复必须使用同一个请求编号再次调用同一上游');
  const sameRequestAttempts = upstreamRequests.filter((item) => item.clientRequestId === repairedRequestId);
  assert.equal(sameRequestAttempts.length, 2);
  assert.equal(sameRequestAttempts[0].targetedRepair, false);
  assert.equal(sameRequestAttempts[1].targetedRepair, true);
  assert.equal(sameRequestAttempts[0].model, sameRequestAttempts[1].model);
  assert.equal(repairedJob.data.lessonPlan.sourceSummary, '已按教师要求定向修改章节概述。');

  const repairFailedCreated = await client.json('/api/ai/revision-jobs', {
    method: 'POST',
    cookie: repairCookie,
    headers: { 'Idempotency-Key': 'revision-repair-failure-0001' },
    body: {
      lessonPlan: structuredClone(baseLessonPlan),
      sectionKeys: ['objectives'],
      customSections: [],
      feedback: 'FORCE_TARGETED_INVALID_ALWAYS',
    },
  });
  assert.equal(repairFailedCreated.status, 202);
  const repairFailedJob = await waitForRevisionJob(
    client,
    repairCookie,
    repairFailedCreated.body.data.job.id,
  );
  assert.equal(repairFailedJob.status, 'failed');
  assert.equal(repairFailedJob.error.code, 'AI_REVISION_SCOPE_VIOLATION');

  for (const [idempotencyKey, marker] of [
    ['revision-double-json-0001', 'RETURN_DOUBLE_ENCODED_JSON'],
    ['revision-fenced-json-0001', 'RETURN_FENCED_JSON'],
  ]) {
    const tolerantCreated = await client.json('/api/ai/revision-jobs', {
      method: 'POST',
      cookie: repairCookie,
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        lessonPlan: structuredClone(baseLessonPlan),
        sectionKeys: ['keypoints'],
        customSections: [],
        feedback: marker,
      },
    });
    assert.equal(tolerantCreated.status, 202);
    const tolerantJob = await waitForRevisionJob(client, repairCookie, tolerantCreated.body.data.job.id);
    assert.equal(tolerantJob.status, 'completed', `${marker} 应被安全解析后继续严格校验`);
  }
  const sharedDeadlineStartedAt = Date.now();
  const sharedDeadlineCreated = await client.json('/api/ai/revision-jobs', {
    method: 'POST',
    cookie: repairCookie,
    headers: { 'Idempotency-Key': 'revision-shared-deadline-0001' },
    body: {
      lessonPlan: structuredClone(baseLessonPlan),
      sectionKeys: ['objectives'],
      customSections: [],
      feedback: 'FORCE_TARGETED_INVALID_ONCE DELAY_EACH_TARGETED_ATTEMPT',
    },
  });
  assert.equal(sharedDeadlineCreated.status, 202);
  const sharedDeadlineJob = await waitForRevisionJob(
    client,
    repairCookie,
    sharedDeadlineCreated.body.data.job.id,
    { timeoutMs: 3_000 },
  );
  assert.equal(sharedDeadlineJob.status, 'failed');
  assert.equal(sharedDeadlineJob.error.code, 'AI_TIMEOUT');
  assert.equal(Date.now() - sharedDeadlineStartedAt < 1_100, true, '首次调用与修复调用必须共享同一个总 deadline');
  await delay(20);
  assert.match(appLog, /"event":"ai_revision_upstream_started"/);
  assert.match(appLog, /"event":"ai_revision_upstream_completed"/);
  assert.match(appLog, /"event":"ai_revision_upstream_failed"/);
  assert.match(appLog, /"event":"ai_revision_repair_started"/);
  assert.match(appLog, /"event":"ai_revision_repair_completed"/);
  assert.match(appLog, /"event":"ai_revision_repair_failed"/);
  assert.match(appLog, /"validationIssue":"模型输出/);
  assert.equal(appLog.includes('把目标写得更可测量'), false, '修改任务日志不得包含教师反馈');
  assert.equal(appLog.includes('原有拓展内容'), false, '修改任务日志不得包含教案内容');
  assert.equal(appLog.includes('integration-environment-key'), false, '修改任务日志不得包含模型密钥');

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
  const providerDiscovery = await client.json('/api/admin/providers/discover', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      providerType: 'custom_openai_compatible',
      adapter: 'openai_chat_completions',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: providerKey,
    },
  });
  assert.equal(providerDiscovery.status, 200);
  assert.equal(providerDiscovery.body.data.result.connected, true);
  assert.deepEqual(
    providerDiscovery.body.data.result.availableModels.map((item) => item.id),
    ['environment-test-model', 'deepseek-v4-pro'],
  );
  assert.equal(JSON.stringify(providerDiscovery.body).includes(providerKey), false);

  const providerModelProbe = await client.json('/api/admin/providers/discover', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      providerType: 'custom_openai_compatible',
      adapter: 'openai_chat_completions',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: providerKey,
      model: 'environment-test-model',
    },
  });
  assert.equal(providerModelProbe.status, 200);
  assert.equal(providerModelProbe.body.data.result.recommendedAdapter, 'openai_responses');
  assert.deepEqual(providerModelProbe.body.data.result.selectedModel.capabilities, {
    text: true,
    vision: true,
    image: true,
    pdf: true,
  });
  assert.equal(providerModelProbe.body.data.result.selectedModel.capabilitySource, 'live_probe');
  assert.deepEqual(new Set(providerModelProbe.body.data.result.supportedAdapters), new Set(['openai_responses', 'openai_chat_completions']));
  const responsesTextProbe = [...upstreamRequests].reverse().find((item) => (
    item.endpoint === 'responses' && item.inputKinds.length === 1 && item.inputKinds[0] === 'input_text'
  ));
  assert.equal(responsesTextProbe.hasInstructions, true);
  assert.equal(responsesTextProbe.reasoningEffort, 'low');
  assert.equal(responsesTextProbe.responseFormat, 'json_schema');
  assert.equal(responsesTextProbe.strictSchema, true);
  const chatTextProbe = [...upstreamRequests].reverse().find((item) => (
    item.endpoint === 'chat/completions' && item.inputKinds.length === 1 && item.inputKinds[0] === 'text'
  ));
  assert.equal(chatTextProbe.responseFormat, 'json_object');

  const providerCreated = await client.json('/api/admin/providers', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: 'DeepSeek 本地模拟通道',
      providerType: 'deepseek',
      adapter: 'openai_chat_completions',
      baseUrl: `http://127.0.0.1:${mockPort}`,
      apiKey: providerKey,
      model: 'deepseek-v4-pro',
      capabilities: ['lesson_generation', 'lesson_revision'],
      priority: 1,
    },
  });
  assert.equal(providerCreated.status, 201);
  assert.equal(providerCreated.body.data.provider.keyLastFour, '-key');
  assert.equal(providerCreated.body.data.provider.providerType, 'deepseek');
  assert.equal(providerCreated.body.data.provider.provider, 'DeepSeek');
  assert.equal(providerCreated.body.data.provider.adapter, 'openai_chat_completions');
  assert.deepEqual(providerCreated.body.data.provider.capabilities, ['lesson_generation', 'lesson_revision']);
  assert.equal(JSON.stringify(providerCreated.body).includes(providerKey), false);
  const providerId = providerCreated.body.data.provider.id;
  const channelFile = readFileSync(join(dataDir, 'model-channels.json'), 'utf8');
  assert.equal(channelFile.includes(providerKey), false, '模型密钥不得明文落盘');
  assert.match(channelFile, /aes-256-gcm/);

  const storedProviderTest = await client.json(`/api/admin/providers/${encodeURIComponent(providerId)}/test`, {
    method: 'POST',
    cookie: adminCookie,
    body: {},
  });
  assert.equal(storedProviderTest.status, 200);
  assert.equal(storedProviderTest.body.data.result.modelAvailable, true);
  assert.equal(storedProviderTest.body.data.result.invocationVerified, true);
  assert.equal(upstreamRequests.at(-1).endpoint, 'chat/completions');
  assert.equal(upstreamRequests.at(-1).thinking, 'disabled');

  const secondGeneration = await client.json('/api/ai/generate', {
    method: 'POST',
    cookie: userCookie,
    body: generationBody('使用存储通道'),
  });
  assert.equal(secondGeneration.status, 200);
  assert.equal(secondGeneration.body.data.providerId, providerId);
  assert.equal(secondGeneration.body.data.creditsRemaining, 1);
  assert.equal(upstreamRequests.at(-1).model, 'deepseek-v4-pro');
  assert.equal(upstreamRequests.at(-1).authorization, `Bearer ${providerKey}`);
  assert.equal(upstreamRequests.at(-1).endpoint, 'chat/completions');
  assert.equal(upstreamRequests.at(-1).thinking, 'disabled');

  const providerTemporarilyDisabled = await client.json(`/api/admin/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { enabled: false },
  });
  assert.equal(providerTemporarilyDisabled.status, 200);
  const arbitraryFormatKey = 'opaque-secret-without-standard-prefix';
  const echoProviderCreated = await client.json('/api/admin/providers', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: '错误脱敏测试通道',
      providerType: 'custom_openai_compatible',
      adapter: 'openai_chat_completions',
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: arbitraryFormatKey,
      model: 'echo-key-error-model',
      capabilities: ['lesson_generation', 'lesson_revision'],
      detectedCapabilities: { text: true, image: false, pdf: false },
      lastCheckedAt: new Date().toISOString(),
      priority: 1,
    },
  });
  assert.equal(echoProviderCreated.status, 201);
  const echoProviderId = echoProviderCreated.body.data.provider.id;
  echoAuthorizationModels.add('echo-key-error-model');
  const echoedSecretFailure = await client.json('/api/ai/generate', {
    method: 'POST',
    cookie: userCookie,
    body: generationBody('上游错误脱敏'),
  });
  echoAuthorizationModels.delete('echo-key-error-model');
  assert.equal(echoedSecretFailure.status, 502);
  assert.equal(JSON.stringify(echoedSecretFailure.body).includes(arbitraryFormatKey), false, '任意格式密钥被上游回显时也必须精确脱敏');
  assert.equal(JSON.stringify(echoedSecretFailure.body).includes('Bearer opaque-secret'), false);
  const echoProviderDeleted = await client.json(`/api/admin/providers/${encodeURIComponent(echoProviderId)}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(echoProviderDeleted.status, 200);
  const providerReenabled = await client.json(`/api/admin/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { enabled: true },
  });
  assert.equal(providerReenabled.status, 200);

  const discoveredCapabilities = providerModelProbe.body.data.result.selectedModel.capabilities;
  const multimodalProviderCreated = await client.json('/api/admin/providers', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      name: '兼容接口多模态通道',
      providerType: 'custom_openai_compatible',
      adapter: providerModelProbe.body.data.result.recommendedAdapter,
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiKey: providerKey,
      model: 'environment-test-model',
      capabilities: ['lesson_generation', 'lesson_revision', 'multimodal_input'],
      detectedCapabilities: discoveredCapabilities,
      lastCheckedAt: providerModelProbe.body.data.result.checkedAt,
      priority: 2,
    },
  });
  assert.equal(multimodalProviderCreated.status, 201);
  const multimodalProviderId = multimodalProviderCreated.body.data.provider.id;
  assert.deepEqual(multimodalProviderCreated.body.data.provider.detectedCapabilities, {
    ...discoveredCapabilities,
    source: 'live_probe',
  });

  const multimodalProviderTest = await client.json(`/api/admin/providers/${encodeURIComponent(multimodalProviderId)}/test`, {
    method: 'POST',
    cookie: adminCookie,
    body: {},
  });
  assert.equal(multimodalProviderTest.status, 200);
  assert.equal(multimodalProviderTest.body.data.result.recommendedAdapter, 'openai_responses');
  assert.equal(multimodalProviderTest.body.data.result.selectedModel.capabilities.image, true);
  assert.equal(multimodalProviderTest.body.data.result.selectedModel.capabilities.pdf, true);

  transientProbeModels.add('environment-test-model');
  const inconclusiveProviderTest = await client.json(`/api/admin/providers/${encodeURIComponent(multimodalProviderId)}/test`, {
    method: 'POST',
    cookie: adminCookie,
    body: {},
  });
  transientProbeModels.delete('environment-test-model');
  assert.equal(inconclusiveProviderTest.status, 503);
  assert.equal(inconclusiveProviderTest.body.error.code, 'AI_PROVIDER_TEST_INCONCLUSIVE');
  const providersAfterInconclusive = await client.json('/api/admin/providers', { cookie: adminCookie });
  const preservedProvider = providersAfterInconclusive.body.data.providers.find((item) => item.id === multimodalProviderId);
  assert.equal(preservedProvider.health, 'healthy');
  assert.equal(preservedProvider.lastCheckStatus, 'inconclusive');
  assert.equal(preservedProvider.detectedCapabilities.image, true, '瞬时失败不得覆盖上次已验证的图片能力');
  assert.equal(preservedProvider.detectedCapabilities.pdf, true, '瞬时失败不得覆盖上次已验证的 PDF 能力');

  const multimodalGeneration = await client.json('/api/ai/generate', {
    method: 'POST',
    cookie: userCookie,
    body: {
      ...generationBody('使用图片能力路由'),
      images: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlWQAAAAASUVORK5CYII='],
    },
  });
  assert.equal(multimodalGeneration.status, 200, JSON.stringify(multimodalGeneration.body));
  assert.equal(multimodalGeneration.body.data.providerId, multimodalProviderId, '图片请求必须跳过仅文字的更高优先级通道');
  assert.equal(upstreamRequests.at(-1).endpoint, 'responses');
  assert.equal(upstreamRequests.at(-1).inputKinds.includes('input_image'), true);

  const providersAfterUsage = await client.json('/api/admin/providers', { cookie: adminCookie });
  const usedProvider = providersAfterUsage.body.data.providers.find((item) => item.id === multimodalProviderId);
  assert.equal(usedProvider.routeOrder, 2);
  assert.equal(usedProvider.useCount, 1);
  assert.equal(usedProvider.lastSelectedTask, 'generation');
  assert.equal(usedProvider.lastSelectedModel, 'environment-test-model');
  assert.match(usedProvider.lastUsedAt, /^\d{4}-\d{2}-\d{2}T/);

  const providerModelChanged = await client.json(`/api/admin/providers/${encodeURIComponent(multimodalProviderId)}`, {
    method: 'PATCH',
    cookie: adminCookie,
    body: { model: 'changed-model-requires-new-probe' },
  });
  assert.equal(providerModelChanged.status, 200);
  assert.equal(providerModelChanged.body.data.provider.health, 'unknown');
  assert.deepEqual(providerModelChanged.body.data.provider.detectedCapabilities, {
    text: null,
    vision: null,
    image: null,
    pdf: null,
    source: 'unknown',
  }, '模型变化后不得沿用旧能力检测结果');
  assert.equal(providerModelChanged.body.data.provider.lastCheckedAt, null);

  const environmentDeleteDenied = await client.json('/api/admin/providers/environment-fallback', {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(environmentDeleteDenied.status, 403);
  assert.equal(environmentDeleteDenied.body.error.code, 'PROVIDER_READONLY');
  const multimodalProviderDeleted = await client.json(`/api/admin/providers/${encodeURIComponent(multimodalProviderId)}`, {
    method: 'DELETE',
    cookie: adminCookie,
  });
  assert.equal(multimodalProviderDeleted.status, 200);
  const providersAfterDelete = await client.json('/api/admin/providers', { cookie: adminCookie });
  assert.equal(providersAfterDelete.body.data.providers.some((item) => item.id === multimodalProviderId), false);

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
  const chatFinishRegistration = await client.json('/api/auth/register', {
    method: 'POST',
    body: {
      identifier: 'chat-finish@example.com',
      password: 'ChatFinishPass1',
      privacyAccepted: true,
      privacyPolicyUpdatedAt: currentPrivacyPolicyUpdatedAt,
    },
  });
  assert.equal(chatFinishRegistration.status, 201);
  const chatFinishCookie = cookiePair(chatFinishRegistration.headers.get('set-cookie'));
  for (const [suffix, marker, expectedCode] of [
    ['length', 'FORCE_CHAT_LENGTH', 'AI_INCOMPLETE'],
    ['filter', 'FORCE_CHAT_CONTENT_FILTER', 'AI_REFUSED'],
  ]) {
    const finishJobCreated = await client.json('/api/ai/revision-jobs', {
      method: 'POST',
      cookie: chatFinishCookie,
      headers: { 'Idempotency-Key': `chat-finish-${suffix}-0001` },
      body: {
        lessonPlan: structuredClone(secondGeneration.body.data.lessonPlan),
        sectionKeys: ['objectives'],
        customSections: [],
        feedback: marker,
      },
    });
    assert.equal(finishJobCreated.status, 202);
    const finishJob = await waitForRevisionJob(client, chatFinishCookie, finishJobCreated.body.data.job.id);
    assert.equal(finishJob.status, 'failed');
    assert.equal(finishJob.error.code, expectedCode);
  }
  await delay(20);
  assert.match(appLog, /"finishReason":"length"/);
  assert.match(appLog, /"finishReason":"content_filter"/);
  const customSectionRevision = await client.json('/api/ai/revise-custom-sections', {
    method: 'POST',
    cookie: secondCookie,
    body: {
      lessonPlan: secondGeneration.body.data.lessonPlan,
      sections: [
        { id: 'custom_extension', title: '拓展阅读', content: '' },
        { id: 'custom_local', title: '乡土素材', content: '结合本地春季景物。' },
      ],
      instruction: '补充可直接上课的讲解话术和学生任务。',
    },
  });
  assert.equal(customSectionRevision.status, 200);
  assert.deepEqual(
    customSectionRevision.body.data.sections.map(({ id, title }) => ({ id, title })),
    [
      { id: 'custom_extension', title: '拓展阅读' },
      { id: 'custom_local', title: '乡土素材' },
    ],
  );
  assert.equal(customSectionRevision.body.data.sections.every((section) => /[\u3400-\u9fff]/u.test(section.content)), true);
  assert.equal(customSectionRevision.body.data.providerId, providerId);
  assert.equal(upstreamRequests.at(-1).endpoint, 'chat/completions');
  assert.equal(upstreamRequests.at(-1).responseFormat, 'json_object');
  assert.equal(Object.hasOwn(customSectionRevision.body.data, 'lessonPlan'), false, '定向修改不应回传完整教案');
  assert.equal(appLog.includes('补充可直接上课的讲解话术'), false, '定向修改日志不得记录教师指令');
  assert.equal(appLog.includes(providerKey), false, '定向修改日志不得记录模型密钥');
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
  for (let attempt = 0; attempt < 5; attempt += 1) {
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

  const credentialsBeforeChange = await client.json('/api/admin/system/credentials', { cookie: adminCookie });
  assert.equal(credentialsBeforeChange.status, 200);
  assert.deepEqual(credentialsBeforeChange.body.data.credentials.username, 'admin');
  assert.equal(Object.hasOwn(credentialsBeforeChange.body.data.credentials, 'password'), false);

  const credentialTotpEnrollment = await client.json('/api/admin/security/mfa/totp/enroll', {
    method: 'POST',
    cookie: adminCookie,
    body: { currentPassword: adminPassword },
  });
  assert.equal(credentialTotpEnrollment.status, 201);
  const credentialTotp = credentialTotpEnrollment.body.data.enrollment;
  const credentialTotpConfirmed = await client.json('/api/admin/security/mfa/totp/confirm', {
    method: 'POST',
    cookie: adminCookie,
    body: {
      enrollmentId: credentialTotp.enrollmentId,
      code: generateTotpCode(credentialTotp.secret),
    },
  });
  assert.equal(credentialTotpConfirmed.status, 200);

  const rejectedCredentialChange = await client.json('/api/admin/system/credentials', {
    method: 'PUT',
    cookie: adminCookie,
    body: { currentPassword: 'wrong-current-password', username: 'admin-renamed' },
  });
  assert.equal(rejectedCredentialChange.status, 401);
  assert.equal(rejectedCredentialChange.body.error.code, 'CURRENT_PASSWORD_INVALID');

  const renamedAdminPassword = 'ChangedAdmin9!Secure';
  const credentialChange = await client.json('/api/admin/system/credentials', {
    method: 'PUT',
    cookie: adminCookie,
    body: {
      currentPassword: adminPassword,
      username: 'admin-renamed',
      newPassword: renamedAdminPassword,
    },
  });
  assert.equal(credentialChange.status, 200);
  assert.equal(credentialChange.body.data.credentials.username, 'admin-renamed');
  assert.equal(credentialChange.body.data.credentialsChanged, true);
  assert.equal(credentialChange.body.data.sessionInvalidated, true);
  assert.equal(credentialChange.body.data.recoveryCodes.length, 10);
  assert.match(credentialChange.headers.get('set-cookie'), /Max-Age=0/);

  const invalidatedAdminSession = await client.json('/api/admin/system/credentials', { cookie: adminCookie });
  assert.equal(invalidatedAdminSession.status, 401);
  const invalidatedTeacherSession = await client.json('/api/auth/session', { cookie: adminTeacherCookie });
  assert.equal(invalidatedTeacherSession.status, 401);
  const oldAdminFrontendLogin = await client.json('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'admin', password: adminPassword },
  });
  assert.equal(oldAdminFrontendLogin.status, 401);
  const oldAdminBackendLogin = await client.json('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin', password: adminPassword },
  });
  assert.equal(oldAdminBackendLogin.status, 401);

  const renamedAdminFrontendLogin = await client.json('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'admin-renamed', password: renamedAdminPassword },
  });
  assert.equal(renamedAdminFrontendLogin.status, 200);
  assert.equal(renamedAdminFrontendLogin.body.data.user.account, 'admin-renamed');
  assert.equal(renamedAdminFrontendLogin.body.data.user.displayName, 'admin-renamed');

  const renamedAdminPasswordStage = await client.json('/api/admin/login', {
    method: 'POST',
    body: { username: 'admin-renamed', password: renamedAdminPassword },
  });
  assert.equal(renamedAdminPasswordStage.status, 202);
  assert.equal(renamedAdminPasswordStage.body.data.challenge.channel, 'totp');
  const renamedAdminLogin = await client.json('/api/admin/mfa/verify', {
    method: 'POST',
    body: {
      challengeId: renamedAdminPasswordStage.body.data.challenge.id,
      code: credentialChange.body.data.recoveryCodes[0],
    },
  });
  assert.equal(renamedAdminLogin.status, 200, '用户名变更后重新生成的恢复码应可完成后台登录');
  const renamedAdminCookie = cookiePair(renamedAdminLogin.headers.get('set-cookie'));
  const credentialsAfterChange = await client.json('/api/admin/system/credentials', { cookie: renamedAdminCookie });
  assert.equal(credentialsAfterChange.status, 200);
  assert.equal(credentialsAfterChange.body.data.credentials.username, 'admin-renamed');

  const logout = await client.json('/api/auth/logout', { method: 'POST', cookie: userCookie, body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);

  console.log(JSON.stringify({
    ok: true,
    checks: {
      authAndSignedCookies: true,
      aiRequiresLogin: true,
      successOnlyQuotaDeduction: true,
      asyncGenerationIdempotencyAndPolling: true,
      asyncTargetedRevisionJobs: true,
      delayedResponseBodyTimeout: true,
      encryptedProviderRouting: true,
      targetedCustomSectionRevision: true,
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
      explicitAdminCredentialManagement: true,
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

async function waitForGenerationJob(client, cookie, jobId, { timeoutMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await client.json(`/api/ai/generation-jobs/${encodeURIComponent(jobId)}`, { cookie });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const job = response.body.data.job;
    if (job.status === 'completed' || job.status === 'failed') return job;
    if (Date.now() >= deadline) assert.fail(`生成任务 ${jobId} 在 ${timeoutMs}ms 内没有进入终态`);
    await delay(Math.min(50, Math.max(10, Number(job.pollAfterMs || 10))));
  }
}

async function waitForRevisionJob(client, cookie, jobId, { timeoutMs = 3_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await client.json(`/api/ai/revision-jobs/${encodeURIComponent(jobId)}`, { cookie });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const job = response.body.data.job;
    if (job.status === 'completed' || job.status === 'failed') return job;
    if (Date.now() >= deadline) assert.fail(`修改任务 ${jobId} 在 ${timeoutMs}ms 内没有进入终态`);
    await delay(Math.min(50, Math.max(10, Number(job.pollAfterMs || 10))));
  }
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
