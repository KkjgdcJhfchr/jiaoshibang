import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  BadgePercent,
  Bell,
  BookOpenCheck,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  CreditCard,
  GraduationCap,
  Gift,
  KeyRound,
  ListChecks,
  LoaderCircle,
  Menu,
  Megaphone,
  Network,
  Plus,
  ReceiptText,
  RefreshCw,
  Route,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { useSiteConfig } from '../lib/site-config.jsx'
import { KnowledgeGraphAdminPage, OrganizationsAdminPage, QuestionBankAdminPage } from './DomainManagementPages.jsx'
import { SecuritySettingsPage } from './SecuritySettingsPage.jsx'
import { MembershipPlansPage, OrdersPage, PaymentChannelsPage, PromotionsPage } from './PaymentSettingsPage.jsx'
import { SystemSettingsPage } from './SystemSettingsPage.jsx'
import { UserManagementPage } from './UserManagementPage.jsx'
import { ContentManagementPage } from './ContentManagementPage.jsx'
import { MarketingPage } from './MarketingPage.jsx'
import { ReferralRewardsPage } from './ReferralRewardsPage.jsx'
import './admin.css'

const navigationItems = [
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'organizations', label: '学校与组织', icon: Building2 },
  { id: 'plans', label: '套餐设置', icon: GraduationCap },
  { id: 'promotions', label: '优惠活动', icon: BadgePercent },
  { id: 'marketing', label: '广告宣传营销', icon: Megaphone },
  { id: 'referrals', label: '推广奖励', icon: Gift },
  { id: 'announcements', label: '公告管理', icon: Bell },
  { id: 'tutorial', label: '新手教程', icon: BookOpenCheck },
  { id: 'knowledgeGraph', label: '教学认知图谱', icon: Network },
  { id: 'questionBank', label: '题库管理', icon: ListChecks },
  { id: 'models', label: 'AI模型通道', icon: Bot },
  { id: 'training', label: '训练素材', icon: Database },
  { id: 'paymentChannels', label: '支付通道', icon: CreditCard },
  { id: 'orders', label: '订单管理', icon: ReceiptText },
  { id: 'securitySettings', label: '安全与通信', icon: KeyRound },
  { id: 'settings', label: '系统设置', icon: Settings },
]

const modelProviderPresets = [
  { value: 'deepseek', label: 'DeepSeek', adapter: 'openai_chat_completions', baseUrl: 'https://api.deepseek.com' },
  { value: 'openai', label: 'OpenAI 官方', adapter: 'openai_responses', baseUrl: 'https://api.openai.com/v1' },
  { value: 'aliyun_bailian', label: '阿里云百炼', adapter: 'openai_chat_completions', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { value: 'custom_openai_compatible', label: '自定义兼容接口（第三方/自研）', adapter: 'openai_chat_completions', baseUrl: '' },
]

const modelCapabilityLabels = {
  lesson_generation: '教案生成',
  lesson_revision: '对话修改',
  multimodal_input: '教材图片/PDF输入',
  generation: '教案生成',
  revision: '对话修改',
}

const providerRouteDefinitions = [
  { id: 'generation_text', label: '生成·文字', summaryLabel: '教案生成 · 文字', purpose: 'lesson_generation', input: 'text' },
  { id: 'generation_image', label: '生成·图片', summaryLabel: '教案生成 · 图片', purpose: 'lesson_generation', input: 'image' },
  { id: 'generation_pdf', label: '生成·PDF', summaryLabel: '教案生成 · PDF', purpose: 'lesson_generation', input: 'pdf' },
  { id: 'revision_text', label: '修改·文字', summaryLabel: '对话修改 · 文字', purpose: 'lesson_revision', input: 'text' },
  { id: 'revision_image', label: '修改·图片', summaryLabel: '对话修改 · 图片', purpose: 'lesson_revision', input: 'image' },
  { id: 'revision_pdf', label: '修改·PDF', summaryLabel: '对话修改 · PDF', purpose: 'lesson_revision', input: 'pdf' },
]

function providerTaskLabel(task) {
  const normalized = String(task || '').trim().toLowerCase()
  if (normalized === 'generation' || normalized === 'lesson_generation') return '教案生成'
  if (normalized === 'revision' || normalized === 'lesson_revision') return '对话修改'
  return modelCapabilityLabels[task] || task
}

function normalizeDetectedCapabilities(value = {}) {
  const capabilities = value?.capabilities || value || {}
  const normalizeFlag = (flag) => typeof flag === 'boolean' ? flag : null
  return {
    text: normalizeFlag(capabilities.text),
    image: normalizeFlag(capabilities.image ?? capabilities.vision),
    pdf: normalizeFlag(capabilities.pdf),
    source: capabilities.source || value?.capabilitySource || 'unknown',
  }
}

function normalizeDiscoveredModels(result = {}) {
  const models = Array.isArray(result.availableModels) ? result.availableModels : []
  return models
    .map((model) => {
      const id = typeof model === 'string' ? model : model?.id
      if (!id) return null
      return {
        id,
        capabilities: normalizeDetectedCapabilities(model),
      }
    })
    .filter(Boolean)
}

function formatProviderTime(value) {
  if (!value) return '尚未命中'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '尚未命中'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function providerToChannel(provider, index = 0) {
  const health = provider.health || provider.healthCheck?.status || 'unknown'
  const normalizedHealth = health === 'unhealthy' || health === 'error' ? 'abnormal' : health
  const model = provider.model || provider.models?.generation?.modelId || provider.models?.generation || provider.models?.revision?.modelId || '未配置'
  const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : []
  return {
    id: provider.id || provider.providerId,
    name: provider.displayName || provider.name || `模型通道 ${index + 1}`,
    provider: provider.provider || (provider.providerType === 'openai' ? 'OpenAI 官方' : '自定义兼容接口'),
    model,
    purpose: capabilities.length ? capabilities.map((item) => modelCapabilityLabels[item] || item).join('、') : provider.purpose || '未配置用途',
    capabilities,
    priority: Number(provider.priority ?? provider.routing?.taskPriority?.generation ?? index + 1),
    latency: provider.latency || provider.averageLatency || '待检测',
    success: provider.success || provider.successRate || '—',
    health: normalizedHealth,
    enabled: provider.enabled === true,
    keyLastFour: provider.keyLastFour || provider.auth?.keyLastFour || '',
    readonly: provider.readonly === true,
    managedBy: provider.managedBy || 'admin',
    detectedCapabilities: normalizeDetectedCapabilities(provider.detectedCapabilities || provider.modelCapabilities),
    lastCheckedAt: provider.lastCheckedAt || provider.healthCheck?.checkedAt || null,
    lastCheckLatencyMs: Number.isFinite(Number(provider.lastCheckLatencyMs)) && Number(provider.lastCheckLatencyMs) > 0 ? Number(provider.lastCheckLatencyMs) : null,
    lastCheckError: provider.lastCheckError || provider.healthCheck?.error || null,
    lastUsedAt: provider.lastUsedAt || null,
    useCount: Number(provider.useCount || 0),
    lastSelectedTask: provider.lastSelectedTask || '',
    routeOrder: provider.routeOrder || null,
  }
}

function StatusPill({ children, tone }) {
  return <span className={`admin-status admin-status-${tone || 'muted'}`}>{children}</span>
}

function MetricCard({ label, value, note, tone = 'positive', icon: Icon = Activity }) {
  return (
    <article className="admin-metric-card">
      <div className="admin-metric-copy">
        <span className="admin-metric-label">{label}</span>
        <strong className="admin-metric-value">{value}</strong>
        <span className={`admin-metric-note admin-metric-note-${tone}`}>{note}</span>
      </div>
      <div className="admin-metric-visual" aria-hidden="true">
        <Icon size={30} strokeWidth={1.7} />
      </div>
    </article>
  )
}

function PanelHeader({ title, action, onAction, children }) {
  return (
    <header className="admin-panel-header">
      <h2>{title}</h2>
      {children || (action ? <button className="admin-text-action" type="button" onClick={onAction}>{action}<ChevronRight size={16} /></button> : null)}
    </header>
  )
}

function ProviderCapabilitySummary({ capabilities }) {
  const items = [
    ['text', '文字'],
    ['image', '图片'],
    ['pdf', 'PDF'],
  ]
  return (
    <span className="admin-provider-capability-summary" aria-label="模型实测能力">
      {items.map(([key, label]) => {
        const supported = capabilities?.[key]
        return <small className={supported === true ? 'is-supported' : supported === false ? 'is-unsupported' : 'is-unknown'} key={key}>{label}{supported === true ? '可用' : supported === false ? '不可用' : '暂无法确认'}</small>
      })}
    </span>
  )
}

function ProviderPriorityEditor({ channel, busy, onSave }) {
  const [value, setValue] = useState(String(channel.priority))
  useEffect(() => setValue(String(channel.priority)), [channel.priority])
  const changed = Number(value) !== channel.priority
  const invalid = !Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 1000
  return (
    <span className="admin-provider-priority">
      <input type="number" min="1" max="1000" step="1" value={value} aria-label={`${channel.name}的路由优先级`} disabled={channel.readonly || busy} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && changed && !invalid) onSave(channel, Number(value)) }} />
      {!channel.readonly ? <button type="button" aria-label={`保存${channel.name}的路由优先级`} title="保存优先级" disabled={busy || invalid || !changed} onClick={() => onSave(channel, Number(value))}><Save size={14} /></button> : null}
    </span>
  )
}

function channelSupportsRoute(channel, route) {
  const definition = typeof route === 'string'
    ? providerRouteDefinitions.find((item) => item.id === route)
    : route
  if (!definition || !channel.capabilities.includes(definition.purpose)) return false
  if (definition.input === 'text') return channel.detectedCapabilities.text !== false
  if (channel.detectedCapabilities[definition.input] !== true) return false
  if (definition.input !== 'text' && !channel.capabilities.includes('multimodal_input')) return false
  return true
}

function channelParticipatesInRouting(channel) {
  return channel.enabled && channel.health !== 'abnormal'
}

function buildRoutePositions(channels) {
  const enabled = channels.filter(channelParticipatesInRouting).sort((left, right) => left.priority - right.priority)
  const positions = new Map()
  for (const channel of channels) positions.set(channel.id, [])
  for (const route of providerRouteDefinitions) {
    enabled.filter((channel) => channelSupportsRoute(channel, route)).forEach((channel, index) => {
      positions.get(channel.id)?.push(`${route.label}${index === 0 ? '首选' : `第 ${index + 1} 顺位`}`)
    })
  }
  return positions
}

function ChannelHealthTable({ channels, onToggle, onTest, onPrioritySave, onDelete, query, busyIds }) {
  const normalizedQuery = query.trim().toLowerCase()
  const filteredChannels = channels.filter((channel) => !normalizedQuery || Object.values(channel).join(' ').toLowerCase().includes(normalizedQuery))
  const routePositions = buildRoutePositions(channels)

  return (
    <section className="admin-panel admin-channel-panel">
      <PanelHeader title="通道与实际路由" />
      <div className="admin-provider-routing-note"><Route size={18} /><div><b>多个通道同时启用时不会随机分配</b><p>系统先按任务用途和模型实测输入能力筛选，再选择优先级数字最小的通道。下表会直接标出每个通道当前承担的顺位和最近一次实际命中。</p></div></div>
      <div className="admin-table-wrap">
        <table className="admin-table admin-channel-table">
          <caption className="admin-sr-only">AI 模型通道健康状态</caption>
          <thead><tr><th>通道名称</th><th>模型与实测能力</th><th>参与用途</th><th>当前路由顺位 / 实际命中</th><th>优先级</th><th>状态</th><th>检测</th><th>启用</th><th>操作</th></tr></thead>
          <tbody>
            {filteredChannels.map((channel) => (
              <tr key={channel.id}>
                <td><span className={`admin-health-dot admin-health-dot-${channel.health}`} /><span className="admin-channel-identity"><b>{channel.name}</b><small>{channel.provider} · {channel.managedBy === 'environment' ? `服务器安全配置${channel.keyLastFour ? ` · 密钥尾号 ••••${channel.keyLastFour}` : ''}` : channel.keyLastFour ? `密钥尾号 ••••${channel.keyLastFour}` : '密钥已加密保存'}</small></span></td>
                <td><span className="admin-provider-model"><b>{channel.model}</b><ProviderCapabilitySummary capabilities={channel.detectedCapabilities} /></span></td>
                <td>{channel.purpose}</td>
                <td><span className="admin-provider-route-state"><span>{!channel.enabled ? '已停用，不参与路由' : channel.health === 'abnormal' ? '通道异常，不参与路由' : (routePositions.get(channel.id)?.join('、') || '未参与当前路由')}</span><small>{channel.lastUsedAt ? `最近命中 ${formatProviderTime(channel.lastUsedAt)}${channel.lastSelectedTask ? ` · ${providerTaskLabel(channel.lastSelectedTask)}` : ''}${channel.useCount ? ` · 累计 ${channel.useCount} 次` : ''}` : '尚无实际命中记录'}</small></span></td>
                <td><ProviderPriorityEditor channel={channel} busy={busyIds.has(channel.id)} onSave={onPrioritySave} /></td>
                <td>
                  <StatusPill tone={channel.health === 'healthy' ? 'success' : channel.health === 'degraded' ? 'warning' : channel.health === 'unknown' || channel.health === 'disabled' ? 'muted' : 'danger'}>
                    {channel.health === 'healthy' ? '健康' : channel.health === 'degraded' ? '降级' : channel.health === 'unknown' ? '待检测' : channel.health === 'disabled' ? '已停用' : '异常'}
                  </StatusPill>
                  <small className="admin-provider-checked-at">{channel.lastCheckedAt ? `检测于 ${formatProviderTime(channel.lastCheckedAt)}${channel.lastCheckLatencyMs ? ` · ${channel.lastCheckLatencyMs} ms` : ''}` : '尚未检测'}</small>
                  {channel.lastCheckError ? <small className="admin-provider-check-error" title={channel.lastCheckError}>{channel.lastCheckError}</small> : null}
                </td>
                <td><button className="admin-channel-test" type="button" disabled={busyIds.has(channel.id)} onClick={() => onTest(channel)}>{busyIds.has(channel.id) ? <LoaderCircle className="spin" size={14} /> : <Activity size={14} />}重新检测</button></td>
                <td>
                  <button className={`admin-toggle ${channel.enabled ? 'admin-toggle-on' : ''}`} type="button" aria-label={channel.readonly ? `${channel.name}由服务器配置管理` : `${channel.enabled ? '停用' : '启用'}${channel.name}`} aria-pressed={channel.enabled} disabled={channel.readonly || busyIds.has(channel.id)} onClick={() => onToggle(channel)}>
                    <span className="admin-toggle-knob" />
                  </button>
                </td>
                <td><button className="admin-provider-delete" type="button" disabled={channel.readonly || busyIds.has(channel.id)} onClick={() => onDelete(channel)} title={channel.readonly ? '服务器配置通道不能在此删除' : `删除${channel.name}`}><Trash2 size={15} /><span>删除</span></button></td>
              </tr>
            ))}
            {filteredChannels.length === 0 ? <tr><td className="admin-empty-cell" colSpan="9">没有匹配的模型通道</td></tr> : null}
          </tbody>
        </table>
      </div>
      <footer className="admin-table-footer">
        <span>共 {filteredChannels.length} 条</span>
        <div className="admin-pagination" aria-label="模型通道分页"><button type="button" aria-label="上一页" disabled><ChevronLeft size={15} /></button><button type="button" className="admin-page-current" aria-current="page" aria-label="第 1 页" disabled>1</button><button type="button" aria-label="下一页" disabled><ChevronRight size={15} /></button></div>
        <select aria-label="每页条数" defaultValue="10"><option value="10">10 条/页</option><option value="20">20 条/页</option></select>
      </footer>
    </section>
  )
}

function RoutingSummaryPanel({ channels }) {
  const enabledChannels = channels.filter(channelParticipatesInRouting).sort((left, right) => left.priority - right.priority)
  return (
    <section className="admin-panel admin-recent-panel">
      <PanelHeader title="当前首选路由" />
      <div className="admin-provider-route-overview">
        {providerRouteDefinitions.map((route) => {
          const selected = enabledChannels.find((channel) => channelSupportsRoute(channel, route))
          return <div key={route.id}><span>{route.summaryLabel}</span>{selected ? <strong>{selected.name}<small>{selected.model} · 优先级 {selected.priority}</small></strong> : <strong className="is-empty">未配置可用通道<small>需同时满足任务用途与输入能力</small></strong>}</div>
        })}
      </div>
    </section>
  )
}

function TrainingReadiness({ onAction }) {
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    let active = true
    api.getTrainingStats().then((response) => { if (active) setSummary(response.data?.summary || {}) }).catch(() => { if (active) setSummary(null) })
    return () => { active = false }
  }, [])
  const items = [
    { label: '候选样本', value: summary ? String(summary.total || 0) : '—', note: '真实候选池', tone: 'neutral' },
    { label: '待审核', value: summary ? String(summary.pendingReview || 0) : '—', note: '等待人工复核', tone: 'neutral' },
    { label: '已通过', value: summary ? String(summary.approved || 0) : '—', note: '可进入版本数据集', tone: 'positive' },
    { label: '已撤回', value: summary ? String(summary.revoked || 0) : '—', note: '不再允许训练', tone: 'negative' },
  ]
  return (
    <section className="admin-panel admin-training-ready">
      <PanelHeader title="训练素材就绪情况" />
      <div className="admin-training-stats">
        {items.map((item) => <div className="admin-training-stat" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small className={`admin-text-${item.tone}`}>{item.note}</small></div>)}
      </div>
      <div className="admin-readiness-row"><strong>审核完成率</strong><div className="admin-progress"><span style={{ width: `${summary?.total ? Math.round(((summary.approved || 0) + (summary.rejected || 0)) / summary.total * 100) : 0}%` }} /></div><b>{summary?.total ? Math.round(((summary.approved || 0) + (summary.rejected || 0)) / summary.total * 100) : 0}%</b></div>
    </section>
  )
}

const trainingStatusLabels = {
  pending_review: '待审核',
  approved: '已通过',
  rejected: '未通过',
  revoked: '已撤回',
}

const trainingStatusTones = {
  pending_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  revoked: 'muted',
}

function formatTrainingDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function TrainingMaterialsPage({ query }) {
  const [summary, setSummary] = useState(null)
  const [items, setItems] = useState([])
  const [pagination, setPagination] = useState({ offset: 0, limit: 20, total: 0 })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [refreshToken, setRefreshToken] = useState(0)

  const page = Math.floor(pagination.offset / pagination.limit) + 1
  const pageCount = Math.max(1, Math.ceil(pagination.total / pagination.limit))

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError('')
    const queryString = new URLSearchParams({
      offset: String(pagination.offset),
      limit: String(pagination.limit),
    }).toString()

    Promise.all([
      api.getTrainingStats(),
      api.getTrainingCandidates(queryString),
    ]).then(([statsResponse, candidatesResponse]) => {
      if (!active) return
      const listData = candidatesResponse.data || {}
      const nextPagination = listData.pagination || {}
      setSummary(statsResponse.data?.summary || listData.summary || {})
      setItems(Array.isArray(listData.items) ? listData.items : [])
      setPagination((current) => ({
        offset: Number(nextPagination.offset ?? current.offset),
        limit: Number(nextPagination.limit ?? current.limit),
        total: Number(nextPagination.total ?? listData.summary?.total ?? 0),
      }))
    }).catch((requestError) => {
      if (!active) return
      setItems([])
      setSummary(null)
      setLoadError(requestError.message || '训练素材加载失败，请稍后重试。')
    }).finally(() => {
      if (active) setLoading(false)
    })

    return () => { active = false }
  }, [pagination.offset, pagination.limit, refreshToken])

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return items
    return items.filter((item) => [
      item.sampleId,
      item.subject,
      item.grade,
      item.chapterTitle,
      trainingStatusLabels[item.status] || item.status,
    ].some((value) => String(value || '').toLocaleLowerCase('zh-CN').includes(keyword)))
  }, [items, query])

  const summaryItems = [
    { label: '候选素材', value: summary?.total, note: '已写入候选池', tone: 'neutral' },
    { label: '待审核', value: summary?.pendingReview, note: '等待人工复核', tone: 'neutral' },
    { label: '已通过', value: summary?.approved, note: '可进入后续数据流程', tone: 'positive' },
    { label: '未通过 / 已撤回', value: summary ? Number(summary.rejected || 0) + Number(summary.revoked || 0) : null, note: '不进入后续数据流程', tone: 'negative' },
  ]

  const goToPage = (nextPage) => {
    const boundedPage = Math.min(Math.max(nextPage, 1), pageCount)
    setPagination((current) => ({ ...current, offset: (boundedPage - 1) * current.limit }))
  }

  return (
    <>
      <div className="admin-page-heading">
        <div><h1>训练素材</h1><p>查看真实候选素材的审核状态与去标识处理结果</p></div>
        <div className="admin-page-actions">
          <button className="admin-button admin-button-secondary" type="button" onClick={() => setRefreshToken((current) => current + 1)} disabled={loading}>
            <RefreshCw size={17} className={loading ? 'admin-icon-spin' : undefined} />{loading ? '正在刷新…' : '刷新'}
          </button>
        </div>
      </div>

      {loadError ? <div className="admin-api-state admin-api-state-error" role="alert"><AlertTriangle size={18} /><span>{loadError}</span></div> : null}
      {loading && !summary ? <div className="admin-api-state" role="status"><Activity size={18} /><span>正在加载训练素材…</span></div> : null}

      <section className="admin-panel admin-training-summary-panel" aria-label="训练素材汇总">
        <div className="admin-training-stats">
          {summaryItems.map((item) => (
            <div className="admin-training-stat" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value === null || item.value === undefined ? '—' : String(item.value)}</strong>
              <small className={`admin-text-${item.tone}`}>{item.note}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-panel admin-training-list-panel">
        <PanelHeader title="候选素材列表"><span className="admin-panel-note">{query ? `当前页筛选：${query}` : '按提交时间倒序排列'}</span></PanelHeader>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <caption className="admin-sr-only">训练候选素材</caption>
            <thead><tr><th>素材 ID</th><th>学科</th><th>年级</th><th>章节</th><th>审核状态</th><th>去标识项</th><th>提交时间</th></tr></thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.sampleId}>
                  <td><code className="admin-training-sample-id" title={item.sampleId}>{item.sampleId}</code></td>
                  <td>{item.subject || '—'}</td>
                  <td>{item.grade || '—'}</td>
                  <td>{item.chapterTitle || '—'}</td>
                  <td><StatusPill tone={trainingStatusTones[item.status] || 'muted'}>{trainingStatusLabels[item.status] || item.status || '未知'}</StatusPill></td>
                  <td>{Number(item.redactionCount || 0)} 项</td>
                  <td>{formatTrainingDate(item.createdAt)}</td>
                </tr>
              ))}
              {!loading && filteredItems.length === 0 ? <tr><td className="admin-empty-cell" colSpan="7">{query ? '当前页没有匹配的素材' : '暂无候选素材'}</td></tr> : null}
              {loading && items.length === 0 ? <tr><td className="admin-empty-cell" colSpan="7">正在加载…</td></tr> : null}
            </tbody>
          </table>
        </div>
        <footer className="admin-table-footer">
          <span>共 {pagination.total} 条，第 {page} / {pageCount} 页</span>
          <div className="admin-pagination" aria-label="训练素材分页">
            <button type="button" aria-label="上一页" onClick={() => goToPage(page - 1)} disabled={loading || page <= 1}><ChevronLeft size={15} /></button>
            <button type="button" className="admin-page-current" aria-current="page" aria-label={`第 ${page} 页`} disabled>{page}</button>
            <button type="button" aria-label="下一页" onClick={() => goToPage(page + 1)} disabled={loading || page >= pageCount}><ChevronRight size={15} /></button>
          </div>
          <select aria-label="每页条数" value={pagination.limit} onChange={(event) => setPagination((current) => ({ ...current, offset: 0, limit: Number(event.target.value) }))} disabled={loading}>
            <option value="10">10 条 / 页</option><option value="20">20 条 / 页</option><option value="50">50 条 / 页</option>
          </select>
        </footer>
      </section>
    </>
  )
}

function AddChannelModal({ open, onClose, onAdd }) {
  const emptyForm = () => ({
    name: '',
    provider: modelProviderPresets[0].value,
    adapter: modelProviderPresets[0].adapter,
    baseUrl: modelProviderPresets[0].baseUrl,
    apiKey: '',
    model: '',
    capabilities: [],
    detectedCapabilities: normalizeDetectedCapabilities(),
    lastCheckedAt: null,
    priority: '7',
  })
  const emptyDetection = () => ({ state: 'idle', message: '', models: [], checkedModel: '' })
  const [form, setForm] = useState(emptyForm)
  const [detection, setDetection] = useState(emptyDetection)
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [probingModel, setProbingModel] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setForm(emptyForm())
      setDetection(emptyDetection())
      setError('')
      setSaving(false)
      setDetecting(false)
      setProbingModel(false)
      return undefined
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !saving && !detecting && !probingModel) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, saving, detecting, probingModel])

  if (!open) return null

  const resetDetection = () => {
    setDetection(emptyDetection())
    setForm((current) => ({ ...current, model: '', capabilities: [], detectedCapabilities: normalizeDetectedCapabilities(), lastCheckedAt: null }))
  }
  const updateField = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const updateCredentialField = (field) => (event) => {
    const value = event.target.value
    setForm((current) => ({ ...current, [field]: value, model: '', capabilities: [], detectedCapabilities: normalizeDetectedCapabilities(), lastCheckedAt: null }))
    setDetection(emptyDetection())
    setError('')
  }
  const updateProvider = (event) => {
    const preset = modelProviderPresets.find((item) => item.value === event.target.value)
    if (!preset) return
    setForm((current) => ({
      ...current,
      provider: preset.value,
      adapter: preset.adapter,
      baseUrl: preset.baseUrl,
      model: '',
      capabilities: [],
      detectedCapabilities: normalizeDetectedCapabilities(),
      lastCheckedAt: null,
    }))
    setDetection(emptyDetection())
    setError('')
  }

  const probeModel = async (model, sourceForm = form) => {
    if (!model || probingModel) return
    setProbingModel(true)
    setError('')
    setDetection((current) => ({ ...current, state: 'probing', checkedModel: model, message: `正在实测 ${model} 的文字、图片和 PDF 能力…` }))
    try {
      const response = await api.discoverProvider({
        providerType: sourceForm.provider,
        adapter: sourceForm.adapter,
        baseUrl: sourceForm.baseUrl,
        apiKey: sourceForm.apiKey,
        model,
      })
      const result = response.data?.result || response.data || {}
      const selected = result.selectedModel || normalizeDiscoveredModels(result).find((item) => item.id === model) || { id: model }
      const detectedCapabilities = normalizeDetectedCapabilities(selected.detectedCapabilities || selected)
      const adapter = selected.adapter || result.recommendedAdapter || result.adapter || sourceForm.adapter
      const capabilities = []
      if (detectedCapabilities.text === true) capabilities.push('lesson_generation', 'lesson_revision')
      if (detectedCapabilities.image === true || detectedCapabilities.pdf === true) capabilities.push('multimodal_input')
      const checkedAt = result.checkedAt || new Date().toISOString()
      setForm((current) => current.model === model ? { ...current, adapter, capabilities, detectedCapabilities: { ...detectedCapabilities, source: 'live_probe' }, lastCheckedAt: checkedAt } : current)
      setDetection((current) => ({
        ...current,
        state: 'verified',
        checkedModel: model,
        message: `${model} 能力实测完成，接口协议已自动选择为 ${adapter === 'openai_responses' ? 'Responses API' : 'Chat Completions'}。`,
      }))
    } catch (requestError) {
      setForm((current) => current.model === model ? { ...current, capabilities: [], detectedCapabilities: normalizeDetectedCapabilities(), lastCheckedAt: null } : current)
      setDetection((current) => ({ ...current, state: 'model-error', checkedModel: model, message: requestError.message || '模型能力检测失败。' }))
    } finally {
      setProbingModel(false)
    }
  }

  const handleDiscover = async () => {
    if (detecting || probingModel) return
    if (!form.baseUrl.trim() || !form.apiKey.trim()) {
      setError('请先填写 API Base URL 和 API Key。')
      return
    }
    setDetecting(true)
    setError('')
    setDetection({ state: 'connecting', message: '正在连接服务并读取可用模型列表…', models: [], checkedModel: '' })
    try {
      const response = await api.discoverProvider({
        providerType: form.provider,
        adapter: form.adapter,
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
      })
      const result = response.data?.result || response.data || {}
      const models = normalizeDiscoveredModels(result)
      if (!result.connected || models.length === 0) throw new Error(result.message || '连接成功，但接口没有返回可选择的模型。')
      const adapter = result.recommendedAdapter || result.adapter || form.adapter
      setForm((current) => ({ ...current, adapter, model: '', capabilities: [], detectedCapabilities: normalizeDetectedCapabilities(), lastCheckedAt: null }))
      setDetection({ state: 'connected', message: `连接成功，已发现 ${models.length} 个可用模型。请选择模型，系统会继续实测图片和 PDF 能力。`, models, checkedModel: '' })
    } catch (requestError) {
      resetDetection()
      setDetection({ state: 'connection-error', message: requestError.message || '连接检测失败，请核对地址、密钥和服务状态。', models: [], checkedModel: '' })
    } finally {
      setDetecting(false)
    }
  }

  const handleModelChange = async (event) => {
    const model = event.target.value
    const nextForm = { ...form, model, capabilities: [], detectedCapabilities: normalizeDetectedCapabilities(), lastCheckedAt: null }
    setForm(nextForm)
    if (!model) {
      setDetection((current) => ({ ...current, state: 'connected', checkedModel: '', message: `连接成功，已发现 ${current.models.length} 个可用模型。请选择需要使用的模型。` }))
      return
    }
    await probeModel(model, nextForm)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    if (detection.state !== 'verified' || detection.checkedModel !== form.model) {
      setError('请先完成连接检测并选择一个通过实测的模型。')
      return
    }
    if (!form.capabilities.some((item) => item === 'lesson_generation' || item === 'lesson_revision')) {
      setError('请至少选择“教案生成”或“对话修改”中的一项。')
      return
    }
    setSaving(true)
    setError('')
    try {
      await onAdd({ ...form })
      setForm(emptyForm())
      setDetection(emptyDetection())
    } catch (requestError) {
      setError(requestError.message || '模型通道保存失败，请检查配置后重试。')
    } finally {
      setSaving(false)
    }
  }

  const toggleCapability = (capability) => setForm((current) => ({
    ...current,
    capabilities: current.capabilities.includes(capability)
      ? current.capabilities.filter((item) => item !== capability)
      : [...current.capabilities, capability],
  }))
  const detectionBusy = detecting || probingModel
  const hasVerifiedModel = detection.state === 'verified' && detection.checkedModel === form.model

  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving && !detectionBusy) onClose() }}>
      <section className="admin-modal admin-provider-modal" role="dialog" aria-modal="true" aria-labelledby="admin-add-channel-title">
        <header className="admin-modal-header"><div><h2 id="admin-add-channel-title">添加模型通道</h2><p>先检测真实连接和模型能力，再决定该通道参与哪些任务。</p></div><button type="button" onClick={onClose} aria-label="关闭" disabled={saving || detectionBusy}><X size={20} /></button></header>
        <form className="admin-modal-form" onSubmit={handleSubmit}>
          <div className="admin-form-grid">
            <label><span>通道名称</span><input value={form.name} onChange={updateField('name')} placeholder="例如：第三方 GPT 主通道" required autoFocus disabled={saving} /></label>
            <label><span>供应商类型</span><select value={form.provider} onChange={updateProvider} disabled={saving || detectionBusy}>{modelProviderPresets.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          </div>
          <label><span>API Base URL</span><input value={form.baseUrl} onChange={updateCredentialField('baseUrl')} placeholder="https://api.example.com/v1" required disabled={saving || detectionBusy} /><small>应填写兼容接口的 API 根地址，末尾可以包含 /v1。</small></label>
          <label><span>API Key</span><input value={form.apiKey} onChange={updateCredentialField('apiKey')} type="password" autoComplete="new-password" placeholder="密钥仅用于本次检测，保存后只显示末四位" required disabled={saving || detectionBusy} /></label>
          <button className="admin-provider-discover-button" type="button" onClick={handleDiscover} disabled={saving || detectionBusy || !form.baseUrl.trim() || !form.apiKey.trim()}>{detecting ? <LoaderCircle className="spin" size={17} /> : <Activity size={17} />}{detecting ? '正在检测连接…' : '检测连接并发现模型'}</button>

          {detection.state !== 'idle' ? <div className={`admin-provider-detection admin-provider-detection-${detection.state.includes('error') ? 'error' : detection.state === 'verified' || detection.state === 'connected' ? 'success' : 'pending'}`} role={detection.state.includes('error') ? 'alert' : 'status'}>{detection.state === 'verified' || detection.state === 'connected' ? <CheckCircle2 size={18} /> : detection.state.includes('error') ? <AlertTriangle size={18} /> : <LoaderCircle className="spin" size={18} />}<p>{detection.message}</p></div> : null}

          <label><span>选择可用模型</span><select value={form.model} onChange={handleModelChange} required disabled={saving || detectionBusy || detection.models.length === 0}><option value="">{detection.models.length ? `请选择（已发现 ${detection.models.length} 个）` : '请先检测连接'}</option>{detection.models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select><small>选择后系统会真实调用该模型，分别验证文字、图片和 PDF。</small></label>

          <div className="admin-provider-capability-results" aria-label="所选模型能力检测结果">
            {[
              ['text', '文字生成'],
              ['image', '图片识别'],
              ['pdf', 'PDF 识别'],
            ].map(([key, label]) => {
              const value = hasVerifiedModel ? form.detectedCapabilities[key] : null
              return <div className={value === true ? 'is-supported' : value === false ? 'is-unsupported' : 'is-unknown'} key={key}><span>{label}</span><b>{value === true ? '实测支持' : value === false ? '实测不支持' : probingModel ? '检测中…' : hasVerifiedModel ? '暂无法确认' : '待检测'}</b></div>
            })}
          </div>

          <fieldset className="admin-capability-fieldset">
            <legend>参与任务（可多选）</legend>
            <div className="admin-capability-options">
              {[
                ['lesson_generation', '教案生成', form.detectedCapabilities.text === true],
                ['lesson_revision', '对话修改', form.detectedCapabilities.text === true],
              ].map(([value, label, supported]) => <label key={value}><input type="checkbox" checked={form.capabilities.includes(value)} onChange={() => toggleCapability(value)} disabled={saving || !hasVerifiedModel || !supported} /><span>{label}{hasVerifiedModel && !supported ? '（模型实测不支持）' : ''}</span></label>)}
            </div>
            <small>用途不再按供应商名称判断。图片与 PDF 属于所选模型的实测输入能力，不需要手动猜测或勾选；第三方模型实测支持后会自动参与对应教材任务。</small>
          </fieldset>
          <label><span>路由优先级</span><input value={form.priority} onChange={updateField('priority')} type="number" min="1" max="1000" required disabled={saving} /><small>多个通道同时启用时，先按任务能力筛选，再使用数字最小的通道；不是随机分配。</small></label>
          <div className="admin-modal-callout"><ShieldCheck size={18} /><p>API Key 会在服务端加密保存，页面、日志和接口响应均不会回显完整密钥。</p></div>
          {error ? <p className="admin-form-error" role="alert">{error}</p> : null}
          <footer className="admin-modal-footer"><button className="admin-button admin-button-secondary" type="button" onClick={onClose} disabled={saving || detectionBusy}>取消</button><button className="admin-button admin-button-primary" type="submit" disabled={saving || detectionBusy || !hasVerifiedModel}><Plus size={17} />{saving ? '正在保存…' : '保存并启用'}</button></footer>
        </form>
      </section>
    </div>
  )
}

function ModelChannelsPage({ query, onNotice }) {
  const [channels, setChannels] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [deleteCandidate, setDeleteCandidate] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busyIds, setBusyIds] = useState(() => new Set())

  useEffect(() => {
    let active = true
    setLoading(true)
    api.getProviders().then((response) => {
      if (!active) return
      const providers = response.data?.providers || response.data?.channels || []
      setChannels(providers.map(providerToChannel))
      setLoadError('')
    }).catch((requestError) => {
      if (!active) return
      setChannels([])
      setLoadError(requestError.message || '模型通道加载失败，请稍后重试。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false }
  }, [])

  const toggleChannel = async (channel) => {
    const nextEnabled = !channel.enabled
    setBusyIds((current) => new Set(current).add(channel.id))
    try {
      const response = await api.updateProvider(channel.id, { enabled: nextEnabled })
      const updatedProvider = response.data?.provider || response.data?.channel
      setChannels((current) => current.map((item) => item.id === channel.id ? (updatedProvider ? providerToChannel(updatedProvider) : { ...item, enabled: nextEnabled }) : item))
      onNotice(`${channel.name}已${nextEnabled ? '启用' : '停用'}`)
    } catch (requestError) {
      onNotice(`操作失败：${requestError.message}`)
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(channel.id)
        return next
      })
    }
  }
  const testChannel = async (channel) => {
    setBusyIds((current) => new Set(current).add(channel.id))
    try {
      const response = await api.testProvider(channel.id)
      const result = response.data?.result || response.data || {}
      const selected = result.selectedModel || {}
      const detectedCapabilities = normalizeDetectedCapabilities(selected.detectedCapabilities || selected.capabilities || result.detectedCapabilities)
      setChannels((current) => current.map((item) => item.id === channel.id ? {
        ...item,
        health: 'healthy',
        latency: Number.isFinite(Number(result.latencyMs)) ? `${result.latencyMs} ms` : item.latency,
        detectedCapabilities: { ...detectedCapabilities, source: 'live_probe' },
        lastCheckedAt: result.checkedAt || new Date().toISOString(),
        lastCheckLatencyMs: Number.isFinite(Number(result.latencyMs)) && Number(result.latencyMs) > 0 ? Number(result.latencyMs) : null,
        lastCheckError: null,
      } : item))
      const capabilityResultLabel = (label, value) => value === true ? `${label}可用` : value === false ? `${label}不可用` : `${label}暂无法确认`
      const abilityText = [
        capabilityResultLabel('文字', detectedCapabilities.text),
        capabilityResultLabel('图片', detectedCapabilities.image),
        capabilityResultLabel('PDF ', detectedCapabilities.pdf),
      ].join('、')
      onNotice(`${channel.name}连接成功，模型实测结果：${abilityText}`)
    } catch (requestError) {
      setChannels((current) => current.map((item) => item.id === channel.id ? {
        ...item,
        health: 'abnormal',
        lastCheckedAt: new Date().toISOString(),
        lastCheckLatencyMs: null,
        lastCheckError: requestError.message || '连接检测失败',
      } : item))
      onNotice(`连接测试失败：${requestError.message}`)
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(channel.id)
        return next
      })
    }
  }
  const savePriority = async (channel, priority) => {
    setBusyIds((current) => new Set(current).add(channel.id))
    try {
      const response = await api.updateProvider(channel.id, { priority })
      const updatedProvider = response.data?.provider || response.data?.channel
      setChannels((current) => current.map((item) => item.id === channel.id ? (updatedProvider ? providerToChannel(updatedProvider) : { ...item, priority }) : item))
      onNotice(`${channel.name}优先级已更新为 ${priority}`)
    } catch (requestError) {
      onNotice(`优先级保存失败：${requestError.message}`)
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(channel.id)
        return next
      })
    }
  }
  const deleteChannel = async () => {
    const channel = deleteCandidate
    if (!channel || channel.readonly) return
    setBusyIds((current) => new Set(current).add(channel.id))
    try {
      await api.deleteProvider(channel.id)
      setChannels((current) => current.filter((item) => item.id !== channel.id))
      setDeleteCandidate(null)
      onNotice(`模型通道“${channel.name}”已删除`)
    } catch (requestError) {
      onNotice(`删除失败：${requestError.message}`)
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(channel.id)
        return next
      })
    }
  }
  const addChannel = async (form) => {
    const response = await api.createProvider({
      name: form.name,
      displayName: form.name,
      provider: form.provider,
      providerType: form.provider,
      adapter: form.adapter,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      model: form.model,
      capabilities: form.capabilities,
      detectedCapabilities: form.detectedCapabilities,
      lastCheckedAt: form.lastCheckedAt,
      priority: Number(form.priority),
      enabled: true,
    })
    const provider = response.data?.provider || response.data?.channel
    if (!provider) throw new Error('服务端未返回新建模型通道。')
    setChannels((current) => [...current, providerToChannel(provider, current.length)].sort((left, right) => left.priority - right.priority))
    setModalOpen(false)
    onNotice(`模型通道“${form.name}”已添加并启用`)
  }
  return (
    <>
      <div className="admin-page-heading">
        <div><h1>AI模型通道</h1><p>管理与监控 AI 模型通道的健康状态、性能指标与使用情况</p></div>
        <div className="admin-page-actions">
          <button className="admin-button admin-button-primary" type="button" onClick={() => setModalOpen(true)}><Plus size={18} />添加模型通道</button>
        </div>
      </div>

      {loadError ? <div className="admin-api-state admin-api-state-error" role="alert"><AlertTriangle size={18} /><span>{loadError}</span></div> : null}
      {loading ? <div className="admin-api-state" role="status"><Activity size={18} /><span>正在加载模型通道…</span></div> : null}

      <div className="admin-model-metrics">
        <MetricCard label="已配置通道" value={String(channels.length)} note="来自服务端配置" tone="neutral" icon={Server} />
        <MetricCard label="已启用通道" value={String(channels.filter((item) => item.enabled).length)} note="可参与模型路由" tone="positive" icon={ShieldCheck} />
        <MetricCard label="健康通道" value={String(channels.filter((item) => item.health === 'healthy').length)} note="未检测显示为待检测" tone="neutral" icon={Activity} />
        <MetricCard label="已实测模型" value={String(channels.filter((item) => item.detectedCapabilities.source === 'live_probe').length)} note="能力来自真实模型调用" tone="neutral" icon={CheckCircle2} />
      </div>

      <ChannelHealthTable channels={channels} onToggle={toggleChannel} onTest={testChannel} onPrioritySave={savePriority} onDelete={setDeleteCandidate} query={query} busyIds={busyIds} />
      <div className="admin-model-insights">
        <RoutingSummaryPanel channels={channels} />
        <TrainingReadiness />
      </div>
      <AddChannelModal open={modalOpen} onClose={() => setModalOpen(false)} onAdd={addChannel} />
      {deleteCandidate ? <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyIds.has(deleteCandidate.id)) setDeleteCandidate(null) }}><section className="admin-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="admin-delete-provider-title"><div className="admin-confirm-icon"><Trash2 size={22} /></div><h2 id="admin-delete-provider-title">删除模型通道？</h2><p>将永久删除“{deleteCandidate.name}”及其加密密钥配置。删除后，该通道会立即退出所有任务路由。</p><div><button className="admin-button admin-button-secondary" type="button" onClick={() => setDeleteCandidate(null)} disabled={busyIds.has(deleteCandidate.id)}>取消</button><button className="admin-button admin-button-danger" type="button" onClick={deleteChannel} disabled={busyIds.has(deleteCandidate.id)}>{busyIds.has(deleteCandidate.id) ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}{busyIds.has(deleteCandidate.id) ? '正在删除…' : '确认删除'}</button></div></section></div> : null}
    </>
  )
}

function Sidebar({ activePage, collapsed, mobileOpen, onNavigate, onCollapse, onMobileClose }) {
  const { siteName } = useSiteConfig()
  return (
    <aside className={`admin-sidebar ${collapsed ? 'admin-sidebar-collapsed' : ''} ${mobileOpen ? 'admin-sidebar-mobile-open' : ''}`}>
      <div className="admin-brand"><span className="admin-brand-mark"><BookOpenCheck size={23} /></span><div className="admin-brand-copy"><strong>{siteName}</strong><span>管理后台</span></div><button className="admin-mobile-close" type="button" onClick={onMobileClose} aria-label="关闭导航"><X size={20} /></button></div>
      <nav className="admin-nav" aria-label="管理员导航">
        {navigationItems.map((item) => {
          const Icon = item.icon
          return <button className={`admin-nav-item ${activePage === item.id ? 'admin-nav-item-active' : ''}`} type="button" key={item.id} aria-current={activePage === item.id ? 'page' : undefined} title={collapsed ? item.label : undefined} onClick={() => onNavigate(item.id)}><Icon size={20} strokeWidth={1.8} /><span>{item.label}</span></button>
        })}
      </nav>
      <button className="admin-collapse-button" type="button" aria-label={collapsed ? '展开菜单' : '收起菜单'} onClick={onCollapse}>{collapsed ? <ChevronRight size={19} /> : <ChevronLeft size={19} />}<span>{collapsed ? '' : '收起菜单'}</span></button>
    </aside>
  )
}

function Topbar({ query, onQueryChange, onMenuOpen, alertOpen, onAlertToggle, profileOpen, onProfileToggle, onLogout, onNavigate, admin }) {
  return (
    <header className="admin-topbar">
      <button className="admin-menu-button" type="button" onClick={onMenuOpen} aria-label="打开导航"><Menu size={21} /></button>
      <label className="admin-search"><Search size={18} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="筛选当前页面的数据…" /></label>
      <div className="admin-top-actions">
        <div className="admin-popover-anchor">
          <button className="admin-top-action" type="button" onClick={onAlertToggle} aria-expanded={alertOpen}><Bell size={20} /><span>告警</span></button>
          {alertOpen ? <div className="admin-popover admin-alert-popover"><div className="admin-popover-heading"><strong>系统告警</strong></div><div className="admin-popover-empty"><CheckCircle2 size={18} /><span>当前没有需要处理的系统告警。</span></div></div> : null}
        </div>
        <div className="admin-popover-anchor">
          <button className="admin-profile-button" type="button" onClick={onProfileToggle} aria-expanded={profileOpen}><span className="admin-avatar"><UserRound size={22} /></span><span className="admin-profile-copy"><strong>{admin?.username || 'admin'}</strong><small>{admin?.role === 'super_admin' ? '超级管理员' : admin?.role || '管理员'}</small></span><ChevronDown size={16} /></button>
          {profileOpen ? <div className="admin-popover admin-profile-popover"><button type="button" onClick={() => onNavigate('securitySettings')}><ShieldCheck size={17} />安全设置</button><button type="button" onClick={onLogout}>退出登录</button></div> : null}
        </div>
      </div>
    </header>
  )
}

function AdminAccessPage({ mode, onAuthenticated }) {
  const { siteName } = useSiteConfig()
  const [form, setForm] = useState({ username: '', password: '', confirmPassword: '', code: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [challenge, setChallenge] = useState(null)
  const initializing = mode === 'uninitialized'

  const passwordChecks = {
    length: form.password.length >= 12 && form.password.length <= 128,
    categories: [
      /[a-z]/.test(form.password),
      /[A-Z]/.test(form.password),
      /\d/.test(form.password),
      /[^\p{L}\p{N}\s]/u.test(form.password),
      /\p{L}/u.test(form.password) && !/[A-Za-z]/.test(form.password),
    ].filter(Boolean).length >= 3,
    account: Boolean(form.username.trim()) && !form.password.toLocaleLowerCase().includes(form.username.trim().toLocaleLowerCase()),
    confirmed: Boolean(form.confirmPassword) && form.password === form.confirmPassword,
  }

  async function submit(event) {
    event.preventDefault()
    if (loading) return
    const username = form.username.trim()
    if (initializing) {
      if (!/^[\p{L}\p{N}_.@-]{3,100}$/u.test(username)) {
        setError('管理员账号需为 3-100 个字母、数字或 _ . @ -。')
        return
      }
      if (!passwordChecks.length || !passwordChecks.categories || !passwordChecks.account) {
        setError('请按照下方要求设置强密码。')
        return
      }
      if (!passwordChecks.confirmed) {
        setError('两次输入的密码不一致。')
        return
      }
    }
    setLoading(true)
    setError('')
    try {
      if (challenge) {
        const response = await api.adminVerifyMfa({ challengeId: challenge.id, code: form.code.trim() })
        onAuthenticated(response.data?.admin || { username: form.username, role: 'super_admin' })
        setForm({ username: '', password: '', confirmPassword: '', code: '' })
        setChallenge(null)
        return
      }
      const response = initializing
        ? await api.adminBootstrap({ username, password: form.password })
        : await api.adminLogin({ username, password: form.password })
      if (!initializing && response.data?.mfaRequired === true) {
        setChallenge(response.data.challenge)
        setForm((current) => ({ ...current, password: '', code: '' }))
        return
      }
      onAuthenticated(response.data?.admin || { username, role: 'super_admin' })
      setForm({ username: '', password: '', confirmPassword: '', code: '' })
    } catch (requestError) {
      if (requestError.code === 'ADMIN_ALREADY_INITIALIZED') {
        setForm((current) => ({ ...current, password: '', confirmPassword: '' }))
        setError('管理员已由其他会话完成初始化，请使用刚设置的账号登录。')
        onAuthenticated(null, 'loggedOut')
      } else if (requestError.code === 'ADMIN_NOT_INITIALIZED') {
        onAuthenticated(null, 'uninitialized')
      } else {
        setError(requestError.message || (initializing ? '初始化失败，请检查填写内容后重试。' : '管理员登录失败，请检查账号和密码。'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-access-page">
      <main className="admin-access-card">
        <div className="admin-access-brand"><span className="admin-brand-mark"><BookOpenCheck size={25} /></span><div><strong>{siteName}</strong><span>管理后台</span></div></div>
        {mode === 'checking' ? <div className="admin-access-state" role="status"><Activity className="spin" size={28} /><h1>正在验证管理员会话</h1><p>请稍候，系统正在确认当前浏览器的登录状态。</p></div> : null}
        {mode === 'uninitialized' ? <>
          <div className="admin-access-heading"><ShieldCheck size={24} /><div><h1>首次设置管理后台</h1><p>创建唯一的超级管理员。完成后本入口会自动关闭，并直接进入控制台。</p></div></div>
          <div className="admin-access-setup-callout"><AlertTriangle size={18} /><p>请在可信设备上立即完成设置。管理员账号创建后不可再次通过此页面初始化。</p></div>
          <form className="admin-access-form" onSubmit={submit} aria-busy={loading}>
            <label><span>管理员账号</span><input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} autoComplete="username" required autoFocus minLength="3" maxLength="100" disabled={loading} placeholder="例如：admin_zhang" /></label>
            <label><span>设置强密码</span><input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} autoComplete="new-password" required minLength="12" maxLength="128" disabled={loading} aria-describedby="admin-password-rules" /></label>
            <ul className="admin-password-rules" id="admin-password-rules" aria-live="polite">
              <li className={passwordChecks.length ? 'is-valid' : ''}>12-128 个字符</li>
              <li className={passwordChecks.categories ? 'is-valid' : ''}>大小写字母、数字、符号或中文中至少三类</li>
              <li className={passwordChecks.account ? 'is-valid' : ''}>不包含管理员账号</li>
            </ul>
            <label><span>确认密码</span><input type="password" value={form.confirmPassword} onChange={(event) => setForm((current) => ({ ...current, confirmPassword: event.target.value }))} autoComplete="new-password" required minLength="12" maxLength="128" disabled={loading} /></label>
            {error ? <p className="admin-form-error" role="alert">{error}</p> : null}
            <button className="admin-button admin-button-primary admin-button-full" type="submit" disabled={loading}>{loading ? '正在安全初始化…' : '创建管理员并进入后台'}</button>
          </form>
          <p className="admin-access-note"><ShieldCheck size={15} /> 密码仅以 scrypt 哈希保存；成功后会通过 HttpOnly Cookie 建立管理员会话。</p>
        </> : null}
        {mode === 'loggedOut' && challenge ? <>
          <div className="admin-access-heading"><KeyRound size={24} /><div><h1>输入验证码</h1><p>{challenge.delivery === 'failed' ? (challenge.notice || '验证码暂时无法送达，请使用恢复码。') : challenge.destination ? `验证码已发送至 ${challenge.destination}` : '请输入身份验证器中显示的验证码。'}</p></div></div>
          <form className="admin-access-form" onSubmit={submit} aria-busy={loading}>
            <label><span>验证码</span><input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.trim().slice(0, 32) }))} inputMode={challenge.recoveryCodeAccepted ? 'text' : 'numeric'} autoComplete="one-time-code" required autoFocus disabled={loading} placeholder="6 位验证码或恢复码" /></label>
            {error ? <p className="admin-form-error" role="alert">{error}</p> : null}
            <button className="admin-button admin-button-primary admin-button-full" type="submit" disabled={loading}>{loading ? '正在验证…' : '验证并进入后台'}</button>
            <button className="admin-access-back" type="button" onClick={() => { setChallenge(null); setForm((current) => ({ ...current, code: '' })); setError('') }} disabled={loading}>返回账号密码登录</button>
          </form>
          <p className="admin-access-note"><ShieldCheck size={15} /> 验证码短时有效且只能使用一次；连续输错会暂时锁定本次验证。</p>
        </> : null}
        {mode === 'loggedOut' && !challenge ? <>
          <div className="admin-access-heading"><ShieldCheck size={24} /><div><h1>管理员登录</h1><p>使用部署时设置的管理员账号进入控制台。</p></div></div>
          <form className="admin-access-form" onSubmit={submit} aria-busy={loading}>
            <label><span>管理员账号</span><input value={form.username} onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))} autoComplete="username" required autoFocus disabled={loading} /></label>
            <label><span>密码</span><input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} autoComplete="current-password" required minLength="8" disabled={loading} /></label>
            {error ? <p className="admin-form-error" role="alert">{error}</p> : null}
            <button className="admin-button admin-button-primary admin-button-full" type="submit" disabled={loading}>{loading ? '正在登录…' : '安全登录'}</button>
          </form>
          <p className="admin-access-note"><ShieldCheck size={15} /> 会话由服务器通过 HttpOnly Cookie 管理，前端不会保存管理员令牌。</p>
        </> : null}
      </main>
    </div>
  )
}

export default function AdminApp() {
  const [authState, setAuthState] = useState('checking')
  const [admin, setAdmin] = useState(null)
  const [activePage, setActivePage] = useState('models')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [alertOpen, setAlertOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    api.adminSession().then((response) => {
      if (!active) return
      if (response.data?.initialized === false) {
        setAuthState('uninitialized')
        return
      }
      const currentAdmin = response.data?.admin
      if (currentAdmin || response.data?.authenticated === true) {
        setAdmin(currentAdmin || { username: 'admin', role: 'super_admin' })
        setAuthState('authenticated')
      } else {
        setAuthState('loggedOut')
      }
    }).catch((requestError) => {
      if (!active) return
      setAuthState(requestError.code === 'ADMIN_NOT_INITIALIZED' ? 'uninitialized' : 'loggedOut')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(''), 2800)
    return () => window.clearTimeout(timer)
  }, [notice])

  const navigate = (pageId) => {
    setActivePage(pageId)
    setQuery('')
    setMobileSidebarOpen(false)
  }

  const authenticate = (nextAdmin, forcedState) => {
    if (forcedState) {
      setAuthState(forcedState)
      return
    }
    setAdmin(nextAdmin)
    setAuthState('authenticated')
  }

  const logout = async () => {
    try {
      await api.adminLogout()
      setAdmin(null)
      setProfileOpen(false)
      setAuthState('loggedOut')
    } catch (requestError) {
      setNotice(`退出失败：${requestError.message}`)
    }
  }

  if (authState !== 'authenticated') return <AdminAccessPage mode={authState} onAuthenticated={authenticate} />

  const noticeIsWarning = /失败|错误|未完成|无法|尚未|未启用/.test(notice)

  let pageContent
  if (activePage === 'models') pageContent = <ModelChannelsPage query={query} onNotice={setNotice} />
  else if (activePage === 'users') pageContent = <UserManagementPage query={query} onQueryChange={setQuery} onNotice={setNotice} />
  else if (activePage === 'training') pageContent = <TrainingMaterialsPage query={query} />
  else if (activePage === 'knowledgeGraph') pageContent = <KnowledgeGraphAdminPage onNotice={setNotice} />
  else if (activePage === 'questionBank') pageContent = <QuestionBankAdminPage onNotice={setNotice} />
  else if (activePage === 'organizations') pageContent = <OrganizationsAdminPage onNotice={setNotice} />
  else if (activePage === 'plans') pageContent = <MembershipPlansPage onNotice={setNotice} />
  else if (activePage === 'promotions') pageContent = <PromotionsPage onNotice={setNotice} />
  else if (activePage === 'marketing') pageContent = <MarketingPage onNotice={setNotice} />
  else if (activePage === 'referrals') pageContent = <ReferralRewardsPage onNotice={setNotice} />
  else if (activePage === 'announcements') pageContent = <ContentManagementPage initialSection="announcements" onNotice={setNotice} />
  else if (activePage === 'tutorial') pageContent = <ContentManagementPage initialSection="tutorial" onNotice={setNotice} />
  else if (activePage === 'paymentChannels') pageContent = <PaymentChannelsPage onNotice={setNotice} />
  else if (activePage === 'orders') pageContent = <OrdersPage query={query} onNotice={setNotice} />
  else if (activePage === 'securitySettings') pageContent = <SecuritySettingsPage onNotice={setNotice} />
  else if (activePage === 'settings') pageContent = <SystemSettingsPage onNotice={setNotice} />
  else pageContent = <ModelChannelsPage query={query} onNotice={setNotice} />

  return (
    <div className={`admin-app ${sidebarCollapsed ? 'admin-app-sidebar-collapsed' : ''}`}>
      <Sidebar activePage={activePage} collapsed={sidebarCollapsed} mobileOpen={mobileSidebarOpen} onNavigate={navigate} onCollapse={() => setSidebarCollapsed((current) => !current)} onMobileClose={() => setMobileSidebarOpen(false)} />
      {mobileSidebarOpen ? <button className="admin-mobile-overlay" type="button" aria-label="关闭导航" onClick={() => setMobileSidebarOpen(false)} /> : null}
      <div className="admin-shell">
        <Topbar query={query} onQueryChange={setQuery} onMenuOpen={() => setMobileSidebarOpen(true)} alertOpen={alertOpen} onAlertToggle={() => { setAlertOpen((current) => !current); setProfileOpen(false) }} profileOpen={profileOpen} onProfileToggle={() => { setProfileOpen((current) => !current); setAlertOpen(false) }} onLogout={logout} onNavigate={navigate} admin={admin} />
        <main className="admin-main">{pageContent}</main>
      </div>
      {notice ? <div className={`admin-toast ${noticeIsWarning ? 'admin-toast-warning' : ''}`} role="status">{noticeIsWarning ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}<span>{notice}</span></div> : null}
    </div>
  )
}
