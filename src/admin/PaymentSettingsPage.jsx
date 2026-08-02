import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  CreditCard,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  WalletCards,
  X,
} from 'lucide-react';
import './admin-payment.css';

const PROVIDERS = Object.freeze({
  wechat: {
    label: '微信支付',
    shortLabel: '微信',
    description: 'Native 扫码支付 · API v3',
    colorClass: 'wechat',
  },
  alipay: {
    label: '支付宝',
    shortLabel: '支付宝',
    description: '电脑网站支付 · RSA2',
    colorClass: 'alipay',
  },
});

const EMPTY_FORMS = Object.freeze({
  wechat: {
    displayName: '微信支付',
    appId: '',
    merchantId: '',
    merchantCertificateSerial: '',
    verifierSerial: '',
    notifyUrl: '',
    merchantPrivateKeyPem: '',
    apiV3Key: '',
    verifierPublicKeyPem: '',
  },
  alipay: {
    displayName: '支付宝',
    appId: '',
    sellerId: '',
    notifyUrl: '',
    returnUrl: '',
    environment: 'production',
    appPrivateKeyPem: '',
    alipayPublicKeyPem: '',
  },
});

const STATUS_LABELS = Object.freeze({
  CREATED: '已创建',
  PENDING: '待支付',
  PAID: '已支付',
  CLOSED: '已关闭',
  FAILED: '支付失败',
  CANCELED: '已取消',
  REFUNDING: '退款中',
  REFUNDED: '已退款',
});

const PERIOD_LABELS = Object.freeze({ month: '月付', quarter: '季付', half_year: '半年付', year: '年付' });
const EMPTY_PLAN_FORM = Object.freeze({
  planId: '', name: '', tier: 'pro', tierRank: '10', billingPeriod: 'month', price: '', credits: '', durationDays: '30',
  features: '教案生成点数\nAI 教案修改\nDOC / 打印-PDF / JSON 导出', saleable: true,
  promotionEnabled: false, promotionLabel: '', promotionPrice: '', promotionStartsAt: '', promotionEndsAt: '',
});

export function PaymentSettingsPage({ onNotice = () => {} }) {
  const [configs, setConfigs] = useState({});
  const [forms, setForms] = useState(() => cloneEmptyForms());
  const [orders, setOrders] = useState([]);
  const [plans, setPlans] = useState([]);
  const [planForms, setPlanForms] = useState({});
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [newPlanForm, setNewPlanForm] = useState(() => ({ ...EMPTY_PLAN_FORM }));
  const [orderTotal, setOrderTotal] = useState(0);
  const [activeProvider, setActiveProvider] = useState('wechat');
  const [providerFilter, setProviderFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const activeConfig = configs[activeProvider] || emptyPublicConfig(activeProvider);
  const activeForm = forms[activeProvider];

  async function reload({ preserveError = false } = {}) {
    setLoading(true);
    if (!preserveError) setError('');
    const query = new URLSearchParams({ limit: '100' });
    if (providerFilter) query.set('provider', providerFilter);
    if (statusFilter) query.set('status', statusFilter);
    const [configResult, orderResult, planResult] = await Promise.allSettled([
      paymentRequest('/api/admin/payments/configs'),
      paymentRequest(`/api/admin/payments/orders?${query}`),
      paymentRequest('/api/admin/payments/plans'),
    ]);

    if (configResult.status === 'fulfilled') {
      const nextConfigs = Object.fromEntries((configResult.value?.data?.configs || []).map((config) => [config.provider, config]));
      setConfigs(nextConfigs);
      setForms((current) => mergePublicConfigsIntoForms(current, nextConfigs));
    }
    if (orderResult.status === 'fulfilled') {
      const data = orderResult.value?.data || {};
      setOrders(Array.isArray(data.items) ? data.items : []);
      setOrderTotal(Number(data.total || 0));
    }
    if (planResult.status === 'fulfilled') {
      const nextPlans = Array.isArray(planResult.value?.data?.plans) ? planResult.value.data.plans : [];
      setPlans(nextPlans);
      setPlanForms(Object.fromEntries(nextPlans.map((plan) => [plan.planId, planToForm(plan)])));
    }
    const firstFailure = [configResult, orderResult, planResult].find((result) => result.status === 'rejected');
    if (firstFailure) setError(firstFailure.reason?.message || '支付设置读取失败');
    setLoading(false);
  }

  useEffect(() => {
    reload();
  }, [providerFilter, statusFilter]);

  const summary = useMemo(() => {
    const values = Object.values(configs);
    return {
      configured: values.filter((config) => config.configured).length,
      enabled: values.filter((config) => config.enabled).length,
      pendingReview: orders.filter((order) => order.gatewayUnknown).length,
    };
  }, [configs, orders]);

  function updateField(field, value) {
    setForms((current) => ({
      ...current,
      [activeProvider]: { ...current[activeProvider], [field]: value },
    }));
  }

  async function saveProvider(event) {
    event.preventDefault();
    const action = `save-${activeProvider}`;
    setBusy(action);
    setError('');
    try {
      const payload = omitBlankSecrets(activeProvider, activeForm);
      const response = await paymentRequest(`/api/admin/payments/configs/${activeProvider}`, {
        method: 'PUT',
        body: payload,
      });
      const config = response.data?.config;
      setConfigs((current) => ({ ...current, [activeProvider]: config }));
      setForms((current) => mergePublicConfigsIntoForms(current, { [activeProvider]: config }));
      onNotice(`${PROVIDERS[activeProvider].label}配置已加密保存`);
    } catch (requestError) {
      setError(requestError.message || '支付配置保存失败');
    } finally {
      setBusy('');
    }
  }

  async function testProvider() {
    const action = `test-${activeProvider}`;
    setBusy(action);
    setError('');
    try {
      const response = await paymentRequest(`/api/admin/payments/configs/${activeProvider}/test`, { method: 'POST' });
      const result = response.data?.result;
      const config = response.data?.config;
      if (config) setConfigs((current) => ({ ...current, [activeProvider]: config }));
      onNotice(result?.ok ? `${PROVIDERS[activeProvider].label}本地密码学校验通过` : '配置校验未通过');
    } catch (requestError) {
      setError(requestError.message || '支付配置验证失败');
    } finally {
      setBusy('');
    }
  }

  async function toggleProvider() {
    const enabled = !activeConfig.enabled;
    const action = `toggle-${activeProvider}`;
    setBusy(action);
    setError('');
    try {
      const response = await paymentRequest(`/api/admin/payments/configs/${activeProvider}/enabled`, {
        method: 'PATCH',
        body: { enabled },
      });
      const config = response.data?.config;
      setConfigs((current) => ({ ...current, [activeProvider]: config }));
      onNotice(`${PROVIDERS[activeProvider].label}已${enabled ? '启用' : '停用'}`);
    } catch (requestError) {
      setError(requestError.message || '支付通道状态更新失败');
    } finally {
      setBusy('');
    }
  }

  function updatePlanField(planId, field, value) {
    setPlanForms((current) => ({ ...current, [planId]: { ...current[planId], [field]: value } }));
  }

  async function savePlan(event, plan) {
    event.preventDefault();
    const form = planForms[plan.planId];
    const action = `plan-${plan.planId}`;
    setBusy(action);
    setError('');
    try {
      const promotion = form.promotionEnabled ? {
        label: form.promotionLabel,
        amountCents: yuanToCents(form.promotionPrice),
        startsAt: localDateTimeToIso(form.promotionStartsAt),
        endsAt: localDateTimeToIso(form.promotionEndsAt),
      } : null;
      const response = await paymentRequest(`/api/admin/payments/plans/${encodeURIComponent(plan.planId)}`, {
        method: 'PUT',
        body: {
          expectedUpdatedAt: plan.updatedAt,
          name: form.name,
          tier: form.tier,
          tierRank: Number(form.tierRank),
          billingPeriod: form.billingPeriod,
          amountCents: yuanToCents(form.price),
          credits: Number(form.credits),
          durationDays: Number(form.durationDays),
          saleable: form.saleable,
          features: form.features.split('\n').map((item) => item.trim()).filter(Boolean),
          promotion,
        },
      });
      const saved = response.data?.plan;
      setPlans((current) => current.map((item) => item.planId === saved.planId ? saved : item));
      setPlanForms((current) => ({ ...current, [saved.planId]: planToForm(saved) }));
      onNotice(`${saved.name}已保存，新的下单将使用最新服务端报价`);
    } catch (requestError) {
      setError(requestError.message || '会员套餐保存失败');
    } finally {
      setBusy('');
    }
  }

  async function createPlan(event) {
    event.preventDefault();
    const planId = newPlanForm.planId.trim();
    if (plans.some((plan) => plan.planId === planId)) {
      setError('套餐标识已存在，请换一个唯一标识');
      return;
    }
    const action = 'plan-create';
    setBusy(action);
    setError('');
    try {
      const response = await paymentRequest(`/api/admin/payments/plans/${encodeURIComponent(planId)}`, {
        method: 'PUT',
        body: {
          name: newPlanForm.name,
          tier: newPlanForm.tier,
          tierRank: Number(newPlanForm.tierRank),
          billingPeriod: newPlanForm.billingPeriod,
          amountCents: yuanToCents(newPlanForm.price),
          credits: Number(newPlanForm.credits),
          durationDays: Number(newPlanForm.durationDays),
          saleable: newPlanForm.saleable,
          features: newPlanForm.features.split('\n').map((item) => item.trim()).filter(Boolean),
          promotion: null,
        },
      });
      const saved = response.data?.plan;
      setPlans((current) => [...current.filter((item) => item.planId !== saved.planId), saved]);
      setPlanForms((current) => ({ ...current, [saved.planId]: planToForm(saved) }));
      setNewPlanForm({ ...EMPTY_PLAN_FORM });
      setCreatingPlan(false);
      onNotice(`${saved.name}已创建并写入服务端套餐目录`);
    } catch (requestError) {
      setError(requestError.message || '会员套餐创建失败');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="admin-payment-page">
      <div className="admin-page-heading admin-payment-heading">
        <div><h1>支付与订单</h1><p>管理正式支付凭据、通道状态和会员订单；所有密钥仅在服务端加密保存</p></div>
        <button className="admin-button admin-button-secondary" type="button" onClick={() => reload()} disabled={loading || Boolean(busy)}>
          <RefreshCw size={17} className={loading ? 'spin' : ''} />刷新数据
        </button>
      </div>

      {error ? (
        <div className="admin-payment-error" role="alert">
          <AlertTriangle size={18} /><span>{error}</span>
          <button type="button" onClick={() => setError('')} aria-label="关闭错误提示"><X size={16} /></button>
        </div>
      ) : null}

      <section className="admin-payment-safety" aria-label="支付安全说明">
        <ShieldCheck size={23} />
        <div><b>支付处理规则</b><p>回调地址由当前部署域名自动生成；订单只会在官方通知通过签名、商户身份和金额校验后更新状态。</p></div>
        <span>系统自动配置</span>
      </section>

      <div className="admin-payment-summary">
        <SummaryCard icon={<KeyRound size={20} />} label="已配置通道" value={`${summary.configured} / 2`} hint="凭据完整且已加密保存" />
        <SummaryCard icon={<BadgeCheck size={20} />} label="已启用通道" value={summary.enabled} hint="用户当前可选择的支付方式" tone="success" />
        <SummaryCard icon={<Clock3 size={20} />} label="当前列表待核实" value={summary.pendingReview} hint="网关结果不确定，需主动查单" tone={summary.pendingReview ? 'warning' : ''} />
      </div>

      <section className="admin-panel admin-payment-config-panel">
        <header className="admin-payment-config-header">
          <div><h2>支付通道配置</h2><p>新密钥保存后会立即从浏览器表单清空，后台页面不会回显原文。</p></div>
          <div className="admin-payment-tabs" role="tablist" aria-label="支付通道">
            {Object.entries(PROVIDERS).map(([provider, info]) => (
              <button
                key={provider}
                type="button"
                role="tab"
                aria-selected={activeProvider === provider}
                className={activeProvider === provider ? 'active' : ''}
                onClick={() => setActiveProvider(provider)}
              >
                <ProviderGlyph provider={provider} />
                <span>{info.label}<small>{info.description}</small></span>
                <i className={configs[provider]?.enabled ? 'enabled' : ''}>{configs[provider]?.enabled ? '已启用' : configs[provider]?.configured ? '已保存' : '未配置'}</i>
              </button>
            ))}
          </div>
        </header>

        <form className="admin-payment-form" onSubmit={saveProvider}>
          <div className="admin-payment-form-title">
            <div className={`admin-payment-provider-icon ${PROVIDERS[activeProvider].colorClass}`}><ProviderGlyph provider={activeProvider} /></div>
            <div><h3>{PROVIDERS[activeProvider].label}</h3><p>{PROVIDERS[activeProvider].description}</p></div>
            <ConfigStatus config={activeConfig} />
          </div>

          {activeProvider === 'wechat' ? (
            <WechatFields form={activeForm} config={activeConfig} updateField={updateField} />
          ) : (
            <AlipayFields form={activeForm} config={activeConfig} updateField={updateField} />
          )}

          <footer className="admin-payment-form-actions">
            <div>
              <button className="admin-button admin-button-primary" type="submit" disabled={Boolean(busy)}>
                {busy === `save-${activeProvider}` ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存并加密校验
              </button>
              <button className="admin-button admin-button-secondary" type="button" onClick={testProvider} disabled={Boolean(busy) || !activeConfig.configured}>
                {busy === `test-${activeProvider}` ? <LoaderCircle className="spin" size={17} /> : <BadgeCheck size={17} />}验证已保存配置
              </button>
            </div>
            <label className={`admin-payment-switch ${activeConfig.enabled ? 'on' : ''}`}>
              <span><b>{activeConfig.enabled ? '通道已启用' : '通道未启用'}</b><small>启用前必须通过本地密码学校验</small></span>
              <button type="button" role="switch" aria-checked={activeConfig.enabled} onClick={toggleProvider} disabled={Boolean(busy) || !activeConfig.configured}>
                <i />
              </button>
            </label>
          </footer>
        </form>
      </section>

      <section className="admin-panel admin-membership-catalog-panel">
        <header className="admin-payment-orders-header">
          <div><h2>在售会员套餐</h2><p>名称、价格、点数、有效期和限时优惠均由服务端保存；已创建订单保留当时的权益快照，不受后续改价影响。</p></div>
          <div className="admin-membership-catalog-actions"><span className="admin-membership-catalog-count">{plans.filter((plan) => plan.saleable).length} 个在售</span><button className="admin-button admin-button-primary" type="button" onClick={() => setCreatingPlan((value) => !value)}><Plus size={16} />{creatingPlan ? '收起新增' : '添加套餐'}</button></div>
        </header>
        <div className="admin-membership-catalog-grid">
          {creatingPlan ? <form className="admin-membership-plan-form admin-membership-new-plan" onSubmit={createPlan}>
            <header><div><b>新增会员套餐</b><small>套餐标识创建后不可修改</small></div><label><input type="checkbox" checked={newPlanForm.saleable} onChange={(event) => setNewPlanForm((current) => ({ ...current, saleable: event.target.checked }))} /><span>创建后在售</span></label></header>
            <div className="admin-membership-plan-fields">
              <TextField label="套餐标识" value={newPlanForm.planId} onChange={(value) => setNewPlanForm((current) => ({ ...current, planId: value }))} placeholder="例如 pro-quarter-2026" pattern="[A-Za-z0-9_.:-]{2,80}" required />
              <TextField label="套餐名称" value={newPlanForm.name} onChange={(value) => setNewPlanForm((current) => ({ ...current, name: value }))} required />
              <TextField label="会员等级标识" value={newPlanForm.tier} onChange={(value) => setNewPlanForm((current) => ({ ...current, tier: value }))} placeholder="pro" required />
              <TextField label="等级权重" value={newPlanForm.tierRank} onChange={(value) => setNewPlanForm((current) => ({ ...current, tierRank: value }))} type="number" min="1" max="10000" required />
              <label className="admin-payment-field"><span>付费周期</span><select value={newPlanForm.billingPeriod} onChange={(event) => setNewPlanForm((current) => ({ ...current, billingPeriod: event.target.value }))}>{Object.entries(PERIOD_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <TextField label="售价（元）" value={newPlanForm.price} onChange={(value) => setNewPlanForm((current) => ({ ...current, price: value }))} type="number" min="0.01" step="0.01" required />
              <TextField label="发放点数" value={newPlanForm.credits} onChange={(value) => setNewPlanForm((current) => ({ ...current, credits: value }))} type="number" min="0" step="1" required />
              <TextField label="有效天数" value={newPlanForm.durationDays} onChange={(value) => setNewPlanForm((current) => ({ ...current, durationDays: value }))} type="number" min="1" step="1" required />
            </div>
            <label className="admin-membership-feature-field"><span>权益说明（每行一项）</span><textarea value={newPlanForm.features} onChange={(event) => setNewPlanForm((current) => ({ ...current, features: event.target.value }))} required /></label>
            <footer><small>创建后可继续配置限时优惠</small><button className="admin-button admin-button-primary" type="submit" disabled={Boolean(busy)}>{busy === 'plan-create' ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}确认创建</button></footer>
          </form> : null}
          {plans.map((plan) => {
            const form = planForms[plan.planId];
            if (!form) return null;
            return <form key={plan.planId} className="admin-membership-plan-form" onSubmit={(event) => savePlan(event, plan)}>
              <header><div><b>{plan.planId}</b><small>{PERIOD_LABELS[form.billingPeriod] || form.billingPeriod} · 等级 {form.tier}</small></div><label><input type="checkbox" checked={form.saleable} onChange={(event) => updatePlanField(plan.planId, 'saleable', event.target.checked)} /><span>前台在售</span></label></header>
              <div className="admin-membership-plan-fields">
                <TextField label="套餐名称" value={form.name} onChange={(value) => updatePlanField(plan.planId, 'name', value)} required />
                <label className="admin-payment-field"><span>付费周期</span><select value={form.billingPeriod} onChange={(event) => updatePlanField(plan.planId, 'billingPeriod', event.target.value)}>{Object.entries(PERIOD_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
                <TextField label="会员等级标识" value={form.tier} onChange={(value) => updatePlanField(plan.planId, 'tier', value)} required />
                <TextField label="等级权重" value={form.tierRank} onChange={(value) => updatePlanField(plan.planId, 'tierRank', value)} type="number" min="1" max="10000" required />
                <TextField label="售价（元）" value={form.price} onChange={(value) => updatePlanField(plan.planId, 'price', value)} type="number" min="0.01" step="0.01" required />
                <TextField label="发放点数" value={form.credits} onChange={(value) => updatePlanField(plan.planId, 'credits', value)} type="number" min="0" step="1" required />
                <TextField label="有效天数" value={form.durationDays} onChange={(value) => updatePlanField(plan.planId, 'durationDays', value)} type="number" min="1" step="1" required />
              </div>
              <label className="admin-membership-feature-field"><span>权益说明（每行一项）</span><textarea value={form.features} onChange={(event) => updatePlanField(plan.planId, 'features', event.target.value)} required /></label>
              <label className="admin-membership-promotion-toggle"><input type="checkbox" checked={form.promotionEnabled} onChange={(event) => updatePlanField(plan.planId, 'promotionEnabled', event.target.checked)} /><span><b>设置限时优惠</b><small>只在开始至结束时间内使用优惠价</small></span></label>
              {form.promotionEnabled ? <div className="admin-membership-promotion-fields">
                <TextField label="优惠标签" value={form.promotionLabel} onChange={(value) => updatePlanField(plan.planId, 'promotionLabel', value)} placeholder="例如：开学季优惠" required />
                <TextField label="优惠价（元）" value={form.promotionPrice} onChange={(value) => updatePlanField(plan.planId, 'promotionPrice', value)} type="number" min="0.01" step="0.01" required />
                <TextField label="开始时间" value={form.promotionStartsAt} onChange={(value) => updatePlanField(plan.planId, 'promotionStartsAt', value)} type="datetime-local" required />
                <TextField label="结束时间" value={form.promotionEndsAt} onChange={(value) => updatePlanField(plan.planId, 'promotionEndsAt', value)} type="datetime-local" required />
              </div> : null}
              <footer><small>{plan.promotion?.active ? `当前优惠生效：¥${formatAmount(plan.amountCents)}` : `当前成交价：¥${formatAmount(plan.amountCents)}`}</small><button className="admin-button admin-button-primary" type="submit" disabled={Boolean(busy)}>{busy === `plan-${plan.planId}` ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}保存套餐</button></footer>
            </form>;
          })}
          {!loading && !plans.length ? <div className="admin-payment-empty"><CreditCard size={28} /><b>没有可维护的套餐</b><span>请检查服务端会员目录。</span></div> : null}
        </div>
        <p className="admin-membership-promotion-note"><ShieldCheck size={15} /> 限时优惠直接作用于单个套餐，成交价以开始和结束时间范围内的后台配置为准。</p>
      </section>

      <section className="admin-panel admin-payment-orders-panel">
        <header className="admin-payment-orders-header">
          <div><h2>支付订单</h2><p>共 {orderTotal} 笔；状态只允许由已验签通知或后续主动查单结果推进。</p></div>
          <div className="admin-payment-filters">
            <label><span>通道</span><select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="">全部通道</option><option value="wechat">微信支付</option><option value="alipay">支付宝</option></select></label>
            <label><span>状态</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select></label>
          </div>
        </header>

        <div className="admin-payment-table-wrap">
          <table className="admin-payment-table">
            <thead><tr><th>订单号</th><th>用户 / 套餐</th><th>支付方式</th><th>金额</th><th>状态</th><th>创建时间</th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td><b>{order.merchantOrderNo}</b><small>{order.providerTradeNo || order.id}</small></td>
                  <td><b>{order.userId || '—'}</b><small>{order.subject || order.planId || '会员订单'}</small></td>
                  <td><span className={`admin-payment-provider-chip ${order.provider}`}><ProviderGlyph provider={order.provider} />{PROVIDERS[order.provider]?.shortLabel || order.provider}</span></td>
                  <td><b>¥{formatAmount(order.amountCents)}</b><small>{order.currency || 'CNY'}</small></td>
                  <td><OrderStatus order={order} /></td>
                  <td><b>{formatDate(order.createdAt)}</b><small>更新于 {formatDate(order.updatedAt, true)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !orders.length ? <div className="admin-payment-empty"><CreditCard size={28} /><b>暂无符合条件的订单</b><span>用户发起真实支付后会显示在这里。</span></div> : null}
          {loading ? <div className="admin-payment-loading"><LoaderCircle className="spin" size={24} />正在读取支付数据…</div> : null}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ icon, label, value, hint, tone = '' }) {
  return <div className={`admin-payment-summary-card ${tone}`}><span>{icon}</span><div><small>{label}</small><b>{value}</b><p>{hint}</p></div></div>;
}

function ProviderGlyph({ provider }) {
  return provider === 'wechat' ? <WalletCards size={20} /> : <CreditCard size={20} />;
}

function ConfigStatus({ config }) {
  if (!config.configured) return <span className="admin-payment-config-status">未配置</span>;
  if (!config.validation?.ok) return <span className="admin-payment-config-status invalid"><AlertTriangle size={14} />校验失败</span>;
  return <span className="admin-payment-config-status valid"><CheckCircle2 size={14} />已通过本地校验</span>;
}

function WechatFields({ form, config, updateField }) {
  return (
    <div className="admin-payment-field-grid">
      <TextField label="显示名称" value={form.displayName} onChange={(value) => updateField('displayName', value)} />
      <TextField label="应用 AppID" value={form.appId} onChange={(value) => updateField('appId', value)} placeholder="wx..." required />
      <TextField label="微信支付商户号" value={form.merchantId} onChange={(value) => updateField('merchantId', value)} placeholder="纯数字商户号" required />
      <TextField label="商户 API 证书序列号" value={form.merchantCertificateSerial} onChange={(value) => updateField('merchantCertificateSerial', value)} placeholder="证书序列号（十六进制）" required />
      <TextField label="微信支付公钥 ID / 平台证书序列号" value={form.verifierSerial} onChange={(value) => updateField('verifierSerial', value)} placeholder="PUB_KEY_ID_... 或证书序列号" required wide />
      <TextField label="异步通知地址（部署时自动生成）" value={form.notifyUrl} onChange={() => {}} placeholder="保存后由部署域名自动生成" type="url" readOnly required wide />
      <SecretArea label="商户 API 私钥" value={form.merchantPrivateKeyPem} onChange={(value) => updateField('merchantPrivateKeyPem', value)} configured={config.credentials?.merchantPrivateKeyPem} hint={config.credentialHints?.merchantPrivateKeyPem} placeholder="-----BEGIN PRIVATE KEY-----" required={!config.credentials?.merchantPrivateKeyPem} />
      <SecretArea label="微信支付公钥 / 平台证书公钥" value={form.verifierPublicKeyPem} onChange={(value) => updateField('verifierPublicKeyPem', value)} configured={config.credentials?.verifierPublicKeyPem} hint={config.credentialHints?.verifierPublicKeyPem} placeholder="-----BEGIN PUBLIC KEY-----" required={!config.credentials?.verifierPublicKeyPem} />
      <TextField label="API v3 密钥" value={form.apiV3Key} onChange={(value) => updateField('apiV3Key', value)} placeholder={config.credentials?.apiV3Key ? `${config.credentialHints?.apiV3Key || '已加密保存'}，留空不更新` : '必须正好 32 字节'} type="password" autoComplete="new-password" required={!config.credentials?.apiV3Key} wide />
    </div>
  );
}

function AlipayFields({ form, config, updateField }) {
  return (
    <div className="admin-payment-field-grid">
      <TextField label="显示名称" value={form.displayName} onChange={(value) => updateField('displayName', value)} />
      <label className="admin-payment-field"><span>运行环境</span><select value={form.environment} onChange={(event) => updateField('environment', event.target.value)}><option value="production">生产环境</option><option value="sandbox">沙箱环境</option></select></label>
      <TextField label="应用 AppID" value={form.appId} onChange={(value) => updateField('appId', value)} placeholder="支付宝开放平台 AppID" required />
      <TextField label="卖家 ID（seller_id）" value={form.sellerId} onChange={(value) => updateField('sellerId', value)} placeholder="签约支付宝账号 PID" required />
      <TextField label="异步通知地址（部署时自动生成）" value={form.notifyUrl} onChange={() => {}} placeholder="保存后由部署域名自动生成" type="url" readOnly required wide />
      <TextField label="支付完成返回地址（部署时自动生成）" value={form.returnUrl} onChange={() => {}} placeholder="保存后由部署域名自动生成" type="url" readOnly wide />
      <SecretArea label="应用私钥" value={form.appPrivateKeyPem} onChange={(value) => updateField('appPrivateKeyPem', value)} configured={config.credentials?.appPrivateKeyPem} hint={config.credentialHints?.appPrivateKeyPem} placeholder="-----BEGIN PRIVATE KEY-----" required={!config.credentials?.appPrivateKeyPem} />
      <SecretArea label="支付宝公钥" value={form.alipayPublicKeyPem} onChange={(value) => updateField('alipayPublicKeyPem', value)} configured={config.credentials?.alipayPublicKeyPem} hint={config.credentialHints?.alipayPublicKeyPem} placeholder="-----BEGIN PUBLIC KEY-----" required={!config.credentials?.alipayPublicKeyPem} />
    </div>
  );
}

function TextField({ label, value, onChange, wide = false, ...inputProps }) {
  return <label className={`admin-payment-field ${wide ? 'wide' : ''}`}><span>{label}</span><input value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...inputProps} /></label>;
}

function SecretArea({ label, value, onChange, configured, hint, ...textareaProps }) {
  return (
    <label className="admin-payment-field admin-payment-secret">
      <span>{label}{configured ? <i><KeyRound size={12} />{hint || '已加密保存'}</i> : null}</span>
      <textarea {...textareaProps} value={value || ''} onChange={(event) => onChange(event.target.value)} autoComplete="off" placeholder={configured ? '已加密保存，留空表示不更新' : textareaProps.placeholder} />
    </label>
  );
}

function OrderStatus({ order }) {
  const fulfillmentPending = order.status === 'PAID' && order.fulfillment?.status !== 'FULFILLED';
  const label = order.gatewayUnknown ? '待核实' : fulfillmentPending ? '已支付 · 权益待处理' : STATUS_LABELS[order.status] || order.status;
  const className = order.gatewayUnknown || fulfillmentPending ? 'unknown' : String(order.status || '').toLowerCase();
  return <span className={`admin-payment-order-status ${className}`}>{label}</span>;
}

function cloneEmptyForms() {
  return Object.fromEntries(Object.entries(EMPTY_FORMS).map(([provider, fields]) => [provider, { ...fields }]));
}

function mergePublicConfigsIntoForms(current, configs) {
  const next = { ...current };
  for (const [provider, config] of Object.entries(configs || {})) {
    if (!EMPTY_FORMS[provider] || !config) continue;
    const publicFields = Object.keys(EMPTY_FORMS[provider]).filter((field) => !isSecretField(provider, field));
    next[provider] = {
      ...current[provider],
      ...Object.fromEntries(publicFields.map((field) => [field, config[field] ?? current[provider]?.[field] ?? EMPTY_FORMS[provider][field]])),
      ...Object.fromEntries(Object.keys(EMPTY_FORMS[provider]).filter((field) => isSecretField(provider, field)).map((field) => [field, ''])),
    };
  }
  return next;
}

function omitBlankSecrets(provider, form) {
  return Object.fromEntries(Object.entries(form).filter(([field, value]) => !isSecretField(provider, field) || String(value || '').trim()));
}

function isSecretField(provider, field) {
  return provider === 'wechat'
    ? ['merchantPrivateKeyPem', 'apiV3Key', 'verifierPublicKeyPem'].includes(field)
    : ['appPrivateKeyPem', 'alipayPublicKeyPem'].includes(field);
}

function emptyPublicConfig(provider) {
  return { provider, configured: false, enabled: false, validation: { ok: false }, credentials: {}, credentialHints: {} };
}

function planToForm(plan) {
  return {
    name: plan.name || '',
    tier: plan.tier || 'pro',
    tierRank: String(Number(plan.tierRank || 10)),
    billingPeriod: plan.billingPeriod || 'month',
    price: (Number(plan.regularAmountCents ?? plan.amountCents ?? 0) / 100).toFixed(2),
    credits: String(Number(plan.credits || 0)),
    durationDays: String(Number(plan.durationDays || 0)),
    features: Array.isArray(plan.features) ? plan.features.join('\n') : '',
    saleable: Boolean(plan.saleable),
    promotionEnabled: Boolean(plan.promotion),
    promotionLabel: plan.promotion?.label || '',
    promotionPrice: plan.promotion ? (Number(plan.promotion.amountCents || 0) / 100).toFixed(2) : '',
    promotionStartsAt: isoToLocalDateTime(plan.promotion?.startsAt),
    promotionEndsAt: isoToLocalDateTime(plan.promotion?.endsAt),
  };
}

function yuanToCents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) throw new Error('价格必须是最多两位小数的人民币金额');
  const [yuan, fraction = ''] = text.split('.');
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error('价格必须大于 0 元');
  return cents;
}

function isoToLocalDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function localDateTimeToIso(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) throw new Error('请填写有效的优惠开始和结束时间');
  return date.toISOString();
}

function formatAmount(cents) {
  const value = Number(cents || 0) / 100;
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value, compact = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    ...(compact ? {} : { year: 'numeric' }),
    hourCycle: 'h23',
  }).format(date);
}

async function paymentRequest(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
  if (!response.ok || payload.ok === false) {
    const details = Array.isArray(payload.error?.details?.errors) ? `：${payload.error.details.errors.join('；')}` : '';
    throw new Error(`${payload.error?.message || `请求失败（HTTP ${response.status}）`}${details}`);
  }
  return payload;
}
