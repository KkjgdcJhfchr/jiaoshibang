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
  CircleDollarSign,
  CircleHelp,
  ClipboardList,
  CreditCard,
  Database,
  FileCheck2,
  GraduationCap,
  LayoutDashboard,
  KeyRound,
  LifeBuoy,
  ListChecks,
  Menu,
  MoreHorizontal,
  Network,
  Plus,
  ReceiptText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserRound,
  Users,
  X,
  Zap,
} from 'lucide-react'
import { api } from '../lib/api.js'
import { KnowledgeGraphAdminPage, OrganizationsAdminPage, QuestionBankAdminPage } from './DomainManagementPages.jsx'
import { SecuritySettingsPage } from './SecuritySettingsPage.jsx'
import { PaymentSettingsPage } from './PaymentSettingsPage.jsx'
import './admin.css'

const navigationItems = [
  { id: 'overview', label: '数据概览', icon: LayoutDashboard },
  { id: 'users', label: '用户管理', icon: Users },
  { id: 'organizations', label: '学校与组织', icon: Building2 },
  { id: 'memberships', label: '会员与套餐', icon: GraduationCap },
  { id: 'promotions', label: '优惠活动', icon: BadgePercent },
  { id: 'tasks', label: '教案任务', icon: ClipboardList },
  { id: 'knowledgeGraph', label: '教学认知图谱', icon: Network },
  { id: 'questionBank', label: '题库管理', icon: ListChecks },
  { id: 'models', label: 'AI模型通道', icon: Bot },
  { id: 'training', label: '训练素材', icon: Database },
  { id: 'safety', label: '内容安全', icon: ShieldCheck },
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

const managementPages = {
  overview: {
    title: '数据概览',
    description: '实时掌握教师使用、教案产出与平台运营趋势',
    action: '导出经营日报',
    metrics: [
      { label: '今日活跃教师', value: '8,412', note: '较昨日 +12.4%', tone: 'positive', icon: Users },
      { label: '今日完成教案', value: '12,842', note: '完成率 96.8%', tone: 'positive', icon: FileCheck2 },
      { label: '会员转化率', value: '8.26%', note: '近 7 日 +0.7%', tone: 'positive', icon: TrendingUp },
      { label: '今日平台收入', value: '¥ 86,420', note: '退款率 0.31%', tone: 'neutral', icon: CircleDollarSign },
    ],
    columns: [
      ['time', '时间'], ['event', '运营事件'], ['source', '来源'], ['owner', '负责人'], ['status', '状态'],
    ],
    rows: [
      { time: '11:42', event: '小学语文教案生成量突破今日目标', source: '实时指标', owner: '系统', status: '已达成' },
      { time: '11:18', event: '暑期备课年卡活动开始放量', source: '优惠活动', owner: '陈老师', status: '进行中' },
      { time: '10:56', event: '华东地区新注册用户增长异常', source: '用户分析', owner: '李敏', status: '待关注' },
      { time: '10:21', event: 'AI 主通道成功率恢复至 99.5%', source: '模型监控', owner: '系统', status: '已恢复' },
      { time: '09:45', event: '昨日日报已生成并发送', source: '自动报表', owner: '系统', status: '已完成' },
    ],
    insights: [
      { label: '生成目标完成度', value: 78 },
      { label: '本月收入目标', value: 64 },
      { label: '会员续费健康度', value: 86 },
    ],
  },
  users: {
    title: '用户管理',
    description: '查看教师资料、会员权益、额度与账号风险',
    action: '新建内部账号',
    metrics: [
      { label: '累计注册用户', value: '128,736', note: '本周新增 4,286', tone: 'positive', icon: Users },
      { label: '今日新增', value: '1,086', note: '注册转化 32.7%', tone: 'positive', icon: UserRound },
      { label: '付费会员', value: '18,642', note: '占比 14.5%', tone: 'neutral', icon: GraduationCap },
      { label: '风险账号', value: '23', note: '7 个待复核', tone: 'warning', icon: AlertTriangle },
    ],
    columns: [
      ['id', '用户ID'], ['name', '教师'], ['subject', '任教学科'], ['plan', '会员'], ['quota', '剩余额度'], ['lastSeen', '最近活跃'], ['status', '状态'],
    ],
    rows: [
      { id: 'U-102893', name: '林舒雅', subject: '小学语文', plan: '专业年卡', quota: '168 次', lastSeen: '3 分钟前', status: '正常' },
      { id: 'U-102892', name: '周启明', subject: '初中数学', plan: '基础月卡', quota: '21 次', lastSeen: '8 分钟前', status: '正常' },
      { id: 'U-102886', name: '宋佳', subject: '高中英语', plan: '免费版', quota: '1 次', lastSeen: '22 分钟前', status: '待验证' },
      { id: 'U-102871', name: '何超', subject: '初中物理', plan: '专业年卡', quota: '96 次', lastSeen: '1 小时前', status: '正常' },
      { id: 'U-102864', name: '谢楠', subject: '小学数学', plan: '免费版', quota: '0 次', lastSeen: '2 小时前', status: '受限' },
    ],
    insights: [
      { label: '资料完整率', value: 82 },
      { label: '7 日留存率', value: 71 },
      { label: '账号健康度', value: 96 },
    ],
  },
  memberships: {
    title: '会员与套餐',
    description: '管理套餐价格、生成额度与各项会员权益',
    action: '创建套餐',
    metrics: [
      { label: '在售套餐', value: '6', note: '2 个限时套餐', tone: 'neutral', icon: CreditCard },
      { label: '有效会员', value: '18,642', note: '本月 +1,246', tone: 'positive', icon: GraduationCap },
      { label: '月度续费率', value: '72.8%', note: '较上月 +2.1%', tone: 'positive', icon: TrendingUp },
      { label: '会员月收入', value: '¥ 486,920', note: '目标完成 81%', tone: 'neutral', icon: CircleDollarSign },
    ],
    columns: [
      ['name', '套餐名称'], ['cycle', '计费周期'], ['price', '售价'], ['quota', '生成额度'], ['members', '有效会员'], ['conversion', '转化率'], ['status', '状态'],
    ],
    rows: [
      { name: '免费体验版', cycle: '长期', price: '¥0', quota: '3 次/月', members: '91,328', conversion: '—', status: '在售' },
      { name: '基础月卡', cycle: '按月', price: '¥39', quota: '40 次/月', members: '6,284', conversion: '6.8%', status: '在售' },
      { name: '专业月卡', cycle: '按月', price: '¥79', quota: '120 次/月', members: '4,126', conversion: '8.4%', status: '在售' },
      { name: '专业年卡', cycle: '按年', price: '¥699', quota: '1,800 次/年', members: '7,902', conversion: '12.1%', status: '主推' },
      { name: '教研组版', cycle: '按年', price: '¥2,999', quota: '8,000 次/年', members: '330', conversion: '2.6%', status: '内测' },
    ],
    insights: [
      { label: '年卡销售占比', value: 58 },
      { label: '权益使用率', value: 67 },
      { label: '到期续费意向', value: 74 },
    ],
  },
  promotions: {
    title: '优惠活动',
    description: '配置限时折扣、优惠码和会员赠送活动',
    action: '新建优惠活动',
    metrics: [
      { label: '进行中活动', value: '8', note: '3 个今日结束', tone: 'warning', icon: BadgePercent },
      { label: '今日优惠订单', value: '1,286', note: '转化率 16.8%', tone: 'positive', icon: ReceiptText },
      { label: '带动收入', value: '¥ 62,418', note: '投入产出比 4.6', tone: 'positive', icon: CircleDollarSign },
      { label: '待发布活动', value: '4', note: '2 个待审核', tone: 'neutral', icon: ClipboardList },
    ],
    columns: [
      ['name', '活动名称'], ['type', '优惠类型'], ['audience', '适用人群'], ['period', '活动时间'], ['used', '已使用'], ['revenue', '带动收入'], ['status', '状态'],
    ],
    rows: [
      { name: '暑期备课季', type: '年卡 8 折', audience: '全部用户', period: '05-18 至 06-18', used: '3,842', revenue: '¥188,236', status: '进行中' },
      { name: '新教师首购礼', type: '立减 ¥20', audience: '注册 7 日内', period: '长期', used: '8,293', revenue: '¥276,102', status: '进行中' },
      { name: '老会员续费礼', type: '赠 30 次额度', audience: '到期前 30 日', period: '05-01 至 05-31', used: '962', revenue: '¥92,014', status: '进行中' },
      { name: '618 教研组专享', type: '满 2000 减 300', audience: '教研组', period: '06-01 至 06-20', used: '0', revenue: '¥0', status: '待发布' },
      { name: '五一限时券', type: '月卡 85 折', audience: '全部用户', period: '05-01 至 05-05', used: '2,105', revenue: '¥68,732', status: '已结束' },
    ],
    insights: [
      { label: '活动预算使用', value: 73 },
      { label: '优惠核销率', value: 61 },
      { label: '新增会员贡献', value: 69 },
    ],
  },
  tasks: {
    title: '教案任务',
    description: '跟踪教材识别、教案生成、修改和导出任务',
    action: '导出任务日志',
    metrics: [
      { label: '今日任务', value: '18,642', note: '运行中 236', tone: 'neutral', icon: ClipboardList },
      { label: '任务成功率', value: '98.91%', note: '较昨日 +0.18%', tone: 'positive', icon: CheckCircle2 },
      { label: '平均完成时间', value: '42.8 s', note: '缩短 3.4 秒', tone: 'positive', icon: Zap },
      { label: '需人工处理', value: '36', note: '12 个高优先级', tone: 'warning', icon: AlertTriangle },
    ],
    columns: [
      ['id', '任务ID'], ['teacher', '教师'], ['lesson', '章节'], ['stage', '任务阶段'], ['model', '使用模型'], ['duration', '耗时'], ['status', '状态'],
    ],
    rows: [
      { id: 'task_889312', teacher: '林舒雅', lesson: '《草船借箭》', stage: '教案生成', model: 'gpt-4o', duration: '38.6 s', status: '成功' },
      { id: 'task_889311', teacher: '周启明', lesson: '二次函数', stage: '教材识别', model: 'qwen-1.5-vl', duration: '12.1 s', status: '成功' },
      { id: 'task_889310', teacher: '何超', lesson: '浮力', stage: '对话修改', model: 'deepseek-chat', duration: '60.0 s', status: '超时' },
      { id: 'task_889308', teacher: '宋佳', lesson: 'Unit 4 Reading', stage: '教材识别', model: 'qwen-1.5-vl', duration: '8.4 s', status: '失败' },
      { id: 'task_889305', teacher: '谢楠', lesson: '分数的意义', stage: '教案生成', model: 'qwen-plus', duration: '—', status: '排队中' },
    ],
    insights: [
      { label: '队列消化能力', value: 88 },
      { label: '结构校验通过率', value: 97 },
      { label: '用户满意完成率', value: 84 },
    ],
  },
  training: {
    title: '训练素材',
    description: '管理已授权教案、教材与习题的审核和数据集准备',
    action: '上传训练素材',
    metrics: [
      { label: '已同意样本', value: '28,736', note: '今日 +536', tone: 'positive', icon: Database },
      { label: '已审核样本', value: '25,892', note: '通过率 90.1%', tone: 'positive', icon: FileCheck2 },
      { label: '待脱敏', value: '1,328', note: '预计 4.2 小时', tone: 'warning', icon: ShieldCheck },
      { label: '当前数据集', value: 'v2.3.1', note: '覆盖 78.6%', tone: 'neutral', icon: Server },
    ],
    columns: [
      ['id', '素材ID'], ['source', '来源'], ['category', '学段/学科'], ['content', '内容类型'], ['quality', '质量评分'], ['consent', '授权状态'], ['status', '审核状态'],
    ],
    rows: [
      { id: 'MAT-28376', source: '用户定稿', category: '小学语文', content: '教案+习题', quality: '96', consent: '已授权', status: '已通过' },
      { id: 'MAT-28375', source: '管理员上传', category: '初中数学', content: '章节教材', quality: '92', consent: '版权已核验', status: '已通过' },
      { id: 'MAT-28374', source: '用户定稿', category: '高中英语', content: '教案+习题', quality: '88', consent: '已授权', status: '脱敏中' },
      { id: 'MAT-28371', source: '用户定稿', category: '初中物理', content: '教案', quality: '79', consent: '已授权', status: '待复核' },
      { id: 'MAT-28368', source: '管理员上传', category: '小学数学', content: '习题集', quality: '64', consent: '证明缺失', status: '已驳回' },
    ],
    insights: [
      { label: '当前版本覆盖率', value: 79 },
      { label: '脱敏完成度', value: 86 },
      { label: '学科均衡度', value: 72 },
    ],
  },
  safety: {
    title: '内容安全',
    description: '处理隐私、版权、不当内容与生成质量风险',
    action: '配置审核规则',
    metrics: [
      { label: '今日审核内容', value: '20,846', note: '自动通过 99.2%', tone: 'positive', icon: ShieldCheck },
      { label: '风险命中', value: '168', note: '较昨日 -12.4%', tone: 'positive', icon: AlertTriangle },
      { label: '人工待审', value: '31', note: '最长等待 18 分钟', tone: 'warning', icon: UserRound },
      { label: '申诉处理中', value: '6', note: '均在 SLA 内', tone: 'neutral', icon: CircleHelp },
    ],
    columns: [
      ['id', '记录ID'], ['source', '内容来源'], ['risk', '风险类型'], ['level', '风险等级'], ['rule', '命中规则'], ['reviewer', '处理人'], ['status', '状态'],
    ],
    rows: [
      { id: 'SAFE-67128', source: '教材图片', risk: '疑似个人信息', level: '中', rule: 'PII-地址', reviewer: '王悦', status: '待复核' },
      { id: 'SAFE-67122', source: 'AI 修改指令', risk: '不当内容', level: '低', rule: 'TEXT-敏感词', reviewer: '自动策略', status: '已拦截' },
      { id: 'SAFE-67109', source: '训练素材', risk: '版权证明缺失', level: '高', rule: 'RIGHTS-001', reviewer: '赵明', status: '已驳回' },
      { id: 'SAFE-67098', source: '导出教案', risk: '答案一致性', level: '低', rule: 'QA-答案冲突', reviewer: '系统', status: '已修复' },
      { id: 'SAFE-67082', source: '用户资料', risk: '异常登录', level: '中', rule: 'ACCOUNT-IP', reviewer: '刘晨', status: '已处理' },
    ],
    insights: [
      { label: '自动审核覆盖', value: 94 },
      { label: '人工 SLA 达成', value: 91 },
      { label: '高风险闭环率', value: 98 },
    ],
  },
  orders: {
    title: '订单与账单',
    description: '查询支付、退款、发票与套餐权益发放记录',
    action: '导出对账单',
    metrics: [
      { label: '今日实收', value: '¥ 86,420', note: '较昨日 +18.6%', tone: 'positive', icon: CircleDollarSign },
      { label: '支付订单', value: '1,842', note: '成功率 99.1%', tone: 'positive', icon: ReceiptText },
      { label: '待处理退款', value: '12', note: '金额 ¥1,286', tone: 'warning', icon: CreditCard },
      { label: '待开发票', value: '48', note: '本月 1,206 张', tone: 'neutral', icon: FileCheck2 },
    ],
    columns: [
      ['id', '订单号'], ['user', '用户'], ['product', '商品'], ['amount', '实付金额'], ['channel', '支付渠道'], ['paidAt', '支付时间'], ['status', '状态'],
    ],
    rows: [
      { id: 'ORD-202605190821', user: '林舒雅', product: '专业年卡', amount: '¥699.00', channel: '微信支付', paidAt: '11:36:28', status: '支付成功' },
      { id: 'ORD-202605190820', user: '周启明', product: '基础月卡', amount: '¥39.00', channel: '支付宝', paidAt: '11:31:04', status: '支付成功' },
      { id: 'ORD-202605190816', user: '何超', product: '专业月卡', amount: '¥79.00', channel: '微信支付', paidAt: '11:20:52', status: '退款审核' },
      { id: 'ORD-202605190809', user: '宋佳', product: '专业年卡', amount: '¥559.20', channel: '支付宝', paidAt: '10:58:16', status: '支付成功' },
      { id: 'ORD-202605190798', user: '谢楠', product: '基础月卡', amount: '¥39.00', channel: '微信支付', paidAt: '10:42:07', status: '待支付' },
    ],
    insights: [
      { label: '支付成功率', value: 99 },
      { label: '自动对账完成', value: 96 },
      { label: '发票处理进度', value: 81 },
    ],
  },
}

const statusToneMap = {
  成功: 'success', 正常: 'success', 在售: 'success', 主推: 'success', 进行中: 'success', 已达成: 'success', 已恢复: 'success', 已完成: 'success', 已通过: 'success', 已授权: 'success', 版权已核验: 'success', 支付成功: 'success', 已修复: 'success', 已处理: 'success',
  排队中: 'info', 待验证: 'info', 内测: 'info', 待发布: 'info', 待复核: 'info', 脱敏中: 'info', 待支付: 'info',
  超时: 'warning', 待关注: 'warning', 退款审核: 'warning', 中: 'warning', 低: 'warning',
  失败: 'danger', 受限: 'danger', 已驳回: 'danger', 已拦截: 'danger', 证明缺失: 'danger', 高: 'danger',
  已结束: 'muted',
}

function StatusPill({ children, tone }) {
  const resolvedTone = tone || statusToneMap[children] || 'muted'
  return <span className={`admin-status admin-status-${resolvedTone}`}>{children}</span>
}

function MiniSparkline({ variant = 0 }) {
  const paths = [
    'M2 28 C12 20 20 24 28 16 S42 28 52 15 S67 19 76 8 S88 22 98 3',
    'M2 26 C13 23 19 8 31 14 S48 29 58 15 S72 6 79 12 S91 16 98 4',
    'M2 25 C16 23 17 17 30 19 S46 8 58 14 S70 24 81 12 S91 8 98 6',
  ]
  return (
    <svg className="admin-mini-sparkline" viewBox="0 0 100 32" role="img" aria-label="近期趋势">
      <path d={paths[variant % paths.length]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function MetricCard({ label, value, note, tone = 'positive', icon: Icon, sparkIndex = 0 }) {
  return (
    <article className="admin-metric-card">
      <div className="admin-metric-copy">
        <span className="admin-metric-label">{label}</span>
        <strong className="admin-metric-value">{value}</strong>
        <span className={`admin-metric-note admin-metric-note-${tone}`}>{note}</span>
      </div>
      <div className="admin-metric-visual" aria-hidden="true">
        {Icon ? <Icon size={30} strokeWidth={1.7} /> : <MiniSparkline variant={sparkIndex} />}
      </div>
    </article>
  )
}

function UsageChart() {
  const dates = ['05-06', '05-07', '05-08', '05-09', '05-10', '05-11', '05-12', '05-13', '05-14', '05-15', '05-16', '05-17', '05-18', '05-19']
  const calls = [10400, 12100, 11700, 12300, 12100, 13000, 17700, 15700, 14300, 9900, 12500, 14300, 14600, 13200]
  const costs = [1380, 1680, 1660, 1730, 1740, 1880, 2670, 2180, 2020, 1360, 1820, 2060, 2110, 1840]
  const width = 720
  const height = 238
  const left = 50
  const right = 45
  const top = 20
  const bottom = 38
  const chartWidth = width - left - right
  const chartHeight = height - top - bottom
  const pointX = (index) => left + (index / (dates.length - 1)) * chartWidth
  const callY = (value) => top + chartHeight - (value / 20000) * chartHeight
  const costY = (value) => top + chartHeight - (value / 4000) * chartHeight
  const callPoints = calls.map((value, index) => `${pointX(index)},${callY(value)}`).join(' ')
  const costPoints = costs.map((value, index) => `${pointX(index)},${costY(value)}`).join(' ')

  return (
    <div className="admin-chart-scroll">
      <svg className="admin-usage-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby="admin-chart-title admin-chart-desc">
        <title id="admin-chart-title">近 14 天调用量与预估成本</title>
        <desc id="admin-chart-desc">绿色实线为调用次数，蓝绿色虚线为预估成本。</desc>
        {[0, 1, 2, 3, 4].map((step) => {
          const y = top + (step / 4) * chartHeight
          const callLabel = step === 4 ? '0' : `${20 - step * 5},000`
          const costLabel = step === 4 ? '0' : `${4 - step},000`
          return (
            <g key={step} className="admin-chart-grid">
              <line x1={left} y1={y} x2={width - right} y2={y} />
              <text x={left - 8} y={y + 4} textAnchor="end">{callLabel}</text>
              <text x={width - right + 8} y={y + 4} textAnchor="start">{costLabel}</text>
            </g>
          )
        })}
        {dates.map((date, index) => (
          <text className="admin-chart-axis-label" key={date} x={pointX(index)} y={height - 11} textAnchor="middle">{date}</text>
        ))}
        <polyline className="admin-chart-line admin-chart-line-primary" points={callPoints} />
        <polyline className="admin-chart-line admin-chart-line-secondary" points={costPoints} />
        {calls.map((value, index) => <circle className="admin-chart-point admin-chart-point-primary" key={`call-${dates[index]}`} cx={pointX(index)} cy={callY(value)} r="3" />)}
        {costs.map((value, index) => <circle className="admin-chart-point admin-chart-point-secondary" key={`cost-${dates[index]}`} cx={pointX(index)} cy={costY(value)} r="2.6" />)}
      </svg>
    </div>
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
                <td><span className={`admin-task-state admin-task-state-${statusToneMap[task.status] || 'muted'}`}><i />{task.status}</span></td>
              </tr>
            ))}
            {filteredTasks.length === 0 ? <tr><td className="admin-empty-cell" colSpan="5">调用日志尚未接入持久化存储，不展示虚构任务</td></tr> : null}
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
  const [emergencyMode, setEmergencyMode] = useState(false)
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
  const toggleEmergency = () => {
    setEmergencyMode((current) => !current)
    onNotice(emergencyMode ? '已恢复常规模型路由策略' : '已启用应急切换策略，主任务将优先走备用通道')
  }

  return (
    <>
      <div className="admin-page-heading">
        <div><h1>AI模型通道</h1><p>管理与监控 AI 模型通道的健康状态、性能指标与使用情况</p></div>
        <div className="admin-page-actions">
          <button className="admin-button admin-button-secondary" type="button" disabled title="需要先接入持久化任务路由器"><Settings size={17} />应急路由待接入</button>
          <button className="admin-button admin-button-primary" type="button" onClick={() => setModalOpen(true)}><Plus size={18} />添加模型通道</button>
        </div>
      </div>

      {loadError ? <div className="admin-api-state admin-api-state-error" role="alert"><AlertTriangle size={18} /><span>{loadError}</span></div> : null}
      {loading ? <div className="admin-api-state" role="status"><Activity size={18} /><span>正在加载模型通道…</span></div> : null}

      <div className="admin-model-metrics">
        <MetricCard label="已配置通道" value={String(channels.length)} note="来自服务端配置" tone="neutral" sparkIndex={0} />
        <MetricCard label="已启用通道" value={String(channels.filter((item) => item.enabled).length)} note="可参与模型路由" tone="positive" icon={ShieldCheck} />
        <MetricCard label="健康通道" value={String(channels.filter((item) => item.health === 'healthy').length)} note="未检测显示为待检测" tone="neutral" icon={Activity} />
        <MetricCard label="今日调用与成本" value="—" note="等待用量日志接入" tone="neutral" icon={ReceiptText} />
      </div>

      <div className="admin-model-layout">
        <div className="admin-model-main-column">
          <section className="admin-panel admin-chart-panel">
            <PanelHeader title="调用量与预估成本" />
            <div className="admin-empty-metric"><Activity size={22} /><div><b>尚无可核验的用量日志</b><p>接入任务持久化与供应商账单后，这里才会计算真实调用量、延迟和成本。</p></div></div>
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

function GenericManagementPage({ config, query, onNotice }) {
  const normalizedQuery = query.trim().toLowerCase()
  const filteredRows = useMemo(() => config.rows.filter((row) => !normalizedQuery || Object.values(row).join(' ').toLowerCase().includes(normalizedQuery)), [config.rows, normalizedQuery])
  const [selectedRow, setSelectedRow] = useState(null)
  return (
    <>
      <div className="admin-page-heading">
        <div><h1>{config.title}</h1><p>{config.description}</p></div>
        <button className="admin-button admin-button-primary" type="button" disabled title="此业务模块尚未连接持久化接口，不会执行虚假操作"><Plus size={18} />{config.action}（待接入）</button>
      </div>
      <div className="admin-capability-banner"><AlertTriangle size={17} /><div><b>当前页面仍是信息架构样例</b><p>下方数据不作为真实经营数据；创建、修改和导出操作已禁用，避免误以为后台已经执行。完成对应数据库接口后再开放。</p></div></div>
      <div className="admin-generic-metrics">
        {config.metrics.map((metric, index) => <MetricCard key={metric.label} {...metric} sparkIndex={index} />)}
      </div>
      <div className="admin-generic-layout">
        <section className="admin-panel admin-management-panel">
          <PanelHeader title={`${config.title}列表`}>
            <button className="admin-icon-button" type="button" aria-label="使用顶部搜索筛选列表" disabled title="请使用顶部搜索框"><Search size={17} /></button>
          </PanelHeader>
          <div className="admin-table-wrap">
            <table className="admin-table admin-management-table">
              <caption className="admin-sr-only">{config.title}列表</caption>
              <thead><tr>{config.columns.map(([, label]) => <th key={label}>{label}</th>)}<th>操作</th></tr></thead>
              <tbody>
                {filteredRows.map((row, rowIndex) => (
                  <tr key={`${config.title}-${rowIndex}`}>
                    {config.columns.map(([key]) => {
                      const value = row[key]
                      const shouldUsePill = ['status', 'level', 'consent'].includes(key)
                      return <td key={key}>{shouldUsePill ? <StatusPill>{value}</StatusPill> : value}</td>
                    })}
                    <td><button className="admin-row-action" type="button" onClick={() => setSelectedRow(row)}>查看样例</button><button className="admin-more-button" type="button" aria-label="更多操作尚未接入" disabled title="未连接持久化接口"><MoreHorizontal size={17} /></button></td>
                  </tr>
                ))}
                {filteredRows.length === 0 ? <tr><td className="admin-empty-cell" colSpan={config.columns.length + 1}>没有符合搜索条件的记录</td></tr> : null}
              </tbody>
            </table>
          </div>
          <footer className="admin-table-footer"><span>显示 {filteredRows.length} 条样例记录</span><div className="admin-pagination" aria-label={`${config.title}分页`}><button type="button" aria-label="上一页" disabled><ChevronLeft size={15} /></button><button type="button" className="admin-page-current" aria-current="page" aria-label="第 1 页" disabled>1</button><button type="button" aria-label="下一页" disabled><ChevronRight size={15} /></button></div></footer>
        </section>
        <aside className="admin-panel admin-insight-panel">
          <PanelHeader title="运营健康度" />
          <div className="admin-insight-score"><span>{Math.round(config.insights.reduce((total, item) => total + item.value, 0) / config.insights.length)}</span><small>综合评分</small></div>
          <div className="admin-insight-list">
            {config.insights.map((item) => <div className="admin-insight-item" key={item.label}><div><span>{item.label}</span><b>{item.value}%</b></div><div className="admin-progress"><span style={{ width: `${item.value}%` }} /></div></div>)}
          </div>
          <div className="admin-insight-tip"><Sparkles size={18} /><p>这里展示的是指标结构样例；实时监控与异常通知会在数据接口接入后启用。</p></div>
        </aside>
      </div>
      {selectedRow ? <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedRow(null) }}><section className="admin-modal admin-sample-detail" role="dialog" aria-modal="true" aria-labelledby="admin-sample-detail-title"><header className="admin-modal-header"><div><h2 id="admin-sample-detail-title">{config.title}样例详情</h2><p>仅用于确认字段结构，不代表真实后台记录。</p></div><button type="button" onClick={() => setSelectedRow(null)} aria-label="关闭"><X size={20} /></button></header><dl>{config.columns.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{selectedRow[key]}</dd></div>)}</dl><footer className="admin-modal-footer"><button className="admin-button admin-button-primary" type="button" onClick={() => setSelectedRow(null)}>知道了</button></footer></section></div> : null}
    </>
  )
}

function SettingsPage({ onNotice }) {
  const [settings] = useState({ registration: false, sms: false, trainingConsent: false, autoBackup: false, maintenance: false, watermark: false })
  const [health, setHealth] = useState(null)
  const [checkingHealth, setCheckingHealth] = useState(false)
  async function checkHealth() {
    setCheckingHealth(true)
    try {
      const response = await api.health()
      setHealth(response.data || {})
      onNotice('已读取服务器实时健康状态')
    } catch (requestError) { onNotice(`健康检查失败：${requestError.message}`) }
    finally { setCheckingHealth(false) }
  }
  const groups = [
    { title: '账号与注册', description: '控制新用户注册、验证码与默认免费额度。', items: [['registration', '开放用户注册', '关闭后仅管理员可创建账号'], ['sms', '启用短信验证码', '登录与敏感操作需要短信验证']] },
    { title: '数据与隐私', description: '配置训练授权和教案导出保护。', items: [['trainingConsent', '默认展示训练授权邀请', '授权仍需用户主动勾选，不会默认同意'], ['watermark', '免费版导出水印', '免费用户导出的 PDF 与 Word 显示品牌水印']] },
    { title: '运行与维护', description: '管理备份策略与站点维护状态。', items: [['autoBackup', '每日自动备份', '每天 03:00 备份数据库与文件索引'], ['maintenance', '维护模式', '启用后普通用户暂时无法进入工作台']] },
  ]
  return (
    <>
      <div className="admin-page-heading"><div><h1>系统设置</h1><p>查看站点基础信息、数据策略与部署状态</p></div><button className="admin-button admin-button-primary" type="button" disabled title="站点设置持久化接口尚未接入"><CheckCircle2 size={18} />保存设置</button></div>
      <div className="admin-capability-banner"><AlertTriangle size={17} /><div><b>站点配置暂为只读</b><p>邮件、短信与支付已经拆分到独立的正式配置页；其余开关在服务端持久化前不会提供假启用状态。</p></div></div>
      <div className="admin-settings-layout">
        <section className="admin-panel admin-settings-main">
          <PanelHeader title="站点基础信息" />
          <div className="admin-settings-form">
            <label><span>站点名称</span><input value="教师帮" readOnly /></label>
            <label><span>主域名</span><input value={window.location.hostname} readOnly /></label>
            <label><span>客服邮箱</span><input value="请在域名邮箱页配置" readOnly /></label>
            <label><span>教材文件保留时间</span><select value="365" disabled><option value="365">等待存储策略接口</option></select></label>
          </div>
        </section>
        <aside className="admin-panel admin-deployment-card">
          <PanelHeader title="部署与证书" />
          <div className="admin-deployment-status">{health?.status === 'ok' ? <CheckCircle2 size={26} /> : <Activity size={26} />}<div><strong>{health?.status === 'ok' ? 'API 服务运行正常' : '尚未执行实时检查'}</strong><span>{health?.timestamp ? new Date(health.timestamp).toLocaleString('zh-CN') : '点击下方按钮读取服务器状态'}</span></div></div>
          <dl><div><dt>API 服务</dt><dd>{health?.service || '待检测'}</dd></div><div><dt>AI 通道</dt><dd>{health ? (health.aiConfigured ? <StatusPill tone="success">已配置</StatusPill> : <StatusPill tone="warning">未配置</StatusPill>) : '待检测'}</dd></div><div><dt>HTTPS 证书</dt><dd>由 Caddy 部署层自动管理</dd></div><div><dt>最近备份</dt><dd>备份接口尚未接入</dd></div></dl>
          <button className="admin-button admin-button-secondary admin-button-full" type="button" onClick={checkHealth} disabled={checkingHealth}>{checkingHealth ? '正在检查…' : '运行实时健康检查'}</button>
        </aside>
      </div>
      <div className="admin-settings-groups">
        {groups.map((group) => <section className="admin-panel admin-setting-group" key={group.title}><div className="admin-setting-group-heading"><h2>{group.title}</h2><p>{group.description}</p></div>{group.items.map(([key, label, description]) => <div className="admin-setting-row" key={key}><div><strong>{label}</strong><span>{description} · 等待服务端配置接口</span></div><button className={`admin-toggle ${settings[key] ? 'admin-toggle-on' : ''}`} type="button" aria-label={`${label}尚未接入`} aria-pressed="false" disabled title="尚未接入持久化配置"><span className="admin-toggle-knob" /></button></div>)}</section>)}
      </div>
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
          {alertOpen ? <div className="admin-popover admin-alert-popover"><div className="admin-popover-heading"><strong>系统告警</strong></div><div className="admin-popover-empty"><CheckCircle2 size={18} /><span>实时告警服务尚未接入，没有伪造告警。</span></div></div> : null}
        </div>
        <button className="admin-top-action admin-message-action" type="button" disabled title="管理员消息服务尚未接入"><ReceiptText size={20} /><span>消息</span></button>
        <button className="admin-top-action admin-help-action" type="button" disabled title="帮助中心尚未接入"><CircleHelp size={20} /><span>帮助待接入</span></button>
        <div className="admin-popover-anchor">
          <button className="admin-profile-button" type="button" onClick={onProfileToggle} aria-expanded={profileOpen}><span className="admin-avatar"><UserRound size={22} /></span><span className="admin-profile-copy"><strong>{admin?.username || 'admin'}</strong><small>{admin?.role === 'super_admin' ? '超级管理员' : admin?.role || '管理员'}</small></span><ChevronDown size={16} /></button>
          {profileOpen ? <div className="admin-popover admin-profile-popover"><button type="button" disabled title="管理员资料编辑接口尚未接入"><UserRound size={17} />个人资料</button><button type="button" onClick={() => onNavigate('securitySettings')}><ShieldCheck size={17} />安全设置</button><button type="button" onClick={onLogout}>退出登录</button></div> : null}
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

  const noticeIsWarning = /失败|错误|未完成|无法|尚未|待接入|未启用/.test(notice)

  let pageContent
  if (activePage === 'models') pageContent = <ModelChannelsPage query={query} onNotice={setNotice} />
  else if (activePage === 'knowledgeGraph') pageContent = <KnowledgeGraphAdminPage onNotice={setNotice} />
  else if (activePage === 'questionBank') pageContent = <QuestionBankAdminPage onNotice={setNotice} />
  else if (activePage === 'organizations') pageContent = <OrganizationsAdminPage onNotice={setNotice} />
  else if (activePage === 'orders') pageContent = <PaymentSettingsPage onNotice={setNotice} />
  else if (activePage === 'securitySettings') pageContent = <SecuritySettingsPage onNotice={setNotice} />
  else if (activePage === 'settings') pageContent = <SettingsPage onNotice={setNotice} />
  else pageContent = <GenericManagementPage config={managementPages[activePage]} query={query} onNotice={setNotice} />

  return (
    <div className={`admin-app ${sidebarCollapsed ? 'admin-app-sidebar-collapsed' : ''}`}>
      <Sidebar activePage={activePage} collapsed={sidebarCollapsed} mobileOpen={mobileSidebarOpen} onNavigate={navigate} onCollapse={() => setSidebarCollapsed((current) => !current)} onMobileClose={() => setMobileSidebarOpen(false)} />
      {mobileSidebarOpen ? <button className="admin-mobile-overlay" type="button" aria-label="关闭导航" onClick={() => setMobileSidebarOpen(false)} /> : null}
      <div className="admin-shell">
        <Topbar query={query} onQueryChange={setQuery} onMenuOpen={() => setMobileSidebarOpen(true)} alertOpen={alertOpen} onAlertToggle={() => { setAlertOpen((current) => !current); setProfileOpen(false) }} profileOpen={profileOpen} onProfileToggle={() => { setProfileOpen((current) => !current); setAlertOpen(false) }} onLogout={logout} onNavigate={navigate} admin={admin} />
        <main className="admin-main">{pageContent}</main>
      </div>
      {notice ? <div className={`admin-toast ${noticeIsWarning ? 'admin-toast-warning' : ''}`} role="status">{noticeIsWarning ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}<span>{notice}</span></div> : null}
      <button className="admin-floating-help" type="button" aria-label="联系支持尚未接入" disabled title="请先在安全与通信页配置客服邮箱"><LifeBuoy size={21} /></button>
    </div>
  )
}
