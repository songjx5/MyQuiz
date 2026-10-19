import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（server/ 的上一级）。 */
export const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

// 如果存在 .env 则加载；不存在时静默跳过。
try {
  process.loadEnvFile(path.join(ROOT_DIR, '.env'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

function fromRoot(value, fallback) {
  return value ? path.resolve(ROOT_DIR, value) : fallback;
}

export const DB_PATH = fromRoot(process.env.DB_PATH, path.join(ROOT_DIR, 'data', 'app.db'));
export const DECK_DIR = path.join(ROOT_DIR, 'data', 'decks');
export const BACKUP_DIR = path.join(ROOT_DIR, 'backups');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'dist');

export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.PORT || 8787);
export const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

export const APP_NAME = 'MemoQuiz API';
export const APP_VERSION = '1.0.0';

export const USER_KEY_PREFIX = 'mck_';
export const ADMIN_KEY_PREFIX = 'adm_';