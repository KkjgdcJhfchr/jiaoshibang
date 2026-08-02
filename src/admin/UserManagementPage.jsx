import { useEffect, useState } from 'react';
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

export function UserManagementPage({ query: controlledQuery, onQueryChange }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [pagination, setPagination] = useState({ offset: 0, limit: PAGE_SIZE, total: 0 });
  const [searchDraft, setSearchDraft] = useState('');
  const [localQuery, setLocalQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

        <div className="admin-table-wrap admin-users-table-wrap">
          <table className="admin-table admin-users-table">
            <caption className="admin-sr-only">平台注册用户列表</caption>
            <thead><tr><th>用户</th><th>任教学科</th><th>账号验证</th><th>会员</th><th>剩余额度</th><th>累计生成</th><th>注册时间</th></tr></thead>
            <tbody>
              {!loading ? items.map((user) => <UserRow key={user.id} user={user} />) : null}
              {loading ? <tr><td className="admin-users-state" colSpan="7"><LoaderCircle className="spin" size={20} />正在读取用户数据…</td></tr> : null}
              {!loading && !error && items.length === 0 ? <tr><td className="admin-users-empty" colSpan="7"><Users size={25} /><b>{query ? '没有匹配的用户' : '尚无注册用户'}</b><span>{query ? '请更换账号、姓名或学科关键词后再搜索。' : '用户完成注册后会自动显示在这里。'}</span></td></tr> : null}
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
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, note }) {
  return <article className="admin-panel admin-users-summary-card"><span><Icon size={20} /></span><div><small>{label}</small><strong>{formatNumber(value)}</strong><p>{note}</p></div></article>;
}

function UserRow({ user }) {
  const displayName = user.displayName || '未设置姓名';
  const verifyChannel = VERIFY_CHANNEL_LABELS[user.verifiedChannel] || '已验证';
  const membershipLabel = user.membership ? (TIER_LABELS[user.membership.tier] || user.membership.tier || '有效会员') : '普通用户';
  return (
    <tr>
      <td><div className="admin-users-identity"><span>{displayName.slice(0, 1).toUpperCase()}</span><div><b>{displayName}</b><small>{user.account}</small></div></div></td>
      <td>{user.subject || '未设置'}</td>
      <td>{user.verified ? <span className="admin-users-verified"><BadgeCheck size={14} />{verifyChannel}</span> : <span className="admin-users-unverified">未验证</span>}</td>
      <td>{user.membership ? <div className="admin-users-membership"><b>{membershipLabel}</b><small>至 {formatDate(user.membership.expiresAt, true)}</small></div> : <span className="admin-users-ordinary">{membershipLabel}</span>}</td>
      <td><span className="admin-users-number"><CircleDollarSign size={14} />{formatNumber(user.credits)}</span></td>
      <td>{formatNumber(user.generationCount)}</td>
      <td>{formatDate(user.createdAt)}</td>
    </tr>
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
