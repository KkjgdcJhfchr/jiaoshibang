import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAdminEntryPath, isValidAdminEntryPath } from '../server/admin-entry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const developmentSecrets = loadOrCreateDevelopmentSecrets();
const serverEnvironment = {
  ...process.env,
  SESSION_SECRET: process.env.SESSION_SECRET || developmentSecrets.sessionSecret,
  SAFETY_ID_SALT: process.env.SAFETY_ID_SALT || developmentSecrets.safetyIdSalt,
  ADMIN_ENTRY_PATH: process.env.ADMIN_ENTRY_PATH || developmentSecrets.adminEntryPath,
};
const children = [
  spawn(node, ['server/index.mjs'], { cwd: root, env: serverEnvironment, stdio: 'inherit' }),
  spawn(node, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1'], {
    cwd: root,
    env: serverEnvironment,
    stdio: 'inherit',
  }),
];

console.log(`[teacher-helper] development admin entry: http://127.0.0.1:5188${serverEnvironment.ADMIN_ENTRY_PATH}`);

let closing = false;
function close(code = 0) {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill();
  setTimeout(() => process.exit(code), 80);
}

for (const child of children) {
  child.on('exit', (code) => {
    if (!closing && code !== 0) close(code ?? 1);
  });
}
process.on('SIGINT', () => close(0));
process.on('SIGTERM', () => close(0));

function loadOrCreateDevelopmentSecrets() {
  const dataDirectory = path.join(root, 'data');
  const secretFile = path.join(dataDirectory, '.development-secrets.json');
  mkdirSync(dataDirectory, { recursive: true });

  if (existsSync(secretFile)) {
    const saved = JSON.parse(readFileSync(secretFile, 'utf8'));
    if (String(saved.sessionSecret || '').length < 32 || String(saved.safetyIdSalt || '').length < 32) {
      throw new Error('data/.development-secrets.json 无效，请修复或移走后再启动开发服务');
    }
    if (!isValidAdminEntryPath(saved.adminEntryPath)) {
      saved.adminEntryPath = createAdminEntryPath();
      writeFileSync(secretFile, `${JSON.stringify(saved, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      chmodSync(secretFile, 0o600);
    }
    return saved;
  }

  const created = {
    sessionSecret: randomBytes(32).toString('hex'),
    safetyIdSalt: randomBytes(32).toString('hex'),
    adminEntryPath: createAdminEntryPath(),
  };
  writeFileSync(secretFile, `${JSON.stringify(created, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  return created;
}
