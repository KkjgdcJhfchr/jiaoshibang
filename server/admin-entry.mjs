import { randomBytes } from 'node:crypto';

export const ADMIN_ENTRY_TOKEN_LENGTH = 40;
export const ADMIN_ENTRY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function createAdminEntryPath() {
  for (;;) {
    const bytes = randomBytes(ADMIN_ENTRY_TOKEN_LENGTH);
    let token = '';
    for (const byte of bytes) token += ADMIN_ENTRY_ALPHABET[byte % ADMIN_ENTRY_ALPHABET.length];
    const candidate = `/${token}`;
    if (isValidAdminEntryPath(candidate)) return candidate;
  }
}

export function isValidAdminEntryPath(value) {
  if (typeof value !== 'string' || value.length !== ADMIN_ENTRY_TOKEN_LENGTH + 1 || value[0] !== '/') return false;
  const token = value.slice(1);
  return /^[A-Za-z0-9_-]{40}$/.test(token)
    && !token.toLowerCase().startsWith('admin')
    && /[A-Z]/.test(token)
    && /[a-z]/.test(token)
    && /[0-9]/.test(token)
    && /[-_]/.test(token);
}

export function isLegacyAdminPagePath(value) {
  const normalized = normalizeRoutingPath(value);
  return Boolean(normalized) && normalized.toLowerCase().startsWith('/admin');
}

export function normalizeRoutingPath(value) {
  if (typeof value !== 'string') return null;
  let decoded;
  try {
    decoded = decodeURIComponent(value).replaceAll('\\', '/');
  } catch {
    return null;
  }
  const segments = [];
  for (const segment of decoded.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}`;
}
