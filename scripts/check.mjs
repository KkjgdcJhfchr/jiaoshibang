import fs from 'node:fs';
import path from 'node:path';

const required = [
  'package.json',
  'index.html',
  'admin.html',
  'src/main.jsx',
  'src/admin-main.jsx',
  'src/App.jsx',
  'src/teacher/WorkflowPages.jsx',
  'src/admin/DomainManagementPages.jsx',
  'server/index.mjs',
  'server/admin-entry.mjs',
  'server/admin-mfa.mjs',
  'server/message-service.mjs',
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

console.log(`项目结构检查通过：${required.length} 个关键文件存在，JSON Schema 可解析。`);
