import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  LoaderCircle,
  Mail,
  MessageSquareText,
  QrCode,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import './admin-security.css';

const emptySmtp = {
  host: '',
  port: 465,
  security: 'tls',
  username: '',
  password: '',
  fromName: '教师帮',
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

function normalizeMfa(payload) {
  const value = payload?.data?.mfa || payload?.data || payload || {};
  const methods = Array.isArray(value.methods)
    ? value.methods
    : Object.entries(value.methods || {}).filter(([, method]) => method?.enabled === true).map(([id]) => id);
  return {
    enabled: value.enabled === true,
    preferred: value.preferred || value.preferredMethod || '',
    methods,
    email: value.email || value.emailMasked || value.methods?.email?.destination || '',
    recoveryCodesRemaining: Number(value.recoveryCodesRemaining || 0),
  };
}

export function SecuritySettingsPage({ onNotice }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mfa, setMfa] = useState({ enabled: false, preferred: '', methods: [], email: '', recoveryCodesRemaining: 0 });
  const [smtp, setSmtp] = useState(emptySmtp);
  const [sms, setSms] = useState(emptySms);
  const [smtpTestEmail, setSmtpTestEmail] = useState('');
  const [smsTestPhone, setSmsTestPhone] = useState('');
  const [smtpDirty, setSmtpDirty] = useState(false);
  const [smsDirty, setSmsDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [dialog, setDialog] = useState(null);

  async function reload() {
    setLoading(true);
    setError('');
    const [mfaResult, smtpResult, smsResult] = await Promise.allSettled([
      api.getAdminMfa(),
      api.getSmtpSettings(),
      api.getSmsSettings(),
    ]);
    if (mfaResult.status === 'fulfilled') setMfa(normalizeMfa(mfaResult.value));
    if (smtpResult.status === 'fulfilled') {
      const value = smtpResult.value?.data?.smtp || smtpResult.value?.data || {};
      setSmtp((current) => ({
        ...current,
        host: value.host || '',
        port: Number(value.port || 465),
        security: value.security || 'starttls',
        username: value.username || '',
        fromName: value.fromName || '教师帮',
        fromEmail: value.fromEmail || '',
        configured: value.configured === true,
        passwordConfigured: value.passwordConfigured === true,
        testedAt: value.testedAt || null,
      }));
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
    const firstFailure = [mfaResult, smtpResult, smsResult].find((result) => result.status === 'rejected');
    if (firstFailure) setError(firstFailure.reason?.message || '部分安全设置暂时无法读取');
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  function updateSmtpField(field, value) {
    setSmtp((current) => ({ ...current, [field]: value, testedAt: null }));
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
      enabled: false,
      configured: false,
      accessKeyId: '',
      accessKeyIdMasked: '',
      accessKeySecret: '',
      sdkAppId: provider === 'tencent' ? '' : current.sdkAppId,
    }));
    setSmsDirty(true);
  }

  const mfaMethodLabels = useMemo(() => mfa.methods.map((method) => {
    const id = typeof method === 'string' ? method : method.id || method.type;
    return id === 'totp' ? '身份验证器' : id === 'email' ? '邮箱验证码' : id;
  }).filter(Boolean), [mfa.methods]);

  async function saveSmtp(event) {
    event.preventDefault();
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
    if (!smtpTestEmail.trim()) { setError('请输入接收测试邮件的邮箱'); return; }
    setBusy('smtp-test'); setError('');
    try {
      const response = await api.testSmtp({ recipient: smtpTestEmail.trim() });
      const value = response.data?.smtp;
      if (value) setSmtp((current) => ({ ...current, ...value, password: '' }));
      onNotice(`测试邮件已提交至 ${smtpTestEmail.trim()}`);
    } catch (requestError) { setError(requestError.message || '测试邮件发送失败'); }
    finally { setBusy(''); }
  }

  async function saveSms(event) {
    event.preventDefault();
    setBusy('sms-save'); setError('');
    try {
      const response = await api.saveSmsSettings({
        ...sms,
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
    if (!/^1[3-9]\d{9}$/.test(smsTestPhone.trim())) { setError('请输入有效的中国大陆测试手机号'); return; }
    setBusy('sms-test'); setError('');
    try {
      await api.testSms({ phone: smsTestPhone.trim() });
      onNotice(`测试短信已提交至 ${smsTestPhone.slice(0, 3)} **** ${smsTestPhone.slice(-4)}`);
    } catch (requestError) { setError(requestError.message || '测试短信发送失败'); }
    finally { setBusy(''); }
  }

  async function setPreferred(method) {
    setBusy(`preferred-${method}`); setError('');
    try {
      await api.setAdminMfaPreferred({ method });
      await reload();
      onNotice('登录验证码方式已更新');
    } catch (requestError) { setError(requestError.message || '验证方式更新失败'); }
    finally { setBusy(''); }
  }

  return (
    <>
      <div className="admin-page-heading admin-security-heading">
        <div><h1>安全与通信</h1><p>配置管理员登录验证码、域名邮箱和用户手机验证码通道</p></div>
        <button className="admin-button admin-button-secondary" type="button" onClick={reload} disabled={loading || Boolean(busy)}><RefreshCw size={17} className={loading ? 'spin' : ''} />刷新状态</button>
      </div>
      {error ? <div className="admin-security-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭"><X size={16} /></button></div> : null}

      <section className="admin-panel admin-security-overview">
        <div className={`admin-security-mark ${mfa.enabled ? 'enabled' : ''}`}><ShieldCheck size={28} /></div>
        <div><small>管理员登录验证码</small><h2>{mfa.enabled ? '已启用' : '未启用'}</h2><p>{mfa.enabled ? `账号密码通过后，还需输入${mfaMethodLabels.join('或') || '验证码'}。` : '首次登录仍只使用账号密码；管理员可在这里主动开启。'}</p></div>
        <div className="admin-security-actions">
          <button className="admin-button admin-button-secondary" type="button" onClick={() => setDialog({ type: 'totp', step: 'credentials', password: '', code: '' })}><QrCode size={17} />配置身份验证器</button>
          <button className="admin-button admin-button-primary" type="button" onClick={() => setDialog({ type: 'email', step: 'credentials', password: '', email: '', code: '' })}><Mail size={17} />配置邮箱验证码</button>
        </div>
      </section>

      {mfa.enabled ? <section className="admin-panel admin-security-methods"><header><div><h2>当前验证方式</h2><p>登录页只会要求输入“验证码”，不会暴露内部安全机制名称。</p></div><div className="admin-security-actions"><button className="admin-button admin-button-secondary" type="button" onClick={() => setDialog({ type: 'recovery', step: 'credentials', method: mfa.methods.includes('totp') ? 'totp' : 'email', password: '', code: '' })}><KeyRound size={16} />更新恢复码</button><button className="admin-button admin-button-danger" type="button" onClick={() => setDialog({ type: 'disable', step: 'credentials', method: mfa.methods.includes('totp') ? 'totp' : 'email', password: '', code: '' })}>关闭登录验证码</button></div></header><div className="admin-security-method-list">{mfa.methods.map((method) => {
        const id = typeof method === 'string' ? method : method.id || method.type;
        const active = mfa.preferred === id || (!mfa.preferred && mfa.methods.length === 1);
        return <button key={id} type="button" className={active ? 'active' : ''} onClick={() => setPreferred(id)} disabled={busy === `preferred-${id}`}><span>{id === 'totp' ? <Smartphone size={19} /> : <Mail size={19} />}</span><p><b>{id === 'totp' ? '身份验证器' : '邮箱验证码'}</b><small>{id === 'email' && mfa.email ? mfa.email : active ? '当前首选方式' : '点击设为首选'}</small></p>{active ? <CheckCircle2 size={18} /> : null}</button>;
      })}</div>{mfa.recoveryCodesRemaining ? <p className="admin-recovery-count"><KeyRound size={16} />尚有 {mfa.recoveryCodesRemaining} 个恢复码可用，请离线妥善保管。</p> : null}</section> : null}

      <div className="admin-communications-grid">
        <form className="admin-panel admin-communication-card" onSubmit={saveSmtp}>
          <header><span><Mail size={21} /></span><div><h2>域名邮箱</h2><p>用于管理员和用户邮箱验证码；通过标准 SMTP 连接企业邮箱。</p></div><i className={!smtpDirty && smtp.testedAt ? 'ready' : ''}>{smtpDirty ? '有未保存更改' : smtp.testedAt ? '已测试' : smtp.configured ? '已保存待测试' : '未配置'}</i></header>
          <div className="admin-form-grid">
            <label className="wide"><span>SMTP 主机</span><input value={smtp.host} onChange={(event) => updateSmtpField('host', event.target.value)} placeholder="smtp.example.com" required /></label>
            <label><span>端口</span><input type="number" min="1" max="65535" value={smtp.port} onChange={(event) => updateSmtpField('port', event.target.value)} required /></label>
            <label><span>连接加密</span><select value={smtp.security} onChange={(event) => updateSmtpField('security', event.target.value)}><option value="tls">TLS（通常 465）</option><option value="starttls">STARTTLS（通常 587）</option></select></label>
            <label className="wide"><span>SMTP 账号</span><input value={smtp.username} onChange={(event) => updateSmtpField('username', event.target.value)} autoComplete="off" required /></label>
            <label className="wide"><span>SMTP 密码 / 授权码</span><input type="password" value={smtp.password} onChange={(event) => updateSmtpField('password', event.target.value)} autoComplete="new-password" placeholder={smtp.passwordConfigured ? '留空表示保持原密码' : '请输入邮箱授权码'} required={!smtp.passwordConfigured} /></label>
            <label><span>发件人名称</span><input value={smtp.fromName} onChange={(event) => updateSmtpField('fromName', event.target.value)} required /></label>
            <label><span>发件邮箱</span><input type="email" value={smtp.fromEmail} onChange={(event) => updateSmtpField('fromEmail', event.target.value)} placeholder="no-reply@example.com" required /></label>
          </div>
          <footer><button className="admin-button admin-button-primary" type="submit" disabled={busy === 'smtp-save'}>{busy === 'smtp-save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存邮箱设置</button><div><input type="email" value={smtpTestEmail} onChange={(event) => setSmtpTestEmail(event.target.value)} placeholder="接收测试邮件的邮箱" /><button className="admin-button admin-button-secondary" type="button" onClick={testSmtp} disabled={busy === 'smtp-test' || smtpDirty || !smtp.configured} title={smtpDirty ? '请先保存当前更改' : ''}><Send size={16} />发送测试</button></div></footer>
        </form>

        <form className="admin-panel admin-communication-card" onSubmit={saveSms}>
          <header><span><MessageSquareText size={21} /></span><div><h2>手机验证码</h2><p>支持阿里云短信和腾讯云短信正式接口，密钥只在服务端加密保存。</p></div><i className={!smsDirty && sms.configured && sms.enabled ? 'ready' : ''}>{smsDirty ? '有未保存更改' : sms.configured ? (sms.enabled ? '已启用' : '已保存未启用') : '未配置'}</i></header>
          <div className="admin-form-grid">
            <label className="wide"><span>短信服务商</span><select value={sms.provider} onChange={(event) => updateSmsProvider(event.target.value)}><option value="aliyun">阿里云短信</option><option value="tencent">腾讯云短信</option></select></label>
            <label className="wide"><span>AccessKey ID / SecretId</span><input value={sms.accessKeyId} onChange={(event) => updateSmsField('accessKeyId', event.target.value)} placeholder={sms.accessKeyIdMasked || '使用仅短信发送权限的子账号密钥'} required={!sms.configured} /></label>
            <label className="wide"><span>AccessKey Secret / SecretKey</span><input type="password" value={sms.accessKeySecret} onChange={(event) => updateSmsField('accessKeySecret', event.target.value)} autoComplete="new-password" placeholder={sms.configured ? '留空表示保持原密钥' : '请输入密钥'} required={!sms.configured} /></label>
            <label><span>已审核短信签名</span><input value={sms.signName} onChange={(event) => updateSmsField('signName', event.target.value)} required /></label>
            <label><span>验证码模板 ID</span><input value={sms.templateCode} onChange={(event) => updateSmsField('templateCode', event.target.value)} required /></label>
            {sms.provider === 'tencent' ? <><label><span>短信应用 SDK AppID</span><input value={sms.sdkAppId} onChange={(event) => updateSmsField('sdkAppId', event.target.value)} required /></label><label><span>地域</span><input value={sms.region} onChange={(event) => updateSmsField('region', event.target.value)} /></label></> : null}
          </div>
          <label className="admin-enable-row"><input type="checkbox" checked={sms.enabled} onChange={(event) => updateSmsField('enabled', event.target.checked)} /><span><b>启用手机验证码通道</b><small>需要企业实名认证、短信资质、已报备签名及审核通过的模板。</small></span></label>
          <footer><button className="admin-button admin-button-primary" type="submit" disabled={busy === 'sms-save'}>{busy === 'sms-save' ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存短信设置</button><div><input inputMode="numeric" value={smsTestPhone} onChange={(event) => setSmsTestPhone(event.target.value.replace(/\D/g, '').slice(0, 11))} placeholder="接收测试短信的手机号" /><button className="admin-button admin-button-secondary" type="button" onClick={testSms} disabled={busy === 'sms-test' || smsDirty || !sms.configured || !sms.enabled} title={smsDirty ? '请先保存当前更改' : !sms.enabled ? '请先启用并保存短信通道' : ''}><Send size={16} />发送测试</button></div></footer>
        </form>
      </div>

      <div className="admin-compliance-note"><ShieldCheck size={20} /><div><b>正式通道安全要求</b><p>验证码仅保存哈希且 5 分钟失效，单次使用、限制重发和尝试次数；短信和邮件凭据加密保存，浏览器永远不会读取已保存的完整密钥。</p></div></div>
      {dialog ? <MfaDialog dialog={dialog} setDialog={setDialog} setError={setError} reload={reload} onNotice={onNotice} /> : null}
    </>
  );
}

function MfaDialog({ dialog, setDialog, setError, reload, onNotice }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');

  const update = (key) => (event) => setDialog((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setLocalError(''); setError('');
    try {
      if (dialog.type === 'totp' && dialog.step === 'credentials') {
        const response = await api.enrollAdminTotp({ currentPassword: dialog.password });
        const enrollment = response.data?.enrollment || response.data || {};
        setDialog((current) => ({ ...current, ...enrollment, step: 'confirm', code: '' }));
      } else if (dialog.type === 'totp' && dialog.step === 'confirm') {
        const response = await api.confirmAdminTotp({ enrollmentId: dialog.enrollmentId, code: dialog.code });
        const recoveryCodes = response.data?.recoveryCodes || response.data?.mfa?.recoveryCodes || [];
        setDialog((current) => ({ ...current, step: 'recovery', recoveryCodes }));
        await reload();
      } else if (dialog.type === 'email' && dialog.step === 'credentials') {
        const response = await api.enrollAdminEmail({ currentPassword: dialog.password, email: dialog.email.trim() });
        const enrollment = response.data?.enrollment || response.data || {};
        setDialog((current) => ({ ...current, ...enrollment, step: 'confirm', code: '' }));
      } else if (dialog.type === 'email' && dialog.step === 'confirm') {
        const response = await api.confirmAdminEmail({ enrollmentId: dialog.enrollmentId, code: dialog.code });
        const recoveryCodes = response.data?.recoveryCodes || response.data?.mfa?.recoveryCodes || [];
        setDialog((current) => ({ ...current, step: 'recovery', recoveryCodes }));
        await reload();
      } else if (['disable', 'recovery'].includes(dialog.type) && dialog.method === 'email' && dialog.step === 'credentials') {
        const response = await api.requestAdminMfaEmailCode({ currentPassword: dialog.password });
        const challenge = response.data?.challenge || response.data || {};
        setDialog((current) => ({ ...current, step: 'confirm', challengeId: challenge.id, destination: challenge.destination, code: '' }));
      } else if (dialog.type === 'disable') {
        await api.disableAdminMfa({
          currentPassword: dialog.password,
          method: 'all',
          code: dialog.code,
          ...(dialog.challengeId ? { challengeId: dialog.challengeId } : {}),
        });
        await reload();
        setDialog(null);
        onNotice('管理员登录验证码已关闭');
      } else if (dialog.type === 'recovery') {
        const response = await api.regenerateAdminRecovery({
          currentPassword: dialog.password,
          code: dialog.code,
          ...(dialog.challengeId ? { challengeId: dialog.challengeId } : {}),
        });
        const recoveryCodes = response.data?.recoveryCodes || [];
        setDialog((current) => ({ ...current, step: 'recovery', recoveryCodes }));
        await reload();
      }
    } catch (requestError) { setLocalError(requestError.message || '操作未完成，请检查输入后重试'); }
    finally { setBusy(false); }
  }

  async function copyRecoveryCodes() {
    const text = (dialog.recoveryCodes || []).join('\n');
    try { await navigator.clipboard.writeText(text); onNotice('恢复码已复制，请离线保存'); }
    catch { setLocalError('浏览器未允许复制，请手动保存恢复码'); }
  }

  const title = dialog.type === 'disable' ? '关闭登录验证码' : dialog.type === 'recovery' ? '更新恢复码' : dialog.type === 'totp' ? '配置身份验证器' : '配置邮箱验证码';
  return <div className="admin-security-dialog-layer"><button className="admin-security-dialog-backdrop" type="button" onClick={() => setDialog(null)} aria-label="关闭" /><section className="admin-security-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-security-dialog-title"><header><div><h2 id="admin-security-dialog-title">{title}</h2><p>{dialog.step === 'recovery' ? '这是恢复账号的最后保障，只展示一次。' : '敏感设置必须先验证当前管理员身份。'}</p></div><button type="button" onClick={() => setDialog(null)} aria-label="关闭"><X size={20} /></button></header>
    {dialog.step === 'recovery' ? <div className="admin-recovery-panel"><CheckCircle2 size={32} /><h3>{dialog.type === 'recovery' ? '恢复码已更新' : '登录验证码已启用'}</h3><p>请立即把恢复码下载或复制到离线密码管理器。每个恢复码只能使用一次。</p><div>{(dialog.recoveryCodes || []).map((code) => <code key={code}>{code}</code>)}</div><footer><button className="admin-button admin-button-secondary" type="button" onClick={copyRecoveryCodes}><Copy size={17} />复制恢复码</button><button className="admin-button admin-button-primary" type="button" onClick={() => setDialog(null)}>我已安全保存</button></footer></div> : <form onSubmit={submit}>
      {dialog.step === 'credentials' ? <label><span>当前管理员密码</span><input type="password" value={dialog.password} onChange={update('password')} autoComplete="current-password" required autoFocus /></label> : null}
      {dialog.type === 'email' && dialog.step === 'credentials' ? <label><span>接收验证码的邮箱</span><input type="email" value={dialog.email} onChange={update('email')} required /></label> : null}
      {dialog.type === 'totp' && dialog.step === 'confirm' ? <div className="admin-totp-setup">{dialog.qrCodeDataUrl ? <img src={dialog.qrCodeDataUrl} alt="身份验证器二维码" /> : <QrCode size={88} />}<p>使用身份验证器扫描二维码；无法扫描时，手动输入下面的密钥。</p><code>{dialog.secret}</code></div> : null}
      {['disable', 'recovery'].includes(dialog.type) && dialog.method === 'email' && dialog.step === 'confirm' && dialog.destination ? <p className="admin-form-hint">验证码已发送至 {dialog.destination}</p> : null}
      {dialog.step === 'confirm' || (['disable', 'recovery'].includes(dialog.type) && dialog.method !== 'email') ? <label><span>验证码</span><input value={dialog.code} onChange={(event) => setDialog((current) => ({ ...current, code: event.target.value.trim().slice(0, 32) }))} inputMode="numeric" autoComplete="one-time-code" placeholder="请输入验证码或恢复码" required autoFocus={dialog.step === 'confirm'} /></label> : null}
      {localError ? <p className="admin-form-error" role="alert">{localError}</p> : null}
      <footer><button className="admin-button admin-button-secondary" type="button" onClick={() => setDialog(null)}>取消</button><button className={`admin-button ${dialog.type === 'disable' && dialog.step !== 'credentials' ? 'admin-button-danger' : 'admin-button-primary'}`} type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : dialog.type === 'disable' && dialog.step !== 'credentials' ? <X size={17} /> : <Check size={17} />}{['disable', 'recovery'].includes(dialog.type) && dialog.method === 'email' && dialog.step === 'credentials' ? '发送验证码' : dialog.type === 'disable' ? '确认关闭' : dialog.type === 'recovery' ? '确认更新' : dialog.step === 'credentials' ? '继续' : '确认启用'}</button></footer>
    </form>}
  </section></div>;
}
