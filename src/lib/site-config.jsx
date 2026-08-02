import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const BOOTSTRAP_SITE_CONFIG = typeof window !== 'undefined' && window.__SITE_CONFIG__
  ? window.__SITE_CONFIG__
  : {};

export const DEFAULT_SITE_CONFIG = Object.freeze({
  supportEmail: '',
  registrationOpen: true,
  registrationVerificationRequired: true,
  privacyPolicy: null,
  ...BOOTSTRAP_SITE_CONFIG,
  siteName: String(BOOTSTRAP_SITE_CONFIG.siteName || ''),
});

const SiteConfigContext = createContext({
  ...DEFAULT_SITE_CONFIG,
  status: 'loading',
  refreshSiteConfig: async () => DEFAULT_SITE_CONFIG,
  applySiteConfig: () => {},
});

const BROADCAST_KEY = 'teacher-helper:site-config-updated';

export function SiteConfigProvider({ children, surface = 'teacher' }) {
  const [config, setConfig] = useState(DEFAULT_SITE_CONFIG);
  const [status, setStatus] = useState('loading');

  const applySiteConfig = useCallback((value, { broadcast = true } = {}) => {
    if (!value || typeof value !== 'object') return;
    setConfig((current) => ({ ...current, ...value }));
    setStatus('ready');
    if (!broadcast) return;
    const detail = { ...value, changedAt: new Date().toISOString() };
    window.dispatchEvent(new CustomEvent('teacher-helper:site-config', { detail }));
    try { localStorage.setItem(BROADCAST_KEY, JSON.stringify(detail)); } catch {}
  }, []);

  const refreshSiteConfig = useCallback(async () => {
    const response = await api.getSiteConfig();
    const value = response.data || {};
    applySiteConfig(value, { broadcast: false });
    return value;
  }, [applySiteConfig]);

  useEffect(() => {
    let active = true;
    api.getSiteConfig().then((response) => {
      if (!active) return;
      applySiteConfig(response.data || {}, { broadcast: false });
    }).catch(() => {
      if (active) setStatus('error');
    });
    return () => { active = false; };
  }, [applySiteConfig]);

  useEffect(() => {
    const handleCustom = (event) => applySiteConfig(event.detail || {}, { broadcast: false });
    const handleStorage = (event) => {
      if (event.key !== BROADCAST_KEY || !event.newValue) return;
      try { applySiteConfig(JSON.parse(event.newValue), { broadcast: false }); } catch {}
    };
    window.addEventListener('teacher-helper:site-config', handleCustom);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('teacher-helper:site-config', handleCustom);
      window.removeEventListener('storage', handleStorage);
    };
  }, [applySiteConfig]);

  useEffect(() => {
    const siteName = config.siteName || DEFAULT_SITE_CONFIG.siteName;
    document.title = surface === 'admin' ? `${siteName} · 管理后台` : `${siteName} · 让每一堂课都有准备`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.setAttribute('content', `${siteName}——上传教材章节，生成可执行、可修改、可导出的详细教案。`);
  }, [config.siteName, surface]);

  const value = useMemo(() => ({
    ...config,
    status,
    refreshSiteConfig,
    applySiteConfig,
  }), [config, status, refreshSiteConfig, applySiteConfig]);

  return <SiteConfigContext.Provider value={value}>{children}</SiteConfigContext.Provider>;
}

export function useSiteConfig() {
  return useContext(SiteConfigContext);
}
