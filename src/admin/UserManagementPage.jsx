import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  BookOpenCheck,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  Users,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import './admin-user-management.css';

const PAGE_SIZE = 20;
const NUMBER_FORMATTER = new Intl.NumberFormat('zh-CN');
const DATE_FORMATTER = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const EMPTY_SUMMARY = {
  total: 0,
  verified: 0,
  activeMembers: 0,
  creditsRemaining: 0,
  generations: 0,
};

const VERIFY_CHANNEL_LABELS = {
  email: '邮箱',
  sms: '手机',
  admin_credentials: '管理员凭据',
};

const TIER_LABELS = {
  pro: '专业版',
  research: '教研版',
};

export function UserManagementPage({ query: controlledQuery, onQueryChange, onNotice = () => {} }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [pagination, setPagination] = useState({ offset: 0, limit: PAGE_SIZE, total: 0 });
  const [searchDraft, setSearchDraft] = useState('');
  const [localQuery, setLocalQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const selectAllRef = useRef(null);
  const isQueryControlled = typeof controlledQuery === 'string' && typeof onQueryChange === 'function';
  const query = isQueryControlled ? controlledQuery.trim() : localQuery;

  useEffect(() => {
    if (!isQueryControlled) return;
    setSearchDraft(controlledQuery);
    setOffset(0);
  }, [controlledQuery, isQueryControlled]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setSelectedIds(new Set());
    api.getAdminUsers({ query, offset, limit: PAGE_SIZE })
      .then((response) => {
        if (!active) return;
        const data = response.data || {};
        setItems(Array.isArray(data.items) ? data.items : []);
        setSummary({ ...EMPTY_SUMMARY, ...(data.summary || {}) });
        setPagination({ offset, limit: PAGE_SIZE, total: 0, ...(data.pagination || {}) });
      })
      .catch((requestError) => {
        if (!active) return;
        setItems([]);
        setError(requestError.message || '用户数据读取失败');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [offset, query, reloadKey]);

  function submitSearch(event) {
    event.preventDefault();
    const nextQuery = searchDraft.trim();
    setOffset(0);
    if (isQueryControlled) onQueryChange(nextQuery);
    else setLocalQuery(nextQuery);
    if (nextQuery === query && offset === 0) setReloadKey((value) => value + 1);
  }

  function clearSearch() {
    setSearchDraft('');
    setOffset(0);
    if (isQueryControlled) onQueryChange('');
    else setLocalQuery('');
  }

  const selectableItems = items.filter((user) => user.deletable !== false);
  const allVisibleSelected = selectableItems.length > 0 && selectableItems.every((user) => selectedIds.has(user.id));
  const someVisibleSelected = selectableItems.some((user) => selectedIds.has(user.id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
  }, [allVisibleSelected, someVisibleSelected]);

  function toggleUser(userId, checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }

  function toggleAllVisible(checked) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const user of selectableItems) {
        if (checked) next.add(user.id);
        else next.delete(user.id);
      }
      return next;
    });
  }

  function openDeleteDialog(target) {
    setError('');
    setDeleteError('');
    setDeleteTarget(target);
  }

  function closeDeleteDialog() {
    setDeleteError('');
    setDeleteTarget(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || deleting) return;
    const ids = deleteTarget.mode === 'bulk' ? deleteTarget.userIds : [deleteTarget.user.id];
    setDeleting(true);
    setDeleteError('');
    try {
      if (deleteTarget.mode === 'bulk') await api.bulkDeleteAdminUsers(ids);
      else await api.deleteAdminUser(ids[0]);
      setSelectedIds(new Set());
      closeDeleteDialog();
      onNotice(ids.length > 1 ? `已删除 ${ids.length} 个用户` : '用户已删除');
      if (items.length <= ids.length && offset > 0) setOffset((value) => Math.max(0, value - PAGE_SIZE));
      else setReloadKey((value) => value + 1);
    } catch (requestError) {
      setDeleteError(requestError.message || '用户删除失败');
    } finally {
      setDeleting(false);
    }
  }

  const firstVisible = pagination.total ? pagination.offset + 1 : 0;
  const lastVisible = Math.min(pagination.offset + items.length, pagination.total);
  const currentPage = Math.floor(pagination.offset / pagination.limit) + 1;
  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.limit));

  return (
    <div className="admin-users-page" aria-busy={loading}>
      <div className="admin-page-heading admin-users-heading">
        <div><h1>用户管理</h1><p>查看已在平台完成注册的真实用户、验证状态、会员状态与使用概况</p></div>
        <button className="admin-button admin-button-secondary" type="button" onClick={() => setReloadKey((value) => value + 1)} disabled={loading}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />刷新数据
        </button>
      </div>

      {error ? <div className="admin-users-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={16} /></button></div> : null}

      <section className="admin-users-summary" aria-label="用户数据汇总">
        <SummaryCard icon={Users} label="注册用户" value={summary.total} note="当前全部账号" />
        <SummaryCard icon={UserRoundCheck} label="已验证" value={summary.verified} note={summary.total ? `${Math.round((summary.verified / summary.total) * 100)}% 验证率` : '暂无用户'} />
        <SummaryCard icon={BadgeCheck} label="有效会员" value={summary.activeMembers} note="当前权益未到期" />
        <SummaryCard icon={BookOpenCheck} label="累计生成" value={summary.generations} note={`剩余 ${formatNumber(summary.creditsRemaining)} 点额度`} />
      </section>

      <section className="admin-panel admin-users-table-panel">
        <header className="admin-users-table-header">
          <div><h2>用户列表</h2><p>{query ? `正在筛选“${query}”` : '按注册时间从新到旧排列'}</p></div>
          <form className="admin-users-search" onSubmit={submitSearch} role="search">
            <Search size={17} aria-hidden="true" />
            <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} maxLength={100} placeholder="搜索账号、姓名或任教学科" aria-label="搜索用户" />
            {searchDraft ? <button className="admin-users-clear" type="button" onClick={clearSearch} aria-label="清空搜索"><X size={15} /></button> : null}
            <button className="admin-button admin-button-primary" type="submit" disabled={loading}>搜索</button>
          </form>
        </header>

        <div className={`admin-users-bulkbar ${selectedIds.size ? 'has-selection' : ''}`}>
          <span>{selectedIds.size ? `已选择 ${selectedIds.size} 个用户` : '可勾选当前页的普通用户进行批量删除'}</span>
          <button className="admin-button admin-users-delete-button" type="button" disabled={!selectedIds.size || loading || deleting} onClick={() => openDeleteDialog({ mode: 'bulk', userIds: [...selectedIds] })}><Trash2 size={16} />批量删除</button>
        </div>

        <div className="admin-table-wrap admin-users-table-wrap">
          <table className="admin-table admin-users-table">
            <caption className="admin-sr-only">平台注册用户列表</caption>
            <thead><tr><th className="admin-users-select-cell"><input ref={selectAllRef} type="checkbox" aria-label="选择当前页全部可删除用户" checked={allVisibleSelected} disabled={!selectableItems.length || loading || deleting} onChange={(event) => toggleAllVisible(event.target.checked)} /></th><th>用户</th><th>任教学科</th><th>账号验证</th><th>会员套餐</th><th>剩余额度</th><th>累计生成</th><th>最后登录</th><th>累计在线</th><th>注册时间</th><th>操作</th></tr></thead>
            <tbody>
              {!loading ? items.map((user) => <UserRow key={user.id} user={user} selected={selectedIds.has(user.id)} deleting={deleting} onSelect={(checked) => toggleUser(user.id, checked)} onDelete={() => openDeleteDialog({ mode: 'single', user })} />) : null}
              {loading ? <tr><td className="admin-users-state" colSpan="11"><LoaderCircle className="spin" size={20} />正在读取用户数据…</td></tr> : null}
              {!loading && !error && items.length === 0 ? <tr><td className="admin-users-empty" colSpan="11"><Users size={25} /><b>{query ? '没有匹配的用户' : '尚无注册用户'}</b><span>{query ? '请更换账号、姓名或学科关键词后再搜索。' : '用户完成注册后会自动显示在这里。'}</span></td></tr> : null}
            </tbody>
          </table>
        </div>

        <footer className="admin-table-footer admin-users-footer">
          <span>{pagination.total ? `显示第 ${firstVisible}–${lastVisible} 条，共 ${pagination.total} 条` : '共 0 条'}</span>
          <div className="admin-users-pages" aria-label="用户列表分页">
            <button type="button" onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))} disabled={loading || offset === 0} aria-label="上一页"><ChevronLeft size={16} /></button>
            <span>第 {currentPage} / {pageCount} 页</span>
            <button type="button" onClick={() => setOffset((value) => value + PAGE_SIZE)} disabled={loading || offset + pagination.limit >= pagination.total} aria-label="下一页"><ChevronRight size={16} /></button>
          </div>
        </footer>
      </section>

      <p className="admin-users-security-note"><ShieldCheck size={16} />本页面只读取业务管理所需字段，不返回密码、内部权限标记或模型改进相关记录。</p>
      {deleteTarget ? <UserDeleteDialog target={deleteTarget} error={deleteError} busy={deleting} onCancel={closeDeleteDialog} onConfirm={confirmDelete} /> : null}
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, note }) {
  return <article className="admin-panel admin-users-summary-card"><span><Icon size={20} /></span><div><small>{label}</small><strong>{formatNumber(value)}</strong><p>{note}</p></div></article>;
}

function UserRow({ user, selected, deleting, onSelect, onDelete }) {
  const displayName = user.displayName || '未设置姓名';
  const verifyChannel = VERIFY_CHANNEL_LABELS[user.verifiedChannel] || '已验证';
  const membershipLabel = user.membership ? (user.membership.planName || TIER_LABELS[user.membership.tier] || user.membership.tier || '有效会员') : '免费版';
  const deletable = user.deletable !== false;
  return (
    <tr className={selected ? 'admin-users-row-selected' : ''}>
      <td className="admin-users-select-cell"><input type="checkbox" aria-label={`选择用户 ${user.account}`} checked={selected} disabled={!deletable || deleting} title={deletable ? '选择用户' : '管理员前台账号受保护，不可删除'} onChange={(event) => onSelect(event.target.checked)} /></td>
      <td><div className="admin-users-identity"><span>{displayName.slice(0, 1).toUpperCase()}</span><div><b>{displayName}</b><small>{user.account}</small></div></div></td>
      <td>{user.subject || '未设置'}</td>
      <td>{user.verified ? <span className="admin-users-verified"><BadgeCheck size={14} />{verifyChannel}</span> : <span className="admin-users-unverified">未验证</span>}</td>
      <td>{user.membership ? <div className="admin-users-membership"><b>{membershipLabel}</b><small>至 {formatDate(user.membership.expiresAt, true)}</small></div> : <span className="admin-users-ordinary">{membershipLabel}</span>}</td>
      <td><span className="admin-users-number"><CircleDollarSign size={14} />{formatNumber(user.credits)}</span></td>
      <td>{formatNumber(user.generationCount)}</td>
      <td><div className="admin-users-membership"><b>{user.lastLoginAt ? formatDate(user.lastLoginAt) : '尚未登录'}</b><small>{user.loginCount ? `累计登录 ${formatNumber(user.loginCount)} 次` : '暂无登录记录'}</small></div></td>
      <td>{formatDuration(user.onlineSeconds)}</td>
      <td>{formatDate(user.createdAt)}</td>
      <td className="admin-users-action-cell">{deletable ? <button type="button" aria-label={`删除用户 ${user.account}`} title="删除用户" disabled={deleting} onClick={onDelete}><Trash2 size={15} /></button> : <span title="管理员前台账号受保护，不可删除"><ShieldCheck size={15} />受保护</span>}</td>
    </tr>
  );
}

function UserDeleteDialog({ target, error, busy, onCancel, onConfirm }) {
  const count = target.mode === 'bulk' ? target.userIds.length : 1;
  const account = target.mode === 'single' ? target.user.account : '';
  return (
    <div className="admin-users-dialog-layer">
      <button className="admin-users-dialog-backdrop" type="button" onClick={onCancel} aria-label="取消删除用户" disabled={busy} />
      <section className="admin-users-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-users-delete-title">
        <span><Trash2 size={24} /></span>
        <h2 id="admin-users-delete-title">{count > 1 ? `删除选中的 ${count} 个用户？` : '删除这个用户？'}</h2>
        <p>{count > 1 ? '这些账号将无法继续登录，相关个人资料会按服务端删除规则处理。' : `账号“${account}”将无法继续登录，相关个人资料会按服务端删除规则处理。`} 此操作不可撤销。</p>
        {error ? <div className="admin-users-dialog-error" role="alert"><AlertTriangle size={18} /><span>{error}</span></div> : null}
        <footer><button className="admin-button admin-button-secondary" type="button" onClick={onCancel} disabled={busy}>取消</button><button className="admin-button admin-users-delete-button" type="button" onClick={onConfirm} disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{busy ? '正在删除…' : '确认删除'}</button></footer>
      </section>
    </div>
  );
}

function formatNumber(value) {
  return NUMBER_FORMATTER.format(Number.isFinite(Number(value)) ? Number(value) : 0);
}

function formatDate(value, dateOnly = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '—';
  return (dateOnly ? DATE_FORMATTER : DATE_TIME_FORMATTER).format(date);
}

function formatDuration(value) {
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 60) return `${Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} 小时 ${remainder} 分钟` : `${hours} 小时`;
}
