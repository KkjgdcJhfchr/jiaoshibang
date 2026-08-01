import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Building2,
  CheckCircle2,
  CircleGauge,
  Database,
  FileSpreadsheet,
  GitMerge,
  Network,
  Plus,
  School,
  Search,
  ShieldCheck,
  Sparkles,
  Upload,
  UsersRound,
} from 'lucide-react';
import './admin-domain.css';

const graphPoints = [
  { name: '多感官描写', questions: 3, confidence: 96, x: 38, y: 18 },
  { name: '比喻与拟人', questions: 3, confidence: 94, x: 58, y: 34 },
  { name: '文章结构', questions: 2, confidence: 91, x: 30, y: 51 },
  { name: '情感线索', questions: 1, confidence: 86, x: 62, y: 67 },
  { name: '迁移表达', questions: 2, confidence: 89, x: 41, y: 82 },
];

export function KnowledgeGraphAdminPage({ onNotice }) {
  return <>
    <div className="admin-page-heading"><div><div><h1>教学认知图谱</h1><p>管理教案、知识点与题目关系，监控覆盖率并处理冲突挂接</p></div><span className="admin-domain-stage"><Sparkles size={14} /> MVP 数据结构预览</span></div><div className="admin-page-actions"><button className="admin-button admin-button-secondary" type="button" onClick={() => onNotice('已完成当前样例的只读结构检查，未修改任何数据')}><CircleGauge size={17} />运行只读体检</button><button className="admin-button admin-button-primary" type="button" disabled title="等待题库持久化与导入事务接口"><Upload size={17} />批量导入待接入</button></div></div>
    <div className="admin-domain-metrics">
      <article><span><Network size={19} /></span><div><small>可见知识点节点</small><strong>{graphPoints.length}</strong><p>当前演示教案</p></div></article>
      <article><span><GitMerge size={19} /></span><div><small>可见关系样例</small><strong>{graphPoints.length + graphPoints.reduce((sum, point) => sum + Math.min(point.questions, 3), 0)}</strong><p>教案教授 + 题目考察</p></div></article>
      <article><span><CheckCircle2 size={19} /></span><div><small>题目标注率</small><strong>100%</strong><p>10 / 10 已关联</p></div></article>
      <article><span><AlertTriangle size={19} /></span><div><small>待仲裁冲突</small><strong>2</strong><p>不会自动合并</p></div></article>
    </div>
    <div className="admin-domain-layout">
      <section className="admin-panel admin-graph-panel">
        <header className="admin-panel-header"><div><h2>关系图谱预览</h2><p>七年级语文 · 《春》第一课时</p></div><label className="admin-domain-select"><span>预览范围</span><select value="lesson" disabled title="跨教案图谱查询尚未接入"><option value="lesson">当前演示教案</option></select></label></header>
        <div className="admin-graph-canvas">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{graphPoints.map((point) => <line key={point.name} x1="14" y1="50" x2={point.x} y2={point.y} />)}{graphPoints.flatMap((point, pointIndex) => Array.from({ length: Math.min(point.questions, 3) }, (_, index) => <line className="question" key={`${point.name}-${index}`} x1={point.x} y1={point.y} x2={82} y2={16 + (pointIndex * 2 + index) * 7} />))}</svg>
          <div className="admin-graph-root"><BookOpenCheck size={20} /><b>《春》第一课时</b><small>教案节点</small></div>
          {graphPoints.map((point) => <button key={point.name} className="admin-kp-node" style={{ left: `${point.x}%`, top: `${point.y}%` }} type="button" disabled title="知识点详情待接入"><b>{point.name}</b><small>{point.questions} 道题 · {point.confidence}%</small></button>)}
          {Array.from({ length: 10 }, (_, index) => <button className="admin-question-node" style={{ left: '82%', top: `${16 + index * 7}%` }} type="button" key={index + 1} disabled title="题目详情待接入">Q{index + 1}</button>)}
          <div className="admin-graph-legend"><span><i className="lesson" />教案</span><span><i className="knowledge" />知识点</span><span><i className="question" />题目</span></div>
        </div>
      </section>
      <aside className="admin-panel admin-graph-health">
        <header className="admin-panel-header"><div><h2>图谱健康度</h2><p>仅统计已审核关系</p></div><span className="admin-health-score">92</span></header>
        <div className="admin-health-list"><div><p><span>知识点覆盖率</span><b>94%</b></p><i><span style={{ width: '94%' }} /></i></div><div><p><span>关系平均置信度</span><b>91%</b></p><i><span style={{ width: '91%' }} /></i></div><div><p><span>孤立节点占比</span><b>3%</b></p><i className="reverse"><span style={{ width: '3%' }} /></i></div><div><p><span>争议关系占比</span><b>2%</b></p><i className="reverse"><span style={{ width: '2%' }} /></i></div></div>
        <div className="admin-health-note"><ShieldCheck size={17} /><p><b>治理原则</b><span>低置信关系只能进入待审核池，不能直接影响教师端推荐。</span></p></div>
      </aside>
    </div>
    <section className="admin-panel admin-conflict-panel"><header className="admin-panel-header"><div><h2>冲突仲裁台</h2><p>当前仅展示结构样例；审计日志和仲裁事务接入前不会执行写操作</p></div><button className="admin-link-button" type="button" disabled title="冲突列表接口尚未接入">查看全部（待接入） <ArrowRight size={15} /></button></header><div className="admin-conflict-table"><div className="admin-conflict-row head"><span>冲突关系</span><span>冲突原因</span><span>影响题目</span><span>置信度</span><span>建议动作</span><span /></div><div className="admin-conflict-row"><span><b>多感官描写</b><small>可能重复：感官描写</small></span><span>名称相似度 96%</span><span>8 道</span><span>88%</span><span>合并并保留别名</span><span><button disabled title="等待审计事务接口">待接入</button></span></div><div className="admin-conflict-row"><span><b>文章主旨</b><small>疑似错误挂接：Q8</small></span><span>与题目解析不一致</span><span>1 道</span><span>62%</span><span>转教研员复核</span><span><button disabled title="等待审计事务接口">待接入</button></span></div></div></section>
  </>;
}

const questionRows = [
  ['Q-10001', '下列加点字读音完全正确的一项是（ ）', '选择题', '字音', 'AI 生成题', '1/5', '待审核'],
  ['Q-10002', '结合语境解释“山朗润起来了”中“朗润”的意思。', '填空题', '词语理解', '教材录入', '1/5', '已审核'],
  ['Q-10003', '全文可以分为哪三个部分？请用三个短语概括。', '简答题', '文章结构', 'AI 生成题', '2/5', '待审核'],
  ['Q-10004', '赏析“小草偷偷地从土里钻出来”的表达效果。', '赏析题', '拟人', '校本题', '2/5', '已审核'],
  ['Q-10005', '作者为什么在写完景物后还要写“迎春图”？', '探究题', '情感线索', 'AI 生成题', '3/5', '待审核'],
];

export function QuestionBankAdminPage({ onNotice }) {
  const [query, setQuery] = useState('');
  const visibleRows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return questionRows.filter((row) => !normalized || row.join(' ').toLowerCase().includes(normalized));
  }, [query]);
  const approvedCount = questionRows.filter((row) => row[6] === '已审核').length;
  const generatedCount = questionRows.filter((row) => row[4] === 'AI 生成题').length;
  return <>
    <div className="admin-page-heading"><div><div><h1>题库管理</h1><p>管理题源、知识点标注、审核状态与批量导入</p></div><span className="admin-domain-stage"><Database size={14} /> 当前仅展示种子题</span></div><div className="admin-page-actions"><button className="admin-button admin-button-secondary" type="button" disabled title="导入模板文件尚未生成"><FileSpreadsheet size={17} />导入模板待接入</button><button className="admin-button admin-button-primary" type="button" disabled title="等待题库持久化与审核事务接口"><Upload size={17} />批量导入待接入</button></div></div>
    <div className="admin-domain-metrics"><article><span><Database size={19} /></span><div><small>题目样例</small><strong>{questionRows.length}</strong><p>当前 MVP 种子题</p></div></article><article><span><CheckCircle2 size={19} /></span><div><small>样例已审核</small><strong>{approvedCount}</strong><p>{Math.round(approvedCount / questionRows.length * 100)}% 样例覆盖率</p></div></article><article><span><Sparkles size={19} /></span><div><small>AI 生成题样例</small><strong>{generatedCount}</strong><p>不可冒充真题</p></div></article><article><span><AlertTriangle size={19} /></span><div><small>样例待处理</small><strong>{questionRows.length - approvedCount}</strong><p>含题源与解析复核</p></div></article></div>
    <section className="admin-panel admin-bank-panel"><header className="admin-panel-header"><div><h2>种子题列表</h2><p>教材题、校本题与 AI 生成题分开标识；详情审核尚未接入</p></div><label className="admin-bank-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选题干、知识点或题目 ID" /></label></header><div className="admin-bank-table"><div className="admin-bank-row head"><span>题目 ID</span><span>题干</span><span>题型</span><span>知识点</span><span>题源</span><span>难度</span><span>状态</span></div>{visibleRows.map((row) => <button className="admin-bank-row" type="button" key={row[0]} disabled title="题目审核详情待接入">{row.map((cell, index) => <span key={`${row[0]}-${index}`} className={index === 6 ? `bank-status ${cell === '已审核' ? 'approved' : ''}` : ''}>{index === 1 ? <b>{cell}</b> : cell}</span>)}</button>)}{!visibleRows.length ? <p className="admin-domain-empty">没有符合筛选条件的种子题</p> : null}</div></section>
  </>;
}

const organizations = [
  { name: '教师帮内测试点校', type: '学校', plan: '校版·标准', teams: 5, teachers: 42, expires: '2027-07-31', status: '内测中' },
  { name: '七年级语文备课组', type: '教研组', plan: '教研组版', teams: 1, teachers: 12, expires: '2027-02-28', status: '正常' },
  { name: '区域教研云演示空间', type: '区域', plan: '区域演示', teams: 18, teachers: 236, expires: '2026-12-31', status: '演示' },
];

export function OrganizationsAdminPage({ onNotice }) {
  const [query, setQuery] = useState('');
  const visibleOrganizations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return organizations.filter((item) => !normalized || Object.values(item).join(' ').toLowerCase().includes(normalized));
  }, [query]);
  return <>
    <div className="admin-page-heading"><div><div><h1>学校与组织</h1><p>管理学校、区域、备课组、成员角色与组织级额度</p></div><span className="admin-domain-stage"><Building2 size={14} /> 多租户 MVP</span></div><div className="admin-page-actions"><button className="admin-button admin-button-primary" type="button" disabled title="等待多租户数据库与角色权限接口"><Plus size={17} />新建组织待接入</button></div></div>
    <div className="admin-domain-metrics"><article><span><School size={19} /></span><div><small>学校样例</small><strong>{organizations.filter((item) => item.type === '学校').length}</strong><p>内测租户字段</p></div></article><article><span><Building2 size={19} /></span><div><small>区域样例</small><strong>{organizations.filter((item) => item.type === '区域').length}</strong><p>演示租户字段</p></div></article><article><span><UsersRound size={19} /></span><div><small>备课组字段合计</small><strong>{organizations.reduce((sum, item) => sum + item.teams, 0)}</strong><p>仅为结构样例</p></div></article><article><span><ShieldCheck size={19} /></span><div><small>教师字段合计</small><strong>{organizations.reduce((sum, item) => sum + item.teachers, 0)}</strong><p>并非真实账号数</p></div></article></div>
    <section className="admin-panel admin-organization-panel"><header className="admin-panel-header"><div><h2>组织列表</h2><p>以下为字段结构样例；正式数据将由 PostgreSQL 租户、成员和角色表提供</p></div><label className="admin-bank-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选学校、区域或备课组" /></label></header><div className="admin-organization-table"><div className="admin-organization-row head"><span>组织</span><span>类型</span><span>套餐</span><span>备课组</span><span>教师</span><span>到期时间</span><span>状态</span></div>{visibleOrganizations.map((item) => <button className="admin-organization-row" type="button" key={item.name} disabled title="租户详情待接入"><span><b>{item.name}</b><small>组织数据隔离空间</small></span><span>{item.type}</span><span>{item.plan}</span><span>{item.teams}</span><span>{item.teachers}</span><span>{item.expires}</span><span>{item.status}</span></button>)}{!visibleOrganizations.length ? <p className="admin-domain-empty">没有符合筛选条件的组织样例</p> : null}</div></section>
  </>;
}
