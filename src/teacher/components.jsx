import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  CircleHelp,
  Crown,
  FilePlus2,
  Files,
  Gift,
  Home,
  Library,
  Menu,
  Network,
  ScrollText,
  Settings,
  Sparkles,
  UsersRound,
  X,
} from 'lucide-react';
import { Link, navigate } from '../lib/navigation.jsx';
import { useSiteConfig } from '../lib/site-config.jsx';

export function Logo({ compact = false }) {
  const { siteName } = useSiteConfig();
  return (
    <Link to="/" className={`brand ${compact ? 'brand-compact' : ''}`} aria-label={`${siteName}首页`}>
      <span className="brand-mark" aria-hidden="true">
        <BookOpen size={22} strokeWidth={2.2} />
        <i />
      </span>
      {compact ? null : (
        <span className="brand-name">{siteName}</span>
      )}
    </Link>
  );
}

export function Button({ children, variant = 'primary', size = 'md', icon: Icon, className = '', ...props }) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} {...props}>
      {Icon ? <Icon size={size === 'sm' ? 15 : 17} /> : null}
      <span>{children}</span>
    </button>
  );
}

const AccountContext = createContext(null);

export function AccountProvider({ user, children }) {
  return <AccountContext.Provider value={user}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  return useContext(AccountContext);
}

const GENERIC_ACCOUNT_NAMES = new Set(['平台管理员', '管理员']);

export function accountDisplayName(account) {
  const displayName = String(account?.displayName || '').trim();
  const loginAccount = String(account?.account || account?.identifier || '').trim();
  if (displayName && !GENERIC_ACCOUNT_NAMES.has(displayName)) return displayName;
  return loginAccount || '教师用户';
}

const nav = [
  { label: '首页', path: '/app', icon: Home },
  { label: '创建教案', path: '/app/create', icon: FilePlus2 },
  { label: '我的教案', path: '/app/plans', icon: Files },
  { label: '智能组卷', path: '/app/papers', icon: ScrollText },
  { label: '知识图谱', path: '/app/knowledge', icon: Network },
  { label: '教案评审', path: '/app/team', icon: UsersRound },
  { label: '资源库', path: '/app/materials', icon: Library },
  { label: '推广有礼', path: '/app/referrals', icon: Gift, requiresReferral: true },
  { label: '会员中心', path: '/app/membership', icon: Crown },
];

export function TeacherShell({ path, title, subtitle, children, contentClass = '' }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const account = useAccount();
  const { referralProgram } = useSiteConfig();
  const displayName = accountDisplayName(account);
  const subject = account?.subject || '学科待完善';
  const avatarText = displayName.trim().slice(0, 1) || '师';

  useEffect(() => setMobileOpen(false), [path]);

  return (
    <div className="teacher-shell">
      <button className="mobile-menu-btn" onClick={() => setMobileOpen(true)} aria-label="打开菜单" aria-expanded={mobileOpen} aria-controls="teacher-sidebar">
        <Menu size={21} />
      </button>
      {mobileOpen ? <button className="nav-scrim" onClick={() => setMobileOpen(false)} aria-label="关闭菜单" /> : null}
      <aside id="teacher-sidebar" className={`teacher-sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <div className="sidebar-head">
          <Logo />
          <button className="sidebar-close" onClick={() => setMobileOpen(false)} aria-label="关闭菜单">
            <X size={20} />
          </button>
        </div>
        <nav className="sidebar-nav" aria-label="教师端主导航">
          {nav.filter((item) => !item.requiresReferral || referralProgram?.enabled === true).map((item) => {
            const active = item.path === '/app' ? path === item.path : path.startsWith(item.path);
            return (
              <Link key={item.path} to={item.path} className={`sidebar-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}>
                <item.icon size={19} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <Link to="/app/settings" className={`sidebar-link ${path.startsWith('/app/settings') ? 'is-active' : ''}`} aria-current={path.startsWith('/app/settings') ? 'page' : undefined}>
            <Settings size={19} />
            <span>设置</span>
          </Link>
          <button className="user-switcher" onClick={() => navigate('/app/settings')}>
            <span className="avatar avatar-teacher">{avatarText}</span>
            <span className="user-switcher-copy"><b>{displayName}</b><small>{subject}</small></span>
            <ChevronDown size={16} />
          </button>
        </div>
      </aside>
      <main className={`teacher-main ${contentClass}`}>
        <header className="app-topbar">
          <div className="app-heading">
            {title ? <h1>{title}</h1> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <div className="topbar-actions">
            <Link to="/#workflow" className="icon-button" aria-label="查看使用帮助" title="查看使用帮助"><CircleHelp size={19} /></Link>
            <button className="top-user" onClick={() => navigate('/app/settings')}><span className="avatar avatar-teacher">{avatarText}</span><span>{displayName}</span><ChevronDown size={15} /></button>
          </div>
        </header>
        <div className="teacher-content">{children}</div>
      </main>
    </div>
  );
}

export function Status({ children }) {
  const map = { 已完成: 'success', 已到账: 'success', 已退回: 'success', 生成中: 'processing', 草稿: 'muted', 失败: 'danger', 审核中: 'warning' };
  return <span className={`status status-${map[children] || 'muted'}`}>{children}</span>;
}

export function EmptyState({ icon: Icon = Sparkles, title, text, action }) {
  return (
    <div className="empty-state">
      <span className="empty-icon"><Icon size={23} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}{hint ? <small>{hint}</small> : null}</span>
      {children}
    </label>
  );
}

export function Modal({ open, title, description, onClose, children, footer, width = 'md' }) {
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusTimer = window.requestAnimationFrame(() => dialogRef.current?.querySelector(focusableSelector)?.focus());
    const listener = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll(focusableSelector)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.cancelAnimationFrame(focusTimer);
      window.removeEventListener('keydown', listener);
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-layer">
      <div className="modal-backdrop" onMouseDown={onClose} aria-hidden="true" />
      <section ref={dialogRef} className={`modal modal-${width}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <div><h2 id={titleId}>{title}</h2>{description ? <p>{description}</p> : null}</div>
          <button className="icon-button" onClick={onClose} aria-label="关闭"><X size={19} /></button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}

export function Toast({ message, tone = 'success', onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3200);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className={`toast toast-${tone}`} role="status" aria-live="polite">
      <span>{message}</span>
      <button onClick={onClose} aria-label="关闭"><X size={15} /></button>
    </div>
  );
}
