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
  updateTrainingConsent: (trainingConsent) => request('/api/auth/training-consent', {
    method: 'POST',
    body: { trainingConsent },
    timeout: 20_000,
  }),
  adminBootstrap: (body) => request('/api/admin/bootstrap', { method: 'POST', body, timeout: 30_000 }),
  adminLogin: (body) => request('/api/admin/login', { method: 'POST', body, timeout: 20_000 }),
  adminVerifyMfa: (body) => request('/api/admin/mfa/verify', { method: 'POST', body, timeout: 20_000 }),
  adminSession: () => request('/api/admin/session', { timeout: 10_000 }),
  adminLogout: () => request('/api/admin/logout', { method: 'POST', body: {}, timeout: 10_000 }),
  getAdminMfa: () => request('/api/admin/security/mfa', { timeout: 10_000 }),
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
  getProviders: () => request('/api/admin/providers', { timeout: 15_000 }),
  createProvider: (body) => request('/api/admin/providers', { method: 'POST', body, timeout: 30_000 }),
  updateProvider: (providerId, body) => request(`/api/admin/providers/${encodeURIComponent(providerId)}`, { method: 'PATCH', body, timeout: 20_000 }),
  getTrainingStats: () => request('/api/admin/training/stats', { timeout: 10_000 }),
  getTrainingCandidates: (query = '') => request(`/api/admin/training/candidates${query ? `?${query}` : ''}`, { timeout: 15_000 }),
  generateLesson: (body) => request('/api/ai/generate', { method: 'POST', body }),
  reviseLesson: (body) => request('/api/ai/revise', { method: 'POST', body }),
  buildKnowledgeMap: (body) => request('/api/workflow/knowledge-map', { method: 'POST', body, timeout: 30_000 }),
  recommendPaper: (body) => request('/api/workflow/papers/recommend', { method: 'POST', body, timeout: 30_000 }),
  submitTrainingCandidate: (body) => request('/api/training/candidates', { method: 'POST', body, timeout: 20_000 }),
};
