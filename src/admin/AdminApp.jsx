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
  GraduationCap,
  KeyRound,
  ListChecks,
  Menu,
  Network,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { KnowledgeGraphAdminPage, OrganizationsAdminPage, QuestionBankAdminPage } from './DomainManagementPages.jsx'
import { SecuritySettingsPage } from './SecuritySettingsPage.jsx'
import { PaymentSettingsPage } from './PaymentSettingsPage.jsx'
import { SystemSettingsPage } from './SystemSettingsPage.jsx'
import { UserManagementPage } from './UserManagementPage.jsx'
import './admin.css'

const navigationItems = [
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'organizations', label: '学校与组织', icon: Building2 },
  { id: 'memberships', label: '会员与套餐', icon: GraduationCap },
  { id: 'promotions', label: '优惠活动', icon: BadgePercent },
  { id: 'knowledgeGraph', label: '教学认知图谱', icon: Network },
  { id: 'questionBank', label: '题库管理', icon: ListChecks },
  { id: 'models', label: 'AI模型通道', icon: Bot },
  { id: 'training', label: '训练素材', icon: Database },
  { id: 'orders', label: '支付与订单', icon: ReceiptText },
  { id: 'securitySettings', label: '安全与通信', icon: KeyRound },
  { id: 'settings', label: '系统设置', icon: Settings },
]

function providerToChannel(provider, index = 0) {
  const health = provider.health || provider.healthCheck?.status || 'unknown'
  const normalizedHealth = health === 'unhealthy' ? 'abnormal' : health
  const model = provider.model || provider.models?.generation?.modelId || provider.models?.generation || provider.models?.revision?.modelId || '未配置'
  return {
    id: provider.id || provider.providerId,
    name: provider.displayName || provider.name || `模型通道 ${index + 1}`,
    model,
    purpose: provider.purpose || '教案生成',
    priority: Number(provider.priority ?? provider.routing?.taskPriority?.generation ?? index + 1),
    latency: provider.latency || provider.averageLatency || '待检测',
    success: provider.success || provider.successRate || '—',
    health: normalizedHealth,
    enabled: provider.enabled === true,
    keyLastFour: provider.keyLastFour || provider.auth?.keyLastFour || '',
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

function ChannelHealthTable({ channels, onToggle, query, busyIds }) {
  const normalizedQuery = query.trim().toLowerCase()
  const filteredChannels = channels.filter((channel) => !normalizedQuery || Object.values(channel).join(' ').toLowerCase().includes(normalizedQuery))

  return (
    <section className="admin-panel admin-channel-panel">
      <PanelHeader title="通道健康状态" />
      <div className="admin-table-wrap">
        <table className="admin-table admin-channel-table">
          <caption className="admin-sr-only">AI 模型通道健康状态</caption>
          <thead><tr><th>通道名称</th><th>模型</th><th>用途</th><th>优先级</th><th>平均延迟</th><th>成功率</th><th>状态</th><th>启用</th></tr></thead>
          <tbody>
            {filteredChannels.map((channel) => (
              <tr key={channel.id}>
                <td><span className={`admin-health-dot admin-health-dot-${channel.health}`} />{channel.name}</td>
                <td>{channel.model}</td>
                <td>{channel.purpose}</td>
                <td>{channel.priority}</td>
                <td>{channel.latency}</td>
                <td>{channel.success}</td>
                <td>
                  <StatusPill tone={channel.health === 'healthy' ? 'success' : channel.health === 'degraded' ? 'warning' : channel.health === 'unknown' || channel.health === 'disabled' ? 'muted' : 'danger'}>
                    {channel.health === 'healthy' ? '健康' : channel.health === 'degraded' ? '降级' : channel.health === 'unknown' ? '待检测' : channel.health === 'disabled' ? '已停用' : '异常'}
                  </StatusPill>
                </td>
                <td>
                  <button className={`admin-toggle ${channel.enabled ? 'admin-toggle-on' : ''}`} type="button" aria-label={`${channel.enabled ? '停用' : '启用'}${channel.name}`} aria-pressed={channel.enabled} disabled={busyIds.has(channel.id)} onClick={() => onToggle(channel)}>
                    <span className="admin-toggle-knob" />
                  </button>
                </td>
              </tr>
            ))}
            {filteredChannels.length === 0 ? <tr><td className="admin-empty-cell" colSpan="8">没有匹配的模型通道</td></tr> : null}
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

function RecentTasksPanel() {
  const filteredTasks = []
  return (
    <section className="admin-panel admin-recent-panel">
      <PanelHeader title="近期任务" />
      <div className="admin-table-wrap">
        <table className="admin-table admin-task-table">
          <caption className="admin-sr-only">近期 AI 任务</caption>
          <thead><tr><th>时间</th><th>任务ID</th><th>模型/通道</th><th>任务类型</th><th>状态</th></tr></thead>
          <tbody>
            {filteredTasks.map((task) => (
              <tr key={task.id}>
                <td>{task.time}</td><td>{task.id}</td><td><span>{task.model}</span><small>{task.channel}</small></td><td>{task.type}</td>
                <td><span className="admin-task-state admin-task-state-muted"><i />{task.status}</span></td>
              </tr>
            ))}
            {filteredTasks.length === 0 ? <tr><td className="admin-empty-cell" colSpan="5">暂无近期调用任务</td></tr> : null}
          </tbody>
        </table>
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
  const [form, setForm] = useState({ name: '', provider: 'OpenAI Compatible', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '', purpose: '教案生成', priority: '7' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) {
      setForm((current) => current.apiKey ? { ...current, apiKey: '' } : current)
      setError('')
      setSaving(false)
      return undefined
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const updateField = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }))
  const handleSubmit = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError('')
    const submitted = { ...form }
    setForm((current) => ({ ...current, apiKey: '' }))
    try {
      await onAdd(submitted)
      setForm({ name: '', provider: 'OpenAI Compatible', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: '', purpose: '教案生成', priority: '7' })
    } catch (requestError) {
      setError(requestError.message || '模型通道保存失败，请检查配置后重试。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-add-channel-title">
        <header className="admin-modal-header"><div><h2 id="admin-add-channel-title">添加模型通道</h2><p>接入 OpenAI Compatible 或其他大模型服务。</p></div><button type="button" onClick={onClose} aria-label="关闭"><X size={20} /></button></header>
        <form className="admin-modal-form" onSubmit={handleSubmit}>
          <div className="admin-form-grid">
            <label><span>通道名称</span><input value={form.name} onChange={updateField('name')} placeholder="例如：通道-7（备用）" required autoFocus disabled={saving} /></label>
            <label><span>供应商类型</span><select value={form.provider} onChange={updateField('provider')} disabled={saving}><option>OpenAI Compatible</option><option>OpenAI</option><option>阿里云百炼</option><option>火山方舟</option><option>自研模型</option></select></label>
          </div>
          <label><span>API Base URL</span><input value={form.baseUrl} onChange={updateField('baseUrl')} placeholder="https://api.example.com/v1" required disabled={saving} /></label>
          <label><span>API Key</span><input value={form.apiKey} onChange={updateField('apiKey')} type="password" autoComplete="new-password" placeholder="密钥保存后仅显示末四位" required disabled={saving} /></label>
          <div className="admin-form-grid">
            <label><span>模型名称</span><input value={form.model} onChange={updateField('model')} placeholder="例如：gpt-4.1-mini" required disabled={saving} /></label>
            <label><span>主要用途</span><select value={form.purpose} onChange={updateField('purpose')} disabled={saving}><option>教案生成</option><option>视觉识别</option><option>对话修改</option><option>向量嵌入</option></select></label>
          </div>
          <label><span>路由优先级</span><input value={form.priority} onChange={updateField('priority')} type="number" min="1" max="99" required disabled={saving} /><small>数字越小，调用优先级越高。</small></label>
          <div className="admin-modal-callout"><ShieldCheck size={18} /><p>密钥将以加密形式保存，页面、日志和任务响应中不会返回完整内容。</p></div>
          {error ? <p className="admin-form-error" role="alert">{error}</p> : null}
          <footer className="admin-modal-footer"><button className="admin-button admin-button-secondary" type="button" onClick={onClose} disabled={saving}>取消</button><button className="admin-button admin-button-primary" type="submit" disabled={saving}><Plus size={17} />{saving ? '正在保存…' : '保存并启用'}</button></footer>
        </form>
      </section>
    </div>
  )
}

function ModelChannelsPage({ query, onNotice }) {
  const [channels, setChannels] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
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
  const addChannel = async (form) => {
    const response = await api.createProvider({
      name: form.name,
      displayName: form.name,
      provider: form.provider,
      baseUrl: form.baseUrl,
      apiKey: form.apiKey,
      model: form.model,
      purpose: form.purpose,
      priority: Number(form.priority),
      enabled: true,
    })
    const provider = response.data?.provider || response.data?.channel
    if (!provider) throw new Error('服务端未返回新建模型通道。')
    setChannels((current) => [...current, providerToChannel(provider, current.length)])
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
        <MetricCard label="今日调用与成本" value="—" note="暂无可用量数据" tone="neutral" icon={ReceiptText} />
      </div>

      <div className="admin-model-layout">
        <div className="admin-model-main-column">
          <section className="admin-panel admin-chart-panel">
            <PanelHeader title="调用量与预估成本" />
            <div className="admin-empty-metric"><Activity size={22} /><div><b>尚无可核验的用量日志</b><p>当前没有可用于计算调用量、延迟和成本的数据。</p></div></div>
          </section>
          <ChannelHealthTable channels={channels} onToggle={toggleChannel} query={query} busyIds={busyIds} />
        </div>
        <div className="admin-model-side-column">
          <RecentTasksPanel query={query} />
          <TrainingReadiness />
        </div>
      </div>
      <AddChannelModal open={modalOpen} onClose={() => setModalOpen(false)} onAdd={addChannel} />
    </>
  )
}

function Sidebar({ activePage, collapsed, mobileOpen, onNavigate, onCollapse, onMobileClose }) {
  return (
    <aside className={`admin-sidebar ${collapsed ? 'admin-sidebar-collapsed' : ''} ${mobileOpen ? 'admin-sidebar-mobile-open' : ''}`}>
      <div className="admin-brand"><span className="admin-brand-mark"><BookOpenCheck size={23} /></span><div className="admin-brand-copy"><strong>教师帮</strong><span>管理后台</span></div><button className="admin-mobile-close" type="button" onClick={onMobileClose} aria-label="关闭导航"><X size={20} /></button></div>
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
        <div className="admin-access-brand"><span className="admin-brand-mark"><BookOpenCheck size={25} /></span><div><strong>教师帮</strong><span>管理后台</span></div></div>
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
  else if (activePage === 'users') pageContent = <UserManagementPage query={query} onQueryChange={setQuery} />
  else if (activePage === 'training') pageContent = <TrainingMaterialsPage query={query} />
  else if (activePage === 'knowledgeGraph') pageContent = <KnowledgeGraphAdminPage onNotice={setNotice} />
  else if (activePage === 'questionBank') pageContent = <QuestionBankAdminPage onNotice={setNotice} />
  else if (activePage === 'organizations') pageContent = <OrganizationsAdminPage onNotice={setNotice} />
  else if (['orders', 'memberships', 'promotions'].includes(activePage)) pageContent = <PaymentSettingsPage onNotice={setNotice} />
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
