import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { nowIso } from './db.mjs';
import { ADMIN_KEY_PREFIX, USER_KEY_PREFIX } from './config.mjs';

const USER_KEY_RE = /^mck_[A-Za-z0-9_-]{32,64}$/;
const ADMIN_KEY_RE = /^adm_[A-Za-z0-9_-]{32,64}$/;

export function hashKey(key) {
  return createHash('sha256').update(String(key), 'utf8').digest('hex');
}

export function generateKey(prefix) {
  return prefix + randomBytes(32).toString('base64url');
}

export function keyPrefix(key) {
  return String(key).slice(0, 12) + '…';
}

export function isUserKeyFormat(key) {
  return USER_KEY_RE.test(String(key ?? ''));
}

export function isAdminKeyFormat(key) {
  return ADMIN_KEY_RE.test(String(key ?? ''));
}

export function createUser(db, label = null) {
  const key = generateKey(USER_KEY_PREFIX);
  const createdAt = nowIso();
  const info = db
    .prepare(
      `INSERT INTO users(key_hash, key_prefix, label, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(hashKey(key), keyPrefix(key), label || null, createdAt, createdAt);
  const user = db
    .prepare('SELECT * FROM users WHERE id = ?')
    .get(Number(info.lastInsertRowid));
  return { key, user };
}

export function verifyUserKey(db, key) {
  if (!isUserKeyFormat(key)) return null;
  const row = db
    .prepare('SELECT * FROM users WHERE key_hash = ? AND revoked_at IS NULL')
    .get(hashKey(key));
  if (!row) return null;

  // 避免每个请求都写库：最多每分钟更新一次 last_seen_at。
  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (!lastSeen || Date.now() - lastSeen > 60_000) {
    db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(nowIso(), row.id);
  }
  return row;
}

export function rotateUserKey(db, userId) {
  const key = generateKey(USER_KEY_PREFIX);
  const info = db
    .prepare(
      `UPDATE users SET key_hash = ?, key_prefix = ?, revoked_at = NULL
       WHERE id = ? AND revoked_at IS NULL`,
    )
    .run(hashKey(key), keyPrefix(key), userId);
  if (info.changes === 0) return null;
  return { key, user: db.prepare('SELECT * FROM users WHERE id = ?').get(userId) };
}

export function createAdminKey(db, label = null) {
  const key = generateKey(ADMIN_KEY_PREFIX);
  const createdAt = nowIso();
  const info = db
    .prepare(
      `INSERT INTO admin_keys(key_hash, key_prefix, label, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(hashKey(key), keyPrefix(key), label || null, createdAt);
  return {
    key,
    record: db.prepare('SELECT * FROM admin_keys WHERE id = ?').get(Number(info.lastInsertRowid)),
  };
}

export function verifyAdminKey(db, key) {
  if (!isAdminKeyFormat(key)) return null;
  const row = db
    .prepare('SELECT * FROM admin_keys WHERE key_hash = ? AND revoked_at IS NULL')
    .get(hashKey(key));
  if (!row) return null;
  db.prepare('UPDATE admin_keys SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  return row;
}

/** 常数时间比较，供需要比较原始 key 的场景使用。 */
export function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    keyPrefix: row.key_prefix,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}