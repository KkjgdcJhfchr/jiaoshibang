import { useState } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  BookMarked,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  FileCheck2,
  ImageUp,
  Layers3,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Network,
  ScrollText,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { Link, navigate } from '../lib/navigation.jsx';
import { Button, Field, Logo } from './components.jsx';

const VERIFICATION_AUTH_AVAILABLE = import.meta.env.VITE_VERIFICATION_CODE_ENABLED !== 'false';
const PASSWORD_RECOVERY_AVAILABLE = import.meta.env.VITE_PASSWORD_RECOVERY_ENABLED !== 'false';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^1[3-9]\d{9}$/;

function accountError(identifier) {
  const value = identifier.trim();
  if (!value) return '请输入手机号或邮箱。';
  if (!EMAIL_PATTERN.test(value) && !MOBILE_PATTERN.test(value)) return '请输入有效的中国大陆手机号或邮箱地址。';
  return '';
}

function consumeAuthReturnTarget() {
  const target = sessionStorage.getItem('auth-return-to') || '/app';
  sessionStorage.removeItem('auth-return-to');
  return /^\/app(?:\/|$)/.test(target) ? target : '/app';
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
        <Link to="/#security">数据与隐私</Link>
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

export function LandingPage() {
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
          <div className="hero-product" aria-label="教师帮教案生成界面预览">
            <div className="hero-product-head"><span>七年级语文 ·《春》</span><span className="live-dot">正在生成</span></div>
            <div className="hero-plan-layout">
              <div className="hero-outline">
                {['教学目标', '学情分析', '重点难点', '教学过程', '课堂互动', '习题与答案'].map((item, index) => (
                  <span key={item} className={index === 3 ? 'active' : ''}><i>{index + 1}</i>{item}</span>
                ))}
              </div>
              <div className="hero-document">
                <small>教学过程 · 45 分钟</small>
                <h3>从声音开始，遇见朱自清的春天</h3>
                <p>“请先闭上眼睛，听十秒钟。你听到了什么？如果春天会走进教室……”</p>
                <div className="mini-timeline"><span style={{ width: '13%' }}>导入</span><span style={{ width: '32%' }}>品读</span><span style={{ width: '26%' }}>互动</span><span style={{ width: '19%' }}>练习</span><span style={{ width: '10%' }}>总结</span></div>
                <div className="mini-exercise"><b>课堂提问</b><p>两个“盼望着”能删掉一个吗？为什么？</p></div>
              </div>
              <div className="hero-ai">
                <span><WandSparkles size={15} /> AI 助教</span>
                <p>正在补充小组互动环节，并检查课堂时间分配…</p>
                <div><i /><i /><i /></div>
              </div>
            </div>
          </div>
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
              <li><span>1</span><div><h3>上传教材章节</h3><p>手机拍照或 PDF 均可，自动检查模糊、反光与漏页。</p></div></li>
              <li><span>2</span><div><h3>确认学情和课堂偏好</h3><p>选择年级、课时与教学风格，也可以补充班级特点。</p></div></li>
              <li><span>3</span><div><h3>生成、修改、定稿</h3><p>生成过程可离开页面，完成后继续对话修改，满意再定稿。</p></div></li>
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

        <section className="landing-section security-section" id="security">
          <div className="security-heading"><ShieldCheck size={30} /><h2>你的教材和教案，默认只属于你</h2></div>
          <div className="security-points">
            <div><b>服务使用与训练授权分开</b><p>不勾选训练授权，也能完整使用生成、修改和导出。</p></div>
            <div><b>素材可删除、可设置保留期</b><p>上传文件和最终教案分开管理，删除操作有清晰反馈。</p></div>
            <div><b>模型密钥只保存在服务端</b><p>管理员后台仅显示尾号，调用日志不记录完整教材和密钥。</p></div>
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
  return (
    <footer className="public-footer">
      <div><Logo /><p>让每一位教师，都有一位懂课堂的备课伙伴。</p></div>
      <div><b>产品</b><Link to="/#features">功能介绍</Link><Link to="/pricing">会员方案</Link><Link to="/app/lesson/lesson-spring-001">教案示例</Link></div>
      <div><b>支持</b><Link to="/#workflow">使用帮助</Link><a href="mailto:support@jiaoshibang.cn">联系我们</a><Link to="/#security">数据安全说明</Link></div>
      <div><b>规则</b><span className="footer-pending-link" title="正式法律文本尚待发布">用户协议（待发布）</span><Link to="/#security">数据与隐私说明</Link><Link to="/#security">AI 数据授权说明</Link></div>
      <p className="footer-record">© 2026 教师帮 · 演示版本</p>
    </footer>
  );
}

function AuthBrandPanel() {
  return (
    <div className="auth-brand-panel">
      <Logo />
      <div className="auth-brand-copy"><h1>少一点重复备课，<br />多一点真实互动</h1><p>从教材到完整课堂设计，教师帮与你一起把每一个教学环节想清楚。</p></div>
      <div className="auth-quote"><p>“导入、提问链和学生可能的回答都写得很具体，我只需要再加上自己的课堂语言。”</p><span>七年级语文教师 · 体验反馈</span></div>
    </div>
  );
}

export function AuthPage({ mode = 'login' }) {
  const register = mode === 'register';
  const [method, setMethod] = useState(register ? 'code' : 'password');
  const [accepted, setAccepted] = useState(false);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);
  const [verificationId, setVerificationId] = useState('');
  const [form, setForm] = useState({ identifier: '', verificationCode: '', password: '', subject: '语文' });
  const codeMode = method === 'code';

  function update(field) {
    return (event) => setForm((current) => ({ ...current, [field]: event.target.value }));
  }

  async function sendCode() {
    if (!VERIFICATION_AUTH_AVAILABLE || sendingCode) return;
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
    const validationError = accountError(form.identifier);
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
    setError(''); setStatus(''); setLoading(true);
    try {
      if (register) {
        await api.register({
          identifier: form.identifier.trim(),
          password: form.password,
          subject: form.subject,
          trainingConsent: training === true,
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
          {register ? <div className="auth-capability-note subtle"><CircleAlert size={17} /><p><b>手机号或邮箱验证注册</b><span>先获取验证码，再设置登录密码；验证码只在短时间内有效且只能使用一次。</span></p></div> : <div className="auth-method-tabs" role="tablist" aria-label="登录方式">
            <button type="button" role="tab" aria-selected={!codeMode} className={!codeMode ? 'active' : ''} onClick={() => { setMethod('password'); setError(''); setStatus(''); }}>密码登录</button>
            <button type="button" role="tab" aria-selected={codeMode} className={codeMode ? 'active' : ''} onClick={() => { setMethod('code'); setError(''); setStatus(''); }}>验证码登录<small>{VERIFICATION_AUTH_AVAILABLE ? '' : '待接入'}</small></button>
          </div>}
          {codeMode && !VERIFICATION_AUTH_AVAILABLE ? <div className="auth-capability-note"><CircleAlert size={17} /><p><b>验证码服务尚未配置</b><span>界面与 API 契约已经预留，短信或邮件服务接入后即可启用；现在请使用密码方式。</span></p></div> : null}
          <form onSubmit={submit} aria-busy={loading}>
            <Field label="手机号或邮箱"><input type="text" value={form.identifier} onChange={update('identifier')} autoComplete="username" placeholder="请输入手机号或邮箱" required disabled={loading} /></Field>
            {codeMode ? <Field label="验证码"><div className="code-input"><input type="text" value={form.verificationCode} onChange={update('verificationCode')} inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" required disabled={loading || !VERIFICATION_AUTH_AVAILABLE} /><button type="button" onClick={sendCode} disabled={loading || sendingCode || !VERIFICATION_AUTH_AVAILABLE}>{!VERIFICATION_AUTH_AVAILABLE ? '尚未配置' : sendingCode ? '发送中…' : '获取验证码'}</button></div></Field> : null}
            {(!codeMode || register) ? <Field label="密码"><input type="password" value={form.password} onChange={update('password')} autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? '至少 8 位，包含字母和数字' : '请输入密码'} required minLength={8} disabled={loading} /></Field> : null}
            {register ? <Field label="任教学科（可选）"><select value={form.subject} onChange={update('subject')} disabled={loading}><option>语文</option><option>数学</option><option>英语</option><option>物理</option><option>化学</option><option>其他</option></select></Field> : null}
            {register ? (
              <div className="auth-consents">
                <label><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>我已阅读当前的<Link to="/#security">数据与隐私说明</Link>，并同意创建账号</span></label>
                <label><input type="checkbox" checked={training} onChange={(event) => setTraining(event.target.checked)} /><span>我愿意将去标识化后的最终教案用于改进模型（可随时撤回，不影响使用）</span></label>
              </div>
            ) : <div className="login-tools"><span>登录状态将在此设备保留 7 天</span><Link to="/forgot-password">忘记密码？</Link></div>}
            {status ? <p className="form-status" role="status">{status}</p> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <Button size="lg" className="auth-submit" type="submit" icon={loading ? LoaderCircle : undefined} disabled={loading || (codeMode && !VERIFICATION_AUTH_AVAILABLE)}>{loading ? (register ? '正在注册…' : '正在登录…') : codeMode && !VERIFICATION_AUTH_AVAILABLE ? '请改用密码方式' : register ? '注册并免费开始' : '登录'}</Button>
          </form>
          <div className="auth-switch">{register ? '已有账号？' : '还没有账号？'} <Link to={register ? '/login' : '/register'}>{register ? '直接登录' : '免费注册'}</Link></div>
          {!register ? <><div className="auth-divider"><span>第三方登录</span></div><button className="wechat-login" disabled title="微信开放平台尚未接入">微信登录（尚未接入）</button></> : null}
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
          {!PASSWORD_RECOVERY_AVAILABLE ? <div className="auth-capability-note"><CircleAlert size={17} /><p><b>在线找回尚未配置</b><span>短信、邮件发送和重置令牌接口仍待接入；当前不会收集账号，也不会假装发送成功。</span></p></div> : null}
          <form onSubmit={submit} aria-busy={loading}>
            <Field label="手机号或邮箱"><input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="请输入注册账号" disabled={loading || !PASSWORD_RECOVERY_AVAILABLE || step !== 'request'} /></Field>
            {step === 'confirm' ? <><Field label="验证码"><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="6 位验证码" required /></Field><Field label="新密码"><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" placeholder="至少 8 位，包含字母和数字" required minLength={8} /></Field></> : null}
            {status ? <p className="form-status" role="status">{status}</p> : null}
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            {step === 'done' ? <Button size="lg" className="auth-submit" type="button" onClick={() => navigate('/login')}>返回登录</Button> : <Button size="lg" className="auth-submit" type="submit" icon={loading ? LoaderCircle : undefined} disabled={loading || !PASSWORD_RECOVERY_AVAILABLE}>{PASSWORD_RECOVERY_AVAILABLE ? loading ? '正在处理…' : step === 'request' ? '发送验证码' : '确认重置密码' : '重置服务尚未配置'}</Button>}
          </form>
        </div>
      </main>
    </div>
  );
}

const pricingPlans = [
  { name: '免费版', price: '0', unit: '长期可用', desc: '适合先体验完整流程', features: ['注册赠送 3 次生成', '每次最多 10 页教材', '基础教案模板', '导出带品牌标记'], cta: '免费注册' },
  { name: '专业版', price: '39', unit: '/ 月', desc: '适合日常高频备课', features: ['20 次教案生成点数', 'AI 教案反复修改', '多图片与 PDF 教材上传', '可用模型通道自动路由', 'DOC / 打印-PDF / JSON 导出', '历史版本本地保存'], cta: '注册后查看', featured: true },
  { name: '教研版', price: '99', unit: '/ 月', desc: '适合备课组与教研骨干', features: ['每月 80 次完整生成', '不限 AI 修改次数', '共享优质教案模板', '模型质量评测报告', '优先客服支持'], cta: '注册后查看' },
];

export function PricingPage() {
  const [annual, setAnnual] = useState(true);
  return (
    <div className="public-page pricing-page">
      <PublicHeader />
      <main>
        <section className="pricing-heading"><h1>把时间还给课堂</h1><p>从免费体验到高频备课，每一项权益都围绕真实教学流程设计。</p><div className="billing-switch"><button className={!annual ? 'active' : ''} onClick={() => setAnnual(false)}>按月</button><button className={annual ? 'active' : ''} onClick={() => setAnnual(true)}>按年 · 省 30%</button></div></section>
        <section className="pricing-grid">
          {pricingPlans.map((plan) => {
            const price = annual && plan.price !== '0' ? Math.round(Number(plan.price) * 0.7) : plan.price;
            return <article key={plan.name} className={plan.featured ? 'featured' : ''}><div><h2>{plan.name}</h2><p>{plan.desc}</p></div><div className="price"><b>¥{price}</b><span>{plan.unit}</span></div><ul>{plan.features.map((item) => <li key={item}><Check size={16} />{item}</li>)}</ul><Button variant={plan.featured ? 'primary' : 'secondary'} size="lg" onClick={() => navigate('/register')}>{plan.cta}</Button></article>;
          })}
        </section>
        <section className="pricing-note"><Layers3 size={22} /><div><b>套餐权益会在购买时形成快照</b><p>管理员调整后续套餐时，不会静默减少你已经购买的权益；额度失败自动退回，明细随时可查。</p></div></section>
        <section className="pricing-faq"><h2>常见问题</h2>{['一次生成包含什么？', 'AI 修改会消耗生成次数吗？', '不授权训练还能使用吗？', '支持学校统一采购吗？'].map((question) => <details key={question}><summary>{question}<ChevronDown size={18} /></summary><p>{question === '不授权训练还能使用吗？' ? '可以。提供服务所必需的数据处理与训练授权完全分开，训练授权默认不勾选，且可以在隐私设置中随时撤回。' : '每项权益都会在确认生成或购买前清晰展示；具体规则可在会员中心和额度明细中查看。'}</p></details>)}</section>
      </main>
      <PublicFooter />
    </div>
  );
}
