import { nowIso, parseJson, toJson } from './db.mjs';
import { withTopTag } from './topTags.mjs';

function itemPayload(item) {
  if (item.type === 'single' || item.type === 'multi') {
    return {
      options: item.options,
      answer: item.answer,
      ...(item.partialCredit !== undefined ? { partialCredit: item.partialCredit } : {}),
    };
  }
  if (item.type === 'judge') return { answer: item.answer };
  if (item.type === 'fill') {
    return {
      blanks: item.blanks,
      ...(item.caseSensitive !== undefined ? { caseSensitive: item.caseSensitive } : {}),
    };
  }
  if (item.type === 'cloze') {
    return {
      paragraphs: item.paragraphs,
      ...(item.wordBank !== undefined ? { wordBank: item.wordBank } : {}),
      ...(item.showWordBank !== undefined ? { showWordBank: item.showWordBank } : {}),
    };
  }
  return {};
}

function deckParams(deck, now) {
  return {
    id: deck.id,
    name: deck.name,
    category: deck.category,
    description: deck.description ?? null,
    color: deck.color ?? null,
    cover: deck.cover ?? null,
    tagsJson: toJson(deck.tags ?? []),
    sourceJson: deck.source ? toJson(deck.source) : null,
    version: deck.version ?? null,
    sortOrder: deck.order ?? 0,
    createdAt: deck.createdAt ?? now,
    updatedAt: deck.updatedAt ?? now,
  };
}

function itemParams(deckId, item, index, now) {
  return {
    deckId,
    id: item.id,
    type: item.type,
    stem: item.stem ?? null,
    title: item.title ?? null,
    content: item.content ?? null,
    payloadJson: toJson(itemPayload(item)),
    analysis: item.analysis ?? null,
    difficulty: item.difficulty ?? 3,
    importance: item.importance ?? null,
    chapter: item.chapter ?? null,
    section: item.section ?? null,
    image: item.image ?? null,
    assetsJson: toJson(item.assets ?? []),
    notes: item.notes ?? null,
    frequencyJson: item.frequency === undefined ? null : toJson(item.frequency),
    sourceJson: item.source ? toJson(item.source) : null,
    status: item.status ?? 'published',
    language: item.language ?? 'zh-CN',
    sortOrder: item.order ?? index,
    createdAt: item.createdAt ?? now,
    updatedAt: item.updatedAt ?? now,
  };
}

/**
 * 将已通过 validate 的卡组写入数据库。整批使用一个事务。
 * prune: 删除本批次卡组中「JSON 已不存在」的卡片（会级联删除进度）。
 * dryRun: 完整执行后回滚，用于预览。
 */
export function importDecks(db, decks, options = {}) {
  const { prune = false, dryRun = false } = options;
  const now = nowIso();

  const deckExistsStmt = db.prepare('SELECT 1 AS ok FROM decks WHERE id = ?');
  const itemExistsStmt = db.prepare('SELECT 1 AS ok FROM items WHERE deck_id = ? AND id = ?');
  const itemIdsStmt = db.prepare('SELECT id FROM items WHERE deck_id = ?');
  const deleteItemStmt = db.prepare('DELETE FROM items WHERE deck_id = ? AND id = ?');
  const deleteTagsStmt = db.prepare('DELETE FROM item_tags WHERE deck_id = ? AND item_id = ?');

  const upsertDeck = db.prepare(`
    INSERT INTO decks (
      id, name, category, description, color, cover, tags_json, source_json,
      version, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      color = excluded.color,
      cover = excluded.cover,
      tags_json = excluded.tags_json,
      source_json = excluded.source_json,
      version = excluded.version,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `);

  const upsertItem = db.prepare(`
    INSERT INTO items (
      deck_id, id, type, stem, title, content, payload_json, analysis,
      difficulty, importance, chapter, section, image, assets_json, notes,
      frequency_json, source_json, status, language, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(deck_id, id) DO UPDATE SET
      type = excluded.type,
      stem = excluded.stem,
      title = excluded.title,
      content = excluded.content,
      payload_json = excluded.payload_json,
      analysis = excluded.analysis,
      difficulty = excluded.difficulty,
      importance = excluded.importance,
      chapter = excluded.chapter,
      section = excluded.section,
      image = excluded.image,
      assets_json = excluded.assets_json,
      notes = excluded.notes,
      frequency_json = excluded.frequency_json,
      source_json = excluded.source_json,
      status = excluded.status,
      language = excluded.language,
      sort_order = excluded.sort_order,
      updated_at = excluded.updated_at
  `);

  const insertTag = db.prepare(
    'INSERT OR IGNORE INTO item_tags(deck_id, item_id, tag) VALUES (?, ?, ?)',
  );

  const report = {
    dryRun,
    prune,
    decks: [],
    totals: { decks: 0, decksCreated: 0, items: 0, itemsCreated: 0, itemsUpdated: 0, itemsDeleted: 0 },
    byType: {},
  };

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const deck of decks) {
      const wasDeck = Boolean(deckExistsStmt.get(deck.id));
      const params = deckParams(deck, now);
      upsertDeck.run(
        params.id,
        params.name,
        params.category,
        params.description,
        params.color,
        params.cover,
        params.tagsJson,
        params.sourceJson,
        params.version,
        params.sortOrder,
        params.createdAt,
        params.updatedAt,
      );

      const deckReport = {
        id: deck.id,
        name: deck.name,
        category: deck.category,
        items: deck.items.length,
        created: 0,
        updated: 0,
        deleted: 0,
      };

      const incomingIds = new Set();
      deck.items.forEach((item, index) => {
        incomingIds.add(item.id);
        const existed = Boolean(itemExistsStmt.get(deck.id, item.id));
        const p = itemParams(deck.id, item, index, now);
        upsertItem.run(
          p.deckId,
          p.id,
          p.type,
          p.stem,
          p.title,
          p.content,
          p.payloadJson,
          p.analysis,
          p.difficulty,
          p.importance,
          p.chapter,
          p.section,
          p.image,
          p.assetsJson,
          p.notes,
          p.frequencyJson,
          p.sourceJson,
          p.status,
          p.language,
          p.sortOrder,
          p.createdAt,
          p.updatedAt,
        );

        deleteTagsStmt.run(deck.id, item.id);
        for (const tag of withTopTag(item.tags ?? [], item.type)) insertTag.run(deck.id, item.id, tag);

        if (existed) {
          deckReport.updated += 1;
          report.totals.itemsUpdated += 1;
        } else {
          deckReport.created += 1;
          report.totals.itemsCreated += 1;
        }
        report.byType[item.type] = (report.byType[item.type] ?? 0) + 1;
      });

      if (prune) {
        for (const row of itemIdsStmt.all(deck.id)) {
          if (incomingIds.has(row.id)) continue;
          deleteItemStmt.run(deck.id, row.id);
          deckReport.deleted += 1;
          report.totals.itemsDeleted += 1;
        }
      }

      if (!wasDeck) report.totals.decksCreated += 1;
      report.totals.decks += 1;
      report.totals.items += deck.items.length;
      report.decks.push(deckReport);
    }

    if (dryRun) db.exec('ROLLBACK');
    else db.exec('COMMIT');
    return report;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 保留原始错误。
    }
    throw error;
  }
}

function rowToExportedItem(row, tags) {
  const payload = parseJson(row.payload_json, {});
  const item = { id: row.id, type: row.type };
  if (row.stem !== null) item.stem = row.stem;
  Object.assign(item, payload);
  if (row.title !== null) item.title = row.title;
  if (row.content !== null) item.content = row.content;
  if (tags.length > 0) item.tags = tags;
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

/** 从数据库还原为设计文档格式，可用于备份、导出或交接给其他前端。 */
export function exportDecks(db) {
  const decks = db.prepare('SELECT * FROM decks ORDER BY sort_order, name').all();
  const itemStmt = db.prepare('SELECT * FROM items WHERE deck_id = ? ORDER BY sort_order, id');
  const tagStmt = db.prepare('SELECT tag FROM item_tags WHERE deck_id = ? AND item_id = ? ORDER BY tag');

  return decks.map((row) => {
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

    deck.items = itemStmt.all(row.id).map((itemRow) => {
      const itemTags = tagStmt.all(row.id, itemRow.id).map((tagRow) => tagRow.tag);
      return rowToExportedItem(itemRow, withTopTag(itemTags, itemRow.type));
    });
    return deck;
  });
}