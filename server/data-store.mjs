import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export function createDataStore(dataDir, { now = () => new Date() } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });

  const usersFile = join(dataDir, 'users.json');
  const channelsFile = join(dataDir, 'model-channels.json');
  const candidatesFile = join(dataDir, 'training-candidates.json');
  const adminFile = join(dataDir, 'admin.json');
  const smtpConfigFile = join(dataDir, 'smtp-config.json');

  const usersState = readState(usersFile, { version: 1, users: [] }, '用户数据');
  const channelsState = readState(channelsFile, { version: 1, channels: [] }, '模型通道数据');
  const candidatesState = readState(candidatesFile, { version: 1, candidates: [] }, '训练候选数据');
  const quotaReservations = new Map();

  assertArray(usersState.users, 'users.json');
  assertArray(channelsState.channels, 'model-channels.json');
  assertArray(candidatesState.candidates, 'training-candidates.json');

  function findUserByAccountKey(accountKey) {
    return usersState.users.find((user) => user.accountKey === accountKey) || null;
  }

  function findUserById(userId) {
    return usersState.users.find((user) => user.id === userId) || null;
  }

  function listUsersForAdmin({ query = '', offset = 0, limit = 25 } = {}) {
    const normalizedQuery = String(query || '').trim().slice(0, 100).toLocaleLowerCase('zh-CN');
    const safeOffset = Math.max(0, Number.isSafeInteger(offset) ? offset : 0);
    const safeLimit = Math.max(1, Math.min(200, Number.isSafeInteger(limit) ? limit : 25));
    const ordered = [...usersState.users].sort((left, right) => (
      String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
      || String(left.id || '').localeCompare(String(right.id || ''))
    ));
    const matched = normalizedQuery
      ? ordered.filter((user) => [user.account, user.displayName, user.subject]
        .some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(normalizedQuery)))
      : ordered;
    const visibleUsers = matched
      .slice(safeOffset, safeOffset + safeLimit)
      .map(toAdminUserListItem);
    const summary = {
      total: usersState.users.length,
      verified: 0,
      activeMembers: 0,
      creditsRemaining: 0,
      generations: 0,
    };
    for (const user of usersState.users) {
      if (user.verifiedAt) summary.verified += 1;
      if (currentMembership(user.membershipGrants)) summary.activeMembers += 1;
      summary.creditsRemaining += nonNegativeNumber(user.credits);
      summary.generations += nonNegativeNumber(user.generationCount);
    }
    return {
      items: visibleUsers,
      summary,
      pagination: { offset: safeOffset, limit: safeLimit, total: matched.length },
    };
  }

  function registerUser({
    account,
    accountKey,
    displayName,
    subject,
    password,
    credits,
    trainingConsent,
    privacyAcceptedAt = null,
    privacyPolicyUpdatedAt = null,
    verifiedAt = null,
    verifiedChannel = null,
  }) {
    if (findUserByAccountKey(accountKey)) return null;
    const now = new Date().toISOString();
    const user = {
      id: `usr_${randomUUID()}`,
      account,
      accountKey,
      displayName,
      subject,
      password,
      credits,
      generationCount: 0,
      trainingConsent: Boolean(trainingConsent),
      trainingConsentAt: trainingConsent ? now : null,
      privacyAcceptedAt,
      privacyPolicyUpdatedAt,
      verifiedAt,
      verifiedChannel,
      createdAt: now,
      updatedAt: now,
    };
    usersState.users.push(user);
    writeState(usersFile, usersState);
    return user;
  }

  function ensureAdminTeacherUser({ account, accountKey, password, credits }) {
    const existing = findUserByAccountKey(accountKey);
    const timestamp = new Date().toISOString();
    if (existing) {
      // This record is only synchronized after the caller has verified the
      // current administrator credentials. Never take over an unrelated
      // teacher account that happens to use the same identifier; only an
      // existing bridge (or its explicit legacy marker) may be synchronized.
      if (existing.role !== 'admin_teacher' && existing.verifiedChannel !== 'admin_credentials') return null;
      const previous = structuredClone(existing);
      const credentialsChanged = existing.accountKey !== accountKey || !samePasswordRecord(existing.password, password);
      try {
        existing.account = account;
        existing.accountKey = accountKey;
        existing.displayName = account;
        existing.password = password;
        existing.role = 'admin_teacher';
        existing.verifiedAt = existing.verifiedAt || timestamp;
        existing.verifiedChannel = existing.verifiedChannel || 'admin_credentials';
        if (credentialsChanged) existing.passwordChangedAt = timestamp;
        existing.updatedAt = timestamp;
        writeState(usersFile, usersState);
        return existing;
      } catch (error) {
        replaceObject(existing, previous);
        throw error;
      }
    }
    const user = {
      id: `usr_${randomUUID()}`,
      account,
      accountKey,
      displayName: account,
      subject: '',
      password,
      credits,
      generationCount: 0,
      role: 'admin_teacher',
      trainingConsent: true,
      trainingConsentAt: timestamp,
      privacyAcceptedAt: timestamp,
      privacyPolicyUpdatedAt: null,
      verifiedAt: timestamp,
      verifiedChannel: 'admin_credentials',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    usersState.users.push(user);
    try {
      writeState(usersFile, usersState);
      return user;
    } catch (error) {
      const index = usersState.users.indexOf(user);
      if (index >= 0) usersState.users.splice(index, 1);
      throw error;
    }
  }

  function canMigrateAdminTeacherUser({ previousAccountKey, accountKey }) {
    const previous = findUserByAccountKey(previousAccountKey);
    const bridge = isAdminTeacherBridge(previous) ? previous : null;
    const target = findUserByAccountKey(accountKey);
    if (!target) return true;
    if (bridge) return target === bridge;
    return isAdminTeacherBridge(target);
  }

  function migrateAdminTeacherUser({ previousAccountKey, account, accountKey, password, credits }) {
    if (!canMigrateAdminTeacherUser({ previousAccountKey, accountKey })) return null;
    const previous = findUserByAccountKey(previousAccountKey);
    const target = findUserByAccountKey(accountKey);
    const existing = isAdminTeacherBridge(previous)
      ? previous
      : isAdminTeacherBridge(target) ? target : null;
    if (!existing) return ensureAdminTeacherUser({ account, accountKey, password, credits });

    const timestamp = new Date().toISOString();
    const previousState = structuredClone(existing);
    try {
      existing.account = account;
      existing.accountKey = accountKey;
      existing.displayName = account;
      existing.password = password;
      existing.role = 'admin_teacher';
      existing.verifiedAt = existing.verifiedAt || timestamp;
      existing.verifiedChannel = 'admin_credentials';
      existing.passwordChangedAt = timestamp;
      existing.updatedAt = timestamp;
      writeState(usersFile, usersState);
      return existing;
    } catch (error) {
      replaceObject(existing, previousState);
      throw error;
    }
  }

  function updateUserPassword(userId, password) {
    const user = findUserById(userId);
    if (!user) return null;
    user.password = password;
    user.passwordChangedAt = new Date().toISOString();
    user.updatedAt = user.passwordChangedAt;
    writeState(usersFile, usersState);
    return user;
  }

  function markUserVerified(userId, channel) {
    const user = findUserById(userId);
    if (!user) return null;
    user.verifiedAt = user.verifiedAt || new Date().toISOString();
    user.verifiedChannel = user.verifiedChannel || channel;
    user.updatedAt = new Date().toISOString();
    writeState(usersFile, usersState);
    return user;
  }

  function recordUserLogin(userId) {
    const user = findUserById(userId);
    if (!user) return null;
    const timestamp = activityTimestamp(now);
    accrueOnlineSeconds(user, timestamp);
    user.lastLoginAt = timestamp.toISOString();
    user.lastSeenAt = timestamp.toISOString();
    user.loginCount = nonNegativeNumber(user.loginCount) + 1;
    user.updatedAt = timestamp.toISOString();
    writeState(usersFile, usersState);
    return user;
  }

  function touchUserActivity(userId) {
    const user = findUserById(userId);
    if (!user) return null;
    const timestamp = activityTimestamp(now);
    const lastSeen = validDate(user.lastSeenAt);
    if (lastSeen && timestamp.getTime() - lastSeen.getTime() < 60_000) return user;
    accrueOnlineSeconds(user, timestamp);
    user.lastSeenAt = timestamp.toISOString();
    user.updatedAt = timestamp.toISOString();
    writeState(usersFile, usersState);
    return user;
  }

  function grantMembershipPurchase({ orderId, userId, planId, entitlement, paidAt }) {
    const normalizedOrderId = String(orderId || '').trim();
    const normalizedPlanId = String(planId || '').trim();
    if (!/^pay_[0-9a-f-]{36}$/i.test(normalizedOrderId)) throw new Error('支付权益缺少有效订单号');
    if (!/^[A-Za-z0-9_.:-]{2,80}$/.test(normalizedPlanId)) throw new Error('支付权益缺少有效套餐标识');
    const user = findUserById(userId);
    if (!user) throw new Error('支付订单对应的用户不存在');
    const normalized = normalizeMembershipEntitlement(entitlement, normalizedPlanId);
    const grants = Array.isArray(user.membershipGrants) ? user.membershipGrants : [];
    const existing = grants.find((grant) => grant.orderId === normalizedOrderId);
    if (existing) {
      return { user, grant: structuredClone(existing), duplicate: true };
    }

    const grantedAtDate = validDate(paidAt) || validDate(now()) || new Date();
    let startsAtDate = grantedAtDate;
    for (const grant of grants) {
      // The current billing model does not calculate upgrade/downgrade proration. Queue every paid
      // membership after the latest existing grant so users never lose days.
      if (grant.status === 'revoked') continue;
      const candidate = validDate(grant.expiresAt);
      if (candidate && candidate > startsAtDate) startsAtDate = candidate;
    }
    const expiresAtDate = new Date(startsAtDate.getTime() + normalized.durationDays * 24 * 60 * 60 * 1000);
    const grant = {
      id: `ent_${randomUUID()}`,
      orderId: normalizedOrderId,
      planId: normalizedPlanId,
      type: normalized.type,
      tier: normalized.tier,
      tierRank: normalized.tierRank,
      billingPeriod: normalized.billingPeriod,
      durationDays: normalized.durationDays,
      creditsGranted: normalized.credits,
      catalogVersion: normalized.catalogVersion,
      quoteId: normalized.quoteId,
      status: 'granted',
      grantedAt: grantedAtDate.toISOString(),
      startsAt: startsAtDate.toISOString(),
      expiresAt: expiresAtDate.toISOString(),
    };
    const previous = {
      credits: user.credits,
      membershipGrants: user.membershipGrants,
      creditLedger: user.creditLedger,
      updatedAt: user.updatedAt,
    };
    try {
      user.credits = Number(user.credits || 0) + normalized.credits;
      user.membershipGrants = [...grants, grant];
      user.creditLedger = [
        ...(Array.isArray(user.creditLedger) ? user.creditLedger : []),
        {
          id: `credit_${randomUUID()}`,
          type: 'payment_grant',
          amount: normalized.credits,
          balanceAfter: user.credits,
          orderId: normalizedOrderId,
          planId: normalizedPlanId,
          createdAt: grantedAtDate.toISOString(),
        },
      ];
      user.updatedAt = grantedAtDate.toISOString();
      writeState(usersFile, usersState);
      return { user, grant: structuredClone(grant), duplicate: false };
    } catch (error) {
      Object.assign(user, previous);
      throw error;
    }
  }

  function reserveGeneration(userId) {
    const user = findUserById(userId);
    if (!user) return { ok: false, reason: 'missing_user', credits: 0 };
    const reserved = quotaReservations.get(userId) || 0;
    if (Number(user.credits || 0) - reserved < 1) {
      return { ok: false, reason: 'quota', credits: Number(user.credits || 0) };
    }
    quotaReservations.set(userId, reserved + 1);
    return { ok: true, id: randomUUID(), userId };
  }

  function commitGeneration(reservation) {
    const user = findUserById(reservation.userId);
    if (!user || Number(user.credits || 0) < 1) {
      releaseReservation(reservation);
      return null;
    }

    const previous = {
      credits: user.credits,
      generationCount: user.generationCount,
      updatedAt: user.updatedAt,
    };
    try {
      user.credits = Number(user.credits) - 1;
      user.generationCount = Number(user.generationCount || 0) + 1;
      user.updatedAt = new Date().toISOString();
      writeState(usersFile, usersState);
      return user;
    } catch (error) {
      Object.assign(user, previous);
      throw error;
    } finally {
      releaseReservation(reservation);
    }
  }

  function releaseGeneration(reservation) {
    releaseReservation(reservation);
  }

  function releaseReservation(reservation) {
    if (!reservation?.userId) return;
    const current = quotaReservations.get(reservation.userId) || 0;
    if (current <= 1) quotaReservations.delete(reservation.userId);
    else quotaReservations.set(reservation.userId, current - 1);
  }

  function readAdmin() {
    if (!existsSync(adminFile)) return null;
    const admin = readState(adminFile, null, '管理员数据');
    return admin && typeof admin === 'object' ? admin : null;
  }

  function initializeAdmin(admin) {
    try {
      writeFileSync(adminFile, `${JSON.stringify(admin, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      return true;
    } catch (error) {
      if (error?.code === 'EEXIST') return false;
      throw error;
    }
  }

  function updateAdmin(updater) {
    const current = readAdmin();
    if (!current) return null;
    const updated = updater(structuredClone(current));
    if (!updated || typeof updated !== 'object' || Array.isArray(updated)) {
      throw new Error('管理员更新结果无效');
    }
    writeState(adminFile, updated);
    return updated;
  }

  function readSmtpConfig() {
    if (!existsSync(smtpConfigFile)) return null;
    const config = readState(smtpConfigFile, null, 'SMTP 配置');
    return config && typeof config === 'object' && !Array.isArray(config) ? config : null;
  }

  function saveSmtpConfig(config) {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('SMTP 配置无效');
    }
    writeState(smtpConfigFile, config);
    return config;
  }

  function listChannels() {
    return [...channelsState.channels].sort((left, right) => (
      Number(left.priority || 100) - Number(right.priority || 100)
      || left.createdAt.localeCompare(right.createdAt)
    ));
  }

  function findChannel(channelId) {
    return channelsState.channels.find((channel) => channel.id === channelId) || null;
  }

  function addChannel(channel) {
    channelsState.channels.push(channel);
    writeState(channelsFile, channelsState);
    return channel;
  }

  function updateChannel(channelId, updater) {
    const channel = findChannel(channelId);
    if (!channel) return null;
    const updated = updater({ ...channel });
    const index = channelsState.channels.findIndex((item) => item.id === channelId);
    channelsState.channels[index] = updated;
    writeState(channelsFile, channelsState);
    return updated;
  }

  function addTrainingCandidate(candidate) {
    const existing = candidatesState.candidates.find((item) => (
      item.ownerRef === candidate.ownerRef
      && item.sample?.eligibility?.dedupeHash === candidate.sample?.eligibility?.dedupeHash
      && item.reviewStatus !== 'revoked'
    ));
    if (existing) return { candidate: existing, created: false };
    candidatesState.candidates.push(candidate);
    writeState(candidatesFile, candidatesState);
    return { candidate, created: true };
  }

  function trainingSummary() {
    const summary = {
      total: candidatesState.candidates.length,
      pendingReview: 0,
      approved: 0,
      rejected: 0,
      revoked: 0,
    };
    for (const candidate of candidatesState.candidates) {
      if (candidate.reviewStatus === 'pending_review') summary.pendingReview += 1;
      else if (candidate.reviewStatus === 'approved') summary.approved += 1;
      else if (candidate.reviewStatus === 'rejected') summary.rejected += 1;
      else if (candidate.reviewStatus === 'revoked') summary.revoked += 1;
    }
    return summary;
  }

  function listTrainingCandidates({ offset, limit }) {
    const ordered = [...candidatesState.candidates].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return ordered.slice(offset, offset + limit);
  }

  function revokeTrainingCandidates(ownerRef) {
    const now = new Date().toISOString();
    let count = 0;
    for (const candidate of candidatesState.candidates) {
      if (candidate.ownerRef !== ownerRef || candidate.reviewStatus === 'revoked') continue;
      candidate.reviewStatus = 'revoked';
      candidate.sample.candidateStatus = 'revoked';
      candidate.sample.authorization.trainingAllowed = false;
      candidate.sample.authorization.revokedAt = now;
      candidate.sample.eligibility.eligible = false;
      candidate.sample.eligibility.reasons = ['数据用途状态已撤回'];
      candidate.sample.updatedAt = now;
      count += 1;
    }
    if (count) writeState(candidatesFile, candidatesState);
    return count;
  }

  return {
    addChannel,
    addTrainingCandidate,
    canMigrateAdminTeacherUser,
    commitGeneration,
    findChannel,
    findUserByAccountKey,
    findUserById,
    ensureAdminTeacherUser,
    grantMembershipPurchase,
    initializeAdmin,
    listChannels,
    listUsersForAdmin,
    listTrainingCandidates,
    markUserVerified,
    migrateAdminTeacherUser,
    readAdmin,
    readSmtpConfig,
    recordUserLogin,
    registerUser,
    releaseGeneration,
    reserveGeneration,
    revokeTrainingCandidates,
    saveSmtpConfig,
    trainingSummary,
    touchUserActivity,
    updateChannel,
    updateAdmin,
    updateUserPassword,
  };
}

function toAdminUserListItem(user) {
  const membership = currentMembership(user?.membershipGrants);
  return {
    id: String(user?.id || ''),
    account: String(user?.account || ''),
    displayName: String(user?.displayName || ''),
    subject: String(user?.subject || ''),
    credits: nonNegativeNumber(user?.credits),
    generationCount: nonNegativeNumber(user?.generationCount),
    verified: Boolean(user?.verifiedAt),
    verifiedAt: user?.verifiedAt || null,
    verifiedChannel: user?.verifiedChannel || null,
    membership: membership ? {
      planId: membership.planId,
      tier: membership.tier,
      billingPeriod: membership.billingPeriod,
      startsAt: membership.startsAt,
      expiresAt: membership.expiresAt,
      status: membership.status,
    } : null,
    lastLoginAt: user?.lastLoginAt || null,
    lastSeenAt: user?.lastSeenAt || null,
    loginCount: nonNegativeNumber(user?.loginCount),
    onlineSeconds: nonNegativeNumber(user?.onlineSeconds),
    createdAt: user?.createdAt || null,
    updatedAt: user?.updatedAt || null,
  };
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function isAdminTeacherBridge(user) {
  return Boolean(user && (user.role === 'admin_teacher' || user.verifiedChannel === 'admin_credentials'));
}

function samePasswordRecord(left, right) {
  return Boolean(
    left
    && right
    && left.algorithm === right.algorithm
    && left.salt === right.salt
    && left.hash === right.hash
    && Number(left.keyLength) === Number(right.keyLength),
  );
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function activityTimestamp(now) {
  const date = validDate(now());
  if (!date) throw new Error('用户活跃时间无效');
  return date;
}

function accrueOnlineSeconds(user, timestamp) {
  const lastSeen = validDate(user.lastSeenAt);
  const elapsedSeconds = lastSeen
    ? Math.floor((timestamp.getTime() - lastSeen.getTime()) / 1000)
    : 0;
  const activeSeconds = elapsedSeconds > 0 && elapsedSeconds <= 15 * 60 ? elapsedSeconds : 0;
  user.onlineSeconds = nonNegativeNumber(user.onlineSeconds) + activeSeconds;
}

export function publicUser(user) {
  const membership = currentMembership(user?.membershipGrants);
  return {
    id: user.id,
    account: user.account,
    identifier: user.account,
    displayName: user.displayName,
    subject: user.subject || '',
    credits: Number(user.credits || 0),
    generationCount: Number(user.generationCount || 0),
    privacyAcceptedAt: user.privacyAcceptedAt || null,
    verifiedAt: user.verifiedAt || null,
    verifiedChannel: user.verifiedChannel || null,
    membership,
    createdAt: user.createdAt,
  };
}

function currentMembership(grants, at = new Date()) {
  if (!Array.isArray(grants)) return null;
  const timestamp = at.getTime();
  const active = grants.filter((grant) => {
    if (grant?.status !== 'granted') return false;
    const startsAt = validDate(grant.startsAt)?.getTime();
    const expiresAt = validDate(grant.expiresAt)?.getTime();
    return Number.isFinite(startsAt) && Number.isFinite(expiresAt) && startsAt <= timestamp && expiresAt > timestamp;
  }).sort((left, right) => (
    Number(right.tierRank || 0) - Number(left.tierRank || 0)
    || String(right.expiresAt).localeCompare(String(left.expiresAt))
  ));
  const grant = active[0];
  if (!grant) return null;
  return {
    planId: grant.planId,
    tier: grant.tier,
    tierRank: grant.tierRank,
    billingPeriod: grant.billingPeriod,
    startsAt: grant.startsAt,
    expiresAt: grant.expiresAt,
    status: 'active',
    source: 'payment',
  };
}

function normalizeMembershipEntitlement(entitlement, planId) {
  if (!entitlement || typeof entitlement !== 'object' || Array.isArray(entitlement)) {
    throw new Error('支付订单缺少服务端权益快照');
  }
  const normalized = {
    type: String(entitlement.type || ''),
    planId: String(entitlement.planId || ''),
    tier: String(entitlement.tier || ''),
    tierRank: Number(entitlement.tierRank),
    billingPeriod: String(entitlement.billingPeriod || ''),
    durationDays: Number(entitlement.durationDays),
    credits: Number(entitlement.credits),
    catalogVersion: String(entitlement.catalogVersion || '').slice(0, 80),
    quoteId: String(entitlement.quoteId || '').slice(0, 120),
  };
  if (normalized.type !== 'membership' || normalized.planId !== planId) throw new Error('支付订单权益快照与套餐不一致');
  if (!/^[A-Za-z0-9_.:-]{2,40}$/.test(normalized.tier)) throw new Error('支付订单会员等级无效');
  if (!Number.isSafeInteger(normalized.tierRank) || normalized.tierRank < 1) throw new Error('支付订单会员等级权重无效');
  if (!['month', 'quarter', 'half_year', 'year'].includes(normalized.billingPeriod)) throw new Error('支付订单会员周期无效');
  if (!Number.isSafeInteger(normalized.durationDays) || normalized.durationDays < 1 || normalized.durationDays > 3_660) throw new Error('支付订单会员有效期无效');
  if (!Number.isSafeInteger(normalized.credits) || normalized.credits < 0 || normalized.credits > 1_000_000) throw new Error('支付订单点数权益无效');
  return normalized;
}

function validDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function readState(filename, fallback, label) {
  if (!existsSync(filename)) return structuredClone(fallback);
  try {
    return JSON.parse(readFileSync(filename, 'utf8'));
  } catch (error) {
    throw new Error(`${label}无法读取，请检查 ${filename}：${error.message}`);
  }
}

function writeState(filename, value) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function assertArray(value, filename) {
  if (!Array.isArray(value)) throw new Error(`${filename} 的数据结构无效`);
}
