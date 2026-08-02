import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BadgePercent,
  GripVertical,
  ImagePlus,
  Link2,
  LoaderCircle,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import './admin-marketing.css';

const EMPTY_AD_FORM = Object.freeze({
  title: '',
  altText: '',
  linkUrl: '',
  imageDataUrl: '',
  enabled: true,
});

const EMPTY_REFERRAL_SETTINGS = Object.freeze({
  enabled: false,
  rewardMode: 'both',
  inviterRewardCredits: 1,
  inviteeRewardCredits: 1,
  maxRewardsPerUser: 20,
  headline: '邀请好友一起高效备课',
  description: '好友完成注册后，双方可按当前活动规则获得教案生成额度。',
});

const REWARD_MODES = Object.freeze([
  { value: 'both', label: '邀请人和受邀用户都奖励' },
  { value: 'inviter_only', label: '仅奖励邀请人' },
  { value: 'invitee_only', label: '仅奖励受邀用户' },
]);

export function MarketingPage({ onNotice = () => {} }) {
  const [activeTab, setActiveTab] = useState('ads');
  const [ads, setAds] = useState([]);
  const [referralSettings, setReferralSettings] = useState(() => ({ ...EMPTY_REFERRAL_SETTINGS }));
  const [referralDirty, setReferralDirty] = useState(false);
  const [editor, setEditor] = useState(null);
  const [editorError, setEditorError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [draggedId, setDraggedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  async function reload() {
    setLoading(true);
    setError('');
    try {
      const response = await api.getAdminMarketing();
      const data = response.data || {};
      setAds(Array.isArray(data.ads) ? data.ads : []);
      setReferralSettings(normalizeReferralSettings(data.referralSettings));
      setReferralDirty(false);
    } catch (requestError) {
      setError(requestError.message || '营销配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { reload(); }, []);

  function openCreateAd() {
    setError('');
    setEditorError('');
    setEditor({ ad: null, form: { ...EMPTY_AD_FORM } });
  }

  function openEditAd(ad) {
    setError('');
    setEditorError('');
    setEditor({
      ad,
      form: {
        title: String(ad.title || ''),
        altText: String(ad.altText || ''),
        linkUrl: String(ad.linkUrl || ''),
        imageDataUrl: '',
        enabled: ad.enabled !== false,
      },
    });
  }

  function closeEditor() {
    setEditorError('');
    setEditor(null);
  }

  function openDeleteAd(ad) {
    setError('');
    setDeleteError('');
    setDeleteTarget(ad);
  }

  function closeDeleteAd() {
    setDeleteError('');
    setDeleteTarget(null);
  }

  function updateAdForm(field, value) {
    setEditorError('');
    setEditor((current) => current ? { ...current, form: { ...current.form, [field]: value } } : current);
  }

  async function saveAd(event) {
    event.preventDefault();
    if (!editor || busy) return;
    const id = adId(editor.ad);
    if (!id && !editor.form.imageDataUrl) {
      setEditorError('新增广告必须上传一张宣传图片');
      return;
    }
    const linkError = validateAdLink(editor.form.linkUrl);
    if (linkError) {
      setEditorError(linkError);
      return;
    }
    setBusy('ad-save');
    setEditorError('');
    try {
      const payload = {
        title: editor.form.title.trim(),
        altText: editor.form.altText.trim(),
        linkUrl: editor.form.linkUrl.trim(),
        enabled: Boolean(editor.form.enabled),
        ...(editor.form.imageDataUrl ? { imageDataUrl: editor.form.imageDataUrl } : {}),
      };
      if (id) await api.updateAdminMarketingAd(id, payload);
      else await api.createAdminMarketingAd(payload);
      closeEditor();
      await reload();
      onNotice(id ? '广告内容已更新' : '广告内容已创建');
    } catch (requestError) {
      setEditorError(requestError.message || '广告保存失败');
    } finally {
      setBusy('');
    }
  }

  async function removeAd() {
    if (!deleteTarget || busy) return;
    const id = adId(deleteTarget);
    setBusy(`ad-delete-${id}`);
    setDeleteError('');
    try {
      await api.deleteAdminMarketingAd(id);
      setAds((current) => current.filter((ad) => adId(ad) !== id));
      closeDeleteAd();
      onNotice('广告内容已删除');
    } catch (requestError) {
      setDeleteError(requestError.message || '广告删除失败');
    } finally {
      setBusy('');
    }
  }

  async function persistAdOrder(nextAds, previousAds) {
    setAds(nextAds);
    setBusy('ad-order');
    setError('');
    try {
      await api.reorderAdminMarketingAds(nextAds.map(adId));
      onNotice('广告展示顺序已保存');
    } catch (requestError) {
      setAds(previousAds);
      setError(requestError.message || '广告顺序保存失败');
    } finally {
      setBusy('');
      setDraggedId('');
    }
  }

  function moveAdTo(sourceId, targetId) {
    if (!sourceId || sourceId === targetId || busy) return;
    const sourceIndex = ads.findIndex((ad) => adId(ad) === sourceId);
    const targetIndex = ads.findIndex((ad) => adId(ad) === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const previousAds = ads;
    const nextAds = [...ads];
    const [moved] = nextAds.splice(sourceIndex, 1);
    nextAds.splice(targetIndex, 0, moved);
    persistAdOrder(nextAds, previousAds);
  }

  function moveAdBy(id, direction) {
    const index = ads.findIndex((ad) => adId(ad) === id);
    const target = ads[index + direction];
    if (!target) return;
    moveAdTo(id, adId(target));
  }

  function updateReferral(field, value) {
    setReferralSettings((current) => ({ ...current, [field]: value }));
    setReferralDirty(true);
  }

  async function saveReferral(event) {
    event.preventDefault();
    if (!referralDirty || busy) return;
    setBusy('referral-save');
    setError('');
    try {
      const payload = {
        ...referralSettings,
        enabled: Boolean(referralSettings.enabled),
        inviterRewardCredits: boundedInteger(referralSettings.inviterRewardCredits, 0, 100000),
        inviteeRewardCredits: boundedInteger(referralSettings.inviteeRewardCredits, 0, 100000),
        maxRewardsPerUser: boundedInteger(referralSettings.maxRewardsPerUser, 1, 1000000),
        headline: referralSettings.headline.trim(),
        description: referralSettings.description.trim(),
      };
      const response = await api.saveAdminReferralSettings(payload);
      setReferralSettings(normalizeReferralSettings(response.data?.referralSettings || payload));
      setReferralDirty(false);
      onNotice('推广奖励设置已保存');
    } catch (requestError) {
      setError(requestError.message || '推广奖励设置保存失败');
    } finally {
      setBusy('');
    }
  }

  const enabledAds = ads.filter((ad) => ad.enabled !== false).length;

  return (
    <div className="admin-marketing-page" aria-busy={loading || Boolean(busy)}>
      <div className="admin-page-heading admin-marketing-heading">
        <div><h1>广告宣传营销</h1><p>管理用户端广告展示顺序、宣传链接与邀请推广奖励</p></div>
        <button className="admin-button admin-button-secondary" type="button" onClick={reload} disabled={loading || Boolean(busy)}><RefreshCw size={17} className={loading ? 'spin' : ''} />刷新配置</button>
      </div>

      {error ? <div className="admin-marketing-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={16} /></button></div> : null}

      <div className="admin-marketing-tabs" role="tablist" aria-label="营销配置">
        <button type="button" role="tab" aria-selected={activeTab === 'ads'} className={activeTab === 'ads' ? 'active' : ''} onClick={() => setActiveTab('ads')}><Megaphone size={17} />广告位</button>
        <button type="button" role="tab" aria-selected={activeTab === 'referral'} className={activeTab === 'referral' ? 'active' : ''} onClick={() => setActiveTab('referral')}><UserPlus size={17} />推广奖励</button>
      </div>

      {activeTab === 'ads' ? (
        <section className="admin-panel admin-marketing-ads" role="tabpanel">
          <header className="admin-marketing-section-header">
            <div><h2>广告位内容</h2><p>已创建 {ads.length} 条，启用 {enabledAds} 条。拖动卡片可调整用户端展示顺序。</p></div>
            <button className="admin-button admin-button-primary" type="button" onClick={openCreateAd} disabled={loading || Boolean(busy)}><Plus size={17} />新增广告</button>
          </header>
          <div className="admin-marketing-ad-grid">
            {!loading ? ads.map((ad, index) => {
              const id = adId(ad);
              const isDragging = draggedId === id;
              return (
                <article
                  className={`admin-marketing-ad-card ${isDragging ? 'is-dragging' : ''}`}
                  key={id}
                  draggable={!busy}
                  onDragStart={(event) => { setDraggedId(id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id); }}
                  onDragEnd={() => setDraggedId('')}
                  onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(event) => { event.preventDefault(); moveAdTo(event.dataTransfer.getData('text/plain') || draggedId, id); }}
                >
                  <div className="admin-marketing-ad-image"><img src={adImage(ad)} alt={ad.altText || ad.title || '宣传广告'} /><span>{index + 1}</span></div>
                  <div className="admin-marketing-ad-copy"><div><b>{ad.title || '未命名广告'}</b><i className={ad.enabled !== false ? 'enabled' : ''}>{ad.enabled !== false ? '已启用' : '已停用'}</i></div><p>{ad.altText || '未填写图片说明'}</p><small><Link2 size={13} />{ad.linkUrl || '未设置跳转链接'}</small></div>
                  <footer>
                    <span className="admin-marketing-drag-handle" title="拖动排序"><GripVertical size={18} />拖动排序</span>
                    <div>
                      <button type="button" aria-label={`上移 ${ad.title || '广告'}`} title="上移" disabled={index === 0 || Boolean(busy)} onClick={() => moveAdBy(id, -1)}><ArrowUp size={15} /></button>
                      <button type="button" aria-label={`下移 ${ad.title || '广告'}`} title="下移" disabled={index === ads.length - 1 || Boolean(busy)} onClick={() => moveAdBy(id, 1)}><ArrowDown size={15} /></button>
                      <button type="button" aria-label={`编辑 ${ad.title || '广告'}`} title="编辑" disabled={Boolean(busy)} onClick={() => openEditAd(ad)}><Pencil size={15} /></button>
                      <button className="danger" type="button" aria-label={`删除 ${ad.title || '广告'}`} title="删除" disabled={Boolean(busy)} onClick={() => openDeleteAd(ad)}><Trash2 size={15} /></button>
                    </div>
                  </footer>
                </article>
              );
            }) : null}
            {loading ? <div className="admin-marketing-state"><LoaderCircle className="spin" size={22} />正在读取广告内容…</div> : null}
            {!loading && !ads.length ? <div className="admin-marketing-empty"><ImagePlus size={30} /><b>还没有广告内容</b><p>点击“新增广告”上传第一张宣传图片并设置跳转链接。</p><button className="admin-button admin-button-primary" type="button" onClick={openCreateAd}><Plus size={17} />新增广告</button></div> : null}
          </div>
        </section>
      ) : (
        <ReferralSettingsForm settings={referralSettings} dirty={referralDirty} loading={loading} busy={busy === 'referral-save'} onChange={updateReferral} onSubmit={saveReferral} />
      )}

      {editor ? <AdEditor editor={editor} error={editorError} busy={busy === 'ad-save'} onChange={updateAdForm} onError={setEditorError} onSubmit={saveAd} onClose={closeEditor} /> : null}
      {deleteTarget ? <DeleteAdDialog ad={deleteTarget} error={deleteError} busy={busy === `ad-delete-${adId(deleteTarget)}`} onCancel={closeDeleteAd} onConfirm={removeAd} /> : null}
    </div>
  );
}

function ReferralSettingsForm({ settings, dirty, loading, busy, onChange, onSubmit }) {
  return (
    <form className="admin-panel admin-marketing-referral" role="tabpanel" onSubmit={onSubmit}>
      <header className="admin-marketing-section-header"><div><h2>推广奖励规则</h2><p>配置邀请双方获得的教案生成额度、触发时机与单个邀请人的奖励上限。</p></div><button className={`admin-toggle ${settings.enabled ? 'admin-toggle-on' : ''}`} type="button" role="switch" aria-checked={settings.enabled} aria-label="启用推广奖励" disabled={loading || busy} onClick={() => onChange('enabled', !settings.enabled)}><span className="admin-toggle-knob" /></button></header>
      <div className="admin-marketing-referral-layout">
        <fieldset disabled={loading || busy}>
          <label className="wide"><span>活动标题</span><input value={settings.headline} onChange={(event) => onChange('headline', event.target.value)} maxLength={120} required /></label>
          <label className="wide"><span>活动说明</span><textarea value={settings.description} onChange={(event) => onChange('description', event.target.value)} maxLength={1000} required /></label>
          <label><span>奖励对象</span><select value={settings.rewardMode} onChange={(event) => onChange('rewardMode', event.target.value)}>{REWARD_MODES.map((mode) => <option value={mode.value} key={mode.value}>{mode.label}</option>)}</select><small>奖励在受邀用户完成验证码注册后发放。</small></label>
          <label><span>邀请人奖励额度</span><input type="number" min="0" max="100000" step="1" value={settings.inviterRewardCredits} onChange={(event) => onChange('inviterRewardCredits', event.target.value)} required /></label>
          <label><span>受邀用户奖励额度</span><input type="number" min="0" max="100000" step="1" value={settings.inviteeRewardCredits} onChange={(event) => onChange('inviteeRewardCredits', event.target.value)} required /></label>
          <label><span>每位邀请人最多奖励次数</span><input type="number" min="1" max="1000000" step="1" value={settings.maxRewardsPerUser} onChange={(event) => onChange('maxRewardsPerUser', event.target.value)} required /></label>
        </fieldset>
        <aside><span><BadgePercent size={24} /></span><small>用户端展示预览</small><h3>{settings.headline || '推广活动标题'}</h3><p>{settings.description || '推广活动说明'}</p><dl><div><dt>邀请人</dt><dd>{settings.rewardMode === 'invitee_only' ? '不奖励' : `+${boundedInteger(settings.inviterRewardCredits, 0, 100000)} 次`}</dd></div><div><dt>新用户</dt><dd>{settings.rewardMode === 'inviter_only' ? '不奖励' : `+${boundedInteger(settings.inviteeRewardCredits, 0, 100000)} 次`}</dd></div></dl><i className={settings.enabled ? 'enabled' : ''}>{settings.enabled ? '活动已启用' : '活动未启用'}</i></aside>
      </div>
      <footer><p>保存后新触发的邀请关系将按最新规则计算，历史已发放奖励不会重复计算。</p><button className="admin-button admin-button-primary" type="submit" disabled={loading || busy || !dirty}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{busy ? '正在保存…' : '保存推广设置'}</button></footer>
    </form>
  );
}

function AdEditor({ editor, error, busy, onChange, onError, onSubmit, onClose }) {
  const fileInput = useRef(null);
  const existingImage = adImage(editor.ad);
  const preview = editor.form.imageDataUrl || existingImage;

  async function selectImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('只支持 JPG、PNG、WEBP 或 GIF 图片');
    if (file.size > 5 * 1024 * 1024) throw new Error('宣传图片不能超过 5MB');
    onChange('imageDataUrl', await readFileAsDataUrl(file));
    onError('');
  }

  return (
    <div className="admin-marketing-dialog-layer">
      <button className="admin-marketing-dialog-backdrop" type="button" onClick={onClose} aria-label="关闭广告编辑窗口" disabled={busy} />
      <section className="admin-marketing-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-marketing-dialog-title">
        <header><div><h2 id="admin-marketing-dialog-title">{editor.ad ? '编辑广告' : '新增广告'}</h2><p>上传宣传图片，设置用户点击后打开的站内页面或 HTTPS 链接。</p></div><button type="button" onClick={onClose} aria-label="关闭" disabled={busy}><X size={20} /></button></header>
        <form onSubmit={onSubmit}>
          <div className="admin-marketing-upload wide">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(event) => selectImage(event).catch((failure) => onError(failure.message || '图片读取失败，请重新选择'))} />
            {preview ? <img src={preview} alt="广告图片预览" /> : <span><ImagePlus size={30} /><b>尚未选择宣传图片</b></span>}
            <button className="admin-button admin-button-secondary" type="button" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={16} />{preview ? '更换图片' : '选择图片'}</button>
            <small>支持 JPG、PNG、WEBP、GIF，单张不超过 5MB。推荐横向图片。</small>
          </div>
          <label className="wide"><span>广告标题</span><input value={editor.form.title} onChange={(event) => onChange('title', event.target.value)} maxLength={120} required autoFocus disabled={busy} /></label>
          <label className="wide"><span>图片文字说明</span><input value={editor.form.altText} onChange={(event) => onChange('altText', event.target.value)} maxLength={240} required disabled={busy} /><small>用于无障碍阅读和图片无法显示时的替代说明。</small></label>
          <label className="wide"><span>点击跳转链接</span><input value={editor.form.linkUrl} onChange={(event) => onChange('linkUrl', event.target.value)} maxLength={2000} placeholder="/app/membership 或 https://example.com/activity" disabled={busy} /><small>站内路径请以 / 开头；站外链接仅支持完整 HTTPS 地址。留空表示只展示图片。</small></label>
          <div className="admin-marketing-dialog-switch wide"><div><b>立即启用</b><span>停用后内容仍保留，但不会在用户端展示。</span></div><button className={`admin-toggle ${editor.form.enabled ? 'admin-toggle-on' : ''}`} type="button" role="switch" aria-checked={editor.form.enabled} disabled={busy} onClick={() => onChange('enabled', !editor.form.enabled)}><span className="admin-toggle-knob" /></button></div>
          {error ? <div className="admin-marketing-dialog-error wide" role="alert"><AlertTriangle size={18} /><span>{error}</span></div> : null}
          <footer className="wide"><button className="admin-button admin-button-secondary" type="button" onClick={onClose} disabled={busy}>取消</button><button className="admin-button admin-button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{busy ? '正在保存…' : '保存广告'}</button></footer>
        </form>
      </section>
    </div>
  );
}

function DeleteAdDialog({ ad, error, busy, onCancel, onConfirm }) {
  return (
    <div className="admin-marketing-dialog-layer">
      <button className="admin-marketing-dialog-backdrop" type="button" onClick={onCancel} aria-label="取消删除广告" disabled={busy} />
      <section className="admin-marketing-dialog admin-marketing-confirm" role="alertdialog" aria-modal="true" aria-labelledby="admin-marketing-delete-title">
        <span><Trash2 size={24} /></span><h2 id="admin-marketing-delete-title">删除这条广告？</h2><p>“{ad.title || '未命名广告'}”删除后将立即停止展示，且无法恢复。</p>
        {error ? <div className="admin-marketing-dialog-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div> : null}
        <footer><button className="admin-button admin-button-secondary" type="button" onClick={onCancel} disabled={busy}>取消</button><button className="admin-button admin-marketing-danger-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{busy ? '正在删除…' : '确认删除'}</button></footer>
      </section>
    </div>
  );
}

function adId(ad) {
  return String(ad?.id || ad?.adId || '');
}

function adImage(ad) {
  return String(ad?.imageUrl || ad?.imageDataUrl || '');
}

function normalizeReferralSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  return { ...EMPTY_REFERRAL_SETTINGS, ...source };
}

function boundedInteger(value, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function validateAdLink(value) {
  const link = String(value || '').trim();
  if (!link) return '';
  if (link.startsWith('/') && !link.startsWith('//') && !/[\r\n\\]/.test(link)) return '';
  try {
    const parsed = new URL(link);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return '';
  } catch {
    // Use the same user-facing validation message for malformed and unsafe links.
  }
  return '跳转链接请填写以 / 开头的站内路径，或完整的 HTTPS 地址';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败，请重新选择'));
    reader.readAsDataURL(file);
  });
}
