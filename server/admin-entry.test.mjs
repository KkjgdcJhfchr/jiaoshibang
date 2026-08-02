import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createAdminEntryPath, isLegacyAdminPagePath, isValidAdminEntryPath } from './admin-entry.mjs';

const root = new URL('..', import.meta.url);
const dataDir = mkdtempSync(join(tmpdir(), 'teacher-helper-admin-entry-'));
const staticDir = mkdtempSync(join(tmpdir(), 'teacher-helper-admin-static-'));
writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>Teacher</title><main>teacher-entry-bundle</main>');
writeFileSync(join(staticDir, 'admin.html'), '<!doctype html><title>Admin</title><main>admin-entry-bundle</main>');
const adminEntryPath = createAdminEntryPath();
const generated = new Set();

for (let index = 0; index < 128; index += 1) {
  const value = createAdminEntryPath();
  assert.equal(value.length, 41);
  assert.equal(isValidAdminEntryPath(value), true);
  generated.add(value);
}
assert.equal(generated.size, 128, 'random administrator entries should not repeat in the sample');
assert.equal(isValidAdminEntryPath('/admin'), false);
assert.equal(isValidAdminEntryPath('/adminAa0-Aa0-Aa0-Aa0-Aa0-Aa0-Aa0-Aa0-'), false);
assert.equal(isValidAdminEntryPath('/Aa0-Aa0-Aa0-Aa0-Aa0-Aa0-Aa0-Aa0-Aa0-Aa0-'), true);
assert.equal(isLegacyAdminPagePath('/%2Fadmin.html'), true);
assert.equal(isLegacyAdminPagePath('/%5Cadmin.html'), true);
assert.equal(isLegacyAdminPagePath('/assets/../admin.html'), true);

const port = await reservePort();
let output = '';
const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: dataDir,
    STATIC_DIR: staticDir,
    SESSION_SECRET: 'admin-entry-test-session-secret'.padEnd(64, 's'),
    SAFETY_ID_SALT: 'admin-entry-test-safety-salt'.padEnd(64, 'p'),
    ADMIN_ENTRY_PATH: adminEntryPath,
    TRUST_PROXY: 'false',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output += chunk.toString(); });
child.stderr.on('data', (chunk) => { output += chunk.toString(); });

try {
  await waitForHealth(port, child);
  const origin = `http://127.0.0.1:${port}`;

  for (const pathname of [
    '/admin',
    '/admin/',
    '/admin/x',
    '/admin.html',
    '/ADMIN',
    '/%2Fadmin.html',
    '/%5Cadmin.html',
    '/assets/../admin.html',
    `${adminEntryPath}/`,
    `${adminEntryPath}x`,
  ]) {
    for (const method of ['GET', 'HEAD']) {
      const response = await fetch(`${origin}${pathname}`, { method });
      assert.equal(response.status, 404, `${method} ${pathname} must be hidden`);
    }
  }

  const directApi = await fetch(`${origin}/api/admin/session`);
  assert.equal(directApi.status, 404, 'admin APIs must be concealed before visiting the secret entry');

  const entryResponse = await fetch(`${origin}${adminEntryPath}`);
  assert.equal(entryResponse.status, 200);
  assert.equal(entryResponse.headers.get('cache-control'), 'no-store');
  assert.equal(entryResponse.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(entryResponse.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
  const setCookie = entryResponse.headers.get('set-cookie') || '';
  assert.match(setCookie, /^teacher_helper_admin_entry=/);
  assert.match(setCookie, /Path=\/api\/admin/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Secure/);
  const entryHtml = await entryResponse.text();
  assert.match(entryHtml, /admin-entry-bundle/);
  assert.equal(entryHtml.includes(adminEntryPath), false, 'the secret entry must not be embedded in HTML');
  assert.equal([...entryResponse.headers].flat().join(' ').includes(adminEntryPath), false, 'headers must not reveal the entry');

  const gateCookie = setCookie.split(';', 1)[0];
  const gatedApi = await fetch(`${origin}/api/admin/session`, { headers: { Cookie: gateCookie } });
  assert.equal(gatedApi.status, 200);
  const session = await gatedApi.json();
  assert.equal(session.data.initialized, false);

  const tamperedApi = await fetch(`${origin}/api/admin/session`, { headers: { Cookie: `${gateCookie}x` } });
  assert.equal(tamperedApi.status, 404);

  const headResponse = await fetch(`${origin}${adminEntryPath}`, { method: 'HEAD' });
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), '');
  assert.match(headResponse.headers.get('set-cookie') || '', /^teacher_helper_admin_entry=/);

  const encodedEntry = `/%${adminEntryPath.charCodeAt(1).toString(16)}${adminEntryPath.slice(2)}`;
  const encodedResponse = await fetch(`${origin}${encodedEntry}`);
  const encodedBody = await encodedResponse.text();
  assert.equal(encodedBody.includes('admin-entry-bundle'), false, 'encoded aliases must not return the administrator page');

  const publicIndex = readFileSync(join(staticDir, 'index.html'), 'utf8');
  assert.equal(publicIndex.includes(adminEntryPath), false);
  for (let attempt = 0; attempt < 30 && !output.includes('[admin-entry]'); attempt += 1) await delay(20);
  assert.match(output, /GET \[admin-entry\] 200/);
  assert.equal(output.includes(adminEntryPath), false, 'server logs must redact the secret entry');
  assert.equal(output.includes(adminEntryPath.slice(2)), false, 'encoded entry aliases must not leak most of the secret');

  console.log('admin entry tests passed');
} finally {
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(2_000),
  ]);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(staticDir, { recursive: true, force: true });
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const selected = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return selected;
}

async function waitForHealth(selectedPort, processHandle) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (processHandle.exitCode !== null) throw new Error(`server exited before startup:\n${output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${selectedPort}/api/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await delay(30);
  }
  throw new Error(`server did not become healthy:\n${output}`);
}
