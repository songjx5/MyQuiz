import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { DB_PATH } from './config.mjs';

const SCHEMA_PATH = fileURLToPath(new URL('./schema.sql', import.meta.url));
const SCHEMA_VERSION = 1;

let singleton = null;

export function nowIso() {
  return new Date().toISOString();
}

export function openDatabase(dbPath = DB_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

export function initSchema(db) {
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(schema);
  db.prepare(
    `INSERT INTO meta(key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION));
  return db;
}

/** 进程级单例，供 API 服务使用。 */
export function getDatabase() {
  if (!singleton) {
    singleton = openDatabase();
    initSchema(singleton);
  }
  return singleton;
}

export function closeDatabase(db = singleton) {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // 忽略 checkpoint 失败，继续关闭。
  }
  db.close();
  if (db === singleton) singleton = null;
}

const SCHEMA_TABLES = [
  'meta',
  'users',
  'admin_keys',
  'decks',
  'items',
  'item_tags',
  'progress',
  'attempts',
  'user_item_tags',
];

export function schemaIsInitialized(db) {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name);
  const present = new Set(rows);
  return SCHEMA_TABLES.every((table) => present.has(table));
}

/** 打开并确保 schema 存在。 */
export function openInitializedDatabase(dbPath = DB_PATH) {
  const db = openDatabase(dbPath);
  initSchema(db);
  return db;
}

/**
 * 手动事务。node:sqlite 不支持嵌套事务，调用方需保证不嵌套。
 */
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 保留原始错误。
    }
    throw error;
  }
}

export function resetDatabase(dbPath = DB_PATH) {
  closeDatabase();
  for (const suffix of ['', '-wal', '-shm']) {
    const file = dbPath + suffix;
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  }
  const db = openInitializedDatabase(dbPath);
  return db;
}

export function backupDatabase(db, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  if (fs.existsSync(outFile)) fs.rmSync(outFile, { force: true });
  const escaped = outFile.replaceAll("'", "''");
  db.exec(`VACUUM INTO '${escaped}'`);
  return outFile;
}

export function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function toJson(value) {
  return JSON.stringify(value ?? null);
}

export function boolToInt(value) {
  return value ? 1 : 0;
}

export function intToBool(value) {
  return value === 1 || value === true;
}