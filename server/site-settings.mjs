import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

const DEFAULT_PRIVACY_POLICY = `教师帮会为创建账号、发送验证码、生成和修改教案、导出文件、处理订单与保障账号安全而处理你主动提交的信息。

上传的教材图片、文字和最终教案会分别保存，并按照当前公布的保留规则处理。请勿上传与备课无关的个人信息，也请确认你有权将相关教材用于备课。

为持续改进教案生成质量，平台可能在去除直接身份信息、完成版权与安全审核后，使用最终定稿及其修改记录改进模型能力。原始账号密码、支付凭据、邮箱或短信密钥不会用于此目的。

平台会采用访问控制、传输加密和敏感配置加密存储等措施降低数据泄露风险。你可以通过客服邮箱咨询数据处理规则或提出依法享有的权利请求。`;

export function createSiteSettingsStore({
  dataDir,
  registrationVerificationRequired = true,
  now = () => new Date(),
} = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const filename = join(dataDir, 'site-settings.json');
  let state = readSettings(filename, { registrationVerificationRequired, now });

  function getPublicSettings() {
    return {
      siteName: state.siteName,
      supportEmail: state.supportEmail,
      registrationOpen: state.registrationOpen,
      registrationVerificationRequired: state.registrationVerificationRequired,
      privacyPolicy: {
        title: state.privacyPolicyTitle,
        content: state.privacyPolicyContent,
        updatedAt: state.privacyPolicyUpdatedAt,
      },
      updatedAt: state.updatedAt,
    };
  }

  function getAdminSettings() {
    return structuredClone(state);
  }

  function saveSettings(input, actor = 'admin') {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw settingsError(400, 'SITE_SETTINGS_INVALID', '系统设置必须是对象');
    }
    const allowed = new Set([
      'expectedUpdatedAt',
      'siteName',
      'supportEmail',
      'registrationOpen',
      'registrationVerificationRequired',
      'privacyPolicyTitle',
      'privacyPolicyContent',
    ]);
    const unknown = Object.keys(input).filter((key) => !allowed.has(key));
    if (unknown.length) throw settingsError(400, 'SITE_SETTINGS_FIELD_UNKNOWN', `不支持的系统设置：${unknown.join('、')}`);
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== state.updatedAt) {
      throw settingsError(409, 'SITE_SETTINGS_CONFLICT', '系统设置已被其他管理员修改，请刷新后重试');
    }

    const previousSiteName = state.siteName;
    const siteName = cleanText(input.siteName ?? previousSiteName, 40);
    const supportEmail = cleanText(input.supportEmail ?? state.supportEmail, 254).toLowerCase();
    const siteNameChanged = siteName !== previousSiteName;
    const rawPrivacyPolicyTitle = input.privacyPolicyTitle ?? state.privacyPolicyTitle;
    const rawPrivacyPolicyContent = input.privacyPolicyContent ?? state.privacyPolicyContent;
    const privacyPolicyTitleSource = siteNameChanged
      ? replaceBrand(rawPrivacyPolicyTitle, previousSiteName, siteName)
      : rawPrivacyPolicyTitle;
    const privacyPolicyContentSource = siteNameChanged
      ? replaceBrand(rawPrivacyPolicyContent, previousSiteName, siteName)
      : rawPrivacyPolicyContent;
    const privacyPolicyTitle = cleanText(privacyPolicyTitleSource, 80);
    const privacyPolicyContent = normalizeMultiline(privacyPolicyContentSource, 20_000);
    if (siteName.length < 2) throw settingsError(422, 'SITE_NAME_INVALID', '站点名称至少需要 2 个字符');
    if (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) {
      throw settingsError(422, 'SUPPORT_EMAIL_INVALID', '客服邮箱格式无效');
    }
    if (privacyPolicyTitle.length < 2) throw settingsError(422, 'PRIVACY_POLICY_TITLE_INVALID', '隐私说明标题至少需要 2 个字符');
    if (privacyPolicyContent.length < 100) throw settingsError(422, 'PRIVACY_POLICY_CONTENT_INVALID', '数据与隐私说明至少需要 100 个字符');
    for (const field of ['registrationOpen', 'registrationVerificationRequired']) {
      if (input[field] !== undefined && typeof input[field] !== 'boolean') {
        throw settingsError(422, 'SITE_SETTINGS_BOOLEAN_INVALID', `${field} 必须是布尔值`);
      }
    }

    const timestamp = toIso(now());
    const policyChanged = privacyPolicyTitle !== state.privacyPolicyTitle || privacyPolicyContent !== state.privacyPolicyContent;
    state = {
      version: 1,
      siteName,
      supportEmail,
      registrationOpen: input.registrationOpen ?? state.registrationOpen,
      registrationVerificationRequired: input.registrationVerificationRequired ?? state.registrationVerificationRequired,
      privacyPolicyTitle,
      privacyPolicyContent,
      privacyPolicyUpdatedAt: policyChanged ? timestamp : state.privacyPolicyUpdatedAt,
      updatedAt: timestamp,
      updatedBy: cleanText(actor, 100) || 'admin',
    };
    writeSettings(filename, state);
    return getAdminSettings();
  }

  return { getAdminSettings, getPublicSettings, saveSettings };
}

function readSettings(filename, { registrationVerificationRequired, now }) {
  const timestamp = toIso(now());
  const defaults = {
    version: 1,
    siteName: '教师帮',
    supportEmail: '',
    registrationOpen: true,
    registrationVerificationRequired: Boolean(registrationVerificationRequired),
    privacyPolicyTitle: '数据与隐私说明',
    privacyPolicyContent: DEFAULT_PRIVACY_POLICY,
    privacyPolicyUpdatedAt: timestamp,
    updatedAt: timestamp,
    updatedBy: 'system-default',
  };
  if (!existsSync(filename)) return defaults;
  let parsed;
  try { parsed = JSON.parse(readFileSync(filename, 'utf8')); }
  catch (error) { throw new Error(`site-settings.json 无法读取：${error.message}`); }
  if (!parsed || parsed.version !== 1 || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('site-settings.json 数据结构无效');
  }
  return {
    ...defaults,
    ...parsed,
    registrationOpen: parsed.registrationOpen !== false,
    registrationVerificationRequired: parsed.registrationVerificationRequired === true,
  };
}

function writeSettings(filename, state) {
  const temporary = `${filename}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, filename);
}

function cleanText(value, maximum) {
  return String(value ?? '').replace(/[\r\n\0]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function normalizeMultiline(value, maximum) {
  return String(value ?? '').replace(/\0/g, '').replace(/\r\n?/g, '\n').trim().slice(0, maximum);
}

function replaceBrand(value, previousSiteName, siteName) {
  if (!previousSiteName || previousSiteName === siteName) return value;
  return String(value ?? '').split(previousSiteName).join(siteName);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('系统时间无效');
  return date.toISOString();
}

function settingsError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}
