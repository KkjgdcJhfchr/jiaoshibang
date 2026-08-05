import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BadgeCheck,
  BadgePercent,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CreditCard,
  Edit3,
  KeyRound,
  LoaderCircle,
  PackageCheck,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
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
  durationDays: '30', features: '教案生成点数\nAI 教案修改\nDOCX / PDF 导出', saleable: true,
})

const EMPTY_PROMOTION_FORM = Object.freeze({
  name: '', template: 'new_term', content: '', discountPercent: '10', targetPlanIds: [], startsAt: '', endsAt: '', enabled: true,
})

const EMPTY_CREDIT_RESET_FORM = Object.freeze({
  credits: '', reason: '', mode: 'now', executeAt: '', userIds: [],
})

const CREDIT_RESET_STATUS = Object.freeze({
  pending: '等待执行', processing: '正在执行', completed: '执行成功', cancelled: '已取消', failed: '执行失败',
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
  const [editor, setEditor] = useState(null)
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
    } catch (requestError) {
      setError(requestError.message || '套餐目录读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  function openCreatePlan() {
    setError('')
    setEditor({ plan: null, form: { ...EMPTY_PLAN_FORM } })
  }

  function openEditPlan(plan) {
    setError('')
    setEditor({ plan, form: planToForm(plan) })
  }

  function updatePlanField(field, value) {
    setEditor((current) => current ? { ...current, form: { ...current.form, [field]: value } } : current)
  }

  async function savePlan(event) {
    event.preventDefault()
    if (!editor) return
    const { plan, form } = editor
    const planId = plan?.planId || form.planId.trim()
    if (!plan && plans.some((item) => item.planId === planId)) {
      setError('套餐标识已存在，请换一个唯一标识')
      return
    }
    setBusy('plan-save')
    setError('')
    try {
      const response = await api.saveAdminPaymentPlan(planId, buildPlanPayload(form, plan))
      const saved = response.data?.plan
      setPlans((current) => plan
        ? current.map((item) => item.planId === saved.planId ? saved : item)
        : [...current, saved])
      setEditor(null)
      onNotice(`${saved.name}已${plan ? '保存' : '添加到套餐目录'}`)
    } catch (requestError) {
      setError(requestError.message || '套餐保存失败')
    } finally {
      setBusy('')
    }
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
      if (editor?.plan?.planId === plan.planId) setEditor(null)
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
        <button className="admin-button admin-button-primary" type="button" onClick={openCreatePlan} disabled={Boolean(busy)}><Plus size={16} />添加付费套餐</button>
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
          {plans.map((plan) => <PlanSummary key={plan.planId} plan={plan} busy={Boolean(busy)} onEdit={() => openEditPlan(plan)} onArchive={() => archivePlan(plan)} />)}
          {loading ? <InlineLoading label="正在读取套餐目录…" /> : null}
          {!loading && !plans.length ? <CommerceEmpty icon={<PackageCheck size={28} />} title="暂无套餐" description="点击“添加付费套餐”创建第一个在售套餐。" /> : null}
        </div>
      </section>

      {editor ? <CommerceEditorModal title={editor.plan ? '编辑套餐' : '新增付费套餐'} description={editor.plan ? `正在编辑 ${editor.plan.name}` : '填写套餐信息后保存到用户端套餐目录'} busy={busy === 'plan-save'} error={error} onClose={() => { setEditor(null); setError('') }}>
        <PlanForm form={editor.form} plan={editor.plan} onChange={updatePlanField} onSubmit={savePlan} onCancel={() => { setEditor(null); setError('') }} busy={busy === 'plan-save'} isNew={!editor.plan} />
      </CommerceEditorModal> : null}
    </div>
  )
}

export function PromotionsPage({ onNotice = () => {} }) {
  const [promotions, setPromotions] = useState([])
  const [plans, setPlans] = useState([])
  const [creditResets, setCreditResets] = useState([])
  const [creditResetPage, setCreditResetPage] = useState(1)
  const [creditResetPageSize, setCreditResetPageSize] = useState(8)
  const [creditResetEditor, setCreditResetEditor] = useState(null)
  const [creditResetUsers, setCreditResetUsers] = useState([])
  const [creditResetSearch, setCreditResetSearch] = useState('')
  const [creditResetUserOffset, setCreditResetUserOffset] = useState(0)
  const [creditResetUserPagination, setCreditResetUserPagination] = useState({ offset: 0, limit: 50, total: 0 })
  const [creditResetUsersLoading, setCreditResetUsersLoading] = useState(false)
  const creditResetUsersRequestRef = useRef(0)
  const [editor, setEditor] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  async function reload() {
    setLoading(true)
    setError('')
    try {
      const [promotionResponse, planResponse, creditResetResponse] = await Promise.all([
        api.getAdminPromotions(),
        api.getAdminPaymentPlans(),
        api.listCreditResets(),
      ])
      const nextPromotions = promotionResponse.data?.promotions || promotionResponse.data?.items || []
      const nextPlans = planResponse.data?.plans || []
      const nextCreditResets = creditResetResponse.data?.jobs || creditResetResponse.data?.items || []
      setPromotions(Array.isArray(nextPromotions) ? nextPromotions : [])
      setPlans(Array.isArray(nextPlans) ? nextPlans.filter((plan) => plan.kind !== 'free' && !plan.archivedAt) : [])
      setCreditResets(Array.isArray(nextCreditResets) ? nextCreditResets : [])
      setCreditResetPage(1)
    } catch (requestError) {
      setError(requestError.message || '优惠活动读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { reload() }, [])

  const isCreditResetEditorOpen = Boolean(creditResetEditor)
  useEffect(() => {
    if (!isCreditResetEditorOpen) {
      creditResetUsersRequestRef.current += 1
      return undefined
    }
    const requestId = ++creditResetUsersRequestRef.current
    const timer = window.setTimeout(async () => {
      setCreditResetUsersLoading(true)
      try {
        const response = await api.getAdminUsers({ query: creditResetSearch, offset: creditResetUserOffset, limit: 50 })
        if (requestId !== creditResetUsersRequestRef.current) return
        const data = response.data || {}
        setCreditResetUsers(Array.isArray(data.items) ? data.items : [])
        setCreditResetUserPagination({ offset: creditResetUserOffset, limit: 50, total: 0, ...(data.pagination || {}) })
      } catch (requestError) {
        if (requestId === creditResetUsersRequestRef.current) {
          setCreditResetUsers([])
          setError(requestError.message || '会员列表读取失败')
        }
      } finally {
        if (requestId === creditResetUsersRequestRef.current) setCreditResetUsersLoading(false)
      }
    }, creditResetSearch ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [isCreditResetEditorOpen, creditResetSearch, creditResetUserOffset])

  function openCreatePromotion() {
    setError('')
    setEditor({ promotion: null, form: { ...EMPTY_PROMOTION_FORM, targetPlanIds: [] } })
  }

  function openEditPromotion(promotion) {
    setError('')
    setEditor({ promotion, form: promotionToForm(promotion) })
  }

  function updatePromotionField(field, value) {
    setEditor((current) => current ? { ...current, form: { ...current.form, [field]: value } } : current)
  }

  function openCreditReset() {
    setError('')
    setCreditResetSearch('')
    setCreditResetUserOffset(0)
    setCreditResetUsers([])
    setCreditResetUserPagination({ offset: 0, limit: 50, total: 0 })
    setCreditResetUsersLoading(true)
    setCreditResetEditor({ form: { ...EMPTY_CREDIT_RESET_FORM, userIds: [] } })
  }

  function updateCreditResetSearch(value) {
    setCreditResetSearch(value)
    setCreditResetUserOffset(0)
  }

  function updateCreditResetField(field, value) {
    setCreditResetEditor((current) => current ? { ...current, form: { ...current.form, [field]: value } } : current)
  }

  async function saveCreditReset(event) {
    event.preventDefault()
    if (!creditResetEditor) return
    const form = creditResetEditor.form
    const credits = Number(form.credits)
    if (!Number.isSafeInteger(credits) || credits < 0) {
      setError('重置后的额度必须是大于或等于 0 的整数')
      return
    }
    if (!form.userIds.length) {
      setError('请至少选择一个需要重置额度的会员')
      return
    }
    if (form.userIds.length > 1_000) {
      setError('单次额度重置最多选择 1000 个会员')
      return
    }
    let executeAt
    try {
      executeAt = form.mode === 'scheduled' ? creditResetDateTimeToIso(form.executeAt) : undefined
    } catch (formError) {
      setError(formError.message)
      return
    }
    setBusy('credit-reset-save')
    setError('')
    try {
      const response = await api.createCreditReset({
        userIds: form.userIds,
        credits,
        reason: String(form.reason || '').trim(),
        ...(executeAt ? { executeAt } : {}),
        idempotencyKey: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      })
      const saved = response.data?.job || response.data?.item || response.data
      if (saved?.status === 'failed') throw new Error(saved.failureMessage || '额度重置执行失败')
      if (saved?.id) setCreditResets((current) => [saved, ...current.filter((item) => item.id !== saved.id)])
      setCreditResetPage(1)
      setCreditResetEditor(null)
      onNotice(form.mode === 'scheduled'
        ? '额度重置任务已安排，将按设定时间自动执行'
        : saved?.status === 'completed' ? (saved.result?.summary || `已完成 ${Number(saved.result?.updatedCount ?? form.userIds.length)} 个会员的额度重置`) : '额度重置任务已提交执行')
    } catch (requestError) {
      setError(requestError.message || '额度重置任务保存失败')
    } finally {
      setBusy('')
    }
  }

  async function cancelCreditReset(job) {
    if (!window.confirm(`确认取消“${job.reason}”额度重置任务吗？`)) return
    setBusy(`credit-reset-cancel-${job.id}`)
    setError('')
    try {
      const response = await api.cancelCreditReset(job.id)
      const saved = response.data?.job || response.data?.item || response.data
      setCreditResets((current) => current.map((item) => item.id === job.id ? saved : item))
      onNotice('额度重置任务已取消')
    } catch (requestError) {
      setError(requestError.message || '额度重置任务取消失败')
    } finally {
      setBusy('')
    }
  }

  async function savePromotion(event) {
    event.preventDefault()
    if (!editor) return
    const { promotion, form } = editor
    const id = promotionIdOf(promotion)
    setBusy('promotion-save')
    setError('')
    try {
      const response = promotion
        ? await api.updateAdminPromotion(id, buildPromotionPayload(form, promotion))
        : await api.createAdminPromotion(buildPromotionPayload(form))
      const saved = promotionFromResponse(response)
      setPromotions((current) => promotion
        ? current.map((item) => promotionIdOf(item) === id ? saved : item)
        : [saved, ...current])
      setEditor(null)
      onNotice(`${saved.name || saved.label || '优惠活动'}已${promotion ? '保存' : '创建'}`)
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
      if (promotionIdOf(editor?.promotion) === id) setEditor(null)
      onNotice(`${name}已删除`)
    } catch (requestError) {
      setError(requestError.message || '优惠活动删除失败')
    } finally {
      setBusy('')
    }
  }

  const enabledCount = promotions.filter((promotion) => promotion.enabled).length
  const activeCount = promotions.filter(isPromotionActive).length
  const creditResetPageCount = Math.max(1, Math.ceil(creditResets.length / creditResetPageSize))
  const normalizedCreditResetPage = Math.min(creditResetPage, creditResetPageCount)
  const visibleCreditResets = creditResets.slice((normalizedCreditResetPage - 1) * creditResetPageSize, normalizedCreditResetPage * creditResetPageSize)

  return (
    <div className="admin-payment-page">
      <CommercePageHeader title="优惠活动" description="创建庆祝活动，设置折扣比例、目标套餐、生效时间和前端活动文案" loading={loading} busy={busy} onRefresh={reload}>
        <button className="admin-button admin-button-primary" type="button" onClick={openCreatePromotion} disabled={Boolean(busy)}><Plus size={16} />添加优惠活动</button>
      </CommercePageHeader>
      <CommerceError error={error} onClose={() => setError('')} />

      <div className="admin-payment-summary admin-payment-summary-three">
        <SummaryCard icon={<BadgePercent size={20} />} label="优惠活动" value={promotions.length} hint="已创建的全部活动" />
        <SummaryCard icon={<CheckCircle2 size={20} />} label="已启用" value={enabledCount} hint="允许按设置时间自动生效" tone="success" />
        <SummaryCard icon={<CalendarDays size={20} />} label="当前生效" value={activeCount} hint="此刻正在执行的活动" />
      </div>

      <section className="admin-panel admin-credit-reset-panel">
        <header className="admin-payment-orders-header">
          <div><h2>会员额度重置</h2><p>选择指定会员，将剩余额度统一重置为设定值；支持立即执行或定时执行。</p></div>
          <button className="admin-button admin-button-primary" type="button" onClick={openCreditReset} disabled={Boolean(busy)}><RotateCcw size={16} />一键重置额度</button>
        </header>
        <div className="admin-credit-reset-list">
          {visibleCreditResets.map((job) => <CreditResetSummary key={job.id} job={job} busy={Boolean(busy)} onCancel={() => cancelCreditReset(job)} />)}
          {!loading && !creditResets.length ? <CommerceEmpty icon={<RotateCcw size={28} />} title="暂无额度重置记录" description="创建任务后，可在这里查看执行时间、目标会员和执行结果。" /> : null}
        </div>
        {creditResets.length ? <footer className="admin-credit-reset-history-pagination">
          <span>共 {creditResets.length} 条，第 {normalizedCreditResetPage} / {creditResetPageCount} 页</span>
          <div>
            <button type="button" onClick={() => setCreditResetPage(Math.max(1, normalizedCreditResetPage - 1))} disabled={normalizedCreditResetPage <= 1}><ChevronLeft size={15} />上一页</button>
            <button type="button" onClick={() => setCreditResetPage(Math.min(creditResetPageCount, normalizedCreditResetPage + 1))} disabled={normalizedCreditResetPage >= creditResetPageCount}>下一页<ChevronRight size={15} /></button>
            <select aria-label="每页额度重置记录数" value={creditResetPageSize} onChange={(event) => { setCreditResetPageSize(Number(event.target.value)); setCreditResetPage(1) }}>
              <option value="8">8 条 / 页</option><option value="20">20 条 / 页</option><option value="2000">查看全部</option>
            </select>
          </div>
        </footer> : null}
      </section>

      <section className="admin-panel admin-promotion-panel">
        <header className="admin-payment-orders-header"><div><h2>活动列表</h2><p>折扣在开始与结束时间之间自动生效；目标套餐可以多选。</p></div></header>
        <div className="admin-promotion-grid">
          {promotions.map((promotion) => <PromotionSummary key={promotionIdOf(promotion)} promotion={promotion} plans={plans} busy={Boolean(busy)} onEdit={() => openEditPromotion(promotion)} onDelete={() => deletePromotion(promotion)} />)}
          {loading ? <InlineLoading label="正在读取优惠活动…" /> : null}
          {!loading && !promotions.length ? <CommerceEmpty icon={<Tag size={28} />} title="暂无优惠活动" description="点击“添加优惠活动”创建开学季、教师节或其他庆祝优惠。" /> : null}
        </div>
      </section>

      {editor ? <CommerceEditorModal title={editor.promotion ? '编辑优惠活动' : '新增优惠活动'} description={editor.promotion ? `正在编辑 ${editor.promotion.name || editor.promotion.label}` : '设置折扣、活动时间和参与套餐'} busy={busy === 'promotion-save'} error={error} onClose={() => { setEditor(null); setError('') }} wide>
        <PromotionForm form={editor.form} promotion={editor.promotion} plans={plans} onChange={updatePromotionField} onSubmit={savePromotion} onCancel={() => { setEditor(null); setError('') }} busy={busy === 'promotion-save'} isNew={!editor.promotion} />
      </CommerceEditorModal> : null}
      {creditResetEditor ? <CommerceEditorModal title="一键重置会员额度" description="只会修改选中会员的剩余额度，不影响会员套餐、历史教案和账户资料" busy={busy === 'credit-reset-save'} error={error} onClose={() => { setCreditResetEditor(null); setError('') }} wide>
        <CreditResetForm form={creditResetEditor.form} users={creditResetUsers} search={creditResetSearch} pagination={creditResetUserPagination} usersLoading={creditResetUsersLoading} onSearch={updateCreditResetSearch} onPageChange={setCreditResetUserOffset} onChange={updateCreditResetField} onSubmit={saveCreditReset} onCancel={() => { setCreditResetEditor(null); setError('') }} busy={busy === 'credit-reset-save'} />
      </CommerceEditorModal> : null}
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

function PlanSummary({ plan, busy, onEdit, onArchive }) {
  const isFree = plan.kind === 'free'
  const price = isFree ? '免费' : `¥${formatAmount(plan.regularAmountCents ?? plan.amountCents)}`
  return <article className={`admin-commerce-summary-card ${isFree ? 'is-free' : ''}`}>
    <header><div><b>{plan.name}</b><small>{plan.planId}</small></div><span className={plan.saleable ? 'is-enabled' : ''}>{plan.saleable ? '前端展示' : '已下架'}</span></header>
    <div className="admin-commerce-summary-price"><strong>{price}</strong><span>{PERIOD_LABELS[plan.billingPeriod] || plan.billingPeriod}</span></div>
    <dl><div><dt>发放额度</dt><dd>{Number(plan.credits || 0)}</dd></div><div><dt>有效期</dt><dd>{isFree ? '长期' : `${Number(plan.durationDays || 0)} 天`}</dd></div></dl>
    <ul>{(plan.features || []).slice(0, 4).map((feature) => <li key={feature}><CheckCircle2 size={13} />{feature}</li>)}</ul>
    <footer>{!isFree ? <button className="admin-button admin-button-danger" type="button" onClick={onArchive} disabled={busy}><Trash2 size={15} />归档</button> : <span>基础套餐不可删除</span>}<button className="admin-button admin-button-secondary" type="button" onClick={onEdit} disabled={busy}><Edit3 size={15} />编辑套餐</button></footer>
  </article>
}

function PlanForm({ form, plan, onChange, onSubmit, onCancel, busy, isNew = false }) {
  const isFree = !isNew && (plan?.kind === 'free' || form.kind === 'free')
  return <form className="admin-commerce-editor-form admin-plan-editor-form" onSubmit={onSubmit} aria-busy={busy}>
    <div className="admin-membership-plan-fields">
      {isNew ? <TextField label="套餐标识" value={form.planId} onChange={(value) => onChange('planId', value)} placeholder="例如 pro-quarter-2026" pattern="[A-Za-z0-9_.:-]{2,80}" required autoFocus /> : null}
      <TextField label="套餐名称" value={form.name} onChange={(value) => onChange('name', value)} required autoFocus={!isNew} />
      <TextField label="会员等级标识" value={form.tier} onChange={(value) => onChange('tier', value)} placeholder={isFree ? 'free' : 'pro'} required />
      <TextField label="等级权重" value={form.tierRank} onChange={(value) => onChange('tierRank', value)} type="number" min={isFree ? '0' : '1'} max="10000" required />
      {isFree ? <TextField label="套餐价格" value="0.00" onChange={() => {}} readOnly /> : <><label className="admin-payment-field"><span>付费周期</span><select value={form.billingPeriod} onChange={(event) => onChange('billingPeriod', event.target.value)}>{Object.entries(PERIOD_LABELS).filter(([value]) => value !== 'free').map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><TextField label="售价（元）" value={form.price} onChange={(value) => onChange('price', value)} type="number" min="0.01" step="0.01" required /></>}
      <TextField label={isFree ? '注册赠送额度' : '发放额度'} value={form.credits} onChange={(value) => onChange('credits', value)} type="number" min="0" step="1" required />
      {isFree ? <TextField label="有效期" value="长期有效" onChange={() => {}} readOnly /> : <TextField label="有效天数" value={form.durationDays} onChange={(value) => onChange('durationDays', value)} type="number" min="1" max="3660" required />}
    </div>
    <label className="admin-membership-feature-field"><span>前端展示权益（每行一项）</span><textarea value={form.features} onChange={(event) => onChange('features', event.target.value)} required /></label>
    <div className="admin-commerce-switch-row"><div><b>在用户端展示</b><span>关闭后不会出现在注册与购买页面，已发放的会员权益不受影响。</span></div><button className={`admin-toggle ${form.saleable ? 'admin-toggle-on' : ''}`} type="button" role="switch" aria-checked={Boolean(form.saleable)} onClick={() => onChange('saleable', !form.saleable)} disabled={busy}><span className="admin-toggle-knob" /></button></div>
    <footer><small>{isFree ? '免费版不可删除，但名称、额度和权益内容均可编辑。' : '保存后只影响后续下单，已有订单不会变化。'}</small><div className="admin-commerce-form-actions"><button className="admin-button admin-button-secondary" type="button" onClick={onCancel} disabled={busy}><X size={16} />取消</button><button className="admin-button admin-button-primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{isNew ? '确认添加' : '保存套餐'}</button></div></footer>
  </form>
}

function PromotionSummary({ promotion, plans, busy, onEdit, onDelete }) {
  const targetIds = promotion.targetPlanIds || promotion.planIds || []
  const targetNames = plans.filter((plan) => targetIds.includes(plan.planId)).map((plan) => plan.name)
  const active = isPromotionActive(promotion)
  return <article className="admin-commerce-summary-card admin-promotion-summary-card">
    <header><div><b>{promotion.name || promotion.label}</b><small>{CELEBRATION_TEMPLATES[promotion.template] || '自定义活动'}</small></div><span className={active ? 'is-enabled' : ''}>{active ? '生效中' : promotion.enabled ? '已启用' : '已停用'}</span></header>
    <div className="admin-promotion-summary-discount"><BadgePercent size={23} /><strong>优惠 {Number(promotion.discountPercent || promotion.discount || 0)}%</strong></div>
    <p>{promotion.content || promotion.message || promotion.description || '未填写活动文案'}</p>
    <dl><div><dt>活动时间</dt><dd>{formatDate(promotion.startsAt)} 至 {formatDate(promotion.endsAt)}</dd></div><div><dt>目标套餐</dt><dd>{targetNames.length ? targetNames.join('、') : `${targetIds.length} 个套餐`}</dd></div></dl>
    <footer><button className="admin-button admin-button-danger" type="button" onClick={onDelete} disabled={busy}><Trash2 size={15} />删除</button><button className="admin-button admin-button-secondary" type="button" onClick={onEdit} disabled={busy}><Edit3 size={15} />编辑活动</button></footer>
  </article>
}

function PromotionForm({ form, promotion, plans, onChange, onSubmit, onCancel, busy, isNew = false }) {
  const togglePlan = (planId) => { const selected = new Set(form.targetPlanIds || []); if (selected.has(planId)) selected.delete(planId); else selected.add(planId); onChange('targetPlanIds', [...selected]) }
  const allPlanIds = plans.map((plan) => plan.planId)
  const selectedCount = allPlanIds.filter((planId) => (form.targetPlanIds || []).includes(planId)).length
  return <form className="admin-commerce-editor-form admin-promotion-editor-form" onSubmit={onSubmit} aria-busy={busy}>
    <div className="admin-promotion-fields">
      <TextField label="活动名称" value={form.name} onChange={(value) => onChange('name', value)} placeholder="例如：教师节感恩优惠" required autoFocus />
      <label className="admin-payment-field"><span>庆祝模板</span><select value={form.template} onChange={(event) => onChange('template', event.target.value)}>{Object.entries(CELEBRATION_TEMPLATES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <TextField label="优惠折扣（%）" value={form.discountPercent} onChange={(value) => onChange('discountPercent', value)} type="number" min="1" max="99" step="1" required />
      <DateTimeField label="开始时间" value={form.startsAt} onChange={(value) => onChange('startsAt', value)} required />
      <DateTimeField label="结束时间" value={form.endsAt} onChange={(value) => onChange('endsAt', value)} required />
    </div>
    <label className="admin-membership-feature-field"><span>活动弹窗文案</span><textarea value={form.content} onChange={(event) => onChange('content', event.target.value)} placeholder="填写用户端可见的活动说明" required /></label>
    <div className="admin-promotion-targets"><div className="admin-promotion-targets-header"><span>目标套餐 <small>已选 {selectedCount} / {plans.length}</small></span><div><button type="button" onClick={() => onChange('targetPlanIds', allPlanIds)} disabled={!plans.length || selectedCount === plans.length}>全选</button><button type="button" onClick={() => onChange('targetPlanIds', [])} disabled={!selectedCount}>取消全选</button></div></div>{plans.map((plan) => <label key={plan.planId}><input type="checkbox" checked={(form.targetPlanIds || []).includes(plan.planId)} onChange={() => togglePlan(plan.planId)} /><span><b>{plan.name}</b><small>{PERIOD_LABELS[plan.billingPeriod] || plan.billingPeriod} · ¥{formatAmount(plan.regularAmountCents ?? plan.amountCents)}</small></span></label>)}{!plans.length ? <p>暂无可选择的付费套餐，请先在“套餐设置”中添加。</p> : null}</div>
    <div className="admin-commerce-switch-row"><div><b>启用活动</b><span>启用后仍只会在设置的开始与结束时间之间生效。</span></div><button className={`admin-toggle ${form.enabled ? 'admin-toggle-on' : ''}`} type="button" role="switch" aria-checked={Boolean(form.enabled)} onClick={() => onChange('enabled', !form.enabled)} disabled={busy}><span className="admin-toggle-knob" /></button></div>
    <footer><small>{isPromotionActive(promotion || form) ? '活动当前正在生效' : form.enabled ? '活动将按设定时间自动生效' : '活动当前停用'}</small><div className="admin-commerce-form-actions"><button className="admin-button admin-button-secondary" type="button" onClick={onCancel} disabled={busy}><X size={16} />取消</button><button className="admin-button admin-button-primary" type="submit" disabled={busy || !plans.length}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{isNew ? '创建活动' : '保存活动'}</button></div></footer>
  </form>
}

function CreditResetSummary({ job, busy, onCancel }) {
  const status = String(job.status || 'pending')
  const resultText = status === 'completed'
    ? (job.result?.summary || `成功重置 ${Number(job.result?.updatedCount ?? job.targetCount ?? job.userIds?.length ?? 0)} 个会员`)
    : status === 'failed' ? (job.failureMessage || '执行失败，请检查用户数据后重新创建任务')
      : `${Number(job.targetCount ?? job.userIds?.length ?? 0)} 个会员 · 重置为 ${Number(job.credits || 0)} 点`
  return <article className="admin-credit-reset-item">
    <span className={`admin-credit-reset-icon ${status}`}><RotateCcw size={18} /></span>
    <div className="admin-credit-reset-main"><b>{job.reason || '会员额度重置'}</b><small>{resultText}</small></div>
    <div className="admin-credit-reset-time"><b>{status === 'pending' ? '计划执行' : '执行时间'}</b><small>{formatDate(job.completedAt || job.failedAt || job.cancelledAt || job.executeAt)}</small></div>
    <span className={`admin-credit-reset-status ${status}`}>{CREDIT_RESET_STATUS[status] || status}</span>
    {status === 'pending' ? <button className="admin-button admin-button-secondary" type="button" onClick={onCancel} disabled={busy}><X size={14} />取消任务</button> : <span className="admin-credit-reset-action-placeholder" />}
  </article>
}

function CreditResetForm({ form, users, search, pagination, usersLoading, onSearch, onPageChange, onChange, onSubmit, onCancel, busy }) {
  const selected = new Set(form.userIds || [])
  const visibleIds = users.map((user) => user.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((userId) => selected.has(userId))
  const selectionFull = selected.size >= 1_000
  const page = Math.floor(Number(pagination.offset || 0) / Number(pagination.limit || 50)) + 1
  const pageCount = Math.max(1, Math.ceil(Number(pagination.total || 0) / Number(pagination.limit || 50)))
  const toggleUser = (userId) => {
    const next = new Set(selected)
    if (next.has(userId)) next.delete(userId)
    else if (next.size < 1_000) next.add(userId)
    onChange('userIds', [...next])
  }
  const toggleVisible = () => {
    const next = new Set(selected)
    if (allVisibleSelected) visibleIds.forEach((userId) => next.delete(userId))
    else {
      for (const userId of visibleIds) {
        if (next.size >= 1_000) break
        next.add(userId)
      }
    }
    onChange('userIds', [...next])
  }
  return <form className="admin-commerce-editor-form admin-credit-reset-form" onSubmit={onSubmit} aria-busy={busy}>
    <div className="admin-credit-reset-fields">
      <TextField label="重置后的额度" value={form.credits} onChange={(value) => onChange('credits', value)} type="number" min="0" max="1000000" step="1" placeholder="例如 30" required autoFocus />
      <label className="admin-payment-field"><span>执行方式</span><select value={form.mode} onChange={(event) => onChange('mode', event.target.value)}><option value="now">保存后立即执行</option><option value="scheduled">按指定时间执行</option></select></label>
      {form.mode === 'scheduled' ? <DateTimeField label="准确执行时间" value={form.executeAt} onChange={(value) => onChange('executeAt', value)} min={isoToLocalDateTime(new Date().toISOString())} required /> : <div className="admin-credit-reset-now-note"><Clock3 size={17} /><span><b>立即执行</b><small>点击确认后，系统会马上重置所选会员的额度。</small></span></div>}
    </div>
    <label className="admin-membership-feature-field"><span>重置说明</span><textarea value={form.reason} onChange={(event) => onChange('reason', event.target.value)} maxLength="200" placeholder="例如：教师节狂欢额度重置" required /></label>
    <section className="admin-credit-reset-members">
      <header>
        <div><b>选择会员</b><small>已选 {selected.size} 人，共 {Number(pagination.total || 0)} 人；单次最多选择 1000 人</small></div>
        <label><Search size={15} /><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索账号、姓名或学科" /></label>
      </header>
      <div className="admin-credit-reset-selectbar"><span>{search ? `搜索结果第 ${page} / ${pageCount} 页` : `会员列表第 ${page} / ${pageCount} 页`}</span><button type="button" onClick={toggleVisible} disabled={!visibleIds.length || (selectionFull && !allVisibleSelected)}>{allVisibleSelected ? '取消选择本页' : '全选本页'}</button></div>
      <div className="admin-credit-reset-members-list">
        {usersLoading ? <InlineLoading label="正在读取会员列表…" /> : users.map((user) => <label key={user.id} className={selected.has(user.id) ? 'selected' : ''}><input type="checkbox" checked={selected.has(user.id)} disabled={!selected.has(user.id) && selectionFull} onChange={() => toggleUser(user.id)} /><span className="admin-credit-reset-avatar">{String(user.displayName || user.account || '会').slice(0, 1).toUpperCase()}</span><span><b>{user.displayName || '未设置姓名'}</b><small>{user.account} · {user.subject || '未设置学科'} · 当前 {Number(user.credits || 0)} 点</small></span></label>)}
        {!usersLoading && !users.length ? <p>{search ? '没有符合搜索条件的会员' : '暂无可选择的注册会员'}</p> : null}
      </div>
      <footer className="admin-credit-reset-pagination"><span>第 {page} / {pageCount} 页</span><div><button type="button" aria-label="上一页会员" disabled={usersLoading || page <= 1} onClick={() => onPageChange(Math.max(0, Number(pagination.offset || 0) - Number(pagination.limit || 50)))}><ChevronLeft size={15} />上一页</button><button type="button" aria-label="下一页会员" disabled={usersLoading || page >= pageCount} onClick={() => onPageChange(Number(pagination.offset || 0) + Number(pagination.limit || 50))}>下一页<ChevronRight size={15} /></button></div></footer>
    </section>
    <footer><small>额度会被设置为填写的数值，并非在原额度上累加。</small><div className="admin-commerce-form-actions"><button className="admin-button admin-button-secondary" type="button" onClick={onCancel} disabled={busy}><X size={16} />取消</button><button className="admin-button admin-button-primary" type="submit" disabled={busy || usersLoading || !selected.size}>{busy ? <LoaderCircle className="spin" size={16} /> : <RotateCcw size={16} />}{form.mode === 'scheduled' ? '确认定时任务' : '确认立即重置'}</button></div></footer>
  </form>
}

function CommerceEditorModal({ title, description, busy, error, onClose, wide = false, children }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKeyDown = (event) => { if (event.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', handleKeyDown) }
  }, [busy, onClose])
  return <div className="admin-commerce-dialog-layer"><button className="admin-commerce-dialog-backdrop" type="button" onClick={onClose} aria-label="关闭编辑窗口" disabled={busy} /><section className={`admin-commerce-dialog ${wide ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="admin-commerce-dialog-title"><header><div><h2 id="admin-commerce-dialog-title">{title}</h2><p>{description}</p></div><button type="button" onClick={onClose} aria-label="关闭" disabled={busy}><X size={20} /></button></header><div className="admin-commerce-dialog-body">{error ? <CommerceError error={error} /> : null}{children}</div></section></div>
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
  return error ? <div className="admin-payment-error" role="alert"><AlertTriangle size={18} /><span>{error}</span>{onClose ? <button type="button" onClick={onClose} aria-label="关闭错误提示"><X size={16} /></button> : null}</div> : null
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
    <TextField label="卖家 ID（选填）" value={form.sellerId} onChange={(value) => updateField('sellerId', value)} placeholder="通常无需填写；仅特殊商户验签策略使用" />
    <TextField label="异步通知地址（自动生成）" value={form.notifyUrl} onChange={() => {}} placeholder="保存后由部署域名自动生成" type="url" readOnly wide />
    <TextField label="支付完成返回地址（自动生成）" value={form.returnUrl} onChange={() => {}} placeholder="保存后由部署域名自动生成" type="url" readOnly wide />
    <SecretArea label="应用私钥" value={form.appPrivateKeyPem} onChange={(value) => updateField('appPrivateKeyPem', value)} configured={config.credentials?.appPrivateKeyPem} hint={config.credentialHints?.appPrivateKeyPem} placeholder="-----BEGIN PRIVATE KEY-----" required={!config.credentials?.appPrivateKeyPem} />
    <SecretArea label="支付宝公钥" value={form.alipayPublicKeyPem} onChange={(value) => updateField('alipayPublicKeyPem', value)} configured={config.credentials?.alipayPublicKeyPem} hint={config.credentialHints?.alipayPublicKeyPem} placeholder="-----BEGIN PUBLIC KEY-----" required={!config.credentials?.alipayPublicKeyPem} />
  </div>
}

function TextField({ label, value, onChange, wide = false, ...inputProps }) {
  return <label className={`admin-payment-field ${wide ? 'wide' : ''}`}><span>{label}</span><input value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...inputProps} /></label>
}

function DateTimeField({ label, value, onChange, ...inputProps }) {
  const inputRef = useRef(null)
  const focusAndOpen = () => {
    const input = inputRef.current
    if (!input || input.disabled) return
    input.focus()
    try { input.showPicker?.() } catch { /* 浏览器不支持时仍保持输入框聚焦 */ }
  }
  return <label className="admin-payment-field admin-datetime-field" onClick={focusAndOpen}><span>{label}</span><input ref={inputRef} type="datetime-local" value={value ?? ''} onChange={(event) => onChange(event.target.value)} onClick={(event) => { event.stopPropagation(); focusAndOpen() }} {...inputProps} /></label>
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

function creditResetDateTimeToIso(value) {
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) throw new Error('请填写有效的额度重置执行时间')
  if (date.getTime() <= Date.now()) throw new Error('定时执行时间必须晚于当前时间')
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
