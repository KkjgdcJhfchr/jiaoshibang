import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  Mail,
  QrCode,
  Save,
  ShieldCheck,
  Smartphone,
  UserCog,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';

const EMPTY_MFA = Object.freeze({
  enabled: false,
  preferred: '',
  methods: [],
  email: '',
  recoveryCodesRemaining: 0,
});

const USERNAME_PATTERN = /^[\p{L}\p{N}_.@-]{3,100}$/u;

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

function passwordChecks(password, username) {
  return {
    length: password.length >= 12 && password.length <= 128,
    lower: /[a-z]/.test(password),
    upper: /[A-Z]/.test(password),
    number: /\d/.test(password),
    symbol: /[^\p{L}\p{N}\s]/u.test(password),
    identity: Boolean(username) && !password.toLocaleLowerCase().includes(username.toLocaleLowerCase()),
  };
}

export function AdminAccountSecurity({ onNotice = () => {} }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mfa, setMfa] = useState(EMPTY_MFA);
  const [credentials, setCredentials] = useState({ username: '' });
  const [credentialForm, setCredentialForm] = useState({ username: '', currentPassword: '', newPassword: '', confirmPassword: '' });
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [credentialRecovery, setCredentialRecovery] = useState(null);
  const [mfaBusy, setMfaBusy] = useState('');
  const [dialog, setDialog] = useState(null);

  async function reload() {
    setLoading(true);
    setError('');
    const [credentialsResult, mfaResult] = await Promise.allSettled([
      api.getAdminCredentials(),
      api.getAdminMfa(),
    ]);
    if (credentialsResult.status === 'fulfilled') {
      const value = credentialsResult.value?.data?.credentials || credentialsResult.value?.data || {};
      const username = String(value.username || '');
      setCredentials({ username });
      setCredentialForm({ username, currentPassword: '', newPassword: '', confirmPassword: '' });
    }
    if (mfaResult.status === 'fulfilled') setMfa(normalizeMfa(mfaResult.value));
    const failure = [credentialsResult, mfaResult].find((result) => result.status === 'rejected');
    if (failure) setError(failure.reason?.message || '管理员安全设置读取失败');
    setLoading(false);
  }

  useEffect(() => { reload(); }, []);

  const newPasswordChecks = useMemo(
    () => passwordChecks(credentialForm.newPassword, credentialForm.username.trim()),
    [credentialForm.newPassword, credentialForm.username],
  );
  const usernameChanged = credentialForm.username.trim() !== credentials.username;
  const passwordChanged = Boolean(credentialForm.newPassword);
  const credentialsDirty = usernameChanged || passwordChanged;
  const passwordValid = !passwordChanged || Object.values(newPasswordChecks).every(Boolean);
  const credentialFormValid = credentialsDirty
    && USERNAME_PATTERN.test(credentialForm.username.trim())
    && Boolean(credentialForm.currentPassword)
    && passwordValid
    && (!passwordChanged || credentialForm.newPassword === credentialForm.confirmPassword);

  const mfaMethodLabels = useMemo(() => mfa.methods.map((method) => {
    const id = typeof method === 'string' ? method : method.id || method.type;
    return id === 'totp' ? '身份验证器' : id === 'email' ? '邮箱验证码' : id;
  }).filter(Boolean), [mfa.methods]);

  function updateCredential(field, value) {
    setCredentialForm((current) => ({ ...current, [field]: value }));
  }

  async function saveCredentials(event) {
    event.preventDefault();
    if (!credentialFormValid || credentialBusy) return;
    setCredentialBusy(true);
    setError('');
    try {
      const response = await api.updateAdminCredentials({
        currentPassword: credentialForm.currentPassword,
        username: credentialForm.username.trim(),
        ...(credentialForm.newPassword ? { newPassword: credentialForm.newPassword } : {}),
      });
      const result = response.data || {};
      const updated = result.credentials || {};
      const username = String(updated.username || credentialForm.username.trim());
      setCredentials({ username });
      setCredentialForm({ username, currentPassword: '', newPassword: '', confirmPassword: '' });
      const sessionInvalidated = result.sessionInvalidated === true || result.reauthenticationRequired === true;
      const recoveryCodes = Array.isArray(result.recoveryCodes) ? result.recoveryCodes : [];
      if (recoveryCodes.length > 0) {
        setCredentialRecovery({ recoveryCodes, sessionInvalidated, copyError: '' });
        onNotice('管理员账号安全信息已更新，请立即保存新的恢复码');
        return;
      }
      if (sessionInvalidated) {
        onNotice('管理员账号安全信息已更新，请使用新凭据重新登录');
        window.location.assign(window.location.pathname);
        return;
      }
      onNotice(result.credentialsChanged === false ? '管理员凭据没有变化' : '管理员账号安全信息已更新');
    } catch (requestError) {
      setError(requestError.message || '管理员账号安全信息更新失败');
    } finally {
      setCredentialBusy(false);
    }
  }

  async function setPreferred(method) {
    if (loading || mfaBusy) return;
    setMfaBusy(`preferred-${method}`);
    setError('');
    try {
      await api.setAdminMfaPreferred({ method });
      const response = await api.getAdminMfa();
      setMfa(normalizeMfa(response));
      onNotice('登录验证码方式已更新');
    } catch (requestError) {
      setError(requestError.message || '验证方式更新失败');
    } finally {
      setMfaBusy('');
    }
  }

  async function reloadMfa() {
    const response = await api.getAdminMfa();
    setMfa(normalizeMfa(response));
  }

  return (
    <>
      {error ? <div className="admin-system-security-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭"><X size={16} /></button></div> : null}

      <section className="admin-panel admin-system-card admin-account-credentials-card">
        <header><span><UserCog size={20} /></span><div><h2>管理员账号与密码</h2><p>只有提交并通过当前密码验证后才会修改；留空的新密码不会覆盖现有密码。</p></div></header>
        <form className="admin-account-credentials-form" onSubmit={saveCredentials}>
          <fieldset className="admin-system-fields" disabled={loading || credentialBusy}>
            <label><span>管理员账号</span><input value={credentialForm.username} onChange={(event) => updateCredential('username', event.target.value)} minLength={3} maxLength={100} autoComplete="username" required /></label>
            <label><span>当前管理员密码</span><input type="password" value={credentialForm.currentPassword} onChange={(event) => updateCredential('currentPassword', event.target.value)} autoComplete="current-password" required={credentialsDirty} placeholder="修改账号或密码时必须填写" /></label>
            <label><span>新密码（不修改请留空）</span><input type="password" value={credentialForm.newPassword} onChange={(event) => updateCredential('newPassword', event.target.value)} minLength={12} maxLength={128} autoComplete="new-password" /></label>
            <label><span>确认新密码</span><input type="password" value={credentialForm.confirmPassword} onChange={(event) => updateCredential('confirmPassword', event.target.value)} autoComplete="new-password" disabled={!passwordChanged || loading || credentialBusy} /></label>
          </fieldset>
          {passwordChanged ? <ul className="admin-credential-rules" aria-live="polite">
            <Rule valid={newPasswordChecks.length}>12–128 个字符</Rule>
            <Rule valid={newPasswordChecks.lower && newPasswordChecks.upper}>同时包含大小写英文字母</Rule>
            <Rule valid={newPasswordChecks.number}>包含数字</Rule>
            <Rule valid={newPasswordChecks.symbol}>包含特殊符号</Rule>
            <Rule valid={newPasswordChecks.identity}>不能包含管理员账号</Rule>
            <Rule valid={credentialForm.newPassword === credentialForm.confirmPassword}>两次输入一致</Rule>
          </ul> : null}
          <footer><p><LockKeyhole size={15} />更新成功后将清除已有管理员会话，但不会擅自改动未提交的账号或密码。</p><button className="admin-button admin-button-primary" type="submit" disabled={loading || credentialBusy || !credentialFormValid}>{credentialBusy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存管理员凭据</button></footer>
        </form>
      </section>

      <section className="admin-panel admin-security-overview admin-system-mfa-overview">
        <div className={`admin-security-mark ${mfa.enabled ? 'enabled' : ''}`}><ShieldCheck size={28} /></div>
        <div><small>管理员登录保护</small><h2>{mfa.enabled ? '验证码已启用' : '仅账号密码登录'}</h2><p>{mfa.enabled ? `账号密码通过后，还需输入${mfaMethodLabels.join('或') || '验证码'}。` : '首次登录仍只使用账号密码；可在这里主动添加身份验证器或管理员邮箱验证码。'}</p></div>
        <div className="admin-security-actions">
          <button className="admin-button admin-button-secondary" type="button" disabled={loading || Boolean(mfaBusy)} onClick={() => setDialog({ type: 'totp', step: 'credentials', password: '', code: '' })}><QrCode size={17} />配置身份验证器</button>
          <button className="admin-button admin-button-primary" type="button" disabled={loading || Boolean(mfaBusy)} onClick={() => setDialog({ type: 'email', step: 'credentials', password: '', email: '', code: '' })}><Mail size={17} />{mfa.methods.includes('email') ? '更换管理员验证邮箱' : '添加管理员邮箱验证码'}</button>
        </div>
      </section>

      {mfa.enabled ? <section className="admin-panel admin-security-methods admin-system-mfa-methods"><header><div><h2>当前验证方式</h2><p>管理员登录页只会要求输入“验证码”，不会暴露内部安全机制名称。</p></div><div className="admin-security-actions"><button className="admin-button admin-button-secondary" type="button" disabled={loading || Boolean(mfaBusy)} onClick={() => setDialog({ type: 'recovery', step: 'credentials', method: mfa.methods.includes('totp') ? 'totp' : 'email', password: '', code: '' })}><KeyRound size={16} />更新恢复码</button><button className="admin-button admin-button-danger" type="button" disabled={loading || Boolean(mfaBusy)} onClick={() => setDialog({ type: 'disable', step: 'credentials', method: mfa.methods.includes('totp') ? 'totp' : 'email', password: '', code: '' })}>关闭登录验证码</button></div></header><div className="admin-security-method-list">{mfa.methods.map((method) => {
        const id = typeof method === 'string' ? method : method.id || method.type;
        const active = mfa.preferred === id || (!mfa.preferred && mfa.methods.length === 1);
        return <button key={id} type="button" className={active ? 'active' : ''} onClick={() => setPreferred(id)} disabled={loading || Boolean(mfaBusy)}><span>{id === 'totp' ? <Smartphone size={19} /> : <Mail size={19} />}</span><p><b>{id === 'totp' ? '身份验证器' : '邮箱验证码'}</b><small>{id === 'email' && mfa.email ? mfa.email : active ? '当前首选方式' : '点击设为首选'}</small></p>{active ? <CheckCircle2 size={18} /> : null}</button>;
      })}</div>{mfa.recoveryCodesRemaining ? <p className="admin-recovery-count"><KeyRound size={16} />尚有 {mfa.recoveryCodesRemaining} 个恢复码可用，请离线妥善保管。</p> : null}</section> : null}

      {dialog ? <MfaDialog dialog={dialog} setDialog={setDialog} setError={setError} reload={reloadMfa} onNotice={onNotice} /> : null}
      {credentialRecovery ? <CredentialRecoveryDialog value={credentialRecovery} setValue={setCredentialRecovery} onNotice={onNotice} /> : null}
    </>
  );
}

function Rule({ valid, children }) {
  return <li className={valid ? 'is-valid' : ''}>{valid ? <Check size={13} /> : <span />}{children}</li>;
}

function CredentialRecoveryDialog({ value, setValue, onNotice }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(value.recoveryCodes.join('\n'));
      setValue((current) => ({ ...current, copyError: '' }));
      onNotice('新的管理员恢复码已复制，请离线保存');
    } catch {
      setValue((current) => ({ ...current, copyError: '浏览器未允许复制，请手动保存下面的恢复码。' }));
    }
  }

  function finish() {
    if (value.sessionInvalidated) {
      window.location.assign(window.location.pathname);
      return;
    }
    setValue(null);
  }

  return <div className="admin-security-dialog-layer"><div className="admin-security-dialog-backdrop" aria-hidden="true" /><section className="admin-security-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-credential-recovery-title"><div className="admin-recovery-panel"><CheckCircle2 size={32} /><h3 id="admin-credential-recovery-title">管理员恢复码已更新</h3><p>管理员账号变更后，原恢复码已失效。下面的恢复码只展示这一次，请立即保存到离线密码管理器。</p><div>{value.recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>{value.copyError ? <p className="admin-form-error" role="alert">{value.copyError}</p> : null}<footer><button className="admin-button admin-button-secondary" type="button" onClick={copy}><Copy size={17} />复制恢复码</button><button className="admin-button admin-button-primary" type="button" onClick={finish}>{value.sessionInvalidated ? '返回登录' : '我已安全保存'}</button></footer></div></section></div>;
}

function MfaDialog({ dialog, setDialog, setError, reload, onNotice }) {
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState('');
  const update = (key) => (event) => setDialog((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setLocalError('');
    setError('');
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
        await api.disableAdminMfa({ currentPassword: dialog.password, method: 'all', code: dialog.code, ...(dialog.challengeId ? { challengeId: dialog.challengeId } : {}) });
        await reload();
        setDialog(null);
        onNotice('管理员登录验证码已关闭');
      } else if (dialog.type === 'recovery') {
        const response = await api.regenerateAdminRecovery({ currentPassword: dialog.password, code: dialog.code, ...(dialog.challengeId ? { challengeId: dialog.challengeId } : {}) });
        const recoveryCodes = response.data?.recoveryCodes || [];
        setDialog((current) => ({ ...current, step: 'recovery', recoveryCodes }));
        await reload();
      }
    } catch (requestError) {
      setLocalError(requestError.message || '操作未完成，请检查输入后重试');
    } finally {
      setBusy(false);
    }
  }

  async function copyRecoveryCodes() {
    const text = (dialog.recoveryCodes || []).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      onNotice('恢复码已复制，请离线保存');
    } catch {
      setLocalError('浏览器未允许复制，请手动保存恢复码');
    }
  }

  const title = dialog.type === 'disable' ? '关闭登录验证码' : dialog.type === 'recovery' ? '更新恢复码' : dialog.type === 'totp' ? '配置身份验证器' : '设置验证邮箱';
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
