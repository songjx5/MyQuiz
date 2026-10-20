-- MemoQuiz SQLite schema
-- 内容（decks/items/item_tags）与用户进度（users/progress/attempts/user_item_tags）分离。
-- 内容可由 data/decks/*.json 重建；进度是唯一不可重建的数据，请定期备份。

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  label        TEXT,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_prefix ON users(key_prefix);

CREATE TABLE IF NOT EXISTS admin_keys (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash     TEXT NOT NULL UNIQUE,
  key_prefix   TEXT NOT NULL,
  label        TEXT,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_keys_prefix ON admin_keys(key_prefix);

CREATE TABLE IF NOT EXISTS decks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL CHECK (category IN ('card', 'question')),
  description TEXT,
  color       TEXT,
  cover       TEXT,
  tags_json   TEXT NOT NULL DEFAULT '[]',
  source_json TEXT,
  version     TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- 卡片内容；主键 (deck_id, id)。
-- table_json 是所有题型可选的结构化表格内容，例如单选/判断题干中的对比表、
-- 知识卡片背面的汇总表；没有表格时为 NULL。文本字段中的 Markdown 管道表格
-- 仍原样保存在 TEXT 列中，由前端渲染。
CREATE TABLE IF NOT EXISTS items (
  deck_id        TEXT NOT NULL,
  id             TEXT NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('single', 'multi', 'judge', 'fill', 'knowledge', 'cloze')),
  stem           TEXT,
  title          TEXT,
  content        TEXT,
  payload_json   TEXT NOT NULL DEFAULT '{}',
  table_json     TEXT,
  analysis       TEXT,
  difficulty     INTEGER CHECK (difficulty IS NULL OR difficulty BETWEEN 1 AND 5),
  importance     INTEGER CHECK (importance IS NULL OR importance BETWEEN 1 AND 5),
  chapter        TEXT,
  section        TEXT,
  image          TEXT,
  assets_json    TEXT NOT NULL DEFAULT '[]',
  notes          TEXT,
  frequency_json TEXT,
  source_json    TEXT,
  status         TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  language       TEXT NOT NULL DEFAULT 'zh-CN',
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  PRIMARY KEY (deck_id, id),
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_items_deck_order ON items(deck_id, sort_order);

-- 卡片原始标签；每张卡片至少包含一个由 type 派生的顶级标签。
CREATE TABLE IF NOT EXISTS item_tags (
  deck_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  tag     TEXT NOT NULL,
  PRIMARY KEY (deck_id, item_id, tag),
  FOREIGN KEY (deck_id, item_id) REFERENCES items(deck_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_item_tags_tag ON item_tags(tag);

CREATE TABLE IF NOT EXISTS progress (
  user_id         INTEGER NOT NULL,
  deck_id         TEXT NOT NULL,
  item_id         TEXT NOT NULL,
  familiarity     TEXT CHECK (familiarity IS NULL OR familiarity IN ('familiar', 'normal', 'unfamiliar')),
  last_answer_json TEXT,
  last_correct    INTEGER,
  last_detail_json TEXT,
  attempt_count   INTEGER NOT NULL DEFAULT 0,
  correct_count   INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  updated_at      TEXT NOT NULL,
  PRIMARY KEY (user_id, deck_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (deck_id, item_id) REFERENCES items(deck_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_deck ON progress(user_id, deck_id);

CREATE TABLE IF NOT EXISTS attempts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL,
  deck_id     TEXT NOT NULL,
  item_id     TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  is_correct  INTEGER NOT NULL,
  detail_json TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (deck_id, item_id) REFERENCES items(deck_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_time ON attempts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attempts_item ON attempts(deck_id, item_id, created_at DESC);

-- 用户对某张卡片的普通标签覆盖（为空数组表示清空普通标签，顶级标签仍保留）。
-- 没有该行时，使用 item_tags 中的卡组原始标签。
-- 顶级标签由 items.type 派生，不写入本表，读取时统一补回。
CREATE TABLE IF NOT EXISTS user_item_tags (
  user_id    INTEGER NOT NULL,
  deck_id    TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  tags_json  TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, deck_id, item_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (deck_id, item_id) REFERENCES items(deck_id, id) ON DELETE CASCADE
);

INSERT OR IGNORE INTO meta(key, value) VALUES ('schema_version', '2');