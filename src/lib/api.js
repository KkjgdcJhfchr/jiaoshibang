export class ApiError extends Error {
  constructor(message, { status = 0, code = '', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout ?? 180_000);
  try {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(
        payload.error?.message || payload.message || (typeof payload.error === 'string' ? payload.error : '') || `请求失败（${response.status}）`,
        {
          status: response.status,
          code: payload.error?.code || payload.code || '',
          details: payload.error?.details || payload.data || null,
        },
      );
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError('请求处理时间较长，本次请求已超时，请稍后重试。', { code: 'REQUEST_TIMEOUT' });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  health: () => request('/api/health', { timeout: 8_000 }),
  getSiteConfig: () => request('/api/site-config', { timeout: 10_000 }),
  register: (body) => request('/api/auth/register', { method: 'POST', body, timeout: 20_000 }),
  login: (body) => request('/api/auth/login', { method: 'POST', body, timeout: 20_000 }),
  sendVerificationCode: (body) => request('/api/auth/verification-codes', { method: 'POST', body, timeout: 20_000 }),
  loginWithCode: (body) => request('/api/auth/login/code', { method: 'POST', body, timeout: 20_000 }),
  requestPasswordReset: (body) => request('/api/auth/password-reset/request', { method: 'POST', body, timeout: 20_000 }),
  confirmPasswordReset: (body) => request('/api/auth/password-reset/confirm', { method: 'POST', body, timeout: 20_000 }),
  getPaymentPlans: () => request('/api/payments/plans', { timeout: 15_000 }),
  createPaymentOrder: (body, idempotencyKey) => request('/api/payments/orders', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
    timeout: 30_000,
  }),
  getPaymentOrder: (orderId) => request(`/api/payments/orders/${encodeURIComponent(orderId)}`, { timeout: 15_000 }),
  authSession: () => request('/api/auth/session', { timeout: 10_000 }),
  logout: () => request('/api/auth/logout', { method: 'POST', body: {}, timeout: 10_000 }),
  adminBootstrap: (body) => request('/api/admin/bootstrap', { method: 'POST', body, timeout: 30_000 }),
  adminLogin: (body) => request('/api/admin/login', { method: 'POST', body, timeout: 20_000 }),
  adminVerifyMfa: (body) => request('/api/admin/mfa/verify', { method: 'POST', body, timeout: 20_000 }),
  adminSession: () => request('/api/admin/session', { timeout: 10_000 }),
  adminLogout: () => request('/api/admin/logout', { method: 'POST', body: {}, timeout: 10_000 }),
  getAdminMfa: () => request('/api/admin/security/mfa', { timeout: 10_000 }),
  getAdminCredentials: () => request('/api/admin/system/credentials', { timeout: 10_000 }),
  updateAdminCredentials: (body) => request('/api/admin/system/credentials', { method: 'PUT', body, timeout: 20_000 }),
  enrollAdminTotp: (body) => request('/api/admin/security/mfa/totp/enroll', { method: 'POST', body, timeout: 20_000 }),
  confirmAdminTotp: (body) => request('/api/admin/security/mfa/totp/confirm', { method: 'POST', body, timeout: 20_000 }),
  enrollAdminEmail: (body) => request('/api/admin/security/mfa/email/enroll', { method: 'POST', body, timeout: 20_000 }),
  confirmAdminEmail: (body) => request('/api/admin/security/mfa/email/confirm', { method: 'POST', body, timeout: 20_000 }),
  requestAdminMfaEmailCode: (body) => request('/api/admin/security/mfa/email/code', { method: 'POST', body, timeout: 20_000 }),
  setAdminMfaPreferred: (body) => request('/api/admin/security/mfa/preferred', { method: 'POST', body, timeout: 20_000 }),
  disableAdminMfa: (body) => request('/api/admin/security/mfa/disable', { method: 'POST', body, timeout: 20_000 }),
  regenerateAdminRecovery: (body) => request('/api/admin/security/mfa/recovery/regenerate', { method: 'POST', body, timeout: 20_000 }),
  getSmtpSettings: () => request('/api/admin/communication/smtp', { timeout: 10_000 }),
  saveSmtpSettings: (body) => request('/api/admin/communication/smtp', { method: 'PUT', body, timeout: 20_000 }),
  testSmtp: (body) => request('/api/admin/communication/smtp/test', { method: 'POST', body, timeout: 20_000 }),
  getSmsSettings: () => request('/api/admin/communication/sms', { timeout: 10_000 }),
  saveSmsSettings: (body) => request('/api/admin/communication/sms', { method: 'PUT', body, timeout: 20_000 }),
  testSms: (body) => request('/api/admin/communication/sms/test', { method: 'POST', body, timeout: 20_000 }),
  getSystemSettings: () => request('/api/admin/system/settings', { timeout: 10_000 }),
  saveSystemSettings: (body) => request('/api/admin/system/settings', { method: 'PUT', body, timeout: 20_000 }),
  getAdminContent: () => request('/api/admin/content', { timeout: 15_000 }),
  createAnnouncement: (body) => request('/api/admin/announcements', { method: 'POST', body, timeout: 20_000 }),
  updateAnnouncement: (announcementId, body) => request(`/api/admin/announcements/${encodeURIComponent(announcementId)}`, { method: 'PUT', body, timeout: 20_000 }),
  deleteAnnouncement: (announcementId, body = {}) => request(`/api/admin/announcements/${encodeURIComponent(announcementId)}`, { method: 'DELETE', body, timeout: 20_000 }),
  saveTutorial: (body) => request('/api/admin/tutorial', { method: 'PUT', body, timeout: 20_000 }),
  getAppContentBootstrap: () => request('/api/app/content/bootstrap', { timeout: 15_000 }),
  getReferralOverview: () => request('/api/app/referrals', { timeout: 15_000 }),
  uploadLessonMaterial: (body) => request('/api/app/material-uploads', { method: 'POST', body, timeout: 60_000 }),
  deleteLessonMaterial: (attachmentId) => request(`/api/app/material-uploads/${encodeURIComponent(attachmentId)}`, { method: 'DELETE', body: {}, timeout: 20_000 }),
  acknowledgeAnnouncement: (announcementId, body) => request(`/api/app/announcements/${encodeURIComponent(announcementId)}/acknowledge`, { method: 'POST', body, timeout: 15_000 }),
  saveTutorialProgress: (body) => request('/api/app/tutorial/progress', { method: 'PUT', body, timeout: 15_000 }),
  getAdminUsers: ({ query = '', offset = 0, limit = 25 } = {}) => {
    const search = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (String(query).trim()) search.set('query', String(query).trim());
    return request(`/api/admin/users?${search}`, { timeout: 15_000 });
  },
  deleteAdminUser: (userId) => request(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE', body: {}, timeout: 20_000 }),
  bulkDeleteAdminUsers: (userIds) => request('/api/admin/users/bulk-delete', { method: 'POST', body: { userIds }, timeout: 30_000 }),
  getAdminMarketing: () => request('/api/admin/marketing', { timeout: 15_000 }),
  getAdminReferralSettings: () => request('/api/admin/marketing/referral-settings', { timeout: 15_000 }),
  createAdminMarketingAd: (body) => request('/api/admin/marketing/ads', { method: 'POST', body, timeout: 30_000 }),
  updateAdminMarketingAd: (adId, body) => request(`/api/admin/marketing/ads/${encodeURIComponent(adId)}`, { method: 'PUT', body, timeout: 30_000 }),
  deleteAdminMarketingAd: (adId) => request(`/api/admin/marketing/ads/${encodeURIComponent(adId)}`, { method: 'DELETE', body: {}, timeout: 20_000 }),
  reorderAdminMarketingAds: (ids) => request('/api/admin/marketing/ads/order', { method: 'PUT', body: { ids }, timeout: 20_000 }),
  saveAdminReferralSettings: (body) => request('/api/admin/marketing/referral-settings', { method: 'PUT', body, timeout: 20_000 }),
  getAdminPaymentConfigs: () => request('/api/admin/payments/configs', { timeout: 15_000 }),
  saveAdminPaymentConfig: (provider, body) => request(`/api/admin/payments/configs/${encodeURIComponent(provider)}`, { method: 'PUT', body, timeout: 30_000 }),
  testAdminPaymentConfig: (provider) => request(`/api/admin/payments/configs/${encodeURIComponent(provider)}/test`, { method: 'POST', body: {}, timeout: 20_000 }),
  setAdminPaymentConfigEnabled: (provider, enabled) => request(`/api/admin/payments/configs/${encodeURIComponent(provider)}/enabled`, { method: 'PATCH', body: { enabled }, timeout: 20_000 }),
  getAdminPaymentPlans: () => request('/api/admin/payments/plans', { timeout: 15_000 }),
  saveAdminPaymentPlan: (planId, body) => request(`/api/admin/payments/plans/${encodeURIComponent(planId)}`, { method: 'PUT', body, timeout: 20_000 }),
  deleteAdminPaymentPlan: (planId) => request(`/api/admin/payments/plans/${encodeURIComponent(planId)}`, { method: 'DELETE', body: {}, timeout: 20_000 }),
  getAdminPromotions: () => request('/api/admin/promotions', { timeout: 15_000 }),
  createAdminPromotion: (body) => request('/api/admin/promotions', { method: 'POST', body, timeout: 20_000 }),
  updateAdminPromotion: (promotionId, body) => request(`/api/admin/promotions/${encodeURIComponent(promotionId)}`, { method: 'PUT', body, timeout: 20_000 }),
  deleteAdminPromotion: (promotionId) => request(`/api/admin/promotions/${encodeURIComponent(promotionId)}`, { method: 'DELETE', body: {}, timeout: 20_000 }),
  listCreditResets: () => request('/api/admin/credit-resets', { timeout: 15_000 }),
  createCreditReset: (body) => request('/api/admin/credit-resets', { method: 'POST', body, timeout: 30_000 }),
  cancelCreditReset: (resetId) => request(`/api/admin/credit-resets/${encodeURIComponent(resetId)}`, { method: 'DELETE', body: {}, timeout: 20_000 }),
  getAdminPaymentOrders: ({ provider = '', status = '', offset = 0, limit = 25, query = '' } = {}) => {
    const search = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (provider) search.set('provider', provider);
    if (status) search.set('status', status);
    if (String(query).trim()) search.set('query', String(query).trim());
    return request(`/api/admin/payments/orders?${search}`, { timeout: 15_000 });
  },
  getProviders: () => request('/api/admin/providers', { timeout: 15_000 }),
  createProvider: (body) => request('/api/admin/providers', { method: 'POST', body, timeout: 30_000 }),
  discoverProvider: (body) => request('/api/admin/providers/discover', { method: 'POST', body, timeout: 90_000 }),
  updateProvider: (providerId, body) => request(`/api/admin/providers/${encodeURIComponent(providerId)}`, { method: 'PATCH', body, timeout: 20_000 }),
  testProvider: (providerId) => request(`/api/admin/providers/${encodeURIComponent(providerId)}/test`, { method: 'POST', body: {}, timeout: 90_000 }),
  deleteProvider: (providerId) => request(`/api/admin/providers/${encodeURIComponent(providerId)}`, { method: 'DELETE', timeout: 20_000 }),
  getTrainingStats: () => request('/api/admin/training/stats', { timeout: 10_000 }),
  getTrainingCandidates: (query = '') => request(`/api/admin/training/candidates${query ? `?${query}` : ''}`, { timeout: 15_000 }),
  createGenerationJob: (body, idempotencyKey) => request('/api/ai/generation-jobs', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
    timeout: 30_000,
  }),
  getGenerationJob: (jobId) => request(`/api/ai/generation-jobs/${encodeURIComponent(jobId)}`, { timeout: 20_000 }),
  generateLesson: (body) => request('/api/ai/generate', { method: 'POST', body, timeout: 660_000 }),
  reviseLesson: (body) => request('/api/ai/revise', { method: 'POST', body, timeout: 660_000 }),
  reviseCustomSections: (body) => request('/api/ai/revise-custom-sections', { method: 'POST', body, timeout: 660_000 }),
  buildKnowledgeMap: (body) => request('/api/workflow/knowledge-map', { method: 'POST', body, timeout: 30_000 }),
  recommendPaper: (body) => request('/api/workflow/papers/recommend', { method: 'POST', body, timeout: 30_000 }),
  submitTrainingCandidate: (body) => request('/api/training/candidates', { method: 'POST', body, timeout: 20_000 }),
};
