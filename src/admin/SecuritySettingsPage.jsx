import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  LoaderCircle,
  Mail,
  MessageSquareText,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useSiteConfig } from '../lib/site-config.jsx';
import './admin-security.css';

const emptySmtp = {
  host: '',
  port: 465,
  security: 'tls',
  username: '',
  password: '',
  fromName: '',
  fromEmail: '',
};

const emptySms = {
  enabled: false,
  provider: 'aliyun',
  accessKeyId: '',
  accessKeySecret: '',
  signName: '',
  templateCode: '',
  region: 'ap-guangzhou',
  sdkAppId: '',
};

const SMTP_PROVIDERS = Object.freeze({
  resend: {
    label: 'Resend（海外，提供免费额度）', host: 'smtp.resend.com', port: 465, security: 'tls', username: 'resend',
    docs: 'https://resend.com/docs/send-with-smtp',
    steps: ['在 Resend 添加并验证发信域名。', '创建 API Key，并把它填写到“SMTP 密码 / 授权码”。', '发件邮箱必须使用已经验证的域名。'],
  },
  aliyun: {
    label: '阿里企业邮箱（国内）', host: 'smtp.qiye.aliyun.com', port: 465, security: 'tls', username: '',
    docs: 'https://help.aliyun.com/zh/document_detail/36576.html',
    steps: ['开通阿里企业邮箱并完成域名解析。', '创建发件账号；如启用了客户端安全密码，请使用安全密码。', 'SMTP 账号和发件邮箱均填写完整邮箱地址。'],
  },
  qq: {
    label: 'QQ 邮箱（国内个人邮箱）', host: 'smtp.qq.com', port: 465, security: 'tls', username: '',
    docs: 'https://mail.qq.com/',
    steps: ['登录 QQ 邮箱，在“设置 → 账号”中开启 SMTP 服务。', '生成客户端授权码，不要填写 QQ 登录密码。', 'SMTP 账号和发件邮箱填写完整 QQ 邮箱地址。'],
  },
  tencentEnterprise: {
    label: '腾讯企业邮箱（国内）', host: 'smtp.exmail.qq.com', port: 465, security: 'tls', username: '',
    docs: 'https://www.qqbizmail.com/help/570.html',
    steps: ['开通腾讯企业邮箱并添加成员邮箱。', '管理员允许成员使用 SMTP，成员获取客户端授权码。', 'SMTP 账号和发件邮箱填写完整企业邮箱地址。'],
  },
  outlook: {
    label: 'Outlook.com（海外）', host: 'smtp-mail.outlook.com', port: 587, security: 'starttls', username: '',
    docs: 'https://support.microsoft.com/en-US/Outlook/pop-imap-and-smtp-settings-for-outlook-com',
    steps: ['服务器和端口可自动填入。', 'Microsoft 当前优先要求 OAuth2；本系统的基础 SMTP 认证仅适用于仍允许应用密码的账号或租户。', '若验证失败，请改用 Resend 或企业邮箱，避免降低 Microsoft 账号安全策略。'],
    warning: true,
  },
  custom: {
    label: '其他 SMTP 服务', host: '', port: 465, security: 'tls', username: '', docs: '',
    steps: ['向邮箱服务商确认 SMTP 主机、端口、加密方式和授权码。', '优先使用 TLS 465 或 STARTTLS 587。'],
  },
});

const SMS_GUIDES = Object.freeze({
  aliyun: {
    label: '阿里云短信', docs: 'https://help.aliyun.com/zh/sms/',
    steps: ['完成企业实名认证并开通短信服务。', '申请短信签名和验证码模板，等待审核通过。', '创建只授予短信发送权限的 RAM 子账号 AccessKey。', '模板变量必须与验证码模板要求一致。'],
  },
  tencent: {
    label: '腾讯云短信', docs: 'https://cloud.tencent.com/document/product/382/37745',
    steps: ['完成实名认证并开通短信服务。', '完成实名资质报备，再申请签名与验证码模板。', '在短信应用中取得 SDK AppID，并创建最小权限子账号 SecretId/SecretKey。', '填写审核通过的签名和模板 ID。'],
  },
});

function detectSmtpProvider(host) {
  return Object.entries(SMTP_PROVIDERS).find(([id, provider]) => id !== 'custom' && provider.host === host)?.[0] || 'custom';
}

export function SecuritySettingsPage({ onNotice }) {
  const { siteName } = useSiteConfig();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [smtp, setSmtp] = useState(emptySmtp);
  const [smtpProvider, setSmtpProvider] = useState('custom');
  const [sms, setSms] = useState(emptySms);
  const [smtpTestEmail, setSmtpTestEmail] = useState('');
  const [smsTestPhone, setSmsTestPhone] = useState('');
  const [smtpDirty, setSmtpDirty] = useState(false);
  const [smsDirty, setSmsDirty] = useState(false);
  const [busy, setBusy] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    const [smtpResult, smsResult] = await Promise.allSettled([
      api.getSmtpSettings(),
      api.getSmsSettings(),
    ]);
    if (smtpResult.status === 'fulfilled') {
      const value = smtpResult.value?.data?.smtp || smtpResult.value?.data || {};
      setSmtp((current) => ({
        ...current,
        host: value.host || '',
        port: Number(value.port || 465),
        security: value.security || 'starttls',
        username: value.username || '',
        fromName: value.fromName || siteName,
        fromEmail: value.fromEmail || '',
        configured: value.configured === true,
        passwordConfigured: value.passwordConfigured === true,
        testedAt: value.testedAt || null,
      }));
      setSmtpProvider(detectSmtpProvider(value.host || ''));
      setSmtpDirty(false);
    }
    if (smsResult.status === 'fulfilled') {
      const value = smsResult.value?.data?.sms || smsResult.value?.data || {};
      setSms((current) => ({
        ...current,
        enabled: value.enabled === true,
        provider: value.provider || 'aliyun',
        accessKeyId: '',
        accessKeyIdMasked: value.accessKeyIdMasked || '',
        accessKeySecret: '',
        signName: value.signName || '',
        templateCode: value.templateCode || '',
        region: value.region || 'ap-guangzhou',
        sdkAppId: value.sdkAppId || '',
        configured: value.configured === true,
      }));
      setSmsDirty(false);
    }
    const firstFailure = [smtpResult, smsResult].find((result) => result.status === 'rejected');
    if (firstFailure) setError(firstFailure.reason?.message || '部分安全设置暂时无法读取');
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  function updateSmtpField(field, value) {
    setSmtp((current) => ({ ...current, [field]: value, testedAt: null }));
    setSmtpDirty(true);
  }

  function updateSmtpProvider(providerId) {
    const provider = SMTP_PROVIDERS[providerId] || SMTP_PROVIDERS.custom;
    setSmtpProvider(providerId);
    setSmtp((current) => ({
      ...current,
      host: provider.host || '',
      port: provider.port,
      security: provider.security,
      username: provider.username || '',
      password: '',
      passwordConfigured: provider.host === current.host ? current.passwordConfigured : false,
      testedAt: null,
    }));
    setSmtpDirty(true);
  }

  function updateSmsField(field, value) {
    setSms((current) => ({ ...current, [field]: value }));
    setSmsDirty(true);
  }

  function updateSmsProvider(provider) {
    setSms((current) => ({
      ...current,
      provider,
      enabled: true,
      configured: false,
      accessKeyId: '',
      accessKeyIdMasked: '',
      accessKeySecret: '',
      sdkAppId: provider === 'tencent' ? '' : current.sdkAppId,
    }));
    setSmsDirty(true);
  }

  async function saveSmtp(event) {
    event.preventDefault();
    if (loading || busy) return;
    setBusy('smtp-save'); setError('');
    try {
      const response = await api.saveSmtpSettings({
        host: smtp.host,
        port: Number(smtp.port),
        security: smtp.security,
        username: smtp.username,
        ...(smtp.password ? { password: smtp.password } : {}),
        fromName: smtp.fromName,
        fromEmail: smtp.fromEmail,
      });
      const value = response.data?.smtp || response.data || {};
      setSmtp((current) => ({ ...current, ...value, password: '', configured: value.configured !== false }));
      setSmtpDirty(false);
      onNotice('域名邮箱设置已安全保存');
    } catch (requestError) {
      setError(requestError.message || '域名邮箱设置保存失败');
    } finally { setBusy(''); }
  }

  async function testSmtp() {
    if (!smtpTestEmail.trim()) { setError('请输入接收验证邮件的邮箱'); return; }
    if (loading || busy) return;
    setBusy('smtp-test'); setError('');
    try {
      const response = await api.testSmtp({ recipient: smtpTestEmail.trim() });
      const value = response.data?.smtp;
      if (value) setSmtp((current) => ({ ...current, ...value, password: '' }));
      onNotice(`发信验证邮件已提交至 ${smtpTestEmail.trim()}`);
    } catch (requestError) { setError(requestError.message || '发信验证失败'); }
    finally { setBusy(''); }
  }

  async function saveSms(event) {
    event.preventDefault();
    if (loading || busy) return;
    setBusy('sms-save'); setError('');
    try {
      const response = await api.saveSmsSettings({
        ...sms,
        enabled: true,
        accessKeyId: sms.accessKeyId || undefined,
        accessKeySecret: sms.accessKeySecret || undefined,
      });
      const value = response.data?.sms || response.data || {};
      setSms((current) => ({ ...current, ...value, accessKeyId: '', accessKeySecret: '', configured: value.configured !== false }));
      setSmsDirty(false);
      onNotice('短信验证码通道已安全保存');
    } catch (requestError) { setError(requestError.message || '短信设置保存失败'); }
    finally { setBusy(''); }
  }

  async function testSms() {
    if (!/^1[3-9]\d{9}$/.test(smsTestPhone.trim())) { setError('请输入有效的中国大陆验证手机号'); return; }
    if (loading || busy) return;
    setBusy('sms-test'); setError('');
    try {
      await api.testSms({ phone: smsTestPhone.trim() });
      onNotice(`短信验证请求已提交至 ${smsTestPhone.slice(0, 3)} **** ${smsTestPhone.slice(-4)}`);
    } catch (requestError) { setError(requestError.message || '短信通道验证失败'); }
    finally { setBusy(''); }
  }

  return (
    <>
      <div className="admin-page-heading admin-security-heading">
        <div><h1>安全与通信</h1><p>管理全站邮件发送与用户手机验证码服务；管理员账号和登录保护已归入“系统设置”。</p></div>
        <button className="admin-button admin-button-secondary" type="button" onClick={reload} disabled={loading || Boolean(busy)}><RefreshCw size={17} className={loading ? 'spin' : ''} />刷新状态</button>
      </div>
      {error ? <div className="admin-security-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭"><X size={16} /></button></div> : null}

      <div className="admin-communications-grid">
        <form className="admin-panel admin-communication-card" onSubmit={saveSmtp}>
          <header><span><Mail size={21} /></span><div><h2>邮件发送服务（SMTP）</h2><p>保存完整配置后成为全站邮件通道，可供注册验证、通知及管理员邮箱验证码使用。</p></div><i className={!smtpDirty && smtp.testedAt ? 'ready' : ''}>{smtpDirty ? '有未保存更改' : smtp.testedAt ? '已验证' : smtp.configured ? '已启用待验证' : '未配置'}</i></header>
          <fieldset className="admin-form-grid" disabled={loading || Boolean(busy)}>
            <label className="wide"><span>选择邮箱平台</span><select value={smtpProvider} onChange={(event) => updateSmtpProvider(event.target.value)}>{Object.entries(SMTP_PROVIDERS).map(([id, provider]) => <option value={id} key={id}>{provider.label}</option>)}</select></label>
            <label className="wide"><span>SMTP 主机</span><input value={smtp.host} onChange={(event) => updateSmtpField('host', event.target.value)} placeholder="smtp.example.com" required /></label>
            <label><span>端口</span><input type="number" min="1" max="65535" value={smtp.port} onChange={(event) => updateSmtpField('port', event.target.value)} required /></label>
            <label><span>连接加密</span><select value={smtp.security} onChange={(event) => updateSmtpField('security', event.target.value)}><option value="tls">TLS（通常 465）</option><option value="starttls">STARTTLS（通常 587）</option></select></label>
            <label className="wide"><span>SMTP 账号</span><input value={smtp.username} onChange={(event) => updateSmtpField('username', event.target.value)} autoComplete="off" required /></label>
            <label className="wide"><span>SMTP 密码 / 授权码</span><input type="password" value={smtp.password} onChange={(event) => updateSmtpField('password', event.target.value)} autoComplete="new-password" placeholder={smtp.passwordConfigured ? '留空表示保持原密码' : '请输入邮箱授权码'} required={!smtp.passwordConfigured} /></label>
            <label><span>发件人名称</span><input value={smtp.fromName} onChange={(event) => updateSmtpField('fromName', event.target.value)} required /></label>
            <label><span>发件邮箱</span><input type="email" value={smtp.fromEmail} onChange={(event) => updateSmtpField('fromEmail', event.target.value)} placeholder="no-reply@example.com" required /></label>
          </fieldset>
          <ProviderGuide guide={SMTP_PROVIDERS[smtpProvider]} />
          <footer><button className="admin-button admin-button-primary" type="submit" disabled={loading || Boolean(busy)}>{busy === 'smtp-save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存邮箱设置</button><div><input type="email" value={smtpTestEmail} onChange={(event) => setSmtpTestEmail(event.target.value)} placeholder="接收验证邮件的邮箱" disabled={loading || Boolean(busy)} /><button className="admin-button admin-button-secondary" type="button" onClick={testSmtp} disabled={loading || Boolean(busy) || smtpDirty || !smtp.configured} title={smtpDirty ? '请先保存当前更改' : ''}><Send size={16} />验证发信</button></div></footer>
        </form>

        <form className="admin-panel admin-communication-card" onSubmit={saveSms}>
          <header><span><MessageSquareText size={21} /></span><div><h2>手机验证码</h2><p>保存完整配置后自动启用，无需再次操作开关；密钥只在服务端加密保存。</p></div><i className={!smsDirty && sms.configured ? 'ready' : ''}>{smsDirty ? '有未保存更改' : sms.configured ? '已启用' : '未配置'}</i></header>
          <fieldset className="admin-form-grid" disabled={loading || Boolean(busy)}>
            <label className="wide"><span>短信服务商</span><select value={sms.provider} onChange={(event) => updateSmsProvider(event.target.value)}><option value="aliyun">阿里云短信</option><option value="tencent">腾讯云短信</option></select></label>
            <label className="wide"><span>AccessKey ID / SecretId</span><input value={sms.accessKeyId} onChange={(event) => updateSmsField('accessKeyId', event.target.value)} placeholder={sms.accessKeyIdMasked || '使用仅短信发送权限的子账号密钥'} required={!sms.configured} /></label>
            <label className="wide"><span>AccessKey Secret / SecretKey</span><input type="password" value={sms.accessKeySecret} onChange={(event) => updateSmsField('accessKeySecret', event.target.value)} autoComplete="new-password" placeholder={sms.configured ? '留空表示保持原密钥' : '请输入密钥'} required={!sms.configured} /></label>
            <label><span>已审核短信签名</span><input value={sms.signName} onChange={(event) => updateSmsField('signName', event.target.value)} required /></label>
            <label><span>验证码模板 ID</span><input value={sms.templateCode} onChange={(event) => updateSmsField('templateCode', event.target.value)} required /></label>
            {sms.provider === 'tencent' ? <><label><span>短信应用 SDK AppID</span><input value={sms.sdkAppId} onChange={(event) => updateSmsField('sdkAppId', event.target.value)} required /></label><label><span>地域</span><input value={sms.region} onChange={(event) => updateSmsField('region', event.target.value)} /></label></> : null}
          </fieldset>
          <ProviderGuide guide={SMS_GUIDES[sms.provider]} />
          <footer><button className="admin-button admin-button-primary" type="submit" disabled={loading || Boolean(busy)}>{busy === 'sms-save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存并启用</button><div><input inputMode="numeric" value={smsTestPhone} onChange={(event) => setSmsTestPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="接收验证短信的手机号" disabled={loading || Boolean(busy)} /><button className="admin-button admin-button-secondary" type="button" onClick={testSms} disabled={loading || Boolean(busy) || smsDirty || !sms.configured} title={smsDirty ? '请先保存当前更改' : ''}><Send size={16} />验证通道</button></div></footer>
        </form>
      </div>

      <div className="admin-compliance-note"><ShieldCheck size={20} /><div><b>正式通道安全要求</b><p>验证码仅保存哈希且 5 分钟失效，单次使用、限制重发和尝试次数；短信和邮件凭据加密保存，浏览器永远不会读取已保存的完整密钥。</p></div></div>
    </>
  );
}

function ProviderGuide({ guide }) {
  if (!guide) return null;
  return <details className={`admin-provider-guide ${guide.warning ? 'warning' : ''}`}><summary>查看申请与配置步骤</summary><ol>{guide.steps.map((step) => <li key={step}>{step}</li>)}</ol>{guide.docs ? <a href={guide.docs} target="_blank" rel="noreferrer">打开平台官方文档</a> : null}</details>;
}
