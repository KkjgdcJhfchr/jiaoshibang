import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowRight,
  ArrowLeft,
  BookMarked,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileCheck2,
  Gift,
  ImageUp,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Network,
  ScrollText,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Link, navigate } from '../lib/navigation.jsx';
import { useSiteConfig } from '../lib/site-config.jsx';
import { Button, Field, Logo } from './components.jsx';

const VERIFICATION_AUTH_AVAILABLE = import.meta.env.VITE_VERIFICATION_CODE_ENABLED !== 'false';
const PASSWORD_RECOVERY_AVAILABLE = import.meta.env.VITE_PASSWORD_RECOVERY_ENABLED !== 'false';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^1[3-9]\d{9}$/;

function accountError(identifier, { allowUsername = false } = {}) {
  const value = identifier.trim();
  if (!value) return '请输入手机号或邮箱。';
  if (allowUsername && /^\S{3,100}$/u.test(value)) return '';
  if (!EMAIL_PATTERN.test(value) && !MOBILE_PATTERN.test(value)) return '请输入有效的中国大陆手机号或邮箱地址。';
  return '';
}

const FALLBACK_PRIVACY_POLICY = {
  title: '数据与隐私说明',
  content: '本平台仅为账号、安全验证、教案生成、导出和订单处理使用你主动提交的信息。平台会采用访问控制、传输加密和敏感配置加密存储等措施。关于教材、教案与服务改进的具体处理范围，请以当前公布的完整说明为准。',
  updatedAt: '',
};

export function PrivacyPolicyLink({ children = '数据与隐私说明', className = '', policy: suppliedPolicy = null }) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState(FALLBACK_PRIVACY_POLICY);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const appRoot = document.getElementById('root');
    const rootWasInert = appRoot?.hasAttribute('inert') || false;
    const previousAriaHidden = appRoot?.getAttribute('aria-hidden');
    const previousOverflow = document.body.style.overflow;
    if (appRoot) {
      appRoot.setAttribute('inert', '');
      appRoot.setAttribute('aria-hidden', 'true');
    }
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => !element.disabled && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    window.requestAnimationFrame(() => dialogRef.current?.focus());
    if (suppliedPolicy?.content) {
      setPolicy({ ...FALLBACK_PRIVACY_POLICY, ...suppliedPolicy });
      setLoading(false);
    } else {
      setLoading(true);
      api.getSiteConfig().then((response) => {
        const value = response.data?.privacyPolicy;
        if (value?.content) setPolicy({ ...FALLBACK_PRIVACY_POLICY, ...value });
      }).catch(() => {}).finally(() => setLoading(false));
    }
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (appRoot) {
        if (!rootWasInert) appRoot.removeAttribute('inert');
        if (previousAriaHidden === null) appRoot.removeAttribute('aria-hidden');
        else appRoot.setAttribute('aria-hidden', previousAriaHidden);
      }
      triggerRef.current?.focus();
    };
  }, [open, suppliedPolicy]);

  const dialog = open ? createPortal(<div className="privacy-modal-layer"><button className="privacy-modal-backdrop" tabIndex={-1} type="button" onClick={() => setOpen(false)} aria-label="关闭数据与隐私说明" /><section ref={dialogRef} tabIndex={-1} className="privacy-modal" role="dialog" aria-modal="true" aria-labelledby="privacy-modal-title"><header><div><h2 id="privacy-modal-title">{policy.title}</h2><p>{policy.updatedAt ? `更新于 ${new Date(policy.updatedAt).toLocaleDateString('zh-CN')}` : '请在创建账号前完整阅读'}</p></div><button type="button" onClick={() => setOpen(false)} aria-label="关闭"><X size={20} /></button></header><div className="privacy-modal-content">{loading ? <p>正在读取最新说明…</p> : policy.content.split(/\n{2,}/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div><footer><Button type="button" onClick={() => setOpen(false)}>我已阅读</Button></footer></section></div>, document.body) : null;
  return <><button ref={triggerRef} className={`privacy-policy-link ${className}`.trim()} type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setOpen(true); }}>{children}</button>{dialog}</>;
}

function consumeAuthReturnTarget() {
  const target = sessionStorage.getItem('auth-return-to') || '/app';
  sessionStorage.removeItem('auth-return-to');
  return /^\/app(?:\/|$)/.test(target) ? target : '/app';
}

function currentReferralCode() {
  const value = new URLSearchParams(window.location.search).get('ref')?.trim() || '';
  return /^[A-Za-z0-9_-]{2,64}$/.test(value) ? value : '';
}

function PublicHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <Logo />
      <nav className={`public-nav ${open ? 'is-open' : ''}`}>
        <Link to="/#features">功能</Link>
        <Link to="/#workflow">使用方式</Link>
        <Link to="/pricing">会员方案</Link>
      </nav>
      <div className="public-actions">
        <Link to="/login" className="text-link">登录</Link>
        <Button onClick={() => navigate('/register')}>免费开始</Button>
      </div>
      <button className="public-menu" onClick={() => setOpen((value) => !value)} aria-label={open ? '关闭导航' : '打开导航'} aria-expanded={open}>
        {open ? <X size={20} /> : <Menu size={20} />}
      </button>
    </header>
  );
}

function normalizedAds(value) {
  const now = Date.now();
  return (Array.isArray(value) ? value : [])
    .map((ad, index) => ({
      id: String(ad?.id || ad?.adId || `ad-${index}`),
      imageUrl: String(ad?.imageUrl || ad?.image || ad?.src || '').trim(),
      linkUrl: String(ad?.linkUrl || ad?.link || ad?.targetUrl || '').trim(),
      altText: String(ad?.altText || '').trim(),
      order: Number(ad?.order ?? ad?.sortOrder ?? index),
      enabled: ad?.enabled !== false,
      startsAt: ad?.startsAt || ad?.startAt || '',
      endsAt: ad?.endsAt || ad?.endAt || '',
    }))
    .filter((ad) => {
      if (!ad.enabled || !ad.imageUrl) return false;
      const startsAt = ad.startsAt ? new Date(ad.startsAt).getTime() : 0;
      const endsAt = ad.endsAt ? new Date(ad.endsAt).getTime() : 0;
      return (!Number.isFinite(startsAt) || startsAt <= now) && (!Number.isFinite(endsAt) || endsAt >= now);
    })
    .sort((a, b) => a.order - b.order);
}

function safeAdTarget(value) {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return {
      href: value.startsWith('/') && !value.startsWith('//') ? `${url.pathname}${url.search}${url.hash}` : url.href,
      external: url.origin !== window.location.origin,
    };
  } catch {
    return null;
  }
}

function HeroAdvertisingCarousel({ ads, siteName }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [pageHidden, setPageHidden] = useState(() => document.hidden);
  const [reduceMotion, setReduceMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, ads.length - 1)));
  }, [ads.length]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onVisibilityChange = () => setPageHidden(document.hidden);
    const onMotionChange = (event) => setReduceMotion(event.matches);
    document.addEventListener('visibilitychange', onVisibilityChange);
    media?.addEventListener?.('change', onMotionChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      media?.removeEventListener?.('change', onMotionChange);
    };
  }, []);

  const paused = hovered || focusWithin || pageHidden || reduceMotion;
  useEffect(() => {
    if (ads.length <= 1 || paused) return undefined;
    const timer = window.setInterval(() => setActiveIndex((current) => (current + 1) % ads.length), 5_000);
    return () => window.clearInterval(timer);
  }, [ads.length, paused]);

  function move(direction) {
    setActiveIndex((current) => (current + direction + ads.length) % ads.length);
  }

  if (!ads.length) {
    return (
      <div className="hero-marketing hero-marketing-placeholder" aria-label={`${siteName}宣传展示区`}>
        <span><BookMarked size={34} /></span>
        <p>{siteName}</p>
        <h2>让每一堂课，都从充分准备开始</h2>
        <small>平台活动与教学资源将在这里发布</small>
      </div>
    );
  }

  return (
    <section
      className="hero-marketing"
      role="region"
      aria-roledescription="轮播图"
      aria-label="平台宣传活动"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocusWithin(false);
      }}
    >
      <div className="hero-ad-slides">
        {ads.map((ad, index) => {
          const target = safeAdTarget(ad.linkUrl);
          const imageAlt = ad.altText || `${siteName}宣传图片 ${index + 1}`;
          const image = <img src={ad.imageUrl} alt={imageAlt} loading={index === 0 ? 'eager' : 'lazy'} />;
          return (
            <article className={`hero-ad-slide ${index === activeIndex ? 'is-active' : ''}`} aria-hidden={index !== activeIndex} key={ad.id}>
              {target ? <a href={target.href} target={target.external ? '_blank' : undefined} rel={target.external ? 'noopener noreferrer sponsored' : undefined} tabIndex={index === activeIndex ? 0 : -1} aria-label={`${imageAlt}${target.external ? '（在新窗口打开）' : ''}`}>{image}</a> : <div>{image}</div>}
            </article>
          );
        })}
      </div>
      {ads.length > 1 ? <>
        <button type="button" className="hero-ad-arrow previous" onClick={() => move(-1)} aria-label="上一张宣传图"><ArrowLeft size={19} /></button>
        <button type="button" className="hero-ad-arrow next" onClick={() => move(1)} aria-label="下一张宣传图"><ArrowRight size={19} /></button>
        <div className="hero-ad-dots" aria-label={`第 ${activeIndex + 1} 张，共 ${ads.length} 张`}>
          {ads.map((ad, index) => <button type="button" key={ad.id} className={index === activeIndex ? 'is-active' : ''} aria-label={`查看第 ${index + 1} 张宣传图`} aria-current={index === activeIndex ? 'true' : undefined} onClick={() => setActiveIndex(index)} />)}
        </div>
      </> : null}
    </section>
  );
}

export function LandingPage() {
  const { siteName, ads: configuredAds, refreshSiteConfig } = useSiteConfig();
  const [latestAds, setLatestAds] = useState(configuredAds);
  const ads = useMemo(() => normalizedAds(latestAds), [latestAds]);

  useEffect(() => {
    setLatestAds(configuredAds);
  }, [configuredAds]);

  useEffect(() => {
    const refresh = () => {
      refreshSiteConfig()
        .then((config) => setLatestAds(config?.ads))
        .catch(() => {});
    };
    const refreshWhenVisible = () => { if (!document.hidden) refresh(); };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshSiteConfig]);

  return (
    <div className="public-page">
      <PublicHeader />
      <main>
        <section className="landing-hero">
          <div className="hero-copy">
            <h1>把教材交给 AI，<br />把课堂留给热爱</h1>
            <p>上传本章节的课本图片，生成真正能拿去上课的详细教案；再把教学意图沉淀为知识点，一键完成同步组卷与备课组评审。</p>
            <div className="hero-actions">
              <Button size="lg" icon={Sparkles} onClick={() => navigate('/register')}>免费生成教案</Button>
              <button className="demo-link" onClick={() => navigate('/app/lesson/lesson-spring-001')}>查看完整教案示例 <ArrowRight size={17} /></button>
            </div>
            <div className="hero-assurances">
              <span><Check size={15} /> 首次注册送 3 次</span>
              <span><Check size={15} /> 不满意可继续修改</span>
              <span><Check size={15} /> 支持 DOC / 打印 PDF</span>
            </div>
          </div>
          <HeroAdvertisingCarousel ads={ads} siteName={siteName} />
        </section>

        <section className="proof-strip">
          <p>从一张教材图片，到“教案—知识点—组卷”完整闭环</p>
          <div><span>教材视觉理解</span><i /><span>分钟级课堂流程</span><i /><span>教学认知图谱</span><i /><span>智能组卷与评审</span></div>
        </section>

        <section className="landing-section features-section" id="features">
          <div className="section-heading">
            <h2>不是一篇“教案作文”，<br />而是一份课堂行动指南</h2>
            <p>每一个模块都围绕“这堂课到底怎么上”展开，教师可以直接使用，也可以随时改成自己的风格。</p>
          </div>
          <div className="feature-editorial-list">
            <article><span>01</span><div><WandSparkles /><h3>完整理解教材</h3><p>识别章节文字、例题、插图和知识结构，低置信内容先由教师确认，不让识别错误一路传递。</p></div></article>
            <article><span>02</span><div><Clock3 /><h3>把课堂拆到分钟</h3><p>每个环节都有时间、教师话术、学生活动、预期回答、常见误区和冷场时的备选方案。</p></div></article>
            <article><span>03</span><div><MessageSquareText /><h3>像和教研员对话一样修改</h3><p>“导入更有感染力”“再加一个小组活动”“习题提高难度”，每次修改形成新版本，可随时恢复。</p></div></article>
            <article><span>04</span><div><FileCheck2 /><h3>最少 10 道可用习题</h3><p>覆盖核心知识点与难度梯度，每题包含答案、解析、常见错误和课堂/课后使用建议。</p></div></article>
            <article><span>05</span><div><Network /><h3>教案自动沉淀知识点</h3><p>把教学目标、重难点和习题连接成认知图谱，标注认知层级、教学环节与关系置信度。</p></div></article>
            <article><span>06</span><div><ScrollText /><h3>从教学意图直接组卷</h3><p>按知识点、难度和题型选题，自动排序与检查重复，分别导出学生卷和答案版。</p></div></article>
          </div>
        </section>

        <section className="landing-section workflow-section" id="workflow">
          <div className="workflow-media" role="img" aria-label="桌面上的教材、茶杯与笔" />
          <div className="workflow-copy">
            <h2>四步，准备好下一堂课</h2>
            <ol>
              <li><span>1</span><div><h3>上传教材章节</h3><p>手机拍照或 PDF 均可，请确保图片清晰、端正、无反光并按页码上传。</p></div></li>
              <li><span>2</span><div><h3>确认学情和课堂偏好</h3><p>选择年级、课时与教学风格，也可以补充班级特点。</p></div></li>
              <li><span>3</span><div><h3>生成、修改、定稿</h3><p>生成完成后可继续对话修改课堂流程、提问和习题，满意再定稿。</p></div></li>
              <li><span>4</span><div><h3>沉淀知识点并智能组卷</h3><p>校验知识点关系，完成选题、排序、双版本导出或提交备课组评审。</p></div></li>
            </ol>
            <Button icon={ImageUp} onClick={() => navigate('/register')}>上传一章试试看</Button>
          </div>
        </section>

        <section className="landing-section lesson-anatomy">
          <div className="section-heading centered"><h2>一份教案，覆盖整堂课的关键时刻</h2><p>从目标到练习，从课堂氛围到突发状况，都有清晰、具体、可执行的安排。</p></div>
          <div className="anatomy-canvas">
            <aside>{['教学目标', '教材分析', '学情分析', '重点难点', '教学过程', '课堂互动', '板书设计', '习题与答案'].map((item, i) => <span className={i === 4 ? 'active' : ''} key={item}>{String(i + 1).padStart(2, '0')} {item}</span>)}</aside>
            <article>
              <p className="document-overline">教学过程</p>
              <h3>合作品读：把春天读出画面</h3>
              <div className="anatomy-row"><b>教师话术</b><p>四人小组选择最喜欢的一幅“春景图”，用“感官—特点—情感”完成汇报。</p></div>
              <div className="anatomy-row"><b>参与目标</b><p>让每位学生都能贡献一个关键词，在合作中获得表达的安全感。</p></div>
              <div className="anatomy-row"><b>应急方案</b><p>如果学生只报修辞名称，使用“原句—改句”对照卡，从差异进入表达效果。</p></div>
            </article>
            <div className="anatomy-aside"><Sparkles size={18} /><b>AI 修改建议</b><p>这个环节可以增加一条面向基础薄弱学生的句式支架。</p><span className="suggestion-preview">编辑器内可应用</span></div>
          </div>
        </section>

        <section className="landing-cta">
          <div><h2>下一堂课，从更从容的准备开始</h2><p>注册送 3 次完整生成额度，不需要绑定支付方式。</p></div>
          <Button size="lg" icon={Sparkles} onClick={() => navigate('/register')}>免费生成第一份教案</Button>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

function PublicFooter() {
  const { siteName, supportEmail } = useSiteConfig();
  return (
    <footer className="public-footer">
      <div><Logo /><p>让每一位教师，都有一位懂课堂的备课伙伴。</p></div>
      <div><b>产品</b><Link to="/#features">功能介绍</Link><Link to="/pricing">会员方案</Link><Link to="/app/lesson/lesson-spring-001">教案示例</Link></div>
      <div><b>支持</b><Link to="/#workflow">使用帮助</Link>{supportEmail ? <a href={`mailto:${supportEmail}`}>联系我们</a> : null}</div>
      <div><b>规则</b><PrivacyPolicyLink>用户协议与隐私规则</PrivacyPolicyLink></div>
      <p className="footer-record">© 2026 {siteName}</p>
    </footer>
  );
}

function AuthBrandPanel() {
  const { siteName } = useSiteConfig();
  return (
    <div className="auth-brand-panel">
      <Logo />
      <div className="auth-brand-copy"><h1>少一点重复备课，<br />多一点真实互动</h1><p>从教材到完整课堂设计，{siteName}与你一起把每一个教学环节想清楚。</p></div>
      <div className="auth-quote"><p>“导入、提问链和学生可能的回答都写得很具体，我只需要再加上自己的课堂语言。”</p><span>七年级语文教师 · 体验反馈</span></div>
    </div>
  );
}

export function AuthPage({ mode = 'login' }) {
  const register = mode === 'register';
  const [referralCode] = useState(() => register ? currentReferralCode() : '');
  const [method, setMethod] = useState(register ? 'code' : 'password');
  const [accepted, setAccepted] = useState(false);
  const [siteConfig, setSiteConfig] = useState({ registrationOpen: true, registrationVerificationRequired: true, privacyPolicy: FALLBACK_PRIVACY_POLICY });
  const [siteConfigReady, setSiteConfigReady] = useState(!register);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verificationId, setVerificationId] = useState('');
  const [form, setForm] = useState({ identifier: '', verificationCode: '', password: '', subject: '语文' });
  const codeMode = register ? siteConfig.registrationVerificationRequired !== false : method === 'code';

  useEffect(() => {
    if (!register) return;
    let active = true;
    api.getSiteConfig().then((response) => {
      if (!active) return;
      setSiteConfig((current) => ({ ...current, ...(response.data || {}) }));
      setSiteConfigReady(true);
    }).catch(() => {
      if (active) setError('注册规则暂时无法读取，请刷新页面后重试。');
    });
    return () => { active = false; };
  }, [register]);

  function update(field) {
    return (event) => {
      const value = event.target.value;
      setForm((current) => field === 'identifier'
        ? { ...current, identifier: value, verificationCode: '' }
        : { ...current, [field]: value });
      if (field === 'identifier') {
        setVerificationId('');
        setStatus('');
      }
    };
  }

  async function sendCode() {
    if (!VERIFICATION_AUTH_AVAILABLE || sendingCode || (register && !siteConfigReady)) return;
    const validationError = accountError(form.identifier);
    if (validationError) { setError(validationError); return; }
    setError(''); setStatus(''); setSendingCode(true);
    try {
      const response = await api.sendVerificationCode({
        identifier: form.identifier.trim(),
        purpose: register ? 'register' : 'login',
      });
      setVerificationId(response.data?.verificationId || '');
      setStatus(register
        ? (response.data?.destination ? `如账号可注册且通道可用，验证码将发送至 ${response.data.destination}。` : '如账号可注册且通道可用，验证码将会发送。')
        : (response.data?.destination ? `如账号存在且通道可用，验证码将发送至 ${response.data.destination}。` : '如账号存在且通道可用，验证码将会发送。'));
    } catch (requestError) {
      setError(requestError.message || '验证码发送失败，请稍后重试。');
    } finally {
      setSendingCode(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (loading) return;
    if (register && !siteConfigReady) {
      setError('正在读取最新注册规则，请稍后再试。');
      return;
    }
    const validationError = accountError(form.identifier, { allowUsername: !register && !codeMode });
    if (validationError) { setError(validationError); return; }
    if (codeMode && !VERIFICATION_AUTH_AVAILABLE) {
      setError('验证码服务尚未配置，请改用密码方式。');
      return;
    }
    if (codeMode && !/^\d{6}$/.test(form.verificationCode.trim())) {
      setError('请输入 6 位验证码。');
      return;
    }
    if (register && (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/\d/.test(form.password))) {
      setError('注册密码至少 8 位，并同时包含字母和数字。');
      return;
    }
    if (register && !accepted) {
      setError('请先阅读当前的数据与隐私说明并确认同意。');
      return;
    }
    if (register && siteConfig.registrationOpen === false) {
      setError('当前暂未开放新账号注册。');
      return;
    }
    setError(''); setStatus(''); setLoading(true);
    try {
      if (register) {
        await api.register({
          identifier: form.identifier.trim(),
          password: form.password,
          subject: form.subject,
          privacyAccepted: true,
          privacyPolicyUpdatedAt: siteConfig.privacyPolicy?.updatedAt || '',
          ...(referralCode ? { referralCode } : {}),
          ...(codeMode ? { verificationCode: form.verificationCode.trim(), verificationId } : {}),
        });
      } else if (codeMode) {
        await api.loginWithCode({ identifier: form.identifier.trim(), code: form.verificationCode.trim(), verificationId });
      } else {
        await api.login({ identifier: form.identifier.trim(), password: form.password });
      }
      navigate(consumeAuthReturnTarget(), { replace: true, instant: true });
    } catch (requestError) {
      setError(requestError.message || '账号服务暂时不可用，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <AuthBrandPanel />
      <main className="auth-form-panel">
        <div className="auth-form-wrap">
          <div className="auth-mobile-logo"><Logo /></div>
          <h2>{register ? '创建教师账号' : '欢迎回来'}</h2>
          <p>{register ? '注册即送 3 次完整教案生成额度' : '登录后继续你的备课工作'}</p>
          {register && referralCode ? <p className="referral-applied"><Gift size={15} /> 已应用好友邀请码 <b>{referralCode}</b></p> : null}
          {register ? <div className="auth-capability-note subtle"><CircleAlert size={17} /><p><b>{codeMode ? '手机号或邮箱验证注册' : '手机号或邮箱注册'}</b><span>{codeMode ? '先获取验证码，再设置登录密码；验证码只在短时间内有效且只能使用一次。' : '设置登录密码后即可创建账号。'}</span></p></div> : <div className="auth-method-tabs" role="tablist" aria-label="登录方式">
            <button type="button" role="tab" aria-selected={!codeMode} className={!codeMode ? 'active' : ''} onClick={() => { setMethod('password'); setError(''); setStatus(''); }}>密码登录</button>
            {VERIFICATION_AUTH_AVAILABLE ? <button type="button" role="tab" aria-selected={codeMode} className={codeMode ? 'active' : ''} onClick={() => { setMethod('code'); setError(''); setStatus(''); }}>验证码登录</button> : null}
          </div>}
          {codeMode && !VERIFICATION_AUTH_AVAILABLE ? <div className="auth-capability-note"><CircleAlert size={17} /><p><b>验证码登录暂不可用</b><span>请使用密码方式登录。</span></p></div> : null}
          <form onSubmit={submit} aria-busy={loading}>
            <Field label={register || codeMode ? '手机号或邮箱' : '手机号、邮箱或管理员账号'}><input type="text" value={form.identifier} onChange={update('identifier')} autoComplete="username" placeholder={register || codeMode ? '请输入手机号或邮箱' : '请输入登录账号'} required disabled={loading} /></Field>
            {codeMode ? <Field label="验证码"><div className="code-input"><input type="text" value={form.verificationCode} onChange={update('verificationCode')} inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" required disabled={loading || !VERIFICATION_AUTH_AVAILABLE || (register && !siteConfigReady)} /><button type="button" onClick={sendCode} disabled={loading || sendingCode || !VERIFICATION_AUTH_AVAILABLE || (register && !siteConfigReady)}>{!VERIFICATION_AUTH_AVAILABLE ? '暂不可用' : register && !siteConfigReady ? '读取中…' : sendingCode ? '发送中…' : '获取验证码'}</button></div></Field> : null}
            {(!codeMode || register) ? <Field label="密码"><input type="password" value={form.password} onChange={update('password')} autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? '至少 8 位，包含字母和数字' : '请输入密码'} required minLength={8} disabled={loading} /></Field> : null}
            {register ? <Field label="任教学科（可选）"><select value={form.subject} onChange={update('subject')} disabled={loading}><option>语文</option><option>数学</option><option>英语</option><option>物理</option><option>化学</option><option>其他</option></select></Field> : null}
          {register ? (
            <div className="auth-consents">
                <label><input type="checkbox" checked={accepted} disabled={!siteConfigReady || loading} onChange={(event) => setAccepted(event.target.checked)} /><span>我已阅读当前的<PrivacyPolicyLink policy={siteConfig.privacyPolicy}>数据与隐私说明</PrivacyPolicyLink>，并同意创建账号</span></label>
            </div>
            ) : <div className="login-tools"><span>登录状态将在此设备保留 7 天</span><Link to="/forgot-password">忘记密码？</Link></div>}
            {status ? <p className="form-status" role="status">{status}</p> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <Button size="lg" className="auth-submit" type="submit" icon={loading ? LoaderCircle : undefined} disabled={loading || (register && !siteConfigReady) || (register && siteConfig.registrationOpen === false) || (codeMode && !VERIFICATION_AUTH_AVAILABLE)}>{loading ? (register ? '正在注册…' : '正在登录…') : register && !siteConfigReady ? '正在读取注册规则…' : register && siteConfig.registrationOpen === false ? '当前暂停注册' : codeMode && !VERIFICATION_AUTH_AVAILABLE ? '请改用密码方式' : register ? '注册并免费开始' : '登录'}</Button>
          </form>
          <div className="auth-switch">{register ? '已有账号？' : '还没有账号？'} <Link to={register ? '/login' : '/register'}>{register ? '直接登录' : '免费注册'}</Link></div>
          {!register ? <div className="auth-privacy-note"><PrivacyPolicyLink>隐私规则</PrivacyPolicyLink></div> : null}
        </div>
      </main>
    </div>
  );
}

export function PasswordRecoveryPage() {
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState('request');
  const [verificationId, setVerificationId] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (!PASSWORD_RECOVERY_AVAILABLE || loading) return;
    const validationError = accountError(identifier);
    if (validationError) { setError(validationError); return; }
    if (step === 'confirm' && !/^\d{6}$/.test(code.trim())) { setError('请输入 6 位验证码。'); return; }
    if (step === 'confirm' && (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password))) { setError('新密码至少 8 位，并同时包含字母和数字。'); return; }
    setError(''); setStatus(''); setLoading(true);
    try {
      if (step === 'request') {
        const response = await api.requestPasswordReset({ identifier: identifier.trim() });
        setVerificationId(response.data?.verificationId || '');
        setStep('confirm');
        setStatus(response.data?.destination ? `如账号存在且通道可用，验证码将发送至 ${response.data.destination}。` : '如账号存在且通道可用，验证码将会发送。');
      } else {
        await api.confirmPasswordReset({ identifier: identifier.trim(), code: code.trim(), verificationId, newPassword: password });
        setStatus('密码已重置，请返回登录。');
        setStep('done');
      }
    } catch (requestError) {
      setError(requestError.message || '密码重置请求失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <AuthBrandPanel />
      <main className="auth-form-panel">
        <div className="auth-form-wrap recovery-form">
          <div className="auth-mobile-logo"><Logo /></div>
          <Link to="/login" className="auth-back"><ArrowLeft size={16} /> 返回登录</Link>
          <h2>找回密码</h2>
          <p>通过注册手机号或邮箱接收验证码并设置新密码。</p>
          {!PASSWORD_RECOVERY_AVAILABLE ? <div className="auth-capability-note"><CircleAlert size={17} /><p><b>在线找回暂不可用</b><span>请联系客服协助核验账号。</span></p></div> : null}
          <form onSubmit={submit} aria-busy={loading}>
            <Field label="手机号或邮箱"><input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="请输入注册账号" disabled={loading || !PASSWORD_RECOVERY_AVAILABLE || step !== 'request'} /></Field>
            {step === 'confirm' ? <><Field label="验证码"><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" required /></Field><Field label="新密码"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="至少 8 位，包含字母和数字" required minLength={8} /></Field></> : null}
            {status ? <p className="form-status" role="status">{status}</p> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {step === 'done' ? <Button size="lg" className="auth-submit" type="button" onClick={() => navigate('/login')}>返回登录</Button> : <Button size="lg" className="auth-submit" type="submit" icon={loading ? LoaderCircle : undefined} disabled={loading || !PASSWORD_RECOVERY_AVAILABLE}>{PASSWORD_RECOVERY_AVAILABLE ? loading ? '正在处理…' : step === 'request' ? '发送验证码' : '确认重置密码' : '暂不可用'}</Button>}
          </form>
        </div>
      </main>
    </div>
  );
}

const BILLING_PERIODS = Object.freeze([
  ['month', '月付'], ['quarter', '季付'], ['half_year', '半年付'], ['year', '年付'],
]);

export function PricingPage() {
  const [period, setPeriod] = useState('month');
  const [plans, setPlans] = useState([]);
  const [plansStatus, setPlansStatus] = useState('loading');

  useEffect(() => {
    let active = true;
    api.getPaymentPlans().then((response) => {
      const next = Array.isArray(response.data?.plans) ? response.data.plans.filter((plan) => plan.saleable) : [];
      if (active) {
        setPlans(next);
        setPlansStatus('ready');
      }
    }).catch(() => {
      if (active) {
        setPlans([]);
        setPlansStatus('error');
      }
    });
    return () => { active = false; };
  }, []);

  const freePlan = plans.find((plan) => plan.kind === 'free' || plan.purchasable === false || Number(plan.amountCents) === 0);
  const visiblePlans = plans.filter((plan) => plan.billingPeriod === period && plan !== freePlan && plan.purchasable !== false);
  return (
    <div className="public-page pricing-page">
      <PublicHeader />
      <main>
        <section className="pricing-heading"><h1>把时间还给课堂</h1><p>所有价格均为本次实际支付总额，一次性购买，不会自动续费。</p><div className="billing-switch" aria-label="选择付费周期">{BILLING_PERIODS.map(([value, label]) => <button type="button" aria-pressed={period === value} className={period === value ? 'active' : ''} onClick={() => setPeriod(value)} key={value}>{label}</button>)}</div></section>
        <section className="pricing-grid">
          <article><div><h2>{freePlan?.name || '免费版'}</h2><p>{freePlan ? `注册即享 ${freePlan.credits} 次教案生成点数` : '适合先体验完整备课流程'}</p></div><div className="price"><b>¥0</b><span>长期可用</span></div><ul>{(freePlan?.features?.length ? freePlan.features : ['注册赠送体验点数', '基础教案生成与修改', '结构化教案导出']).map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul><Button variant="secondary" size="lg" onClick={() => navigate('/register')}>免费注册</Button></article>
          {visiblePlans.map((plan, index) => <article key={plan.planId} className={index === 0 ? 'featured' : ''}><div><h2>{plan.name}</h2><p>{plan.credits} 次教案生成点数 · 有效 {plan.durationDays} 天</p></div><div className="price"><b>{formatPlanPrice(plan.amountCents)}</b><span>本次支付</span>{plan.promotion?.active ? <del>{formatPlanPrice(plan.regularAmountCents)}</del> : null}</div><ul>{(plan.features || []).map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul><Button variant={index === 0 ? 'primary' : 'secondary'} size="lg" onClick={() => navigate('/register')}>注册后购买</Button></article>)}
          {!visiblePlans.length ? <article className="pricing-empty-period"><div><h2>{BILLING_PERIODS.find(([value]) => value === period)?.[1]}套餐</h2><p>{plansStatus === 'loading' ? '正在读取可购买套餐…' : plansStatus === 'error' ? '会员套餐暂时无法读取，请稍后刷新页面' : '当前周期暂未上架套餐'}</p></div>{period !== 'month' && plansStatus === 'ready' ? <Button variant="secondary" size="lg" onClick={() => setPeriod('month')}>查看月付套餐</Button> : null}</article> : null}
        </section>
        <section className="pricing-note"><Layers3 size={22} /><div><b>已购买权益不会被后续调整</b><p>下单时的套餐名称、金额、点数和有效期会随订单保存；生成失败时，预占点数会自动退回。</p></div></section>
        <section className="pricing-faq"><h2>常见问题</h2>{['一次生成包含什么？', 'AI 修改会消耗生成次数吗？', '套餐会自动续费吗？', '支持学校统一采购吗？'].map((question) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{question === '套餐会自动续费吗？' ? '不会。当前套餐均为一次性购买，付款前会再次显示本次支付总额、点数和有效期。' : '每项权益都会在确认生成或购买前清晰展示；具体规则可在会员中心和额度明细中查看。'}</p></details>)}</section>
      </main>
      <PublicFooter />
    </div>
  );
}

function formatPlanPrice(cents) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: 2 }).format(Number(cents || 0) / 100);
}
