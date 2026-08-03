import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMarketingStore } from './marketing-store.mjs';
import { createMaterialUploadStore } from './material-upload-store.mjs';
import { createDataStore } from './data-store.mjs';

const PNG_DATA_URL = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`;
const GIF_DATA_URL = `data:image/gif;base64,${Buffer.from('GIF89a', 'ascii').toString('base64')}`;
const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%%EOF', 'ascii').toString('base64')}`;

test('广告图片安全落盘、排序、替换和推广设置持久化', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-marketing-'));
  try {
    const store = createMarketingStore({ dataDir });
    assert.deepEqual(store.listPublicAds(), []);
    const first = store.createAd({
      linkUrl: '/app/membership',
      imageDataUrl: PNG_DATA_URL,
    }, 'owner');
    const second = store.createAd({
      linkUrl: 'https://example.com/activity',
      imageDataUrl: GIF_DATA_URL,
      enabled: false,
    }, 'owner');
    const publicAds = store.listPublicAds();
    assert.equal(publicAds.length, 2, '广告保存后应立即展示，旧的 enabled 输入不再控制展示');
    assert.deepEqual(Object.keys(publicAds[0]).sort(), ['id', 'imageUrl', 'linkUrl']);
    assert.equal('title' in first, false);
    assert.equal('altText' in first, false);
    assert.equal('enabled' in first, false);
    assert.equal(store.openAsset(first.imageUrl.split('/').at(-1)).mimeType, 'image/png');
    const assetDirectory = join(dataDir, 'marketing-assets');
    const assetCountBeforeRejectedAd = readdirSync(assetDirectory).length;
    assert.throws(
      () => store.createAd({ linkUrl: 'http://example.com/activity', imageDataUrl: PNG_DATA_URL }),
      (error) => error.code === 'ADVERTISEMENT_LINK_INVALID',
    );
    assert.equal(
      readdirSync(assetDirectory).length,
      assetCountBeforeRejectedAd,
      '广告字段校验失败后不得遗留孤儿图片',
    );
    assert.throws(
      () => store.createAd({ linkUrl: 'javascript:alert(1)', imageDataUrl: PNG_DATA_URL }),
      (error) => error.code === 'ADVERTISEMENT_LINK_INVALID',
    );
    assert.throws(
      () => store.createAd({ imageDataUrl: `data:image/png;base64,${Buffer.from('<html>').toString('base64')}` }),
      (error) => error.code === 'ADVERTISEMENT_IMAGE_CONTENT_INVALID',
    );
    const previousAsset = store.openAsset(first.imageUrl.split('/').at(-1)).path;
    const updated = store.updateAd(first.id, { imageDataUrl: GIF_DATA_URL }, 'owner');
    assert.equal(existsSync(previousAsset), false, '换图后旧文件必须删除');
    assert.equal(store.openAsset(updated.imageUrl.split('/').at(-1)).mimeType, 'image/gif');
    const reordered = store.reorderAds([second.id, first.id], 'owner');
    assert.deepEqual(reordered.map((ad) => ad.id), [second.id, first.id]);
    const settings = store.saveReferralSettings({
      enabled: true,
      rewardMode: 'both',
      inviterRewardCredits: 5,
      inviteeRewardCredits: 2,
      maxRewardsPerUser: 10,
      headline: '邀请同事',
      description: '验证注册后双方获得额度。',
    }, 'owner');
    assert.equal(settings.inviterRewardCredits, 5);
    const reloaded = createMarketingStore({ dataDir });
    assert.deepEqual(reloaded.listAdminAds().map((ad) => ad.id), [second.id, first.id]);
    assert.equal(reloaded.getPublicReferralSettings().enabled, true);
    reloaded.deleteAd(second.id);
    assert.deepEqual(reloaded.listAdminAds().map((ad) => ad.order), [0]);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('教材附件逐文件保存、归属隔离、无数量硬限制并支持成功后清理', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-materials-'));
  try {
    const store = createMaterialUploadStore({
      dataDir,
      maxActiveBytesPerUser: 16 * 1024 * 1024,
      maxGenerationBytes: 16 * 1024 * 1024,
    });
    const userId = 'usr_00000000-0000-4000-8000-000000000001';
    const otherUserId = 'usr_00000000-0000-4000-8000-000000000002';
    const attachments = [];
    for (let index = 0; index < 13; index += 1) {
      attachments.push(store.createAttachment({
        userId,
        name: `第${index + 1}页.png`,
        type: 'image/png',
        dataUrl: PNG_DATA_URL,
      }));
    }
    const pdf = store.createAttachment({ userId, name: '章节.pdf', type: 'application/pdf', dataUrl: PDF_DATA_URL });
    const resolved = store.resolveAttachments(userId, [...attachments.map((item) => item.id), pdf.id]);
    assert.equal(resolved.length, 14, '不应再按 12 个文件拒绝');
    assert.equal(resolved.at(-1).type, 'application/pdf');
    assert.throws(
      () => store.resolveAttachments(otherUserId, [attachments[0].id]),
      (error) => error.code === 'MATERIAL_ATTACHMENT_NOT_FOUND',
    );
    assert.throws(
      () => store.createAttachment({ userId, name: '伪装.png', type: 'image/png', dataUrl: GIF_DATA_URL }),
      (error) => error.code === 'MATERIAL_TYPE_MISMATCH',
    );
    store.deleteAttachments(userId, attachments.map((item) => item.id));
    assert.throws(
      () => store.openAttachment(userId, attachments[0].id),
      (error) => error.code === 'MATERIAL_ATTACHMENT_NOT_FOUND',
    );
    assert.equal(store.deleteUserAttachments([userId]), 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('验证注册邀请奖励原子且幂等，管理员桥接账号和生成中账号不可删除', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-users-'));
  try {
    const store = createDataStore(dataDir);
    const settings = {
      enabled: true,
      rewardMode: 'both',
      inviterRewardCredits: 4,
      inviteeRewardCredits: 2,
      maxRewardsPerUser: 1,
    };
    const inviter = store.registerUser(userInput('inviter@example.com', 3));
    const code = store.getReferralOverview(inviter.id, settings).code;
    const invitee = store.registerUser({
      ...userInput('invitee@example.com', 3),
      verifiedAt: new Date().toISOString(),
      verifiedChannel: 'email',
      referralCode: code,
      referralSettings: settings,
      inviteeFingerprint: 'fingerprint-one',
    });
    assert.equal(store.findUserById(inviter.id).credits, 7);
    assert.equal(invitee.credits, 5);
    assert.equal(store.getReferralOverview(inviter.id, settings).stats.rewardedCount, 1);
    const second = store.registerUser({
      ...userInput('second@example.com', 3),
      verifiedAt: new Date().toISOString(),
      verifiedChannel: 'email',
      referralCode: code,
      referralSettings: settings,
      inviteeFingerprint: 'fingerprint-two',
    });
    assert.equal(second.credits, 3, '达到邀请奖励上限后不得继续发放');
    assert.equal(store.findUserById(inviter.id).credits, 7);

    const admin = store.ensureAdminTeacherUser({
      account: 'owner',
      accountKey: 'owner',
      password: { algorithm: 'test', salt: 'x', hash: 'y', keyLength: 1 },
      credits: 3,
    });
    assert.equal(store.listUsersForAdmin().items.find((user) => user.id === admin.id).deletable, false);
    assert.throws(
      () => store.deleteUsers([admin.id]),
      (error) => error.code === 'ADMIN_TEACHER_DELETE_FORBIDDEN',
    );
    const reservation = store.reserveGeneration(invitee.id);
    assert.equal(reservation.ok, true);
    assert.throws(
      () => store.deleteUsers([invitee.id]),
      (error) => error.code === 'USER_GENERATION_IN_PROGRESS',
    );
    store.releaseGeneration(reservation);
    const deleted = store.deleteUsers([invitee.id, second.id]);
    assert.equal(deleted.length, 2);
    assert.equal(store.findUserById(invitee.id), null);
    const persisted = JSON.parse(readFileSync(join(dataDir, 'users.json'), 'utf8'));
    assert.equal(persisted.referrals.length, 2, '邀请记录应保留用于防止删号后重复领取');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

function userInput(account, credits) {
  return {
    account,
    accountKey: account,
    displayName: account.split('@')[0],
    subject: '语文',
    password: { algorithm: 'test', salt: 'x', hash: account, keyLength: 1 },
    credits,
    trainingConsent: true,
  };
}
