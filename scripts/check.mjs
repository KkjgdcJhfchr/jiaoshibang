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

console.log(`项目结构检查通过：${required.length} 个关键文件存在，JSON Schema 可解析。`);
