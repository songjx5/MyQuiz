#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
  BACKUP_DIR,
  DB_PATH,
  DECK_DIR,
} from './config.mjs';
import {
  backupDatabase,
  closeDatabase,
  openInitializedDatabase,
  nowIso,
  resetDatabase,
} from './db.mjs';
import {
  createAdminKey,
  createUser,
  hashKey,
  keyPrefix,
  publicUser,
  rotateUserKey,
  verifyAdminKey,
  verifyUserKey,
} from './auth.mjs';
import { exportDecks, importDecks } from './importer.mjs';
import { readDeckFile, expandJsonPaths, formatIssues, FAMILIARITIES } from './validate.mjs';
import {
  countRows,
  getDeck,
  getDecks,
  getStats,
  setFamiliarity,
} from './queries.mjs';

const OPTIONS = {
  db: { type: 'string' },
  user: { type: 'string' },
  deck: { type: 'string' },
  item: { type: 'string' },
  familiarity: { type: 'string' },
  label: { type: 'string' },
  out: { type: 'string' },
  limit: { type: 'string' },
  json: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  prune: { type: 'boolean' },
  yes: { type: 'boolean' },
  write: { type: 'boolean' },
  all: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

const HELP = `
MemoQuiz 数据库后门 CLI

用法:
  node server/cli.mjs <命令> [参数] [选项]

内容:
  init                          初始化数据库与 schema
  seed                          导入 data/decks 下的所有卡组（首次初始化）
  validate [路径...]            只校验 JSON，不写库（默认 data/decks）
  import [路径...]              校验并导入卡组（支持文件或目录）
                                --prune        删除 JSON 中已不存在的卡片（会级联删除进度）
                                --dry-run      完整执行后回滚，只预览
  export [--out 目录]            从数据库导出设计文档格式的卡组 JSON
  backup [--out 文件]            生成数据库一致性快照（默认 backups/app-<时间>.db）
  reset --yes                    删除并重建数据库（会丢失全部用户与进度）

查看:
  stats                          内容、用户、答题与熟悉度总览
  decks                          卡组列表；decks show <deckId> 查看详情
  users                         用户列表
  users show <id|key>            用户详情
  users create [--label 名称]    创建用户并打印同步码（只显示一次）
  users rotate <id>              轮换用户同步码（旧 key 立即失效）
  users delete <id> --yes        删除用户及其进度、答题记录
  users key-check <key>          校验用户 key
  admin-key                      管理 key 列表
  admin-key create [--label 名称] 生成管理 key（只显示一次）
  admin-key revoke <id|前缀>     吊销管理 key
  admin-key check <key>          校验管理 key
  progress get --user <id|key> [--deck <id>]
  progress set --user <id|key> --deck <id> --item <id> --familiarity <familiar|normal|unfamiliar|none>
  progress clear --user <id|key> [--deck <id>] [--item <id>] [--all] --yes
  attempts --user <id|key> [--limit 20]
  sql "<SQL>" [--write] [--json]  直接执行 SQL（默认只允许读；写操作必须 --write

全局选项:
  --db <文件>                    使用指定数据库文件
  --json                         以 JSON 输出
  -h, --help                     显示帮助

示例:
  npm run db:seed
  npm run db:import -- data/decks --prune
  npm run cli -- users create --label "我的设备"
  npm run cli -- progress set --user 1 --deck d2 --item q1 --familiarity familiar
  npm run cli -- sql "SELECT id,name FROM decks" --json
`;

function log(...args) {
  console.log(...args);
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function resolveDbPath(values) {
  return values.db ? path.resolve(values.db) : DB_PATH;
}

function requireYes(values, message) {
  if (!values.yes) {
    throw new Error(`${message}\n确认后请追加 --yes`);
  }
}

function resolveUser(db, token) {
  if (!token) throw new Error('缺少 --user <id|同步码>');
  const row = /^\d+$/.test(token)
    ? db.prepare('SELECT * FROM users WHERE id = ?').get(Number(token))
    : verifyUserKey(db, token);
  if (!row) throw new Error(`找不到用户：${token}`);
  return row;
}

function collectDecks(paths, values) {
  const targets = paths.length > 0 ? paths : [DECK_DIR];
  const expanded = expandJsonPaths(targets);
  const errors = [...expanded.errors];
  const warnings = [];
  const decks = [];
  const deckIds = new Set();

  for (const file of expanded.files) {
    const report = readDeckFile(file);
    errors.push(...report.errors);
    warnings.push(...report.warnings);
    for (const deck of report.decks) {
      if (deckIds.has(deck.id)) {
        errors.push({ path: file, message: `卡组 id "${deck.id}" 在多文件中重复` });
        continue;
      }
      deckIds.add(deck.id);
      decks.push(deck);
    }
  }

  if (expanded.files.length === 0 && errors.length === 0) {
    errors.push({ path: targets.join(', '), message: '没有找到可导入的 JSON 文件' });
  }

  return { files: expanded.files, decks, errors, warnings };
}

function printIssueReport(report) {
  log(`文件: ${report.files.length}，卡组: ${report.decks.length}`);
  if (report.errors.length > 0) {
    log(`\n错误 (${report.errors.length}):`);
    log(formatIssues(report.errors));
  }
  if (report.warnings.length > 0) {
    log(`\n警告 (${report.warnings.length}):`);
    log(formatIssues(report.warnings));
  }
  if (report.errors.length === 0) log('\n校验通过。');
}

function printImportReport(report) {
  log(
    `${report.dryRun ? '[dry-run] ' : ''}导入完成：卡组 ${report.totals.decks}（新增 ${report.totals.decksCreated}），` +
      `卡片 ${report.totals.items}（新增 ${report.totals.itemsCreated}，更新 ${report.totals.itemsUpdated}，删除 ${report.totals.itemsDeleted}）`,
  );
  for (const deck of report.decks) {
    log(
      `  - ${deck.id} ${deck.name}: ${deck.items} 张（新增 ${deck.created}，更新 ${deck.updated}` +
        `${deck.deleted ? `，删除 ${deck.deleted}` : ''}）`,
    );
  }
  if (Object.keys(report.byType).length > 0) {
    log(`  题型: ${Object.entries(report.byType).map(([type, count]) => `${type}=${count}`).join(', ')}`);
  }
}

/** 导出文件名只保留安全字符，避免题库中的异常 id 造成路径穿越或 Windows 非法文件名。 */
function safeExportStem(value) {
  const stem = String(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 100);
  return stem || 'deck';
}

function printStats(db) {
  const counts = countRows(db);
  log('计数:');
  log(`  卡组 ${counts.decks}，卡片 ${counts.items}，用户 ${counts.users}，管理 key ${counts.admin_keys}`);
  log(`  答题记录 ${counts.attempts}，进度行 ${counts.progress}`);
  const byType = db
    .prepare('SELECT type, COUNT(*) AS count FROM items GROUP BY type ORDER BY count DESC')
    .all();
  if (byType.length > 0) {
    log(`  题型: ${byType.map((row) => `${row.type}=${row.count}`).join(', ')}`);
  }
  const familiarity = db
    .prepare(
      `SELECT familiarity, COUNT(*) AS count FROM progress
       WHERE familiarity IS NOT NULL GROUP BY familiarity`,
    )
    .all();
  if (familiarity.length > 0) {
    log(`  熟悉度: ${familiarity.map((row) => `${row.familiarity}=${row.count}`).join(', ')}`);
  }
  const topUsers = db
    .prepare(
      `SELECT u.id, u.label, u.key_prefix,
              (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts
       FROM users u WHERE u.revoked_at IS NULL
       ORDER BY attempts DESC, u.id LIMIT 5`,
    )
    .all();
  if (topUsers.length > 0) {
    log('\n活跃用户（按答题数）:');
    console.table(topUsers);
  }
}

function listUsers(db, values) {
  const rows = db
    .prepare(
      `SELECT u.id, u.label, u.key_prefix, u.created_at, u.last_seen_at,
              (SELECT COUNT(*) FROM progress p WHERE p.user_id = u.id) AS progress_rows,
              (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempts
       FROM users u WHERE u.revoked_at IS NULL ORDER BY u.id`,
    )
    .all();
  if (values.json) return printJson(rows);
  console.table(rows);
}

function showUser(db, values, token) {
  const user = resolveUser(db, token);
  const stats = getStats(db, user.id);
  const data = { user: publicUser(user), stats };
  if (values.json) return printJson(data);
  log(`用户 #${user.id} ${user.label ?? ''}`);
  log(`  key 前缀: ${user.key_prefix}`);
  log(`  创建: ${user.created_at}，最后访问: ${user.last_seen_at ?? '-'}`);
  log(`  答题: ${stats.attempts.total} 次，正确 ${stats.attempts.correct}，正确率 ${stats.attempts.accuracy}%`);
  log(`  已作答卡片: ${stats.attempts.itemsAttempted}，熟悉度标记: ${stats.familiarity.total}`);
}

function listAdminKeys(db, values) {
  const rows = db
    .prepare(
      `SELECT id, label, key_prefix, created_at, last_used_at, revoked_at
       FROM admin_keys ORDER BY id`,
    )
    .all();
  if (values.json) return printJson(rows);
  console.table(rows);
}

function listProgress(db, values) {
  const user = resolveUser(db, values.user);
  const conditions = ['p.user_id = ?'];
  const params = [user.id];
  if (values.deck) {
    conditions.push('p.deck_id = ?');
    params.push(values.deck);
  }
  if (values.item) {
    conditions.push('p.item_id = ?');
    params.push(values.item);
  }
  const rows = db
    .prepare(
      `SELECT p.deck_id, p.item_id, p.familiarity, p.last_correct,
              p.attempt_count, p.correct_count, p.last_attempt_at, p.updated_at,
              d.name AS deck_name
       FROM progress p JOIN decks d ON d.id = p.deck_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.deck_id, p.item_id`,
    )
    .all(...params);
  if (values.json) return printJson(rows);
  if (rows.length === 0) return log('没有进度记录。');
  console.table(rows);
}

function listAttempts(db, values) {
  const user = resolveUser(db, values.user);
  const limit = Math.max(1, Math.min(500, Number(values.limit || 20)));
  const rows = db
    .prepare(
      `SELECT a.id, a.deck_id, a.item_id, a.is_correct, a.answer_json, a.created_at
       FROM attempts a WHERE a.user_id = ?
       ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    )
    .all(user.id, limit);
  if (values.json) return printJson(rows);
  console.table(rows);
}

function runSql(db, values, positionals) {
  const query = positionals.join(' ').trim();
  if (!query) throw new Error('缺少 SQL 语句');
  const readOnly = /^\s*(select|with|pragma|explain)\b/i.test(query);
  if (!readOnly && !values.write) {
    throw new Error('写操作需要显式追加 --write（例如 --write "UPDATE ..."）');
  }
  if (readOnly) {
    const rows = db.prepare(query).all();
    if (values.json) return printJson(rows);
    if (rows.length === 0) return log('（无结果）');
    console.table(rows);
    return;
  }
  db.exec(query);
  log('SQL 已执行。');
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
  const command = positionals.shift();

  if (values.help || !command || command === 'help') {
    log(HELP);
    return;
  }

  const dbPath = resolveDbPath(values);
  let db = null;
  const open = () => {
    db = openInitializedDatabase(dbPath);
    return db;
  };

  try {
    switch (command) {
      case 'init': {
        open();
        if (values.json) printJson({ dbPath });
        else log(`数据库已初始化：${dbPath}`);
        break;
      }
      case 'seed':
      case 'import': {
        open();
        const report = collectDecks(positionals, values);
        if (values.json && report.errors.length > 0) {
          printJson({ ok: false, files: report.files.length, decks: report.decks.length, errors: report.errors, warnings: report.warnings });
          process.exitCode = 1;
          break;
        }
        if (!values.json) printIssueReport(report);
        if (report.errors.length > 0) {
          process.exitCode = 1;
          break;
        }
        const result = importDecks(db, report.decks, {
          prune: Boolean(values.prune),
          dryRun: Boolean(values['dry-run']),
        });
        if (values.json) printJson({ ...result, files: report.files.length, warnings: report.warnings });
        else printImportReport(result);
        break;
      }
      case 'validate': {
        const report = collectDecks(positionals, values);
        if (values.json) {
          printJson({
            ok: report.errors.length === 0,
            files: report.files.length,
            decks: report.decks.length,
            errors: report.errors,
            warnings: report.warnings,
          });
        } else {
          printIssueReport(report);
        }
        if (report.errors.length > 0) process.exitCode = 1;
        break;
      }
      case 'stats': {
        open();
        if (values.json) {
          printJson({
            counts: countRows(db),
            byType: db.prepare('SELECT type, COUNT(*) AS count FROM items GROUP BY type').all(),
            familiarity: db
              .prepare('SELECT familiarity, COUNT(*) AS count FROM progress WHERE familiarity IS NOT NULL GROUP BY familiarity')
              .all(),
          });
        } else {
          printStats(db);
        }
        break;
      }
      case 'decks': {
        open();
        const sub = positionals[0] ?? 'list';
        if (sub === 'show') {
          const deckId = positionals[1];
          if (!deckId) throw new Error('用法：decks show <deckId>');
          const deck = getDeck(db, deckId, null);
          if (!deck) throw new Error(`卡组不存在：${deckId}`);
          if (values.json) printJson(deck);
          else {
            log(`# ${deck.id} ${deck.name} (${deck.category})`);
            log(`  卡片 ${deck.items.length} 张`);
            for (const item of deck.items) {
              log(`  - ${item.id} [${item.type}] ${item.stem ?? item.title ?? ''}`.slice(0, 120));
            }
          }
        } else {
          const decks = getDecks(db);
          if (values.json) printJson(decks);
          else console.table(decks.map((deck) => ({
            id: deck.id,
            name: deck.name,
            category: deck.category,
            items: deck.itemCount,
          })));
        }
        break;
      }
      case 'users': {
        open();
        const sub = positionals[0] ?? 'list';
        if (sub === 'list') {
          listUsers(db, values);
        } else if (sub === 'create') {
          const created = createUser(db, values.label ?? null);
          if (values.json) printJson({ user: publicUser(created.user), userKey: created.key });
          else {
            log(`用户已创建：#${created.user.id} ${created.user.label ?? ''}`);
            log(`同步码（只显示这一次，请妥善保存）：\n${created.key}`);
          }
        } else if (sub === 'show') {
          showUser(db, values, positionals[1]);
        } else if (sub === 'rotate') {
          const id = Number(positionals[1]);
          if (!Number.isInteger(id)) throw new Error('用法：users rotate <id>');
          const rotated = rotateUserKey(db, id);
          if (!rotated) throw new Error(`用户不存在或已吊销：${id}`);
          log(`用户 #${id} 的新同步码（旧 key 已失效）：\n${rotated.key}`);
        } else if (sub === 'delete') {
          requireYes(values, '删除用户会级联删除其全部进度与答题记录。');
          const id = Number(positionals[1]);
          if (!Number.isInteger(id)) throw new Error('用法：users delete <id> --yes');
          const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
          log(info.changes > 0 ? `用户 #${id} 已删除。` : `用户 #${id} 不存在。`);
        } else if (sub === 'key-check') {
          const key = positionals[1];
          const user = verifyUserKey(db, key);
          if (!user) {
            process.exitCode = 1;
            log('key 无效或已失效。');
          } else {
            log(`key 有效：用户 #${user.id} ${user.label ?? ''}（${user.key_prefix}）`);
          }
        } else {
          throw new Error(`未知 users 子命令：${sub}`);
        }
        break;
      }
      case 'admin-key': {
        open();
        const sub = positionals[0] ?? 'list';
        if (sub === 'list') {
          listAdminKeys(db, values);
        } else if (sub === 'create') {
          const created = createAdminKey(db, values.label ?? null);
          if (values.json) printJson({ admin: created.record, adminKey: created.key });
          else {
            log(`管理 key 已创建：#${created.record.id} ${created.record.label ?? ''}`);
            log(`管理 key（只显示这一次）：\n${created.key}`);
          }
        } else if (sub === 'revoke') {
          const token = positionals[1];
          if (!token) throw new Error('用法：admin-key revoke <id|前缀>');
          const info = /^\d+$/.test(token)
            ? db.prepare('UPDATE admin_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(nowIso(), Number(token))
            : db.prepare('UPDATE admin_keys SET revoked_at = ? WHERE key_prefix = ? AND revoked_at IS NULL').run(nowIso(), token);
          log(info.changes > 0 ? '管理 key 已吊销。' : '没有匹配的管理 key。');
        } else if (sub === 'check') {
          const key = positionals[1];
          const admin = verifyAdminKey(db, key);
          if (!admin) {
            process.exitCode = 1;
            log('管理 key 无效或已失效。');
          } else {
            log(`管理 key 有效：#${admin.id} ${admin.label ?? ''}（${admin.key_prefix}）`);
          }
        } else {
          throw new Error(`未知 admin-key 子命令：${sub}`);
        }
        break;
      }
      case 'progress': {
        open();
        const sub = positionals[0] ?? 'get';
        if (sub === 'get') {
          listProgress(db, values);
        } else if (sub === 'set') {
          const user = resolveUser(db, values.user);
          if (!values.deck || !values.item) throw new Error('必须提供 --deck 与 --item');
          const raw = values.familiarity;
          if (!raw) throw new Error('必须提供 --familiarity familiar|normal|unfamiliar|none');
          const familiarity = raw === 'none' ? null : raw;
          if (familiarity !== null && !FAMILIARITIES.includes(familiarity)) {
            throw new Error(`familiarity 必须是 ${FAMILIARITIES.join(' / ')} 或 none`);
          }
          const progress = setFamiliarity(db, user.id, values.deck, values.item, familiarity);
          if (!progress) throw new Error('卡片不存在');
          if (values.json) printJson(progress);
          else log(`已设置：${values.deck}/${values.item} → ${familiarity ?? '未标记'}`);
        } else if (sub === 'clear') {
          requireYes(values, '清除进度不可恢复（若加 --all 还会删除答题历史）。');
          const user = resolveUser(db, values.user);
          const conditions = ['user_id = ?'];
          const params = [user.id];
          if (values.deck) {
            conditions.push('deck_id = ?');
            params.push(values.deck);
          }
          if (values.item) {
            conditions.push('item_id = ?');
            params.push(values.item);
          }
          if (values.all) {
            db.prepare(`DELETE FROM attempts WHERE user_id = ?`).run(user.id);
          }
          const info = db.prepare(`DELETE FROM progress WHERE ${conditions.join(' AND ')}`).run(...params);
          log(`已清除 ${info.changes} 条进度记录。`);
        } else {
          throw new Error(`未知 progress 子命令：${sub}`);
        }
        break;
      }
      case 'attempts': {
        open();
        listAttempts(db, values);
        break;
      }
      case 'export': {
        open();
        const outDir = values.out ? path.resolve(values.out) : path.join(path.dirname(dbPath), 'export');
        fs.mkdirSync(outDir, { recursive: true });
        const decks = exportDecks(db);
        const files = [];
        for (const deck of decks) {
          const file = path.join(outDir, `${safeExportStem(deck.id)}.json`);
          fs.writeFileSync(file, JSON.stringify(deck, null, 2) + '\n', 'utf8');
          files.push(file);
        }
        if (values.json) printJson(files);
        else log(`已导出 ${decks.length} 个卡组到 ${outDir}`);
        break;
      }
      case 'backup': {
        open();
        const stamp = nowIso().replaceAll(':', '-').replace(/\.\d+Z$/, 'Z');
        const outFile = values.out
          ? path.resolve(values.out)
          : path.join(BACKUP_DIR, `app-${stamp}.db`);
        backupDatabase(db, outFile);
        if (values.json) printJson({ file: outFile });
        else log(`数据库快照已生成：${outFile}`);
        break;
      }
      case 'reset': {
        requireYes(values, '重置数据库会删除全部用户、进度和答题记录。');
        db = resetDatabase(dbPath);
        if (values.json) printJson({ dbPath });
        else log(`数据库已重置：${dbPath}`);
        break;
      }
      case 'sql': {
        open();
        runSql(db, values, positionals);
        break;
      }
      case 'user-key-check': {
        open();
        const user = verifyUserKey(db, positionals[0]);
        if (!user) {
          process.exitCode = 1;
          log('key 无效或已失效。');
        } else {
          log(`key 有效：用户 #${user.id} ${user.label ?? ''}`);
        }
        break;
      }
      case 'admin-key-check': {
        open();
        const admin = verifyAdminKey(db, positionals[0]);
        if (!admin) {
          process.exitCode = 1;
          log('管理 key 无效或已失效。');
        } else {
          log(`管理 key 有效：#${admin.id}`);
        }
        break;
      }
      case 'hash-key': {
        const key = positionals[0];
        if (!key) throw new Error('用法：hash-key <key>');
        log(hashKey(key));
        break;
      }
      default:
        throw new Error(`未知命令：${command}\n${HELP}`);
    }
  } finally {
    if (db) closeDatabase(db);
  }
}

main().catch((error) => {
  console.error(`\n错误：${error.message}`);
  if (process.env.DEBUG) console.error(error.stack);
  process.exitCode = 1;
});