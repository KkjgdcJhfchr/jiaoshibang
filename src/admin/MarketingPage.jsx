import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  GripVertical,
  ImagePlus,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useSiteConfig } from '../lib/site-config.jsx';
import './admin-marketing.css';

const EMPTY_AD_FORM = Object.freeze({
  linkUrl: '',
  imageDataUrl: '',
  imageWidth: 0,
  imageHeight: 0,
});

export function MarketingPage({ onNotice = () => {} }) {
  const { applySiteConfig } = useSiteConfig();
  const [ads, setAds] = useState([]);
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
      return data;
    } catch (requestError) {
      setError(requestError.message || '营销配置读取失败');
      return null;
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
        linkUrl: String(ad.linkUrl || ''),
        imageDataUrl: '',
        imageWidth: 0,
        imageHeight: 0,
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

  function publishAds(nextAds) {
    applySiteConfig({
      ads: (Array.isArray(nextAds) ? nextAds : []).map((ad) => ({
        id: adId(ad),
        imageUrl: adImage(ad),
        linkUrl: String(ad?.linkUrl || ''),
      })),
    });
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
        linkUrl: editor.form.linkUrl.trim(),
        ...(editor.form.imageDataUrl ? { imageDataUrl: editor.form.imageDataUrl } : {}),
      };
      if (id) await api.updateAdminMarketingAd(id, payload);
      else await api.createAdminMarketingAd(payload);
      closeEditor();
      const data = await reload();
      if (data?.ads) publishAds(data.ads);
      onNotice(id ? '广告图片已更新并在官网生效' : '广告图片已创建并在官网生效');
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
      const nextAds = ads.filter((ad) => adId(ad) !== id);
      setAds(nextAds);
      publishAds(nextAds);
      closeDeleteAd();
      onNotice('广告图片已删除，官网展示已同步');
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
      const response = await api.reorderAdminMarketingAds(nextAds.map(adId));
      const savedAds = Array.isArray(response.data?.ads) ? response.data.ads : nextAds;
      setAds(savedAds);
      publishAds(savedAds);
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

  return (
    <div className="admin-marketing-page" aria-busy={loading || Boolean(busy)}>
      <div className="admin-page-heading admin-marketing-heading">
        <div><h1>广告宣传营销</h1><p>上传官网宣传图片、设置点击链接并调整展示顺序</p></div>
        <button className="admin-button admin-button-secondary" type="button" onClick={reload} disabled={loading || Boolean(busy)}><RefreshCw size={17} className={loading ? 'spin' : ''} />刷新配置</button>
      </div>

      {error ? <div className="admin-marketing-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError('')}><X size={16} /></button></div> : null}

      <section className="admin-panel admin-marketing-ads">
          <header className="admin-marketing-section-header">
            <div><h2>官网广告图片</h2><p>已上传 {ads.length} 张。保存后立即展示；拖动卡片可调整轮播顺序。</p></div>
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
                  <div className="admin-marketing-ad-image"><img src={adImage(ad)} alt={`第 ${index + 1} 张官网广告图片`} /><span>{index + 1}</span></div>
                  <div className="admin-marketing-ad-link"><Link2 size={16} /><span>{ad.linkUrl || '未设置点击链接，仅展示图片'}</span></div>
                  <footer>
                    <span className="admin-marketing-drag-handle" title="拖动排序"><GripVertical size={18} />拖动排序</span>
                    <div>
                      <button type="button" aria-label={`上移第 ${index + 1} 张广告`} title="上移" disabled={index === 0 || Boolean(busy)} onClick={() => moveAdBy(id, -1)}><ArrowUp size={15} /></button>
                      <button type="button" aria-label={`下移第 ${index + 1} 张广告`} title="下移" disabled={index === ads.length - 1 || Boolean(busy)} onClick={() => moveAdBy(id, 1)}><ArrowDown size={15} /></button>
                      <button type="button" aria-label={`编辑第 ${index + 1} 张广告`} title="编辑" disabled={Boolean(busy)} onClick={() => openEditAd(ad)}><Pencil size={15} /></button>
                      <button className="danger" type="button" aria-label={`删除第 ${index + 1} 张广告`} title="删除" disabled={Boolean(busy)} onClick={() => openDeleteAd(ad)}><Trash2 size={15} /></button>
                    </div>
                  </footer>
                </article>
              );
            }) : null}
            {loading ? <div className="admin-marketing-state"><LoaderCircle className="spin" size={22} />正在读取广告内容…</div> : null}
            {!loading && !ads.length ? <div className="admin-marketing-empty"><ImagePlus size={30} /><b>还没有广告图片</b><p>点击“新增广告”上传第一张宣传图片，可按需设置点击链接。</p><button className="admin-button admin-button-primary" type="button" onClick={openCreateAd}><Plus size={17} />新增广告</button></div> : null}
          </div>
      </section>

      {editor ? <AdEditor editor={editor} error={editorError} busy={busy === 'ad-save'} onChange={updateAdForm} onError={setEditorError} onSubmit={saveAd} onClose={closeEditor} /> : null}
      {deleteTarget ? <DeleteAdDialog error={deleteError} busy={busy === `ad-delete-${adId(deleteTarget)}`} onCancel={closeDeleteAd} onConfirm={removeAd} /> : null}
    </div>
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
    const imageDataUrl = await readFileAsDataUrl(file);
    const dimensions = await readImageDimensions(imageDataUrl);
    onChange('imageDataUrl', imageDataUrl);
    onChange('imageWidth', dimensions.width);
    onChange('imageHeight', dimensions.height);
    onError('');
  }

  const hasDimensions = editor.form.imageWidth > 0 && editor.form.imageHeight > 0;
  const selectedRatio = hasDimensions ? editor.form.imageWidth / editor.form.imageHeight : 0;
  const ratioMatches = !hasDimensions || Math.abs(selectedRatio - (4 / 3)) <= 0.04;

  return (
    <div className="admin-marketing-dialog-layer">
      <button className="admin-marketing-dialog-backdrop" type="button" onClick={onClose} aria-label="关闭广告编辑窗口" disabled={busy} />
      <section className="admin-marketing-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-marketing-dialog-title">
        <header><div><h2 id="admin-marketing-dialog-title">{editor.ad ? '编辑广告图片' : '新增广告图片'}</h2><p>官网广告位固定使用 4:3 比例，保存后立即启用并同步到首页。</p></div><button type="button" onClick={onClose} aria-label="关闭" disabled={busy}><X size={20} /></button></header>
        <form onSubmit={onSubmit}>
          <div className="admin-marketing-upload wide">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(event) => selectImage(event).catch((failure) => onError(failure.message || '图片读取失败，请重新选择'))} />
            {preview ? <img src={preview} alt="广告图片预览" /> : <span><ImagePlus size={30} /><b>尚未选择宣传图片</b></span>}
            <button className="admin-button admin-button-secondary" type="button" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={16} />{preview ? '更换图片' : '选择图片'}</button>
            <div className="admin-marketing-image-guidance">
              <b>推荐尺寸：1600 × 1200 px</b>
              <span>固定比例 4:3，至少建议 1200 × 900 px；支持 JPG、PNG、WEBP、GIF，单张不超过 5MB。</span>
              {hasDimensions ? <i className={ratioMatches ? 'is-good' : 'is-warning'}>当前图片：{editor.form.imageWidth} × {editor.form.imageHeight} px{ratioMatches ? '，比例合适' : '，展示时会居中裁切为 4:3'}</i> : null}
            </div>
          </div>
          <label className="wide"><span>点击跳转链接（可选）</span><input value={editor.form.linkUrl} onChange={(event) => onChange('linkUrl', event.target.value)} maxLength={2000} placeholder="/app/membership 或 https://example.com/activity" autoFocus disabled={busy} /><small>站内路径请以 / 开头；站外链接仅支持完整 HTTPS 地址。留空时仅展示图片。</small></label>
          {error ? <div className="admin-marketing-dialog-error wide" role="alert"><AlertTriangle size={18} /><span>{error}</span></div> : null}
          <footer className="wide"><button className="admin-button admin-button-secondary" type="button" onClick={onClose} disabled={busy}>取消</button><button className="admin-button admin-button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}{busy ? '正在保存…' : '保存广告'}</button></footer>
        </form>
      </section>
    </div>
  );
}

function DeleteAdDialog({ error, busy, onCancel, onConfirm }) {
  return (
    <div className="admin-marketing-dialog-layer">
      <button className="admin-marketing-dialog-backdrop" type="button" onClick={onCancel} aria-label="取消删除广告" disabled={busy} />
      <section className="admin-marketing-dialog admin-marketing-confirm" role="alertdialog" aria-modal="true" aria-labelledby="admin-marketing-delete-title">
        <span><Trash2 size={24} /></span><h2 id="admin-marketing-delete-title">删除这张广告图片？</h2><p>删除后将立即从官网轮播中移除，且无法恢复。</p>
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

function readImageDimensions(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('图片无法正常显示，请重新选择有效图片'));
    image.src = dataUrl;
  });
}
