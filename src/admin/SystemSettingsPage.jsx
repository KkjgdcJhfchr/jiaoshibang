import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileText,
  LoaderCircle,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useSiteConfig } from '../lib/site-config.jsx';
import { AdminAccountSecurity } from './AdminAccountSecurity.jsx';
import './admin-system-settings.css';
import './admin-security.css';

const EMPTY_SETTINGS = {
  siteName: '',
  supportEmail: '',
  registrationOpen: true,
  registrationVerificationRequired: true,
  privacyPolicyTitle: '数据与隐私说明',
  privacyPolicyContent: '',
  updatedAt: '',
};

export function SystemSettingsPage({ onNotice = () => {} }) {
  const { applySiteConfig } = useSiteConfig();
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const response = await api.getSystemSettings();
      setSettings({ ...EMPTY_SETTINGS, ...(response.data?.settings || response.data || {}) });
      setDirty(false);
    } catch (requestError) {
      setError(requestError.message || '系统设置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  function update(field, value) {
    setSettings((current) => ({ ...current, [field]: value }));
    setDirty(true);
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    try {
      const response = await api.saveSystemSettings({
        expectedUpdatedAt: settings.updatedAt,
        siteName: settings.siteName,
        supportEmail: settings.supportEmail,
        registrationOpen: settings.registrationOpen,
        registrationVerificationRequired: settings.registrationVerificationRequired,
        privacyPolicyTitle: settings.privacyPolicyTitle,
        privacyPolicyContent: settings.privacyPolicyContent,
      });
      setSettings({ ...EMPTY_SETTINGS, ...(response.data?.settings || response.data || {}) });
      applySiteConfig(response.data?.settings || response.data || {});
      setDirty(false);
      onNotice('系统设置已保存并立即生效');
    } catch (requestError) {
      setError(requestError.message || '系统设置保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function checkHealth() {
    setCheckingHealth(true);
    setError('');
    try {
      const response = await api.health();
      setHealth(response.data || {});
      onNotice('服务器运行状态已更新');
    } catch (requestError) {
      setError(requestError.message || '服务器状态读取失败');
    } finally {
      setCheckingHealth(false);
    }
  }

  return (
    <div className="admin-system-page" aria-busy={loading || saving}>
      <div className="admin-page-heading admin-system-heading">
        <div><h1>系统设置</h1><p>维护站点资料、管理员账号与登录保护、注册规则以及数据与隐私说明</p></div>
        <div className="admin-system-heading-actions">
          <button className="admin-button admin-button-secondary" type="button" onClick={reload} disabled={loading || saving}><RefreshCw size={17} className={loading ? 'spin' : ''} />重新读取</button>
          <button className="admin-button admin-button-primary" type="button" onClick={save} disabled={loading || saving || !dirty}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存设置</button>
        </div>
      </div>

      {error ? <div className="admin-system-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭"><X size={16} /></button></div> : null}

      <div className="admin-system-grid">
        <section className="admin-panel admin-system-card">
          <header><span><Settings size={20} /></span><div><h2>站点基础信息</h2><p>站点名称保存后会同步更新前台、后台、页面标题、邮件与支付订单品牌。</p></div></header>
          <div className="admin-system-fields">
            <label><span>站点名称</span><input value={settings.siteName} onChange={(event) => update('siteName', event.target.value)} minLength={2} maxLength={40} required disabled={loading || saving} /></label>
            <label><span>客服邮箱</span><input type="email" value={settings.supportEmail} onChange={(event) => update('supportEmail', event.target.value)} placeholder="support@example.com" disabled={loading || saving} /></label>
            <label><span>当前主域名</span><input value={window.location.hostname} readOnly aria-readonly="true" /></label>
          </div>
        </section>

        <AdminAccountSecurity onNotice={onNotice} />

        <section className="admin-panel admin-system-card">
          <header><span><ShieldCheck size={20} /></span><div><h2>账号注册规则</h2><p>开关保存后由注册接口直接执行，不会只改变页面显示。</p></div></header>
          <SettingSwitch
            label="开放新用户注册"
            description="关闭后，已有账号仍可登录，新账号无法获取注册验证码或提交注册。"
            checked={settings.registrationOpen}
            disabled={loading || saving}
            onChange={(value) => update('registrationOpen', value)}
          />
          <SettingSwitch
            label="注册必须验证邮箱"
            description="开启后必须输入邮箱收到的一次性验证码；请先在“安全与通信”配置邮件发送服务。"
            checked={settings.registrationVerificationRequired}
            disabled={loading || saving}
            onChange={(value) => update('registrationVerificationRequired', value)}
          />
        </section>

        <section className="admin-panel admin-system-card admin-system-policy-card">
          <header><span><FileText size={20} /></span><div><h2>数据与隐私说明</h2><p>注册页和公开页点击后会弹窗显示这里保存的完整内容。</p></div></header>
          <div className="admin-system-fields">
            <label><span>弹窗标题</span><input value={settings.privacyPolicyTitle} onChange={(event) => update('privacyPolicyTitle', event.target.value)} minLength={2} maxLength={80} required disabled={loading || saving} /></label>
            <label className="wide"><span>说明正文</span><textarea value={settings.privacyPolicyContent} onChange={(event) => update('privacyPolicyContent', event.target.value)} minLength={100} maxLength={20000} required disabled={loading || saving} /></label>
          </div>
          <p className="admin-system-policy-note">保存前请确认内容与平台实际的数据处理方式一致。涉及教材、教案或模型改进的用途不能在公开说明中隐瞒。</p>
        </section>

        <aside className="admin-panel admin-system-health-card">
          <header><span><Activity size={20} /></span><div><h2>部署与证书</h2><p>HTTPS 证书由 Caddy 自动申请和续期。</p></div></header>
          <div className={`admin-system-health-status ${health?.status === 'ok' ? 'ready' : ''}`}>
            {health?.status === 'ok' ? <CheckCircle2 size={28} /> : <Activity size={28} />}
            <div><b>{health?.status === 'ok' ? 'API 服务运行正常' : '尚未读取运行状态'}</b><span>{health?.timestamp ? new Date(health.timestamp).toLocaleString('zh-CN') : '点击下方按钮获取服务器返回结果'}</span></div>
          </div>
          <dl><div><dt>主域名</dt><dd>{window.location.hostname}</dd></div><div><dt>API 服务</dt><dd>{health?.service || '待读取'}</dd></div><div><dt>AI 通道</dt><dd>{health ? (health.aiConfigured ? '已配置' : '未配置') : '待读取'}</dd></div><div><dt>HTTPS 证书</dt><dd>自动管理</dd></div></dl>
          <button className="admin-button admin-button-secondary admin-button-full" type="button" onClick={checkHealth} disabled={checkingHealth}>{checkingHealth ? <LoaderCircle className="spin" size={17} /> : <Activity size={17} />}读取运行状态</button>
        </aside>
      </div>
    </div>
  );
}

function SettingSwitch({ label, description, checked, disabled, onChange }) {
  return <div className="admin-system-switch-row"><div><b>{label}</b><p>{description}</p></div><button className={`admin-toggle ${checked ? 'admin-toggle-on' : ''}`} type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span className="admin-toggle-knob" /></button></div>;
}
