import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSmsService } from './sms-service.mjs';
import { buildStoredSmtpConfig } from './message-service.mjs';
import { createVerificationCodeService } from './verification-codes.mjs';

const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-security-'));
try {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('aliyuncs.com')) {
      return new Response(JSON.stringify({ Code: 'OK', RequestId: 'aliyun-test' }), { status: 200 });
    }
    return new Response(JSON.stringify({
      Response: { RequestId: 'tencent-test', SendStatusSet: [{ Code: 'Ok', Message: 'send success' }] },
    }), { status: 200 });
  };
  const secret = 'security-services-test-secret'.padEnd(64, 's');
  const sms = createSmsService({ dataDir, encryptionSecret: secret, fetchImpl });

  const initial = sms.getPublicSettings();
  assert.equal(initial.configured, false);
  sms.saveSettings({
    enabled: true,
    provider: 'aliyun',
    accessKeyId: 'aliyun-access-id',
    accessKeySecret: 'aliyun-secret-value',
    signName: '教师帮',
    templateCode: 'SMS_123456',
  });
  const aliyunPublic = sms.getPublicSettings();
  assert.equal(aliyunPublic.configured, true);
  assert.equal(aliyunPublic.enabled, true);
  assert.equal(aliyunPublic.accessKeyIdMasked.includes('aliyun-access-id'), false);
  const rawSettings = readFileSync(join(dataDir, 'sms-settings.json'), 'utf8');
  assert.equal(rawSettings.includes('aliyun-secret-value'), false);
  await sms.sendVerificationCode({ phone: '13800138000', code: '123456' });
  assert.match(requests[0].options.headers.authorization, /^ACS3-HMAC-SHA256 /);
  assert.equal(requests[0].options.headers['x-acs-action'], 'SendSms');

  assert.throws(
    () => sms.saveSettings({
      enabled: false,
      provider: 'tencent',
      accessKeySecret: 'new-provider-secret',
      signName: '教师帮',
      templateCode: '1234567',
      sdkAppId: '1400000000',
    }),
    (error) => error.code === 'SMS_SETTINGS_INCOMPLETE',
    '切换短信服务商时不得静默复用上一家服务商的 AccessKey ID',
  );

  sms.saveSettings({
    enabled: true,
    provider: 'tencent',
    accessKeyId: 'tencent-secret-id',
    accessKeySecret: 'tencent-secret-key',
    signName: '教师帮',
    templateCode: '1234567',
    sdkAppId: '1400000000',
    region: 'ap-guangzhou',
  });
  await sms.sendVerificationCode({ phone: '13800138000', code: '654321' });
  assert.match(requests[1].options.headers.authorization, /^TC3-HMAC-SHA256 /);
  assert.equal(requests[1].options.headers['x-tc-action'], 'SendSms');

  let currentTime = Date.now();
  let deliveredCode = '';
  const verification = createVerificationCodeService({
    secret,
    resendAfterMs: 60_000,
    now: () => currentTime,
  });
  const issued = await verification.issue({
    identifier: 'teacher@example.com',
    purpose: 'register',
    deliver: async ({ code }) => { deliveredCode = code; },
  });
  assert.equal(issued.channel, 'email');
  assert.match(issued.verificationId, /^vfy_/);
  assert.match(deliveredCode, /^\d{6}$/);
  assert.equal(issued.destination.includes('teacher@example.com'), false);
  assert.throws(
    () => verification.verify({
      identifier: 'teacher@example.com',
      purpose: 'register',
      verificationId: 'vfy_wrong',
      code: deliveredCode,
    }),
    (error) => error.code === 'VERIFICATION_CODE_INVALID',
  );
  assert.equal(verification.verify({
    identifier: 'teacher@example.com',
    purpose: 'register',
    verificationId: issued.verificationId,
    code: deliveredCode,
  }).verified, true);
  assert.throws(
    () => verification.verify({ identifier: 'teacher@example.com', purpose: 'register', code: deliveredCode }),
    (error) => error.code === 'VERIFICATION_CODE_INVALID',
  );

  currentTime += 60_001;
  await verification.issue({
    identifier: '13800138000',
    purpose: 'login',
    deliver: async ({ code }) => { deliveredCode = code; },
  });
  assert.throws(
    () => verification.verify({ identifier: '13800138000', purpose: 'login', code: '000000' }),
    (error) => error.code === 'VERIFICATION_CODE_INVALID',
  );

  const smtpConfig = buildStoredSmtpConfig({
    host: 'smtp.example.com',
    port: 465,
    security: 'tls',
    username: 'mailer@example.com',
    password: 'smtp-secret',
    fromName: '教师帮',
    fromEmail: 'mailer@example.com',
  }, { sealPassword: (value) => ({ sealed: value }) });
  const testedSmtpConfig = { ...smtpConfig, testedAt: '2026-08-01T00:00:00.000Z' };
  const unchangedSmtpConfig = buildStoredSmtpConfig({
    host: 'smtp.example.com',
    port: 465,
    security: 'tls',
    username: 'mailer@example.com',
    fromName: '教师帮',
    fromEmail: 'mailer@example.com',
  }, { existing: testedSmtpConfig, sealPassword: (value) => ({ sealed: value }) });
  assert.equal(unchangedSmtpConfig.testedAt, testedSmtpConfig.testedAt);
  const changedSmtpConfig = buildStoredSmtpConfig({
    host: 'smtp.example.com',
    port: 465,
    security: 'tls',
    username: 'mailer@example.com',
    fromName: '教师帮验证码',
    fromEmail: 'mailer@example.com',
  }, { existing: testedSmtpConfig, sealPassword: (value) => ({ sealed: value }) });
  assert.equal(changedSmtpConfig.testedAt, null);

  console.log(JSON.stringify({ ok: true, checks: { encryptedSmsSettings: true, providerCredentialIsolation: true, aliyunAcs3Signing: true, tencentTc3Signing: true, singleUseVerificationCodes: true, truthfulSmtpTestState: true } }));
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}
