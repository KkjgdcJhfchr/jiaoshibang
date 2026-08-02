import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSessionToken, hashPassword } from './security.mjs';

const root = new URL('..', import.meta.url);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;

test('营销、推广、教材上传和用户删除路由完成鉴权闭环', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-marketing-routes-'));
  const sessionSecret = 'marketing-route-session-secret'.padEnd(64, 's');
  const safetySalt = 'marketing-route-safety-salt'.padEnd(64, 'p');
  const adminUsername = 'route-owner';
  const adminId = 'usr_00000000-0000-4000-8000-000000000010';
  const userId = 'usr_00000000-0000-4000-8000-000000000011';
  const otherUserId = 'usr_00000000-0000-4000-8000-000000000012';
  const pendingPaymentUserId = 'usr_00000000-0000-4000-8000-000000000013';
  const unfulfilledPaymentUserId = 'usr_00000000-0000-4000-8000-000000000014';
  const fulfilledPaymentUserId = 'usr_00000000-0000-4000-8000-000000000015';
  const timestamp = new Date().toISOString();
  writeJson(join(dataDir, 'admin.json'), {
    version: 1,
    username: adminUsername,
    role: 'super_admin',
    password: hashPassword('RouteOwnerPassword1!'),
    updatedAt: timestamp,
  });
  writeJson(join(dataDir, 'users.json'), {
    version: 1,
    referrals: [],
    users: [
      userRecord(adminId, adminUsername, { role: 'admin_teacher', verifiedChannel: 'admin_credentials', referralCode: 'BKXADMIN001' }),
      userRecord(userId, 'route-user@example.com', { referralCode: 'BKXUSER0001' }),
      userRecord(otherUserId, 'other-user@example.com', { referralCode: 'BKXUSER0002' }),
      userRecord(pendingPaymentUserId, 'pending-payment@example.com', { referralCode: 'BKXPENDING1' }),
      userRecord(unfulfilledPaymentUserId, 'unfulfilled-payment@example.com', { referralCode: 'BKXUNFULFIL1' }),
      userRecord(fulfilledPaymentUserId, 'fulfilled-payment@example.com', { referralCode: 'BKXFULFILL1' }),
    ],
  });
  writeJson(join(dataDir, 'payments.json'), {
    version: 1,
    configs: {},
    processedEvents: [],
    orders: [
      paymentOrder('pay_00000000-0000-4000-8000-000000000021', pendingPaymentUserId, 'PENDING', 'PENDING'),
      paymentOrder('pay_00000000-0000-4000-8000-000000000022', unfulfilledPaymentUserId, 'PAID', 'RETRY_REQUIRED'),
      paymentOrder('pay_00000000-0000-4000-8000-000000000023', fulfilledPaymentUserId, 'PAID', 'FULFILLED'),
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
    const adminCookie = tokenCookie('teacher_helper_admin_session', adminUsername, 'admin', sessionSecret);
    const userCookie = tokenCookie('teacher_helper_session', userId, 'user', sessionSecret);
    const otherCookie = tokenCookie('teacher_helper_session', otherUserId, 'user', sessionSecret);
    const pendingPaymentCookie = tokenCookie('teacher_helper_session', pendingPaymentUserId, 'user', sessionSecret);
    const unfulfilledPaymentCookie = tokenCookie('teacher_helper_session', unfulfilledPaymentUserId, 'user', sessionSecret);

    const deniedMarketing = await json(origin, '/api/admin/marketing');
    assert.equal(deniedMarketing.status, 401);

    const settings = await json(origin, '/api/admin/marketing/referral-settings', {
      method: 'PUT',
      cookie: adminCookie,
      body: {
        enabled: true,
        rewardMode: 'both',
        inviterRewardCredits: 3,
        inviteeRewardCredits: 1,
        maxRewardsPerUser: 20,
        headline: '邀请同事',
        description: '完成邮箱或手机验证注册后获得额度。',
      },
    });
    assert.equal(settings.status, 200);

    const createdAd = await json(origin, '/api/admin/marketing/ads', {
      method: 'POST',
      cookie: adminCookie,
      body: { title: '开学季', altText: '开学季宣传', linkUrl: '/app/membership', imageDataUrl: PNG_DATA_URL, enabled: true },
    });
    assert.equal(createdAd.status, 201);
    const publicConfig = await json(origin, '/api/site-config');
    assert.equal(publicConfig.body.data.ads.length, 1);
    assert.equal(publicConfig.body.data.referralProgram.enabled, true);
    const assetResponse = await fetch(`${origin}${publicConfig.body.data.ads[0].imageUrl}`);
    assert.equal(assetResponse.status, 200);
    assert.equal(assetResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await assetResponse.arrayBuffer()), Buffer.from('89504e470d0a1a0a', 'hex'));

    const referralOverview = await json(origin, '/api/app/referrals', { cookie: userCookie });
    assert.equal(referralOverview.status, 200);
    assert.equal(referralOverview.body.data.code, 'BKXUSER0001');
    assert.match(referralOverview.body.data.shareUrl, /\/register\?ref=BKXUSER0001$/);

    const uploaded = await json(origin, '/api/app/material-uploads', {
      method: 'POST',
      cookie: userCookie,
      body: { name: '教材第1页.png', type: 'image/png', dataUrl: PNG_DATA_URL },
    });
    assert.equal(uploaded.status, 201);
    const attachmentId = uploaded.body.data.attachment.id;
    const deniedAttachment = await json(origin, `/api/app/material-uploads/${attachmentId}`, { cookie: otherCookie, raw: true });
    assert.equal(deniedAttachment.status, 404);
    const attachmentResponse = await fetch(`${origin}/api/app/material-uploads/${attachmentId}`, { headers: { Cookie: userCookie } });
    assert.equal(attachmentResponse.status, 200);
    assert.equal(attachmentResponse.headers.get('cache-control'), 'private, no-store');

    const protectedDelete = await json(origin, `/api/admin/users/${adminId}`, { method: 'DELETE', cookie: adminCookie, body: {} });
    assert.equal(protectedDelete.status, 403);
    assert.equal(protectedDelete.body.error.code, 'ADMIN_TEACHER_DELETE_FORBIDDEN');
    const pendingPaymentDelete = await json(origin, `/api/admin/users/${pendingPaymentUserId}`, {
      method: 'DELETE',
      cookie: adminCookie,
      body: {},
    });
    assert.equal(pendingPaymentDelete.status, 409);
    assert.equal(pendingPaymentDelete.body.error.code, 'USER_PAYMENT_STATE_BLOCKS_DELETION');
    assert.equal(pendingPaymentDelete.body.error.details.blockers[0].reason, 'PAYMENT_NOT_FINALIZED');
    assert.equal((await json(origin, '/api/auth/session', { cookie: pendingPaymentCookie })).status, 200);
    const unfulfilledPaymentDelete = await json(origin, `/api/admin/users/${unfulfilledPaymentUserId}`, {
      method: 'DELETE',
      cookie: adminCookie,
      body: {},
    });
    assert.equal(unfulfilledPaymentDelete.status, 409);
    assert.equal(unfulfilledPaymentDelete.body.error.code, 'USER_PAYMENT_STATE_BLOCKS_DELETION');
    assert.equal(unfulfilledPaymentDelete.body.error.details.blockers[0].reason, 'PAID_FULFILLMENT_PENDING');
    assert.equal((await json(origin, '/api/auth/session', { cookie: unfulfilledPaymentCookie })).status, 200);
    const deleted = await json(origin, '/api/admin/users/bulk-delete', {
      method: 'POST',
      cookie: adminCookie,
      body: { userIds: [userId, otherUserId, fulfilledPaymentUserId] },
    });
    assert.equal(deleted.status, 200);
    assert.deepEqual(deleted.body.data.deletedIds, [userId, otherUserId, fulfilledPaymentUserId]);
    assert.equal(deleted.body.data.cleanup.removedAttachments, 1);
    const persistedPayments = JSON.parse(readFileSync(join(dataDir, 'payments.json'), 'utf8'));
    assert.deepEqual(
      persistedPayments.orders.map((order) => [order.id, order.status]),
      [
        ['pay_00000000-0000-4000-8000-000000000021', 'PENDING'],
        ['pay_00000000-0000-4000-8000-000000000022', 'PAID'],
        ['pay_00000000-0000-4000-8000-000000000023', 'PAID'],
      ],
      '删除用户不得取消、改写或删除支付记录',
    );
    const staleSession = await json(origin, '/api/auth/session', { cookie: userCookie });
    assert.equal(staleSession.status, 401);

    const deletedAd = await json(origin, `/api/admin/marketing/ads/${createdAd.body.data.ad.id}`, {
      method: 'DELETE',
      cookie: adminCookie,
      body: {},
    });
    assert.equal(deletedAd.status, 200);
    assert.equal((await fetch(`${origin}${publicConfig.body.data.ads[0].imageUrl}`)).status, 404);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function userRecord(id, account, extra = {}) {
  const timestamp = new Date().toISOString();
  return {
    id,
    account,
    accountKey: account.toLowerCase(),
    displayName: account.split('@')[0],
    subject: '语文',
    password: hashPassword('RouteUserPassword1!'),
    credits: 3,
    generationCount: 0,
    trainingConsent: true,
    trainingConsentAt: timestamp,
    privacyAcceptedAt: timestamp,
    privacyPolicyUpdatedAt: null,
    verifiedAt: timestamp,
    verifiedChannel: 'email',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...extra,
  };
}

function paymentOrder(id, userId, status, fulfillmentStatus) {
  const timestamp = new Date().toISOString();
  return {
    id,
    merchantOrderNo: `T${id.slice(-12)}`,
    provider: 'alipay',
    userId,
    planId: 'pro-monthly',
    quoteId: 'test-quote',
    subject: '专业版月付',
    amountCents: 2700,
    currency: 'CNY',
    status,
    providerState: status,
    providerTradeNo: '',
    gatewayUnknown: status === 'PENDING',
    createdAt: timestamp,
    updatedAt: timestamp,
    paidAt: status === 'PAID' ? timestamp : null,
    closedAt: null,
    refundedAt: null,
    statusHistory: [{ from: null, to: status, at: timestamp, source: 'test' }],
    fulfillment: {
      status: fulfillmentStatus,
      attempts: fulfillmentStatus === 'PENDING' ? 0 : 1,
      fulfilledAt: fulfillmentStatus === 'FULFILLED' ? timestamp : null,
      updatedAt: timestamp,
      lastError: fulfillmentStatus === 'RETRY_REQUIRED' ? '权益待重试' : '',
    },
  };
}

function tokenCookie(name, subject, role, secret) {
  const session = createSessionToken({ subject, role, secret, ttlSeconds: 3_600 });
  return `${name}=${session.token}`;
}

async function json(origin, path, { method = 'GET', cookie = '', body, raw = false } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (raw) return { status: response.status, body: null, headers: response.headers };
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${getLog()}`);
}
