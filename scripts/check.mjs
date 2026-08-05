import fs from 'node:fs';
import path from 'node:path';

const required = [
  'package.json',
  'pnpm-workspace.yaml',
  'index.html',
  'admin.html',
  'src/main.jsx',
  'src/admin-main.jsx',
  'src/App.jsx',
  'src/data/sampleLesson.js',
  'src/teacher/WorkflowPages.jsx',
  'src/admin/DomainManagementPages.jsx',
  'server/index.mjs',
  'server/admin-entry.mjs',
  'server/admin-mfa.mjs',
  'server/message-service.mjs',
  'server/lesson-export-model.mjs',
  'server/lesson-export-docx.mjs',
  'server/lesson-export-pdf.mjs',
  'server/lesson-export-service.mjs',
  'server/teaching-workflow.mjs',
  'scripts/bootstrap.sh',
  'shared/lesson-plan.schema.json',
  'shared/knowledge-map.schema.json',
  'shared/question.schema.json',
  'shared/exam-paper.schema.json',
  'shared/training-sample.schema.json',
  'shared/provider-config.schema.json',
  'compose.yaml',
  'infra/Caddyfile',
];

for (const file of required) {
  if (!fs.existsSync(path.resolve(file))) throw new Error(`缺少文件: ${file}`);
}

for (const file of required.filter((item) => item.endsWith('.json'))) {
  JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

const dockerIgnore = fs.readFileSync(path.resolve('.dockerignore'), 'utf8');
if (!dockerIgnore.split(/\r?\n/).includes('!admin.html')) {
  throw new Error('Docker 构建上下文必须显式包含 admin.html');
}
if (!dockerIgnore.split(/\r?\n/).includes('!pnpm-workspace.yaml')) {
  throw new Error('Docker 构建上下文必须包含 pnpm 的依赖脚本批准清单');
}

const pnpmWorkspace = fs.readFileSync(path.resolve('pnpm-workspace.yaml'), 'utf8');
if (!/allowBuilds:\s*[\r\n]+\s+esbuild@0\.25\.12:\s*true/.test(pnpmWorkspace)) {
  throw new Error('必须只批准锁定版本 esbuild@0.25.12 的构建脚本');
}
const dockerfile = fs.readFileSync(path.resolve('Dockerfile'), 'utf8');
if (!dockerfile.includes('COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./')) {
  throw new Error('Docker 依赖安装阶段必须复制 pnpm-workspace.yaml');
}

const compose = fs.readFileSync(path.resolve('compose.yaml'), 'utf8');
const appServiceStart = compose.indexOf('\n  app:');
const gotenbergServiceStart = compose.indexOf('\n  gotenberg:');
const appServiceBlock = compose.slice(appServiceStart, gotenbergServiceStart);
if (/depends_on:\s*[\s\S]*?gotenberg:/.test(appServiceBlock)) {
  throw new Error('主站启动不得硬依赖 PDF 转换服务健康状态');
}
for (const marker of ['XDG_CONFIG_HOME: /tmp/.chromium', 'XDG_CACHE_HOME: /tmp/.chromium']) {
  if (!compose.includes(marker)) throw new Error(`只读 Chromium 容器缺少可写目录配置: ${marker}`);
}

const serverSource = fs.readFileSync(path.resolve('server/index.mjs'), 'utf8');
for (const marker of ['DOCUMENT_EXPORT_MAX_CONCURRENCY', 'enforceDocumentExportRateLimits', 'withDocumentExportSlot']) {
  if (!serverSource.includes(marker)) throw new Error(`文档导出资源保护缺少关键实现: ${marker}`);
}
if (!serverSource.includes('`lesson-plan${extension}`')) {
  throw new Error('文档下载必须为纯中文标题提供安全的 ASCII 备用文件名');
}

const gitIgnore = fs.readFileSync(path.resolve('.gitignore'), 'utf8');
if (/(^|\r?\n)data\/(\r?\n|$)/.test(gitIgnore)) {
  throw new Error('运行时数据目录必须写成 /data/，否则会误排除 src/data');
}

const caddyfile = fs.readFileSync(path.resolve('infra/Caddyfile'), 'utf8');
if (!caddyfile.includes('?Referrer-Policy "strict-origin-when-cross-origin"')) {
  throw new Error('Caddy 只能补充默认 Referrer-Policy，不能覆盖随机管理员入口的 no-referrer');
}

const bootstrap = fs.readFileSync(path.resolve('scripts/bootstrap.sh'), 'utf8');
for (const marker of ['exec env JIAOSHIBANG_DIR=', '#{pane_dead}', 'tmux attach-session', 'git clone --depth 1', 'https://github.com/KkjgdcJhfchr/jiaoshibang.git']) {
  if (!bootstrap.includes(marker)) throw new Error(`公开断线续装入口缺少关键标记: ${marker}`);
}

const deploymentInstructions = [
  fs.readFileSync(path.resolve('README.md'), 'utf8'),
  fs.readFileSync(path.resolve('docs/DEPLOYMENT.md'), 'utf8'),
  bootstrap,
].join('\n');
if (/gh auth login|gh auth setup-git|gh repo clone|apt-get install -y git gh/.test(deploymentInstructions)) {
  throw new Error('公开仓库部署说明不能要求 GitHub CLI 设备登录');
}

const installer = fs.readFileSync(path.resolve('scripts/install.sh'), 'utf8');
if (!installer.includes('--reset-admin') || !installer.includes("existsSync('/app/data/admin.json')")) {
  throw new Error('重复部署必须默认保留已有管理员，仅允许显式重置');
}

const publicPages = fs.readFileSync(path.resolve('src/teacher/PublicPages.jsx'), 'utf8');
const authSubmitLine = publicPages.split(/\r?\n/).find((line) => line.includes('className="auth-submit"') && line.includes('siteConfig.registrationOpen'));
if (!authSubmitLine?.includes('(register && siteConfig.registrationOpen === false)')) {
  throw new Error('关闭注册只能禁用注册页提交，不得影响已有用户或管理员登录');
}
if (authSubmitLine.includes('|| siteConfig.registrationOpen === false ||') || authSubmitLine.includes(': siteConfig.registrationOpen === false ?')) {
  throw new Error('登录按钮不得直接受 registrationOpen 开关控制');
}
if (!publicPages.includes('!endsAt || !Number.isFinite(endsAt) || endsAt >= now')) {
  throw new Error('未设置结束时间的广告必须持续展示，不能被当作已过期内容过滤');
}

const dashboardPages = fs.readFileSync(path.resolve('src/teacher/DashboardPages.jsx'), 'utf8');
if (/chapterTitle:\s*'《春》'/.test(dashboardPages)) {
  throw new Error('创建教案的章节名称不得写入《春》等示例默认值');
}
if (!dashboardPages.includes('placeholder={chapterPlaceholder(draft.subject)}')) {
  throw new Error('章节名称示例必须使用 placeholder，并随学科提供合适提示');
}
if (dashboardPages.includes('DashboardReferralCard') || dashboardPages.includes('dashboard-referral-card')) {
  throw new Error('教师端首页不得重复展示推广有礼卡片');
}

const teacherNavigation = [
  fs.readFileSync(path.resolve('src/teacher/TeacherApp.jsx'), 'utf8'),
  fs.readFileSync(path.resolve('src/teacher/components.jsx'), 'utf8'),
].join('\n');
if (teacherNavigation.includes('/app/materials') || teacherNavigation.includes('资源库')) {
  throw new Error('教师端不得保留无真实资源能力的资源库入口');
}
if (!teacherNavigation.includes("path === '/app/referrals'") || !teacherNavigation.includes("{ label: '推广有礼', path: '/app/referrals'")) {
  throw new Error('移除首页推广卡片时必须保留侧栏入口和独立推广页');
}

const workflowPages = fs.readFileSync(path.resolve('src/teacher/WorkflowPages.jsx'), 'utf8');
const workflowStyles = fs.readFileSync(path.resolve('src/teacher/teacher-workflows.css'), 'utf8');
const reviewHeroLine = workflowPages.split(/\r?\n/).find((line) => line.includes('workflow-hero team-hero'));
if (!reviewHeroLine?.includes('<p>教案评审工作区</p>') || reviewHeroLine.includes('metadata?.grade') || reviewHeroLine.includes('metadata?.subject')) {
  throw new Error('评审页顶部必须固定使用通用标题，学科年级只能显示在具体任务中');
}
if (!workflowPages.includes('MAX_REVIEW_ACTIVITIES')) {
  throw new Error('评审动态必须限制保留数量');
}
if (!/\.activity-stream\s*\{[^}]*max-height:[^}]*overflow-y:\s*auto/.test(workflowStyles)) {
  throw new Error('评审动态必须限制最大高度并在区域内部滚动');
}

console.log(`项目结构检查通过：${required.length} 个关键文件存在，JSON Schema 可解析。`);
