import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  BadgePercent,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  KeyRound,
  LoaderCircle,
  PackageCheck,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Tag,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react'
import { api } from '../lib/api.js'
import './admin-payment.css'

const PROVIDERS = Object.freeze({
  wechat: { label: '微信支付', shortLabel: '微信', description: 'Native 扫码支付 · API v3', colorClass: 'wechat' },
  alipay: { label: '支付宝', shortLabel: '支付宝', description: '电脑网站支付 · RSA2', colorClass: 'alipay' },
})

const EMPTY_PAYMENT_FORMS = Object.freeze({
  wechat: {
    displayName: '微信支付', appId: '', merchantId: '', merchantCertificateSerial: '', verifierSerial: '', notifyUrl: '',
    merchantPrivateKeyPem: '', apiV3Key: '', verifierPublicKeyPem: '',
  },
  alipay: {
    displayName: '支付宝', appId: '', sellerId: '', notifyUrl: '', returnUrl: '', appPrivateKeyPem: '', alipayPublicKeyPem: '',
  },
})

const STATUS_LABELS = Object.freeze({
  CREATED: '已创建', PENDING: '待支付', PAID: '已支付', CLOSED: '已关闭', FAILED: '支付失败',
  CANCELED: '已取消', REFUNDING: '退款中', REFUNDED: '已退款',
})

const PERIOD_LABELS = Object.freeze({ free: '免费版', month: '月付', quarter: '季付', half_year: '半年付', year: '年付' })
const CELEBRATION_TEMPLATES = Object.freeze({
  new_term: '开学季', teachers_day: '教师节', anniversary: '平台周年', holiday: '节日庆祝', custom: '自定义活动',
})

const EMPTY_PLAN_FORM = Object.freeze({
  planId: '', name: '', kind: 'paid', tier: 'pro', tierRank: '10', billingPeriod: 'month', price: '', credits: '',
  durationDays: '30', features: '教案生成点数\nAI 教案修改\nDOC / 打印-PDF / JSON 导出', saleable: true,
})

const EMPTY_PROMOTION_FORM = Object.freeze({
  name: '', template: 'new_term', content: '', discountPercent: '10', targetPlanIds: [], startsAt: '', endsAt: '', enabled: true,
})

export function PaymentChannelsPage({ onNotice = () => {} }) {
  const [configs, setConfigs] = useState({})
  const [forms, setForms] = useState(() => clonePaymentForms())
  const [activeProvider, setActiveProvider] = useState('wechat')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const activeConfig = configs[activeProvider] || emptyPublicConfig(activeProvider)
  const activeForm = forms[activeProvider]

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const response = await api.getAdminPaymentConfigs()
      const nextConfigs = Object.fromEntries((response.data?.configs || []).map((config) => [config.provider, config]))
      setConfigs(nextConfigs)
      setForms((current) => mergePaymentConfigs(current, nextConfigs))
    } catch (requestError) {
      setError(requestError.message || '支付通道读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  function updateField(field, value) {
    setForms((current) => ({ ...current, [activeProvider]: { ...current[activeProvider], [field]: value } }))
  }

  async function saveProvider(event) {
    event.preventDefault()
    const action = `save-${activeProvider}`
    setBusy(action)
    setError('')
    try {
      const payload = omitBlankSecrets(activeProvider, activeForm)
      if (activeProvider === 'alipay') payload.environment = 'production'
      const response = await api.saveAdminPaymentConfig(activeProvider, payload)
      const config = response.data?.config
      setConfigs((current) => ({ ...current, [activeProvider]: config }))
      setForms((current) => mergePaymentConfigs(current, { [activeProvider]: config }))
      onNotice(`${PROVIDERS[activeProvider].label}配置已加密保存`)
    } catch (requestError) {
      setError(requestError.message || '支付通道保存失败')
    } finally {
      setBusy('')
    }
  }

  async function testProvider() {
    const action = `test-${activeProvider}`
    setBusy(action)
    setError('')
    try {
      const response = await api.testAdminPaymentConfig(activeProvider)
      const result = response.data?.result
      const config = response.data?.config
      if (config) setConfigs((current) => ({ ...current, [activeProvider]: config }))
      onNotice(result?.ok ? `${PROVIDERS[activeProvider].label}配置校验通过` : '配置校验未通过')
    } catch (requestError) {
      setError(requestError.message || '支付通道验证失败')
    } finally {
      setBusy('')
    }
  }

  async function toggleProvider() {
    const enabled = !activeConfig.enabled
    const action = `toggle-${activeProvider}`
    setBusy(action)
    setError('')
    try {
      const response = await api.setAdminPaymentConfigEnabled(activeProvider, enabled)
      const config = response.data?.config
      setConfigs((current) => ({ ...current, [activeProvider]: config }))
      onNotice(`${PROVIDERS[activeProvider].label}已${enabled ? '启用' : '停用'}`)
    } catch (requestError) {
      setError(requestError.message || '支付通道状态更新失败')
    } finally {
      setBusy('')
    }
  }

  const configuredCount = Object.values(configs).filter((config) => config.configured).length
  const enabledCount = Object.values(configs).filter((config) => config.enabled).length

  return (
    <div className="admin-payment-page">
      <CommercePageHeader title="支付通道" description="仅管理微信支付和支付宝正式商户配置；回调地址由当前部署域名自动生成" loading={loading} busy={busy} onRefresh={reload} />
      <CommerceError error={error} onClose={() => setError('')} />

      <section className="admin-payment-safety" aria-label="支付安全说明">
        <ShieldCheck size={23} />
        <div><b>正式支付配置</b><p>支付宝固定使用正式环境，不显示无效的环境选项；密钥保存后立即从浏览器清空，后台不会回显原文。</p></div>
        <span>正式环境</span>
      </section>

      <div className="admin-payment-summary admin-payment-summary-two">
        <SummaryCard icon={<KeyRound size={20} />} label="已配置通道" value={`${configuredCount} / 2`} hint="凭据完整且已加密保存" />
        <SummaryCard icon={<BadgeCheck size={20} />} label="已启用通道" value={enabledCount} hint="用户当前可选择的支付方式" tone="success" />
      </div>

      <section className="admin-panel admin-payment-config-panel">
        <header className="admin-payment-config-header">
          <div><h2>支付通道配置</h2><p>选择通道后填写对应商户资料，两个通道的表单和密钥互不混用。</p></div>
          <div className="admin-payment-tabs" role="tablist" aria-label="支付通道">
            {Object.entries(PROVIDERS).map(([provider, info]) => (
              <button key={provider} type="button" role="tab" aria-selected={activeProvider === provider} className={activeProvider === provider ? 'active' : ''} onClick={() => setActiveProvider(provider)}>
                <ProviderGlyph provider={provider} />
                <span>{info.label}<small>{info.description}</small></span>
                <i className={configs[provider]?.enabled ? 'enabled' : ''}>{configs[provider]?.enabled ? '已启用' : configs[provider]?.configured ? '已保存' : '未配置'}</i>
              </button>
            ))}
          </div>
        </header>

        <form className="admin-payment-form" onSubmit={saveProvider} aria-busy={Boolean(busy)}>
          <div className="admin-payment-form-title">
            <div className={`admin-payment-provider-icon ${PROVIDERS[activeProvider].colorClass}`}><ProviderGlyph provider={activeProvider} /></div>
            <div><h3>{PROVIDERS[activeProvider].label}</h3><p>{PROVIDERS[activeProvider].description}</p></div>
            <ConfigStatus config={activeConfig} />
          </div>
          {loading ? <InlineLoading label="正在读取通道配置…" /> : activeProvider === 'wechat'
            ? <WechatFields form={activeForm} config={activeConfig} updateField={updateField} />
            : <AlipayFields form={activeForm} config={activeConfig} updateField={updateField} />}
          <footer className="admin-payment-form-actions">
            <div>
              <button className="admin-button admin-button-primary" type="submit" disabled={Boolean(busy) || loading}>{busy === `save-${activeProvider}` ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}保存配置</button>
              <button className="admin-button admin-button-secondary" type="button" onClick={testProvider} disabled={Boolean(busy) || !activeConfig.configured}>{busy === `test-${activeProvider}` ? <LoaderCircle className="spin" size={17} /> : <BadgeCheck size={17} />}验证配置</button>
            </div>
            <label className={`admin-payment-switch ${activeConfig.enabled ? 'on' : ''}`}>
              <span><b>{activeConfig.enabled ? '通道已启用' : '通道未启用'}</b><small>启用前必须通过服务端配置校验</small></span>
              <button type="button" role="switch" aria-checked={activeConfig.enabled} onClick={toggleProvider} disabled={Boolean(busy) || !activeConfig.configured}><i /></button>
            </label>
          </footer>
        </form>
      </section>
    </div>
  )
}

export function MembershipPlansPage({ onNotice = () => {} }) {
  const [plans, setPlans] = useState([])
  const [forms, setForms] = useState({})
  const [creating, setCreating] = useState(false)
  const [newForm, setNewForm] = useState(() => ({ ...EMPTY_PLAN_FORM }))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const response = await api.getAdminPaymentPlans()
      const nextPlans = Array.isArray(response.data?.plans) ? response.data.plans : []
      setPlans(nextPlans)
      setForms(Object.fromEntries(nextPlans.map((plan) => [plan.planId, planToForm(plan)])))
    } catch (requestError) {
      setError(requestError.message || '套餐目录读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  function updatePlanField(planId, field, value) {
    setForms((current) => ({ ...current, [planId]: { ...current[planId], [field]: value } }))
  }

  async function savePlan(event, plan) {
    event.preventDefault()
    const form = forms[plan.planId]
    const action = `plan-${plan.planId}`
    setBusy(action)
    setError('')
    try {
      const response = await api.saveAdminPaymentPlan(plan.planId, buildPlanPayload(form, plan))
      const saved = response.data?.plan
      setPlans((current) => current.map((item) => item.planId === saved.planId ? saved : item))
      setForms((current) => ({ ...current, [saved.planId]: planToForm(saved) }))
      onNotice(`${saved.name}已保存`)
    } catch (requestError) {
      setError(requestError.message || '套餐保存失败')
    } finally {
      setBusy('')
    }
  }

  async function createPlan(event) {
    event.preventDefault()
    const planId = newForm.planId.trim()
    if (plans.some((plan) => plan.planId === planId)) {
      setError('套餐标识已存在，请换一个唯一标识')
      return
    }
    setBusy('plan-create')
    setError('')
    try {
      const response = await api.saveAdminPaymentPlan(planId, buildPlanPayload(newForm))
      const saved = response.data?.plan
      setPlans((current) => [...current, saved])
      setForms((current) => ({ ...current, [saved.planId]: planToForm(saved) }))
      cancelCreatePlan()
      onNotice(`${saved.name}已添加到套餐目录`)
    } catch (requestError) {
      setError(requestError.message || '套餐创建失败')
    } finally {
      setBusy('')
    }
  }

  function cancelCreatePlan() {
    setNewForm({ ...EMPTY_PLAN_FORM })
    setCreating(false)
    setError('')
  }

  async function archivePlan(plan) {
    if (plan.kind === 'free') return
    if (!window.confirm(`确认归档“${plan.name}”吗？归档后用户端将不再展示，已有订单和会员权益不会受影响。`)) return
    const action = `delete-plan-${plan.planId}`
    setBusy(action)
    setError('')
    try {
      await api.deleteAdminPaymentPlan(plan.planId)
      setPlans((current) => current.filter((item) => item.planId !== plan.planId))
      setForms((current) => { const next = { ...current }; delete next[plan.planId]; return next })
      onNotice(`${plan.name}已归档`)
    } catch (requestError) {
      setError(requestError.message || '套餐归档失败')
    } finally {
      setBusy('')
    }
  }

  const freeCount = plans.filter((plan) => plan.kind === 'free').length
  const saleableCount = plans.filter((plan) => plan.saleable && !plan.archivedAt).length

  return (
    <div className="admin-payment-page">
      <CommercePageHeader title="套餐设置" description="编辑免费版与付费套餐的价格、额度、有效期和前端展示权益" loading={loading} busy={busy} onRefresh={reload}>
        {!creating ? <button className="admin-button admin-button-primary" type="button" onClick={() => setCreating(true)}><Plus size={16} />添加付费套餐</button> : null}
      </CommercePageHeader>
      <CommerceError error={error} onClose={() => setError('')} />

      <div className="admin-payment-summary admin-payment-summary-three">
        <SummaryCard icon={<PackageCheck size={20} />} label="套餐总数" value={plans.length} hint="包含免费版与全部付费周期" />
        <SummaryCard icon={<CheckCircle2 size={20} />} label="前端展示" value={saleableCount} hint="当前用户可看到的套餐" tone="success" />
        <SummaryCard icon={<CreditCard size={20} />} label="免费基础版" value={freeCount} hint="可编辑权益，不参与支付" />
      </div>

      <section className="admin-panel admin-membership-catalog-panel">
        <header className="admin-payment-orders-header">
          <div><h2>会员套餐目录</h2><p>套餐调整只影响后续注册和下单，已创建订单保留下单时的权益快照。</p></div>
          <span className="admin-membership-catalog-count">{saleableCount} 个展示中</span>
        </header>
        <div className="admin-membership-catalog-grid">
          {creating ? <PlanForm form={newForm} onChange={(field, value) => setNewForm((current) => ({ ...current, [field]: value }))} onSubmit={createPlan} onCancel={cancelCreatePlan} busy={busy === 'plan-create'} isNew /> : null}
          {plans.map((plan) => (
            <PlanForm
              key={plan.planId}
              form={forms[plan.planId] || planToForm(plan)}
              plan={plan}
              onChange={(field, value) => updatePlanField(plan.planId, field, value)}
              onSubmit={(event) => savePlan(event, plan)}
              onArchive={() => archivePlan(plan)}
              busy={busy === `plan-${plan.planId}` || busy === `delete-plan-${plan.planId}`}
            />
          ))}
          {loading ? <InlineLoading label="正在读取套餐目录…" /> : null}
          {!loading && !plans.length && !creating ? <CommerceEmpty icon={<PackageCheck size={28} />} title="暂无套餐" description="点击“添加付费套餐”创建第一个在售套餐。" /> : null}
        </div>
      </section>
    </div>
  )
}

export function PromotionsPage({ onNotice = () => {} }) {
  const [promotions, setPromotions] = useState([])
  const [plans, setPlans] = useState([])
  const [forms, setForms] = useState({})
  const [creating, setCreating] = useState(false)
  const [newForm, setNewForm] = useState(() => ({ ...EMPTY_PROMOTION_FORM }))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [promotionResponse, planResponse] = await Promise.all([api.getAdminPromotions(), api.getAdminPaymentPlans()])
      const nextPromotions = promotionResponse.data?.promotions || promotionResponse.data?.items || []
      const nextPlans = planResponse.data?.plans || []
      setPromotions(Array.isArray(nextPromotions) ? nextPromotions : [])
      setPlans(Array.isArray(nextPlans) ? nextPlans.filter((plan) => plan.kind !== 'free' && !plan.archivedAt) : [])
      setForms(Object.fromEntries((nextPromotions || []).map((promotion) => [promotionIdOf(promotion), promotionToForm(promotion)])))
    } catch (requestError) {
      setError(requestError.message || '优惠活动读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  function updatePromotionField(id, field, value) {
    setForms((current) => ({ ...current, [id]: { ...current[id], [field]: value } }))
  }

  async function createPromotion(event) {
    event.preventDefault()
    setBusy('promotion-create')
    setError('')
    try {
      const response = await api.createAdminPromotion(buildPromotionPayload(newForm))
      const saved = promotionFromResponse(response)
      setPromotions((current) => [saved, ...current])
      setForms((current) => ({ ...current, [promotionIdOf(saved)]: promotionToForm(saved) }))
      setNewForm({ ...EMPTY_PROMOTION_FORM })
      setCreating(false)
      onNotice(`${saved.name || saved.label || '优惠活动'}已创建`)
    } catch (requestError) {
      setError(requestError.message || '优惠活动创建失败')
    } finally {
      setBusy('')
    }
  }

  async function savePromotion(event, promotion) {
    event.preventDefault()
    const id = promotionIdOf(promotion)
    setBusy(`promotion-${id}`)
    setError('')
    try {
      const response = await api.updateAdminPromotion(id, buildPromotionPayload(forms[id], promotion))
      const saved = promotionFromResponse(response)
      setPromotions((current) => current.map((item) => promotionIdOf(item) === id ? saved : item))
      setForms((current) => ({ ...current, [promotionIdOf(saved)]: promotionToForm(saved) }))
      onNotice(`${saved.name || saved.label || '优惠活动'}已保存`)
    } catch (requestError) {
      setError(requestError.message || '优惠活动保存失败')
    } finally {
      setBusy('')
    }
  }

  async function deletePromotion(promotion) {
    const id = promotionIdOf(promotion)
    const name = promotion.name || promotion.label || '该活动'
    if (!window.confirm(`确认删除“${name}”吗？删除后优惠将立即停止，操作不可撤销。`)) return
    setBusy(`delete-promotion-${id}`)
    setError('')
    try {
      await api.deleteAdminPromotion(id)
      setPromotions((current) => current.filter((item) => promotionIdOf(item) !== id))
      setForms((current) => { const next = { ...current }; delete next[id]; return next })
      onNotice(`${name}已删除`)
    } catch (requestError) {
      setError(requestError.message || '优惠活动删除失败')
    } finally {
      setBusy('')
    }
  }

  const enabledCount = promotions.filter((promotion) => promotion.enabled).length
  const activeCount = promotions.filter(isPromotionActive).length

  return (
    <div className="admin-payment-page">
      <CommercePageHeader title="优惠活动" description="创建庆祝活动，设置折扣比例、目标套餐、生效时间和前端活动文案" loading={loading} busy={busy} onRefresh={reload}>
        {!creating ? <button className="admin-button admin-button-primary" type="button" onClick={() => setCreating(true)}><Plus size={16} />添加优惠活动</button> : null}
      </CommercePageHeader>
      <CommerceError error={error} onClose={() => setError('')} />

      <div className="admin-payment-summary admin-payment-summary-three">
        <SummaryCard icon={<BadgePercent size={20} />} label="优惠活动" value={promotions.length} hint="已创建的全部活动" />
        <SummaryCard icon={<CheckCircle2 size={20} />} label="已启用" value={enabledCount} hint="允许按设置时间自动生效" tone="success" />
        <SummaryCard icon={<CalendarDays size={20} />} label="当前生效" value={activeCount} hint="此刻正在执行的活动" />
      </div>

      <section className="admin-panel admin-promotion-panel">
        <header className="admin-payment-orders-header"><div><h2>活动列表</h2><p>折扣在开始与结束时间之间自动生效；目标套餐可以多选。</p></div></header>
        <div className="admin-promotion-grid">
          {creating ? <PromotionForm form={newForm} plans={plans} onChange={(field, value) => setNewForm((current) => ({ ...current, [field]: value }))} onSubmit={createPromotion} onCancel={() => { setCreating(false); setNewForm({ ...EMPTY_PROMOTION_FORM }); setError('') }} busy={busy === 'promotion-create'} isNew /> : null}
          {promotions.map((promotion) => {
            const id = promotionIdOf(promotion)
            return <PromotionForm key={id} form={forms[id] || promotionToForm(promotion)} promotion={promotion} plans={plans} onChange={(field, value) => updatePromotionField(id, field, value)} onSubmit={(event) => savePromotion(event, promotion)} onDelete={() => deletePromotion(promotion)} busy={busy === `promotion-${id}` || busy === `delete-promotion-${id}`} />
          })}
          {loading ? <InlineLoading label="正在读取优惠活动…" /> : null}
          {!loading && !promotions.length && !creating ? <CommerceEmpty icon={<Tag size={28} />} title="暂无优惠活动" description="点击“添加优惠活动”创建开学季、教师节或其他庆祝优惠。" /> : null}
        </div>
      </section>
    </div>
  )
}

export function OrdersPage({ query = '' }) {
  const [orders, setOrders] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit, setLimit] = useState(25)
  const [provider, setProvider] = useState('')
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => { setOffset(0) }, [provider, status, query])

  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError('')
      try {
        const response = await api.getAdminPaymentOrders({ provider, status, offset, limit, query })
        if (!active) return
        const data = response.data || {}
        setOrders(Array.isArray(data.items) ? data.items : [])
        setTotal(Number(data.total || 0))
      } catch (requestError) {
        if (active) setError(requestError.message || '订单列表读取失败')
      } finally {
        if (active) setLoading(false)
      }
    }, query ? 250 : 0)
    return () => { active = false; window.clearTimeout(timer) }
  }, [provider, status, offset, limit, query, refreshToken])

  const page = Math.floor(offset / limit) + 1
  const pageCount = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="admin-payment-page">
      <CommercePageHeader title="订单管理" description="实时查看用户支付订单、订购套餐、支付状态以及失败原因" loading={loading} onRefresh={() => setRefreshToken((value) => value + 1)} />
      <CommerceError error={error} onClose={() => setError('')} />

      <section className="admin-panel admin-payment-orders-panel">
        <header className="admin-payment-orders-header">
          <div><h2>支付订单</h2><p>共 {total} 笔订单；顶部搜索框可筛选用户、手机号、邮箱、订单号或套餐。</p></div>
          <div className="admin-payment-filters">
            <label><span>支付通道</span><select value={provider} onChange={(event) => setProvider(event.target.value)}><option value="">全部通道</option><option value="wechat">微信支付</option><option value="alipay">支付宝</option></select></label>
            <label><span>订单状态</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
        </header>

        <div className="admin-payment-table-wrap">
          <table className="admin-payment-table admin-order-table">
            <thead><tr><th>订单号</th><th>用户信息</th><th>订购套餐</th><th>支付方式</th><th>金额</th><th>状态</th><th>失败原因</th><th>时间</th></tr></thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id || order.merchantOrderNo}>
                  <td><b>{order.merchantOrderNo || order.id}</b><small>{order.providerTradeNo || order.id}</small></td>
                  <td><b>{orderUserPrimary(order)}</b><small>{orderUserSecondary(order)}</small></td>
                  <td><b>{order.planName || order.snapshot?.name || order.subject || '会员套餐'}</b><small>{order.planId || order.snapshot?.planId || '—'}</small></td>
                  <td><span className={`admin-payment-provider-chip ${order.provider}`}><ProviderGlyph provider={order.provider} />{PROVIDERS[order.provider]?.shortLabel || order.provider || '—'}</span></td>
                  <td><b>¥{formatAmount(order.amountCents)}</b><small>{order.currency || 'CNY'}</small></td>
                  <td><OrderStatus order={order} /></td>
                  <td><span className={orderFailureReason(order) === '—' ? 'admin-order-reason-muted' : 'admin-order-reason'} title={orderFailureReason(order)}>{orderFailureReason(order)}</span></td>
                  <td><b>{formatDate(order.createdAt)}</b><small>更新于 {formatDate(order.updatedAt, true)}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !orders.length ? <CommerceEmpty icon={<CreditCard size={28} />} title="暂无符合条件的订单" description="用户发起真实支付后，订单会显示在这里。" /> : null}
          {loading ? <div className="admin-payment-loading"><LoaderCircle className="spin" size={24} />正在读取订单…</div> : null}
        </div>
        <footer className="admin-table-footer admin-order-pagination">
          <span>共 {total} 笔，第 {page} / {pageCount} 页</span>
          <div className="admin-pagination" aria-label="订单分页">
            <button type="button" aria-label="上一页" disabled={loading || page <= 1} onClick={() => setOffset(Math.max(0, offset - limit))}><ChevronLeft size={15} /></button>
            <button type="button" className="admin-page-current" aria-current="page" disabled>{page}</button>
            <button type="button" aria-label="下一页" disabled={loading || page >= pageCount} onClick={() => setOffset(offset + limit)}><ChevronRight size={15} /></button>
          </div>
          <select aria-label="每页订单数" value={limit} disabled={loading} onChange={(event) => { setLimit(Number(event.target.value)); setOffset(0) }}><option value="10">10 条 / 页</option><option value="25">25 条 / 页</option><option value="50">50 条 / 页</option></select>
        </footer>
      </section>
    </div>
  )
}

function PlanForm({ form, plan, onChange, onSubmit, onCancel, onArchive, busy, isNew = false }) {
  const isFree = !isNew && (plan?.kind === 'free' || form.kind === 'free')
  return (
    <form className={`admin-membership-plan-form ${isNew ? 'admin-membership-new-plan' : ''} ${isFree ? 'admin-membership-free-plan' : ''}`} onSubmit={onSubmit} aria-busy={busy}>
      <header>
        <div><b>{isNew ? '新增付费套餐' : form.name || plan?.name}</b><small>{isNew ? '套餐标识创建后不可修改' : `${isFree ? '免费基础权益' : PERIOD_LABELS[form.billingPeriod] || form.billingPeriod} · ${plan?.planId}`}</small></div>
        <label><input type="checkbox" checked={Boolean(form.saleable)} onChange={(event) => onChange('saleable', event.target.checked)} /><span>前端展示</span></label>
      </header>
      <div className="admin-membership-plan-fields">
        {isNew ? <TextField label="套餐标识" value={form.planId} onChange={(value) => onChange('planId', value)} placeholder="例如 pro-quarter-2026" pattern="[A-Za-z0-9_.:-]{2,80}" required /> : null}
        <TextField label="套餐名称" value={form.name} onChange={(value) => onChange('name', value)} required />
        <TextField label="会员等级标识" value={form.tier} onChange={(value) => onChange('tier', value)} placeholder={isFree ? 'free' : 'pro'} required />
        <TextField label="等级权重" value={form.tierRank} onChange={(value) => onChange('tierRank', value)} type="number" min={isFree ? '0' : '1'} max="10000" required />
        {isFree ? <TextField label="套餐价格" value="0.00" onChange={() => {}} readOnly /> : <>
          <label className="admin-payment-field"><span>付费周期</span><select value={form.billingPeriod} onChange={(event) => onChange('billingPeriod', event.target.value)}>{Object.entries(PERIOD_LABELS).filter(([value]) => value !== 'free').map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <TextField label="售价（元）" value={form.price} onChange={(value) => onChange('price', value)} type="number" min="0.01" step="0.01" required />
        </>}
        <TextField label={isFree ? '注册赠送额度' : '发放额度'} value={form.credits} onChange={(value) => onChange('credits', value)} type="number" min="0" step="1" required />
        {isFree ? <TextField label="有效期" value="长期有效" onChange={() => {}} readOnly /> : <TextField label="有效天数" value={form.durationDays} onChange={(value) => onChange('durationDays', value)} type="number" min="1" max="3660" required />}
      </div>
      <label className="admin-membership-feature-field"><span>前端展示权益（每行一项）</span><textarea value={form.features} onChange={(event) => onChange('features', event.target.value)} required /></label>
      <footer>
        <small>{isFree ? '免费版不可删除，但名称、额度和权益内容均可编辑。' : '归档后不影响已支付订单和已发放权益。'}</small>
        <div className="admin-commerce-form-actions">
          {isNew ? <button className="admin-button admin-button-secondary" type="button" onClick={onCancel} disabled={busy}><X size={16} />取消</button> : !isFree ? <button className="admin-button admin-button-danger" type="button" onClick={onArchive} disabled={busy}><Trash2 size={16} />归档套餐</button> : null}
          <button className="admin-button admin-button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{isNew ? '确认添加' : '保存套餐'}</button>
        </div>
      </footer>
    </form>
  )
}

function PromotionForm({ form, promotion, plans, onChange, onSubmit, onCancel, onDelete, busy, isNew = false }) {
  const id = promotion ? promotionIdOf(promotion) : 'new'
  const togglePlan = (planId) => {
    const selected = new Set(form.targetPlanIds || [])
    if (selected.has(planId)) selected.delete(planId)
    else selected.add(planId)
    onChange('targetPlanIds', [...selected])
  }
  return (
    <form className={`admin-promotion-form ${isNew ? 'admin-promotion-new' : ''}`} onSubmit={onSubmit} aria-busy={busy}>
      <header>
        <div><b>{isNew ? '新增优惠活动' : form.name}</b><small>{isNew ? '填写活动规则并选择目标套餐' : `${CELEBRATION_TEMPLATES[form.template] || '自定义活动'} · ${id}`}</small></div>
        <label className="admin-promotion-enabled"><input type="checkbox" checked={Boolean(form.enabled)} onChange={(event) => onChange('enabled', event.target.checked)} /><span>启用活动</span></label>
      </header>
      <div className="admin-promotion-fields">
        <TextField label="活动名称" value={form.name} onChange={(value) => onChange('name', value)} placeholder="例如：教师节感恩优惠" required />
        <label className="admin-payment-field"><span>庆祝模板</span><select value={form.template} onChange={(event) => onChange('template', event.target.value)}>{Object.entries(CELEBRATION_TEMPLATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <TextField label="优惠折扣（%）" value={form.discountPercent} onChange={(value) => onChange('discountPercent', value)} type="number" min="1" max="99" step="1" required />
        <TextField label="开始时间" value={form.startsAt} onChange={(value) => onChange('startsAt', value)} type="datetime-local" required />
        <TextField label="结束时间" value={form.endsAt} onChange={(value) => onChange('endsAt', value)} type="datetime-local" required />
      </div>
      <label className="admin-membership-feature-field"><span>活动弹窗文案</span><textarea value={form.content} onChange={(event) => onChange('content', event.target.value)} placeholder="填写用户端可见的活动说明" required /></label>
      <fieldset className="admin-promotion-targets">
        <legend>目标套餐</legend>
        {plans.map((plan) => <label key={plan.planId}><input type="checkbox" checked={(form.targetPlanIds || []).includes(plan.planId)} onChange={() => togglePlan(plan.planId)} /><span><b>{plan.name}</b><small>{PERIOD_LABELS[plan.billingPeriod] || plan.billingPeriod} · ¥{formatAmount(plan.regularAmountCents ?? plan.amountCents)}</small></span></label>)}
        {!plans.length ? <p>暂无可选择的付费套餐，请先在“套餐设置”中添加。</p> : null}
      </fieldset>
      <footer>
        <small>{isPromotionActive(promotion || form) ? '活动当前正在生效' : form.enabled ? '活动将按设定时间自动生效' : '活动当前停用'}</small>
        <div className="admin-commerce-form-actions">
          {isNew ? <button className="admin-button admin-button-secondary" type="button" onClick={onCancel} disabled={busy}><X size={16} />取消</button> : <button className="admin-button admin-button-danger" type="button" onClick={onDelete} disabled={busy}><Trash2 size={16} />删除活动</button>}
          <button className="admin-button admin-button-primary" type="submit" disabled={busy || !plans.length}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{isNew ? '创建活动' : '保存活动'}</button>
        </div>
      </footer>
    </form>
  )
}

function CommercePageHeader({ title, description, loading, busy, onRefresh, children }) {
  return (
    <div className="admin-page-heading admin-payment-heading">
      <div><h1>{title}</h1><p>{description}</p></div>
      <div className="admin-page-actions">
        {children}
        <button className="admin-button admin-button-secondary" type="button" onClick={onRefresh} disabled={loading || Boolean(busy)}><RefreshCw size={17} className={loading ? 'spin' : ''} />刷新数据</button>
      </div>
    </div>
  )
}

function CommerceError({ error, onClose }) {
  return error ? <div className="admin-payment-error" role="alert"><AlertTriangle size={18} /><span>{error}</span><button type="button" onClick={onClose} aria-label="关闭错误提示"><X size={16} /></button></div> : null
}

function CommerceEmpty({ icon, title, description }) {
  return <div className="admin-payment-empty">{icon}<b>{title}</b><span>{description}</span></div>
}

function InlineLoading({ label }) {
  return <div className="admin-commerce-inline-loading"><LoaderCircle className="spin" size={22} /><span>{label}</span></div>
}

function SummaryCard({ icon, label, value, hint, tone = '' }) {
  return <div className={`admin-payment-summary-card ${tone}`}><span>{icon}</span><div><small>{label}</small><b>{value}</b><p>{hint}</p></div></div>
}

function ProviderGlyph({ provider }) {
  return provider === 'wechat' ? <WalletCards size={20} /> : <CreditCard size={20} />
}

function ConfigStatus({ config }) {
  if (!config.configured) return <span className="admin-payment-config-status">未配置</span>
  if (!config.validation?.ok) return <span className="admin-payment-config-status invalid"><AlertTriangle size={14} />校验失败</span>
  return <span className="admin-payment-config-status valid"><CheckCircle2 size={14} />配置有效</span>
}

function WechatFields({ form, config, updateField }) {
  return <div className="admin-payment-field-grid">
    <TextField label="显示名称" value={form.displayName} onChange={(value) => updateField('displayName', value)} />
    <TextField label="应用 AppID" value={form.appId} onChange={(value) => updateField('appId', value)} placeholder="wx..." required />
    <TextField label="微信支付商户号" value={form.merchantId} onChange={(value) => updateField('merchantId', value)} placeholder="纯数字商户号" required />
    <TextField label="商户 API 证书序列号" value={form.merchantCertificateSerial} onChange={(value) => updateField('merchantCertificateSerial', value)} required />
    <TextField label="微信支付公钥 ID / 平台证书序列号" value={form.verifierSerial} onChange={(value) => updateField('verifierSerial', value)} placeholder="PUB_KEY_ID_... 或证书序列号" required wide />
    <TextField label="异步通知地址（自动生成）" value={form.notifyUrl} onChange={() => {}} placeholder="保存后由部署域名自动生成" type="url" readOnly wide />
    <SecretArea label="商户 API 私钥" value={form.merchantPrivateKeyPem} onChange={(value) => updateField('merchantPrivateKeyPem', value)} configured={config.credentials?.merchantPrivateKeyPem} hint={config.credentialHints?.merchantPrivateKeyPem} placeholder="-----BEGIN PRIVATE KEY-----" required={!config.credentials?.merchantPrivateKeyPem} />
    <SecretArea label="微信支付公钥 / 平台证书公钥" value={form.verifierPublicKeyPem} onChange={(value) => updateField('verifierPublicKeyPem', value)} configured={config.credentials?.verifierPublicKeyPem} hint={config.credentialHints?.verifierPublicKeyPem} placeholder="-----BEGIN PUBLIC KEY-----" required={!config.credentials?.verifierPublicKeyPem} />
    <TextField label="API v3 密钥" value={form.apiV3Key} onChange={(value) => updateField('apiV3Key', value)} placeholder={config.credentials?.apiV3Key ? `${config.credentialHints?.apiV3Key || '已加密保存'}，留空不更新` : '必须正好 32 字节'} type="password" autoComplete="new-password" required={!config.credentials?.apiV3Key} wide />
  </div>
}

function AlipayFields({ form, config, updateField }) {
  return <div className="admin-payment-field-grid">
    <TextField label="显示名称" value={form.displayName} onChange={(value) => updateField('displayName', value)} />
    <TextField label="应用 AppID" value={form.appId} onChange={(value) => updateField('appId', value)} placeholder="支付宝开放平台 AppID" required />
    <TextField label="卖家 ID（seller_id）" value={form.sellerId} onChange={(value) => updateField('sellerId', value)} placeholder="签约支付宝账号 PID" required />
    <TextField label="异步通知地址（自动生成）" value={form.notifyUrl} onChange={() => {}} placeholder="保存后由部署域名自动生成" type="url" readOnly wide />
    <TextField label="支付完成返回地址（自动生成）" value={form.returnUrl} onChange={() => {}} placeholder="保存后由部署域名自动生成" type="url" readOnly wide />
    <SecretArea label="应用私钥" value={form.appPrivateKeyPem} onChange={(value) => updateField('appPrivateKeyPem', value)} configured={config.credentials?.appPrivateKeyPem} hint={config.credentialHints?.appPrivateKeyPem} placeholder="-----BEGIN PRIVATE KEY-----" required={!config.credentials?.appPrivateKeyPem} />
    <SecretArea label="支付宝公钥" value={form.alipayPublicKeyPem} onChange={(value) => updateField('alipayPublicKeyPem', value)} configured={config.credentials?.alipayPublicKeyPem} hint={config.credentialHints?.alipayPublicKeyPem} placeholder="-----BEGIN PUBLIC KEY-----" required={!config.credentials?.alipayPublicKeyPem} />
  </div>
}

function TextField({ label, value, onChange, wide = false, ...inputProps }) {
  return <label className={`admin-payment-field ${wide ? 'wide' : ''}`}><span>{label}</span><input value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...inputProps} /></label>
}

function SecretArea({ label, value, onChange, configured, hint, ...textareaProps }) {
  return <label className="admin-payment-field admin-payment-secret">
    <span>{label}{configured ? <i><KeyRound size={12} />{hint || '已加密保存'}</i> : null}</span>
    <textarea {...textareaProps} value={value || ''} onChange={(event) => onChange(event.target.value)} autoComplete="off" placeholder={configured ? '已加密保存，留空表示不更新' : textareaProps.placeholder} />
  </label>
}

function OrderStatus({ order }) {
  const fulfillmentPending = order.status === 'PAID' && order.fulfillment?.status && order.fulfillment.status !== 'FULFILLED'
  const label = order.gatewayUnknown ? '待核实' : fulfillmentPending ? '已支付 · 权益待处理' : STATUS_LABELS[order.status] || order.status || '未知'
  const className = order.gatewayUnknown || fulfillmentPending ? 'unknown' : String(order.status || '').toLowerCase()
  return <span className={`admin-payment-order-status ${className}`}>{label}</span>
}

function clonePaymentForms() {
  return Object.fromEntries(Object.entries(EMPTY_PAYMENT_FORMS).map(([provider, fields]) => [provider, { ...fields }]))
}

function mergePaymentConfigs(current, configs) {
  const next = { ...current }
  for (const [provider, config] of Object.entries(configs || {})) {
    if (!EMPTY_PAYMENT_FORMS[provider] || !config) continue
    const publicFields = Object.keys(EMPTY_PAYMENT_FORMS[provider]).filter((field) => !isSecretField(provider, field))
    next[provider] = {
      ...current[provider],
      ...Object.fromEntries(publicFields.map((field) => [field, config[field] ?? current[provider]?.[field] ?? EMPTY_PAYMENT_FORMS[provider][field]])),
      ...Object.fromEntries(Object.keys(EMPTY_PAYMENT_FORMS[provider]).filter((field) => isSecretField(provider, field)).map((field) => [field, ''])),
    }
  }
  return next
}

function omitBlankSecrets(provider, form) {
  return Object.fromEntries(Object.entries(form).filter(([field, value]) => !isSecretField(provider, field) || String(value || '').trim()))
}

function isSecretField(provider, field) {
  return provider === 'wechat' ? ['merchantPrivateKeyPem', 'apiV3Key', 'verifierPublicKeyPem'].includes(field) : ['appPrivateKeyPem', 'alipayPublicKeyPem'].includes(field)
}

function emptyPublicConfig(provider) {
  return { provider, configured: false, enabled: false, validation: { ok: false }, credentials: {}, credentialHints: {} }
}

function planToForm(plan) {
  return {
    planId: plan.planId || '', name: plan.name || '', kind: plan.kind || 'paid', tier: plan.tier || 'pro', tierRank: String(Number(plan.tierRank || 0)),
    billingPeriod: plan.billingPeriod || (plan.kind === 'free' ? 'free' : 'month'),
    price: (Number(plan.regularAmountCents ?? plan.amountCents ?? 0) / 100).toFixed(2), credits: String(Number(plan.credits || 0)),
    durationDays: String(Number(plan.durationDays || 0)), features: Array.isArray(plan.features) ? plan.features.join('\n') : '', saleable: Boolean(plan.saleable),
  }
}

function buildPlanPayload(form, existingPlan = null) {
  const isFree = (existingPlan?.kind || form.kind) === 'free'
  const features = String(form.features || '').split('\n').map((item) => item.trim()).filter(Boolean)
  if (!features.length) throw new Error('请至少填写一项套餐权益')
  return {
    ...(existingPlan?.updatedAt ? { expectedUpdatedAt: existingPlan.updatedAt } : {}),
    kind: isFree ? 'free' : 'paid', name: String(form.name || '').trim(), tier: String(form.tier || '').trim(),
    tierRank: Number(form.tierRank), billingPeriod: isFree ? 'free' : form.billingPeriod,
    amountCents: isFree ? 0 : yuanToCents(form.price), credits: Number(form.credits), durationDays: isFree ? 0 : Number(form.durationDays),
    saleable: Boolean(form.saleable), features,
  }
}

function promotionIdOf(promotion) {
  return String(promotion?.promotionId || promotion?.id || '')
}

function promotionToForm(promotion) {
  return {
    name: promotion.name || promotion.label || promotion.title || '', template: promotion.template || promotion.celebrationTemplate || 'custom',
    content: promotion.content || promotion.message || promotion.description || '', discountPercent: String(Number(promotion.discountPercent || promotion.discount || 0)),
    targetPlanIds: Array.isArray(promotion.targetPlanIds) ? promotion.targetPlanIds : Array.isArray(promotion.planIds) ? promotion.planIds : [],
    startsAt: isoToLocalDateTime(promotion.startsAt), endsAt: isoToLocalDateTime(promotion.endsAt), enabled: promotion.enabled !== false,
  }
}

function buildPromotionPayload(form, existing = null) {
  const startsAt = localDateTimeToIso(form.startsAt)
  const endsAt = localDateTimeToIso(form.endsAt)
  if (new Date(startsAt) >= new Date(endsAt)) throw new Error('优惠结束时间必须晚于开始时间')
  const discountPercent = Number(form.discountPercent)
  if (!Number.isFinite(discountPercent) || discountPercent < 1 || discountPercent > 99) throw new Error('优惠折扣必须是 1%-99%')
  if (!Array.isArray(form.targetPlanIds) || !form.targetPlanIds.length) throw new Error('请至少选择一个目标套餐')
  return {
    ...(existing?.updatedAt ? { expectedUpdatedAt: existing.updatedAt } : {}),
    name: String(form.name || '').trim(), label: String(form.name || '').trim(), template: form.template,
    content: String(form.content || '').trim(), discountPercent, targetPlanIds: form.targetPlanIds, startsAt, endsAt, enabled: Boolean(form.enabled),
  }
}

function promotionFromResponse(response) {
  return response.data?.promotion || response.data?.item || response.data
}

function isPromotionActive(promotion) {
  if (!promotion || promotion.enabled === false) return false
  const now = Date.now()
  const startsAt = new Date(promotion.startsAt || promotion.promotionStartsAt || 0).getTime()
  const endsAt = new Date(promotion.endsAt || promotion.promotionEndsAt || 0).getTime()
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= now && now < endsAt
}

function orderUserPrimary(order) {
  return order.user?.name || order.user?.displayName || order.userName || order.userIdentifier || order.user?.account || order.user?.email || order.user?.phone || order.userId || '—'
}

function orderUserSecondary(order) {
  const values = [order.user?.account, order.user?.phone || order.phone, order.user?.email || order.email, order.userId].filter(Boolean)
  return [...new Set(values)].join(' · ') || '未记录联系方式'
}

function orderFailureReason(order) {
  const reason = order.failureReason || order.failure?.message || order.error?.message || order.lastError || order.statusReason
  if (reason) return String(reason)
  return order.status === 'FAILED' ? '支付网关未返回具体原因' : '—'
}

function yuanToCents(value) {
  const text = String(value ?? '').trim()
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(text)) throw new Error('价格必须是最多两位小数的人民币金额')
  const [yuan, fraction = ''] = text.split('.')
  const cents = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents < 1) throw new Error('价格必须大于 0 元')
  return cents
}

function isoToLocalDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function localDateTimeToIso(value) {
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) throw new Error('请填写有效的活动开始和结束时间')
  return date.toISOString()
}

function formatAmount(cents) {
  const value = Number(cents || 0) / 100
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(value, compact = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', ...(compact ? {} : { year: 'numeric' }), hourCycle: 'h23' }).format(date)
}
