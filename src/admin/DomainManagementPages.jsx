import { useMemo, useState } from 'react';
import {
  BookOpenCheck,
  Building2,
  CheckCircle2,
  Database,
  GitMerge,
  Network,
  School,
  Search,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import './admin-domain.css';

const referenceGraphPoints = [
  { name: '学习目标', detail: '教案定义', x: 37, y: 18, questionY: 20 },
  { name: '核心概念', detail: '章节知识', x: 59, y: 32, questionY: 35 },
  { name: '学习方法', detail: '能力与策略', x: 31, y: 52, questionY: 50 },
  { name: '易错表现', detail: '诊断依据', x: 62, y: 68, questionY: 65 },
  { name: '迁移任务', detail: '应用场景', x: 42, y: 83, questionY: 80 },
];

const referenceQuestionNodes = [
  { name: '基础检测', y: 20 },
  { name: '课堂活动', y: 50 },
  { name: '迁移任务', y: 80 },
];

const conflictReferenceRows = [
  ['知识点重名', '同学科同学段出现近似名称', '保留原关系并进入人工核对', '确认主名称与别名'],
  ['题目挂接矛盾', '题目解析与关联知识点不一致', '暂停用于推荐与组卷', '由教研人员确认正确关系'],
  ['关系依据不足', '来源、证据或审核记录不完整', '保持草稿状态', '补齐证据后重新审核'],
];

export function KnowledgeGraphAdminPage() {
  return <>
    <div className="admin-page-heading">
      <div>
        <div><h1>教学认知图谱</h1><p>规划教案、知识点与题目的关系模型和治理规则</p></div>
        <span className="admin-domain-stage"><Network size={14} /> 只读规划</span>
      </div>
    </div>

    <section className="admin-domain-intro">
      <ShieldCheck size={20} />
      <div><b>参考结构</b><p>本页用于确认数据边界、关系类型与审核规则，不读取线上教案、题目或教师数据，也不执行写操作。</p></div>
    </section>

    <div className="admin-domain-reference-grid">
      <article><span><Network size={19} /></span><div><h3>实体边界</h3><p>区分教案、知识点、题目和教学任务，避免不同对象共用同一状态。</p></div></article>
      <article><span><GitMerge size={19} /></span><div><h3>关系来源</h3><p>每条关系需要记录来源、创建方式、审核状态和最后更新时间。</p></div></article>
      <article><span><CheckCircle2 size={19} /></span><div><h3>发布约束</h3><p>只有证据完整且审核通过的关系，才可用于教师端推荐和智能组卷。</p></div></article>
    </div>

    <div className="admin-domain-layout">
      <section className="admin-panel admin-graph-panel">
        <header className="admin-panel-header"><div><h2>关系模型参考结构</h2><p>节点仅说明建议的数据关系，不对应任何线上教案或题目</p></div></header>
        <div className="admin-graph-canvas">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {referenceGraphPoints.map((point) => <line key={`lesson-${point.name}`} x1="14" y1="50" x2={point.x} y2={point.y} />)}
            {referenceGraphPoints.map((point) => <line className="question" key={`question-${point.name}`} x1={point.x} y1={point.y} x2="82" y2={point.questionY} />)}
          </svg>
          <div className="admin-graph-root"><BookOpenCheck size={20} /><b>教案实体</b><small>章节与课时</small></div>
          {referenceGraphPoints.map((point) => <div key={point.name} className="admin-kp-node" style={{ left: `${point.x}%`, top: `${point.y}%` }}><b>{point.name}</b><small>{point.detail}</small></div>)}
          {referenceQuestionNodes.map((node) => <div className="admin-question-node" style={{ left: '82%', top: `${node.y}%` }} key={node.name}>{node.name}</div>)}
          <div className="admin-graph-legend"><span><i className="lesson" />教案实体</span><span><i className="knowledge" />知识点实体</span><span><i className="question" />题目实体</span></div>
        </div>
      </section>

      <aside className="admin-panel admin-governance-panel">
        <header className="admin-panel-header"><div><h2>关系治理规则</h2><p>进入业务流程前需要满足的条件</p></div></header>
        <ol className="admin-governance-list">
          <li><span>01</span><div><b>来源可追溯</b><p>记录教材、教案、人工录入或模型建议等来源。</p></div></li>
          <li><span>02</span><div><b>审核可复核</b><p>保留审核人、审核结论和变更原因。</p></div></li>
          <li><span>03</span><div><b>发布有边界</b><p>草稿与争议关系不参与推荐和组卷。</p></div></li>
          <li><span>04</span><div><b>变更有记录</b><p>合并、撤回和重新挂接均写入审计记录。</p></div></li>
        </ol>
        <div className="admin-health-note"><ShieldCheck size={17} /><p><b>治理原则</b><span>不以单一置信分数代替人工审核，也不在证据不足时自动合并知识点。</span></p></div>
      </aside>
    </div>

    <section className="admin-panel admin-conflict-panel">
      <header className="admin-panel-header"><div><h2>冲突处理参考结构</h2><p>用于确认识别、隔离、复核和发布的规则，不代表当前存在这些冲突</p></div></header>
      <div className="admin-conflict-table">
        <div className="admin-conflict-row reference head"><span>参考场景</span><span>识别信号</span><span>默认处理</span><span>审核输出</span></div>
        {conflictReferenceRows.map((row) => <div className="admin-conflict-row reference" key={row[0]}>{row.map((cell, index) => <span key={cell}>{index === 0 ? <b>{cell}</b> : cell}</span>)}</div>)}
      </div>
    </section>
  </>;
}

const questionSchemaRows = [
  { field: '题目内容', type: '内容字段', purpose: '题干、选项、答案和解析分别保存，便于导出不同版本。', rule: '题干必填；答案与解析在发布前完整。', level: '必填' },
  { field: '题型与难度', type: '教学属性', purpose: '支持选择、填空、简答、探究和写作等题型。', rule: '采用统一枚举；难度需要有可解释依据。', level: '必填' },
  { field: '知识点关系', type: '图谱关系', purpose: '关联主要知识点、次要知识点和考查目标。', rule: '争议关系不参与自动推荐。', level: '必填' },
  { field: '题目来源', type: '溯源字段', purpose: '区分教材录入、校本内容、人工编写和模型建议。', rule: '保留原始来源与版权说明。', level: '必填' },
  { field: '审核记录', type: '治理字段', purpose: '保存审核结论、审核人、时间和修改说明。', rule: '发布、退回和撤回均形成记录。', level: '必填' },
  { field: '适用范围', type: '推荐属性', purpose: '描述学段、学科、教材版本和教学环节。', rule: '缺失时仅允许人工检索，不自动推荐。', level: '建议' },
];

export function QuestionBankAdminPage() {
  const [query, setQuery] = useState('');
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return questionSchemaRows.filter((row) => !normalized || Object.values(row).join(' ').toLowerCase().includes(normalized));
  }, [query]);

  return <>
    <div className="admin-page-heading">
      <div>
        <div><h1>题库管理</h1><p>规划题目字段、来源追踪、审核状态和发布边界</p></div>
        <span className="admin-domain-stage"><Database size={14} /> 只读规划</span>
      </div>
    </div>

    <section className="admin-domain-intro">
      <ShieldCheck size={20} />
      <div><b>参考结构</b><p>本页展示题库应具备的字段和治理要求，不展示线上题量、审核率或题目记录。</p></div>
    </section>

    <div className="admin-domain-reference-grid">
      <article><span><Database size={19} /></span><div><h3>内容分层</h3><p>学生可见内容、教师答案和内部审核信息分开保存与授权。</p></div></article>
      <article><span><Sparkles size={19} /></span><div><h3>来源标识</h3><p>模型建议题不得冒充教材题或校本题，所有来源均可追溯。</p></div></article>
      <article><span><CheckCircle2 size={19} /></span><div><h3>审核闭环</h3><p>草稿、待审核、已发布和已归档使用明确的状态流转。</p></div></article>
    </div>

    <section className="admin-panel admin-bank-panel">
      <header className="admin-panel-header">
        <div><h2>题库字段参考结构</h2><p>用于产品、教研和研发共同确认字段含义与校验要求</p></div>
        <label className="admin-bank-search"><Search size={16} /><input aria-label="筛选题库参考字段" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选字段、用途或规则" /></label>
      </header>
      <div className="admin-bank-table">
        <div className="admin-bank-row schema head"><span>字段</span><span>类型</span><span>用途</span><span>校验与治理要求</span><span>级别</span></div>
        {visibleRows.map((row) => <div className="admin-bank-row schema" key={row.field}><span><b>{row.field}</b></span><span>{row.type}</span><span>{row.purpose}</span><span>{row.rule}</span><span><i className={`admin-reference-tag ${row.level === '必填' ? 'required' : ''}`}>{row.level}</i></span></div>)}
        {!visibleRows.length ? <p className="admin-domain-empty">没有符合筛选条件的参考字段</p> : null}
      </div>
    </section>

    <section className="admin-panel admin-lifecycle-panel">
      <header className="admin-panel-header"><div><h2>题目状态参考</h2><p>状态名称应与权限和可见范围保持一致</p></div></header>
      <ol className="admin-lifecycle-list">
        <li><span>1</span><div><b>草稿</b><p>仅创建者和授权审核人员可见。</p></div></li>
        <li><span>2</span><div><b>待审核</b><p>内容冻结，等待教研人员给出结论。</p></div></li>
        <li><span>3</span><div><b>已发布</b><p>可用于检索、推荐、组卷和导出。</p></div></li>
        <li><span>4</span><div><b>已归档</b><p>不再进入新任务，但保留历史引用。</p></div></li>
      </ol>
    </section>
  </>;
}

const organizationSchemaRows = [
  { field: '组织标识', type: '全局唯一标识', purpose: '作为学校、区域或教研组的数据隔离边界。', boundary: '创建后不可复用给其他组织。', level: '必填' },
  { field: '组织层级', type: '层级关系', purpose: '表达区域、学校、年级组和备课组的归属。', boundary: '跨层级移动需要权限校验和审计记录。', level: '必填' },
  { field: '成员角色', type: '权限关系', purpose: '区分组织管理员、教研负责人和普通教师。', boundary: '权限按组织范围生效，不继承无关租户数据。', level: '必填' },
  { field: '套餐归属', type: '权益关系', purpose: '定义组织可用功能、有效期和购买来源。', boundary: '历史订单和权益快照不可被后续改价覆盖。', level: '必填' },
  { field: '额度策略', type: '资源规则', purpose: '定义组织总额度、个人额度与发放方式。', boundary: '每次发放、扣除和退回均可追溯。', level: '建议' },
  { field: '组织状态', type: '生命周期', purpose: '控制新登录、数据写入和到期后的只读策略。', boundary: '停用组织不等于立即删除历史数据。', level: '必填' },
];

export function OrganizationsAdminPage() {
  const [query, setQuery] = useState('');
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return organizationSchemaRows.filter((row) => !normalized || Object.values(row).join(' ').toLowerCase().includes(normalized));
  }, [query]);

  return <>
    <div className="admin-page-heading">
      <div>
        <div><h1>学校与组织</h1><p>规划租户隔离、组织层级、成员角色和组织级权益</p></div>
        <span className="admin-domain-stage"><Building2 size={14} /> 只读规划</span>
      </div>
    </div>

    <section className="admin-domain-intro">
      <ShieldCheck size={20} />
      <div><b>参考结构</b><p>本页用于确认组织模型与权限边界，不展示线上学校、成员、套餐或额度统计。</p></div>
    </section>

    <div className="admin-domain-reference-grid">
      <article><span><School size={19} /></span><div><h3>租户隔离</h3><p>业务数据始终归属明确组织，跨组织访问必须经过授权。</p></div></article>
      <article><span><UsersRound size={19} /></span><div><h3>角色最小权限</h3><p>不同角色只获得完成职责所需的菜单、数据和操作权限。</p></div></article>
      <article><span><ShieldCheck size={19} /></span><div><h3>变更可审计</h3><p>成员加入、角色调整、额度发放和组织停用均保留记录。</p></div></article>
    </div>

    <section className="admin-panel admin-organization-panel">
      <header className="admin-panel-header">
        <div><h2>组织字段参考结构</h2><p>用于确认多组织数据模型，不对应任何线上学校或账号</p></div>
        <label className="admin-bank-search"><Search size={16} /><input aria-label="筛选组织参考字段" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选字段、用途或权限边界" /></label>
      </header>
      <div className="admin-organization-table">
        <div className="admin-organization-row schema head"><span>字段</span><span>类型</span><span>用途</span><span>权限与数据边界</span><span>级别</span></div>
        {visibleRows.map((row) => <div className="admin-organization-row schema" key={row.field}><span><b>{row.field}</b></span><span>{row.type}</span><span>{row.purpose}</span><span>{row.boundary}</span><span><i className={`admin-reference-tag ${row.level === '必填' ? 'required' : ''}`}>{row.level}</i></span></div>)}
        {!visibleRows.length ? <p className="admin-domain-empty">没有符合筛选条件的参考字段</p> : null}
      </div>
    </section>
  </>;
}
