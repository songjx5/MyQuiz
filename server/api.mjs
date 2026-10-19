import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { APP_NAME, APP_VERSION, CORS_ORIGIN, DB_PATH, HOST, PORT, PUBLIC_DIR } from './config.mjs';
import { closeDatabase, initSchema, nowIso, openDatabase } from './db.mjs';
import { createUser, publicUser, verifyAdminKey, verifyUserKey } from './auth.mjs';
import {
  clearUserTags,
  countRows,
  getDeck,
  getDecks,
  getItem,
  getStats,
  recordAttempt,
  setFamiliarity,
  setUserTags,
} from './queries.mjs';
import { gradeItem, GradeError } from './grade.mjs';
import { FAMILIARITIES, validateInput, validateDeck } from './validate.mjs';
import { importDecks } from './importer.mjs';
import { transaction } from './db.mjs';

const MAX_BODY_BYTES = 2 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, code, message, details) {
  sendJson(res, status, { error: { code, message, ...(details ? { details } : {}) } });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-User-Key, X-Admin-Key, Authorization',
    'Access-Control-Max-Age': '86400',
    ...(CORS_ORIGIN !== '*' ? { Vary: 'Origin' } : {}),
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ApiError(413, 'BODY_TOO_LARGE', '请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      const text = Buffer.concat(chunks).toString('utf8');
      if (!text.trim()) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new ApiError(400, 'INVALID_JSON', `JSON 解析失败：${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function headerKey(req, name) {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function bearerToken(req) {
  const value = headerKey(req, 'authorization');
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : null;
}

function requireUser(req, db) {
  const key = headerKey(req, 'x-user-key') || bearerToken(req);
  if (!key) throw new ApiError(401, 'AUTH_REQUIRED', '缺少用户 key（X-User-Key）');
  const user = verifyUserKey(db, key);
  if (!user) throw new ApiError(401, 'AUTH_INVALID', '同步码无效或已失效');
  return user;
}

function requireAdmin(req, db) {
  const key = headerKey(req, 'x-admin-key') || bearerToken(req);
  if (!key) throw new ApiError(401, 'ADMIN_REQUIRED', '缺少管理 key（X-Admin-Key）');
  const admin = verifyAdminKey(db, key);
  if (!admin) throw new ApiError(403, 'ADMIN_INVALID', '管理 key 无效或已失效');
  return admin;
}

function ensureFamiliarity(value) {
  if (value !== null && !FAMILIARITIES.includes(value)) {
    throw new ApiError(400, 'INVALID_FAMILIARITY', `familiarity 必须是 ${FAMILIARITIES.join(' / ')} 或 null`);
  }
  return value;
}

function normalizeTagList(value) {
  if (!Array.isArray(value)) throw new ApiError(400, 'INVALID_TAGS', 'tags 必须是字符串数组');
  const result = [];
  const seen = new Set();
  for (const raw of value) {
    if (typeof raw !== 'string') throw new ApiError(400, 'INVALID_TAGS', 'tags 中的每一项必须是字符串');
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.length > 60) throw new ApiError(400, 'INVALID_TAGS', '单个标签不能超过 60 个字符');
    if (seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  if (result.length > 50) throw new ApiError(400, 'INVALID_TAGS', '最多允许 50 个标签');
  return result;
}

function apiHealth(db) {
  return {
    ok: true,
    name: APP_NAME,
    version: APP_VERSION,
    time: nowIso(),
    counts: countRows(db),
  };
}

async function handleApi(req, res, db, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const method = req.method || 'GET';

  // /api/health
  if (parts.length === 2 && parts[1] === 'health' && method === 'GET') {
    return sendJson(res, 200, apiHealth(db));
  }

  // /api/auth/session
  if (parts.length === 3 && parts[1] === 'auth' && parts[2] === 'session' && method === 'POST') {
    const body = await readBody(req);
    if (body.userKey) {
      const user = verifyUserKey(db, String(body.userKey));
      if (!user) throw new ApiError(401, 'AUTH_INVALID', '同步码无效或已失效');
      return sendJson(res, 200, { userKey: String(body.userKey), user: publicUser(user), created: false });
    }
    const { key, user } = createUser(db, typeof body.label === 'string' ? body.label : null);
    return sendJson(res, 201, { userKey: key, user: publicUser(user), created: true });
  }

  // /api/auth/me
  if (parts.length === 3 && parts[1] === 'auth' && parts[2] === 'me' && method === 'GET') {
    const user = requireUser(req, db);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  // /api/stats
  if (parts.length === 2 && parts[1] === 'stats' && method === 'GET') {
    const user = requireUser(req, db);
    return sendJson(res, 200, getStats(db, user.id));
  }

  // /api/decks
  if (parts.length === 2 && parts[1] === 'decks' && method === 'GET') {
    const user = requireUser(req, db);
    const includeItems = url.searchParams.get('include') === 'items';
    return sendJson(res, 200, { decks: getDecks(db, { userId: user.id, includeItems }) });
  }

  // /api/decks/:deckId
  if (parts.length === 3 && parts[1] === 'decks' && method === 'GET') {
    const user = requireUser(req, db);
    const deck = getDeck(db, decodeURIComponent(parts[2]), user.id);
    if (!deck) throw new ApiError(404, 'DECK_NOT_FOUND', '卡组不存在');
    return sendJson(res, 200, { deck });
  }

  // /api/decks/:deckId/items/:itemId/...
  if (parts.length >= 5 && parts[1] === 'decks' && parts[3] === 'items') {
    const deckId = decodeURIComponent(parts[2]);
    const itemId = decodeURIComponent(parts[4]);
    const action = parts[5];

    if (method === 'PUT' && action === 'familiarity') {
      const user = requireUser(req, db);
      const body = await readBody(req);
      const familiarity = ensureFamiliarity(body.familiarity ?? null);
      const progress = setFamiliarity(db, user.id, deckId, itemId, familiarity);
      if (!progress) throw new ApiError(404, 'ITEM_NOT_FOUND', '卡片不存在');
      return sendJson(res, 200, { progress });
    }

    if (method === 'POST' && action === 'attempt') {
      const user = requireUser(req, db);
      const body = await readBody(req);
      const item = getItem(db, deckId, itemId, user.id);
      if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', '卡片不存在');
      let result;
      try {
        result = gradeItem(item, body.answer);
      } catch (error) {
        if (error instanceof GradeError) {
          throw new ApiError(400, error.code, error.message);
        }
        throw error;
      }
      const progress = transaction(db, () =>
        recordAttempt(db, user.id, deckId, itemId, body.answer, result),
      );
      return sendJson(res, 200, {
        result: {
          isCorrect: result.isCorrect,
          correctAnswer: result.correctAnswer,
          detail: result.detail,
        },
        progress,
      });
    }

    if (method === 'PUT' && action === 'tags') {
      const user = requireUser(req, db);
      const body = await readBody(req);
      const tags = normalizeTagList(body.tags);
      const saved = setUserTags(db, user.id, deckId, itemId, tags);
      if (!saved) throw new ApiError(404, 'ITEM_NOT_FOUND', '卡片不存在');
      return sendJson(res, 200, { tags: saved, overridden: true });
    }

    if (method === 'DELETE' && action === 'tags') {
      const user = requireUser(req, db);
      clearUserTags(db, user.id, deckId, itemId);
      const item = getItem(db, deckId, itemId, user.id);
      if (!item) throw new ApiError(404, 'ITEM_NOT_FOUND', '卡片不存在');
      return sendJson(res, 200, { tags: item.tags, overridden: false });
    }
  }

  // ── 管理接口 ─────────────────────────────────────────────
  if (parts.length === 3 && parts[1] === 'admin' && parts[2] === 'overview' && method === 'GET') {
    requireAdmin(req, db);
    return sendJson(res, 200, {
      counts: countRows(db),
      generatedAt: nowIso(),
    });
  }

  if (parts.length === 3 && parts[1] === 'admin' && parts[2] === 'import' && method === 'POST') {
    requireAdmin(req, db);
    const body = await readBody(req);
    const report = validateInput(body, 'request');
    if (!report.ok) {
      throw new ApiError(400, 'VALIDATION_FAILED', '卡组校验失败', report.errors);
    }
    const result = importDecks(db, report.decks, {
      prune: Boolean(body.prune),
      dryRun: Boolean(body.dryRun),
    });
    return sendJson(res, 200, { report: result, warnings: report.warnings });
  }

  throw new ApiError(404, 'NOT_FOUND', `未知接口：${method} ${url.pathname}`);
}

function serveStatic(req, res, url, publicDir) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', '不支持的请求方法');
  }
  if (!fs.existsSync(publicDir)) {
    return sendError(res, 404, 'FRONTEND_NOT_BUILT', '前端尚未构建，请运行 npm run build，或在开发时使用 npm run dev');
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return sendError(res, 400, 'BAD_PATH', '路径编码无效');
  }
  if (pathname === '/') pathname = '/index.html';

  const resolved = path.resolve(publicDir, '.' + pathname);
  const inside = resolved === publicDir || resolved.startsWith(publicDir + path.sep);
  if (!inside) return sendError(res, 403, 'FORBIDDEN', '禁止访问');

  let filePath = resolved;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    filePath = path.join(publicDir, 'index.html');
    if (!fs.existsSync(filePath)) {
      return sendError(res, 404, 'NOT_FOUND', '文件不存在');
    }
  }

  const ext = path.extname(filePath).toLowerCase();
  const stat = fs.statSync(filePath);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(filePath).pipe(res);
}

export function createApiServer(options = {}) {
  const dbPath = options.dbPath || DB_PATH;
  const publicDir = options.publicDir || PUBLIC_DIR;
  const db = openDatabase(dbPath);
  initSchema(db);

  const server = http.createServer((req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const cors = corsHeaders();

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }

    const finish = () => {
      const elapsed = Date.now() - started;
      if (!url.pathname.startsWith('/api')) return;
      console.log(`[api] ${req.method} ${url.pathname} ${res.statusCode} ${elapsed}ms`);
    };
    res.on('finish', finish);

    if (!url.pathname.startsWith('/api')) {
      for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
      return serveStatic(req, res, url, publicDir);
    }

    for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);

    handleApi(req, res, db, url).catch((error) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (error instanceof ApiError) {
        return sendError(res, error.status, error.code, error.message, error.details);
      }
      console.error('[api] unhandled error:', error);
      sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
    });
  });

  server.on('clientError', (error, socket) => {
    if (!socket.writable) return;
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  return {
    server,
    db,
    dbPath,
    listen(port = options.port ?? PORT, host = options.host ?? HOST) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.off('error', reject);
          resolve(server.address());
        });
      });
    },
    async close() {
      await new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      });
      closeDatabase(db);
    },
  };
}