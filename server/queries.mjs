import { intToBool, nowIso, parseJson, toJson } from './db.mjs';
import { isTopTag, withTopTag } from './topTags.mjs';

function rowToDeck(row) {
  const deck = {
    id: row.id,
    name: row.name,
    category: row.category,
  };
  if (row.description !== null) deck.description = row.description;
  if (row.color !== null) deck.color = row.color;
  if (row.cover !== null) deck.cover = row.cover;
  const tags = parseJson(row.tags_json, []);
  if (Array.isArray(tags) && tags.length > 0) deck.tags = tags;
  const source = parseJson(row.source_json, null);
  if (source) deck.source = source;
  if (row.version !== null) deck.version = row.version;
  if (row.sort_order) deck.order = row.sort_order;
  if (row.created_at) deck.createdAt = row.created_at;
  if (row.updated_at) deck.updatedAt = row.updated_at;
  return deck;
}

function rowToItem(row, tags) {
  const payload = parseJson(row.payload_json, {});
  const item = { id: row.id, type: row.type };
  if (row.stem !== null) item.stem = row.stem;
  Object.assign(item, payload);
  if (row.title !== null) item.title = row.title;
  if (row.content !== null) item.content = row.content;
  item.tags = tags;
  if (row.difficulty !== null) item.difficulty = row.difficulty;
  if (row.importance !== null) item.importance = row.importance;
  if (row.chapter !== null) item.chapter = row.chapter;
  if (row.section !== null) item.section = row.section;
  if (row.analysis !== null) item.analysis = row.analysis;
  if (row.image !== null) item.image = row.image;
  const assets = parseJson(row.assets_json, []);
  if (Array.isArray(assets) && assets.length > 0) item.assets = assets;
  if (row.notes !== null) item.notes = row.notes;
  const frequency = parseJson(row.frequency_json, undefined);
  if (frequency !== undefined && frequency !== null) item.frequency = frequency;
  const source = parseJson(row.source_json, null);
  if (source) item.source = source;
  if (row.status !== 'published') item.status = row.status;
  if (row.language !== 'zh-CN') item.language = row.language;
  if (row.sort_order) item.order = row.sort_order;
  if (row.created_at) item.createdAt = row.created_at;
  if (row.updated_at) item.updatedAt = row.updated_at;
  return item;
}

function progressToPublic(row, userTags) {
  if (!row) return null;
  return {
    familiarity: row.familiarity ?? null,
    lastAnswer: parseJson(row.last_answer_json, null),
    lastCorrect: row.last_correct === null ? null : intToBool(row.last_correct),
    lastDetail: parseJson(row.last_detail_json, null),
    attemptCount: row.attempt_count,
    correctCount: row.correct_count,
    lastAttemptAt: row.last_attempt_at,
    updatedAt: row.updated_at,
    userTags: Array.isArray(userTags) ? userTags.filter((tag) => !isTopTag(tag)) : null,
  };
}

function userTagMapForDeck(db, userId, deckId) {
  if (!userId) return new Map();
  const rows = db
    .prepare('SELECT item_id, tags_json FROM user_item_tags WHERE user_id = ? AND deck_id = ?')
    .all(userId, deckId);
  return new Map(rows.map((row) => [row.item_id, parseJson(row.tags_json, [])]));
}

function progressMapForDeck(db, userId, deckId) {
  if (!userId) return new Map();
  const rows = db
    .prepare('SELECT * FROM progress WHERE user_id = ? AND deck_id = ?')
    .all(userId, deckId);
  const overrideTags = userTagMapForDeck(db, userId, deckId);
  return new Map(
    rows.map((row) => [row.item_id, progressToPublic(row, overrideTags.get(row.item_id))]),
  );
}

function tagMapForDeck(db, deckId) {
  const rows = db
    .prepare('SELECT item_id, tag FROM item_tags WHERE deck_id = ? ORDER BY tag')
    .all(deckId);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.item_id)) map.set(row.item_id, []);
    map.get(row.item_id).push(row.tag);
  }
  return map;
}

export function getDeck(db, deckId, userId = null) {
  const deckRow = db.prepare('SELECT * FROM decks WHERE id = ?').get(deckId);
  if (!deckRow) return null;

  const tagMap = tagMapForDeck(db, deckId);
  const progress = progressMapForDeck(db, userId, deckId);
  const overrideTags = userTagMapForDeck(db, userId, deckId);
  const items = db
    .prepare('SELECT * FROM items WHERE deck_id = ? ORDER BY sort_order, id')
    .all(deckId)
    .map((row) => {
      const tags = tagMap.get(row.id) ?? [];
      const effectiveTags = overrideTags.get(row.id) ?? tags;
      return rowToItem(row, withTopTag(effectiveTags, row.type));
    });

  return {
    ...rowToDeck(deckRow),
    items,
    progress: Object.fromEntries(progress),
  };
}

export function getItem(db, deckId, itemId, userId = null) {
  const row = db
    .prepare('SELECT * FROM items WHERE deck_id = ? AND id = ?')
    .get(deckId, itemId);
  if (!row) return null;
  const tagRows = db
    .prepare('SELECT tag FROM item_tags WHERE deck_id = ? AND item_id = ? ORDER BY tag')
    .all(deckId, itemId);
  let tags = tagRows.map((tagRow) => tagRow.tag);
  if (userId) {
    const override = db
      .prepare('SELECT tags_json FROM user_item_tags WHERE user_id = ? AND deck_id = ? AND item_id = ?')
      .get(userId, deckId, itemId);
    if (override) tags = parseJson(override.tags_json, []);
  }
  return rowToItem(row, withTopTag(tags, row.type));
}

export function getDeckSummaries(db, userId = null) {
  const rows = db
    .prepare(
      `SELECT d.*, COUNT(i.id) AS item_count
       FROM decks d
       LEFT JOIN items i ON i.deck_id = d.id
       GROUP BY d.id
       ORDER BY d.sort_order, d.name`,
    )
    .all();

  const typeRows = db
    .prepare('SELECT deck_id, type, COUNT(*) AS count FROM items GROUP BY deck_id, type')
    .all();
  const typesByDeck = new Map();
  for (const row of typeRows) {
    if (!typesByDeck.has(row.deck_id)) typesByDeck.set(row.deck_id, {});
    typesByDeck.get(row.deck_id)[row.type] = row.count;
  }

  const progressByDeck = new Map();
  if (userId) {
    const progressRows = db
      .prepare(
        `SELECT deck_id,
                SUM(CASE WHEN attempt_count > 0 THEN 1 ELSE 0 END) AS attempted,
                SUM(attempt_count) AS attempts,
                SUM(CASE WHEN last_correct = 1 THEN 1 ELSE 0 END) AS correct,
                SUM(CASE WHEN familiarity IS NOT NULL THEN 1 ELSE 0 END) AS marked
         FROM progress WHERE user_id = ? GROUP BY deck_id`,
      )
      .all(userId);
    for (const row of progressRows) progressByDeck.set(row.deck_id, row);
  }

  return rows.map((row) => {
    const progress = progressByDeck.get(row.id);
    return {
      ...rowToDeck(row),
      itemCount: row.item_count,
      byType: typesByDeck.get(row.id) ?? {},
      progress: progress
        ? {
            attempted: progress.attempted ?? 0,
            attempts: progress.attempts ?? 0,
            correct: progress.correct ?? 0,
            marked: progress.marked ?? 0,
          }
        : { attempted: 0, attempts: 0, correct: 0, marked: 0 },
    };
  });
}

export function getDecks(db, { userId = null, includeItems = false } = {}) {
  if (includeItems) {
    return db
      .prepare('SELECT id FROM decks ORDER BY sort_order, name')
      .all()
      .map((row) => getDeck(db, row.id, userId))
      .filter(Boolean);
  }
  return getDeckSummaries(db, userId);
}

export function getStats(db, userId) {
  const attemptsRow = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(is_correct), 0) AS correct
       FROM attempts WHERE user_id = ?`,
    )
    .get(userId);
  const total = attemptsRow?.total ?? 0;
  const correct = attemptsRow?.correct ?? 0;

  const attemptedItemsRow = db
    .prepare(
      'SELECT COUNT(*) AS count FROM progress WHERE user_id = ? AND attempt_count > 0',
    )
    .get(userId);

  const familiarity = { familiar: 0, normal: 0, unfamiliar: 0, total: 0 };
  const familiarityRows = db
    .prepare(
      `SELECT familiarity, COUNT(*) AS count FROM progress
       WHERE user_id = ? AND familiarity IS NOT NULL GROUP BY familiarity`,
    )
    .all(userId);
  for (const row of familiarityRows) {
    if (!(row.familiarity in familiarity)) continue;
    familiarity[row.familiarity] = row.count;
    familiarity.total += row.count;
  }

  const deckRows = db
    .prepare(
      `SELECT d.id, d.name, d.category, d.color,
              COUNT(i.id) AS item_count
       FROM decks d
       LEFT JOIN items i ON i.deck_id = d.id
       GROUP BY d.id
       ORDER BY d.sort_order, d.name`,
    )
    .all();

  const progressByDeck = new Map();
  const progressRows = db
    .prepare(
      `SELECT deck_id,
              SUM(CASE WHEN attempt_count > 0 THEN 1 ELSE 0 END) AS attempted,
              SUM(attempt_count) AS attempts,
              SUM(CASE WHEN last_correct = 1 THEN 1 ELSE 0 END) AS correct,
              SUM(CASE WHEN familiarity IS NOT NULL THEN 1 ELSE 0 END) AS marked
       FROM progress WHERE user_id = ? GROUP BY deck_id`,
    )
    .all(userId);
  for (const row of progressRows) progressByDeck.set(row.deck_id, row);

  const familiarByDeck = new Map();
  const familiarRows = db
    .prepare(
      `SELECT deck_id, familiarity, COUNT(*) AS count FROM progress
       WHERE user_id = ? AND familiarity IS NOT NULL
       GROUP BY deck_id, familiarity`,
    )
    .all(userId);
  for (const row of familiarRows) {
    if (!familiarByDeck.has(row.deck_id)) {
      familiarByDeck.set(row.deck_id, { familiar: 0, normal: 0, unfamiliar: 0, total: 0 });
    }
    const entry = familiarByDeck.get(row.deck_id);
    entry[row.familiarity] = row.count;
    entry.total += row.count;
  }

  const decks = deckRows.map((row) => {
    const progress = progressByDeck.get(row.id);
    const fam = familiarByDeck.get(row.id) ?? { familiar: 0, normal: 0, unfamiliar: 0, total: 0 };
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      color: row.color,
      itemCount: row.item_count,
      attempted: progress?.attempted ?? 0,
      attempts: progress?.attempts ?? 0,
      correct: progress?.correct ?? 0,
      marked: progress?.marked ?? 0,
      familiarity: fam,
    };
  });

  const recent = db
    .prepare(
      `SELECT a.id, a.deck_id, a.item_id, a.is_correct, a.created_at,
              d.name AS deck_name, i.type AS item_type
       FROM attempts a
       JOIN decks d ON d.id = a.deck_id
       JOIN items i ON i.deck_id = a.deck_id AND i.id = a.item_id
       WHERE a.user_id = ?
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 10`,
    )
    .all(userId)
    .map((row) => ({
      id: row.id,
      deckId: row.deck_id,
      itemId: row.item_id,
      deckName: row.deck_name,
      itemType: row.item_type,
      isCorrect: intToBool(row.is_correct),
      createdAt: row.created_at,
    }));

  return {
    attempts: {
      total,
      correct,
      incorrect: total - correct,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      itemsAttempted: attemptedItemsRow?.count ?? 0,
    },
    familiarity,
    decks,
    recent,
  };
}

export function setFamiliarity(db, userId, deckId, itemId, familiarity) {
  const exists = db
    .prepare('SELECT 1 AS ok FROM items WHERE deck_id = ? AND id = ?')
    .get(deckId, itemId);
  if (!exists) return null;

  const updatedAt = nowIso();
  db.prepare(
    `INSERT INTO progress (user_id, deck_id, item_id, familiarity, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, deck_id, item_id) DO UPDATE SET
       familiarity = excluded.familiarity,
       updated_at = excluded.updated_at`,
  ).run(userId, deckId, itemId, familiarity, updatedAt);

  return getProgress(db, userId, deckId, itemId);
}

export function getProgress(db, userId, deckId, itemId) {
  const row = db
    .prepare('SELECT * FROM progress WHERE user_id = ? AND deck_id = ? AND item_id = ?')
    .get(userId, deckId, itemId);
  const override = db
    .prepare('SELECT tags_json FROM user_item_tags WHERE user_id = ? AND deck_id = ? AND item_id = ?')
    .get(userId, deckId, itemId);
  return progressToPublic(row, override ? parseJson(override.tags_json, []) : null);
}

export function recordAttempt(db, userId, deckId, itemId, answer, result, createdAt = nowIso()) {
  db.prepare(
    `INSERT INTO attempts (user_id, deck_id, item_id, answer_json, is_correct, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    deckId,
    itemId,
    toJson(answer),
    result.isCorrect ? 1 : 0,
    toJson(result.detail ?? null),
    createdAt,
  );

  db.prepare(
    `INSERT INTO progress (
       user_id, deck_id, item_id, last_answer_json, last_correct, last_detail_json,
       attempt_count, correct_count, last_attempt_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
     ON CONFLICT(user_id, deck_id, item_id) DO UPDATE SET
       last_answer_json = excluded.last_answer_json,
       last_correct = excluded.last_correct,
       last_detail_json = excluded.last_detail_json,
       attempt_count = progress.attempt_count + 1,
       correct_count = progress.correct_count + excluded.correct_count,
       last_attempt_at = excluded.last_attempt_at,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    deckId,
    itemId,
    toJson(answer),
    result.isCorrect ? 1 : 0,
    toJson(result.detail ?? null),
    result.isCorrect ? 1 : 0,
    createdAt,
    createdAt,
  );

  return getProgress(db, userId, deckId, itemId);
}

export function setUserTags(db, userId, deckId, itemId, tags) {
  const item = db
    .prepare('SELECT type FROM items WHERE deck_id = ? AND id = ?')
    .get(deckId, itemId);
  if (!item) return null;

  // 顶级标签由题型决定，不属于用户可编辑标签：静默忽略客户端传来的顶级标签。
  const userTags = [];
  const seen = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (typeof tag !== 'string' || isTopTag(tag) || seen.has(tag)) continue;
    seen.add(tag);
    userTags.push(tag);
  }

  db.prepare(
    `INSERT INTO user_item_tags (user_id, deck_id, item_id, tags_json, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, deck_id, item_id) DO UPDATE SET
       tags_json = excluded.tags_json,
       updated_at = excluded.updated_at`,
  ).run(userId, deckId, itemId, toJson(userTags), nowIso());
  return withTopTag(userTags, item.type);
}

export function clearUserTags(db, userId, deckId, itemId) {
  const info = db
    .prepare('DELETE FROM user_item_tags WHERE user_id = ? AND deck_id = ? AND item_id = ?')
    .run(userId, deckId, itemId);
  return info.changes > 0;
}

export function countRows(db) {
  const tables = ['decks', 'items', 'users', 'admin_keys', 'attempts', 'progress'];
  const counts = {};
  for (const table of tables) {
    counts[table] = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  }
  return counts;
}