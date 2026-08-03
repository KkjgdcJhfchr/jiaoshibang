import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BadgePercent,
  Gift,
  LoaderCircle,
  RefreshCw,
  Save,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useSiteConfig } from '../lib/site-config.jsx';
import './admin-referral-rewards.css';

const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  rewardMode: 'both',
  inviterRewardCredits: 1,
  inviteeRewardCredits: 1,
  maxRewardsPerUser: 20,
  headline: '邀请好友一起高效备课',
  description: '好友完成注册后，双方可按当前活动规则获得教案生成额度。',
});

const REWARD_MODES = Object.freeze([
  { value: 'both', label: '双方奖励', detail: '邀请人和完成注册的新用户都获得额度' },
  { value: 'inviter_only', label: '仅邀请人', detail: '只给发出邀请的教师奖励额度' },
  { value: 'invitee_only', label: '仅新用户', detail: '只给通过邀请完成注册的新用户奖励额度' },
]);

export function ReferralRewardsPage({ onNotice = () => {} }) {
  const { applySiteConfig } = useSiteConfig();
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [saveStatus, setSaveStatus] = useState('');
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setSaveStatus('');
    api.getAdminReferralSettings().then((response) => {
      if (!active) return;
      setSettings(normalizeSettings(response.data?.referralSettings || response.data));
      setDirty(false);
    }).catch((requestError) => {
      if (!active) return;
      setError(requestError.message || '推广奖励设置读取失败，请稍后重试。');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [refreshToken]);

  function update(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setError('');
    setSaveStatus('');
  }

  async function save(event) {
    event.preventDefault();
    if (saving || loading) return;
    const payload = {
      ...settings,
      enabled: Boolean(settings.enabled),
      inviterRewardCredits: boundedInteger(settings.inviterRewardCredits, 0, 100_000),
      inviteeRewardCredits: boundedInteger(settings.inviteeRewardCredits, 0, 100_000),
      maxRewardsPerUser: boundedInteger(settings.maxRewardsPerUser, 1, 1_000_000),
      headline: String(settings.headline || '').trim(),
      description: String(settings.description || '').trim(),
    };
    if (!payload.headline || !payload.description) {
      setError('请完整填写活动标题和规则说明。');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await api.saveAdminReferralSettings(payload);
      const savedSettings = normalizeSettings(response.data?.referralSettings || payload);
      setSettings(savedSettings);
      setDirty(false);
      setSaveStatus('设置已保存并生效');
      applySiteConfig({ referralProgram: savedSettings });
      onNotice('推广奖励设置已保存并立即生效');
    } catch (requestError) {
      const message = requestError.message || '推广奖励设置保存失败，请稍后重试。';
      setError(message);
      setSaveStatus('');
      onNotice(`保存失败：${message}`);
    } finally {
      setSaving(false);
    }
  }

  const inviterReward = settings.rewardMode === 'invitee_only'
    ? 0
    : boundedInteger(settings.inviterRewardCredits, 0, 100_000);
  const inviteeReward = settings.rewardMode === 'inviter_only'
    ? 0
    : boundedInteger(settings.inviteeRewardCredits, 0, 100_000);

  return (
    <div className="admin-referral-page" aria-busy={loading || saving}>
      <div className="admin-page-heading admin-referral-heading">
        <div><h1>推广奖励</h1><p>独立管理邀请活动、双方奖励额度和用户端规则说明</p></div>
        <button className="admin-button admin-button-secondary" type="button" onClick={() => setRefreshToken((current) => current + 1)} disabled={loading || saving || dirty} title={dirty ? '请先保存或刷新页面放弃当前修改' : undefined}>
          <RefreshCw size={17} className={loading ? 'spin' : undefined} />{loading ? '正在读取…' : '重新读取'}
        </button>
      </div>

      {error ? <div className="admin-referral-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div> : null}

      <form className="admin-referral-layout" onSubmit={save}>
        <div className="admin-referral-main">
          <section className="admin-panel admin-referral-status-card">
            <div className="admin-referral-section-title">
              <span><Gift size={21} /></span>
              <div><h2>推广活动状态</h2><p>开启后，用户端会展示当前奖励规则、邀请码和专属推广链接。</p></div>
            </div>
            <button className={`admin-toggle ${settings.enabled ? 'admin-toggle-on' : ''}`} type="button" role="switch" aria-checked={settings.enabled} aria-label={settings.enabled ? '停用推广奖励' : '启用推广奖励'} disabled={loading || saving} onClick={() => update('enabled', !settings.enabled)}><span className="admin-toggle-knob" /></button>
          </section>

          <section className="admin-panel admin-referral-form-card">
            <header><div><h2>奖励方式与额度</h2><p>奖励在受邀用户完成验证注册后按当时启用的规则发放。</p></div><BadgePercent size={22} /></header>
            <fieldset className="admin-referral-modes" disabled={loading || saving}>
              <legend>奖励对象</legend>
              {REWARD_MODES.map((mode) => (
                <label className={settings.rewardMode === mode.value ? 'is-selected' : ''} key={mode.value}>
                  <input type="radio" name="rewardMode" value={mode.value} checked={settings.rewardMode === mode.value} onChange={() => update('rewardMode', mode.value)} />
                  <span><b>{mode.label}</b><small>{mode.detail}</small></span>
                </label>
              ))}
            </fieldset>
            <div className="admin-referral-number-grid">
              <label><span>邀请人奖励额度</span><input type="number" min="0" max="100000" step="1" value={settings.inviterRewardCredits} onChange={(event) => update('inviterRewardCredits', event.target.value)} disabled={loading || saving || settings.rewardMode === 'invitee_only'} required /><small>每成功邀请一位符合条件的新用户获得的教案生成额度。</small></label>
              <label><span>受邀用户奖励额度</span><input type="number" min="0" max="100000" step="1" value={settings.inviteeRewardCredits} onChange={(event) => update('inviteeRewardCredits', event.target.value)} disabled={loading || saving || settings.rewardMode === 'inviter_only'} required /><small>新用户通过邀请链接完成验证注册后获得的额度。</small></label>
              <label><span>每位邀请人最多奖励次数</span><input type="number" min="1" max="1000000" step="1" value={settings.maxRewardsPerUser} onChange={(event) => update('maxRewardsPerUser', event.target.value)} disabled={loading || saving} required /><small>达到上限后仍可分享，但不会继续向邀请人发放奖励。</small></label>
            </div>
          </section>

          <section className="admin-panel admin-referral-copy-card">
            <header><div><h2>用户端文案与规则说明</h2><p>这里的内容会同步展示在教师端推广入口和邀请详情页。</p></div><Sparkles size={22} /></header>
            <label><span>活动标题</span><input value={settings.headline} onChange={(event) => update('headline', event.target.value)} maxLength={120} disabled={loading || saving} required /></label>
            <label><span>规则说明</span><textarea value={settings.description} onChange={(event) => update('description', event.target.value)} maxLength={1000} rows={6} disabled={loading || saving} required /><small>建议写清奖励触发条件、到账方式和活动限制；可换行展示多条说明。</small></label>
          </section>
        </div>

        <aside className="admin-panel admin-referral-preview">
          <div className="admin-referral-preview-label"><UserPlus size={16} />用户端实时预览</div>
          <span className={`admin-referral-preview-status ${settings.enabled ? 'is-enabled' : ''}`}>{settings.enabled ? '活动已开启' : '活动未开启'}</span>
          <h2>{settings.headline || '推广活动标题'}</h2>
          <p>{settings.description || '请填写用户能够理解的推广规则说明。'}</p>
          <div className="admin-referral-preview-rewards">
            <article><small>邀请人</small><b>+{inviterReward}</b><span>额度 / 人</span></article>
            <article><small>新用户</small><b>+{inviteeReward}</b><span>额度 / 人</span></article>
          </div>
          <div className="admin-referral-preview-code"><small>用户专属邀请码</small><strong>BKX••••••••</strong><span>前端会为每位教师生成真实邀请码与推广链接</span></div>
        </aside>

        <footer className="admin-panel admin-referral-actions">
          <div className={saveStatus ? 'is-saved' : ''} role="status" aria-live="polite">{saving ? <><span className="is-dirty" />正在保存设置…</> : saveStatus ? <><span />{saveStatus}</> : dirty ? <><span className="is-dirty" />当前有尚未保存的修改</> : <><span />当前设置已与服务器同步</>}</div>
          <button className="admin-button admin-button-primary" type="submit" disabled={loading || saving || !dirty}>{saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{saving ? '正在保存…' : '保存推广设置'}</button>
        </footer>
      </form>
    </div>
  );
}

function normalizeSettings(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { ...DEFAULT_SETTINGS, ...source };
}

function boundedInteger(value, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, Math.min(maximum, parsed));
}
