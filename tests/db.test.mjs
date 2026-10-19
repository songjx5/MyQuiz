import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, openInitializedDatabase } from '../server/db.mjs';
import { createUser } from '../server/auth.mjs';
import { validateInput } from '../server/validate.mjs';
import { exportDecks, importDecks } from '../server/importer.mjs';
import {
  getDeck,
  getItem,
  getProgress,
  getStats,
  recordAttempt,
  setFamiliarity,
  setUserTags,
  clearUserTags,
} from '../server/queries.mjs';
import { gradeItem } from '../server/grade.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TMP = path.join(ROOT, '.tmp');

function makeDb() {
  fs.mkdirSync(TMP, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP, 'db-test-'));
  const dbPath = path.join(dir, 'test.db');
  return { dir, dbPath, db: openInitializedDatabase(dbPath) };
}

const deckA = {
  id: 'a',
  name: '卡组 A',
  category: 'question',
  items: [
    {
      id: 'x',
      type: 'single',
      stem: '2 + 2 = ?',
      options: [
        { key: 'A', text: '3' },
        { key: 'B', text: '4' },
      ],
      answer: ['B'],
      tags: ['基础', '数学'],
      analysis: '2 + 2 = 4。',
    },
  ],
};

const deckB = {
  id: 'b',
  name: '卡组 B',
  category: 'question',
  items: [
    {
      id: 'x',
      type: 'judge',
      stem: '天空是蓝的。',
      answer: ['正确'],
      tags: ['常识'],
    },
  ],
};

test('导入、复合键隔离、熟悉度覆盖与统计', () => {
  const { dir, dbPath, db } = makeDb();
  try {
    const validated = validateInput([deckA, deckB]);
    assert.equal(validated.ok, true, JSON.stringify(validated.errors));

    const first = importDecks(db, validated.decks);
    assert.equal(first.totals.decks, 2);
    assert.equal(first.totals.items, 2);
    assert.equal(first.totals.itemsCreated, 2);

    // 幂等导入不应重复创建。
    const second = importDecks(db, validated.decks);
    assert.equal(second.totals.itemsCreated, 0);
    assert.equal(second.totals.itemsUpdated, 2);

    const { key, user } = createUser(db, '测试用户');
    assert.match(key, /^mck_/);

    // 只有标签覆盖、还没有答题进度时，GET 卡组也必须返回覆盖后的标签。
    setUserTags(db, user.id, 'b', 'x', ['无进度标签']);
    assert.deepEqual(getDeck(db, 'b', user.id).items[0].tags, ['单选题', '无进度标签']);
    clearUserTags(db, user.id, 'b', 'x');
    assert.deepEqual(getDeck(db, 'b', user.id).items[0].tags, ['单选题', '常识']);

    // 两个卡组都有卡片 id x，进度必须互相隔离。
    setFamiliarity(db, user.id, 'a', 'x', 'familiar');
    setFamiliarity(db, user.id, 'b', 'x', 'unfamiliar');
    assert.equal(getProgress(db, user.id, 'a', 'x').familiarity, 'familiar');
    assert.equal(getProgress(db, user.id, 'b', 'x').familiarity, 'unfamiliar');

    // 最新一次标记覆盖旧值。
    setFamiliarity(db, user.id, 'a', 'x', 'normal');
    assert.equal(getProgress(db, user.id, 'a', 'x').familiarity, 'normal');

    // 答题与统计。
    const item = getItem(db, 'a', 'x', user.id);
    const result = gradeItem(item, ['B']);
    recordAttempt(db, user.id, 'a', 'x', ['B'], result);
    recordAttempt(db, user.id, 'a', 'x', ['A'], gradeItem(item, ['A']));
    const stats = getStats(db, user.id);
    assert.equal(stats.attempts.total, 2);
    assert.equal(stats.attempts.correct, 1);
    assert.equal(stats.attempts.accuracy, 50);
    assert.equal(stats.attempts.itemsAttempted, 1);
    assert.equal(stats.familiarity.total, 2);

    // 标签覆盖与清除；顶级标签始终由题型派生并保留。
    setUserTags(db, user.id, 'a', 'x', ['我的标签']);
    let deck = getDeck(db, 'a', user.id);
    assert.deepEqual(deck.items[0].tags, ['单选题', '我的标签']);
    assert.deepEqual(
      setUserTags(db, user.id, 'a', 'x', ['多选题', '我的标签']),
      ['单选题', '我的标签'],
    );
    deck = getDeck(db, 'a', user.id);
    assert.deepEqual(deck.items[0].tags, ['单选题', '我的标签']);
    setUserTags(db, user.id, 'a', 'x', []);
    deck = getDeck(db, 'a', user.id);
    assert.deepEqual(deck.items[0].tags, ['单选题']);
    clearUserTags(db, user.id, 'a', 'x');
    deck = getDeck(db, 'a', user.id);
    assert.deepEqual(deck.items[0].tags, ['单选题', '基础', '数学']);

    // 导出应还原两个卡组和各自的 x 卡片。
    const exported = exportDecks(db);
    assert.equal(exported.length, 2);
    assert.equal(exported.find((entry) => entry.id === 'a').items[0].id, 'x');
    assert.equal(exported.find((entry) => entry.id === 'b').items[0].type, 'judge');
    assert.deepEqual(exported.find((entry) => entry.id === 'a').items[0].tags, ['单选题', '基础', '数学']);
    assert.deepEqual(exported.find((entry) => entry.id === 'b').items[0].tags, ['单选题', '常识']);
  } finally {
    closeDatabase(db);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('prune 会删除 JSON 中已移除的卡片并级联清理进度', () => {
  const { dir, db } = makeDb();
  try {
    const validated = validateInput([deckA]);
    importDecks(db, validated.decks);
    const { user } = createUser(db, 'prune 用户');
    setFamiliarity(db, user.id, 'a', 'x', 'familiar');

    const emptyDeck = validateInput([
      {
        id: 'a',
        name: '卡组 A',
        category: 'question',
        items: [],
      },
    ]);
    assert.equal(emptyDeck.ok, true, JSON.stringify(emptyDeck.errors));
    const report = importDecks(db, emptyDeck.decks, { prune: true });
    assert.equal(report.totals.itemsDeleted, 1);
    assert.equal(getDeck(db, 'a', user.id).items.length, 0);
    assert.equal(getProgress(db, user.id, 'a', 'x'), null);
    assert.equal(getStats(db, user.id).attempts.total, 0);
  } finally {
    closeDatabase(db);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dry-run 不写入数据库', () => {
  const { dir, db } = makeDb();
  try {
    const validated = validateInput([deckA]);
    const report = importDecks(db, validated.decks, { dryRun: true });
    assert.equal(report.dryRun, true);
    assert.equal(getDeck(db, 'a', null), null);
  } finally {
    closeDatabase(db);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});