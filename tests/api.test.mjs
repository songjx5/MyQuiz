import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiServer } from '../server/api.mjs';
import { createAdminKey } from '../server/auth.mjs';
import { importDecks } from '../server/importer.mjs';
import { validateInput } from '../server/validate.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TMP = path.join(ROOT, '.tmp');

let app;
let base;
let dir;
let userKey;
let adminKey;

const testDeck = {
  id: 'api_deck',
  name: 'API 测试',
  category: 'question',
  color: '#123456',
  tags: ['测试'],
  items: [
    {
      id: 's1',
      type: 'single',
      stem: '2 + 2 = ?',
      options: [
        { key: 'A', text: '3' },
        { key: 'B', text: '4' },
      ],
      answer: ['B'],
      analysis: '答案是 4。',
      tags: ['数学'],
    },
    {
      id: 'm1',
      type: 'multi',
      stem: '选出偶数',
      options: [
        { key: 'A', text: '2' },
        { key: 'B', text: '3' },
        { key: 'C', text: '4' },
      ],
      answer: ['A', 'C'],
    },
    {
      id: 'j1',
      type: 'judge',
      stem: '天空是蓝的。',
      answer: ['正确'],
    },
    {
      id: 'f1',
      type: 'fill',
      stem: '___ 和 ___',
      blanks: ['Hello', 'World'],
    },
    {
      id: 'c1',
      type: 'cloze',
      title: 'HTTP 完型',
      paragraphs: [
        {
          id: 'p1',
          segments: [
            { type: 'text', text: 'HTTP 默认端口是 ' },
            { type: 'blank', id: 'b1', answer: '80' },
            { type: 'text', text: '，传输层是 ' },
            { type: 'blank', id: 'b2', answer: 'TCP', alternatives: ['传输控制协议'] },
          ],
        },
      ],
    },
  ],
};

async function call(pathname, options = {}) {
  const headers = {};
  const { method = 'GET', body, key = userKey, admin } = options;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (key) headers['X-User-Key'] = key;
  if (admin) headers['X-Admin-Key'] = admin;
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: response.status, data };
}

before(async () => {
  fs.mkdirSync(TMP, { recursive: true });
  dir = fs.mkdtempSync(path.join(TMP, 'api-test-'));
  app = createApiServer({
    dbPath: path.join(dir, 'test.db'),
    publicDir: path.join(dir, 'no-dist'),
  });
  const address = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${address.port}`;

  const validated = validateInput(testDeck);
  assert.equal(validated.ok, true, JSON.stringify(validated.errors));
  importDecks(app.db, validated.decks);

  adminKey = createAdminKey(app.db, 'test-admin').key;
  const session = await call('/api/auth/session', {
    method: 'POST',
    body: {},
    key: null,
  });
  assert.equal(session.status, 201);
  userKey = session.data.userKey;
});

after(async () => {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('health 与鉴权', async () => {
  const health = await call('/api/health', { key: null });
  assert.equal(health.status, 200);
  assert.equal(health.data.ok, true);

  const noAuth = await call('/api/decks?include=items', { key: null });
  assert.equal(noAuth.status, 401);

  const badAuth = await call('/api/decks?include=items', {
    key: 'mck_' + 'a'.repeat(43),
  });
  assert.equal(badAuth.status, 401);

  const resumed = await call('/api/auth/session', {
    method: 'POST',
    body: { userKey },
    key: null,
  });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.data.created, false);
  assert.equal(resumed.data.userKey, userKey);

  const invalidResume = await call('/api/auth/session', {
    method: 'POST',
    body: { userKey: 'mck_' + 'b'.repeat(43) },
    key: null,
  });
  assert.equal(invalidResume.status, 401);
});

test('获取卡组与完整题目结构', async () => {
  const response = await call('/api/decks?include=items');
  assert.equal(response.status, 200);
  const deck = response.data.decks.find((entry) => entry.id === 'api_deck');
  assert.ok(deck);
  assert.equal(deck.items.length, 5);
  assert.equal(deck.items.find((item) => item.id === 'm1').answer.join(','), 'A,C');
  assert.equal(deck.items.find((item) => item.id === 'c1').paragraphs[0].segments.length, 4);
  assert.deepEqual(deck.progress, {});
});

test('各题型答题判分与历史统计', async () => {
  const single = await call('/api/decks/api_deck/items/s1/attempt', {
    method: 'POST',
    body: { answer: ['B'] },
  });
  assert.equal(single.status, 200);
  assert.equal(single.data.result.isCorrect, true);
  assert.equal(single.data.progress.attemptCount, 1);

  const singleWrong = await call('/api/decks/api_deck/items/s1/attempt', {
    method: 'POST',
    body: { answer: ['A'] },
  });
  assert.equal(singleWrong.status, 200);
  assert.equal(singleWrong.data.result.isCorrect, false);
  assert.equal(singleWrong.data.progress.attemptCount, 2);

  const multi = await call('/api/decks/api_deck/items/m1/attempt', {
    method: 'POST',
    body: { answer: ['C', 'A'] },
  });
  assert.equal(multi.data.result.isCorrect, true);

  const judge = await call('/api/decks/api_deck/items/j1/attempt', {
    method: 'POST',
    body: { answer: [true] },
  });
  assert.equal(judge.data.result.isCorrect, true);

  const fill = await call('/api/decks/api_deck/items/f1/attempt', {
    method: 'POST',
    body: { answer: [' hello ', 'WORLD'] },
  });
  assert.equal(fill.data.result.isCorrect, true);

  const cloze = await call('/api/decks/api_deck/items/c1/attempt', {
    method: 'POST',
    body: { answer: { b1: '80', b2: '传输控制协议' } },
  });
  assert.equal(cloze.data.result.isCorrect, true);
  assert.equal(cloze.data.result.detail.blanks.length, 2);

  const stats = await call('/api/stats');
  assert.equal(stats.status, 200);
  assert.equal(stats.data.attempts.total, 6);
  assert.equal(stats.data.attempts.correct, 5);
  assert.equal(stats.data.attempts.accuracy, 83);
  assert.equal(stats.data.attempts.itemsAttempted, 5);
  assert.equal(stats.data.decks.find((entry) => entry.id === 'api_deck').attempted, 5);
});

test('每张卡片自动带有且只带一个顶级标签', async () => {
  const response = await call('/api/decks/api_deck');
  const items = Object.fromEntries(response.data.deck.items.map((item) => [item.id, item]));
  assert.deepEqual(items.s1.tags, ['单选题', '数学']);
  assert.deepEqual(items.m1.tags, ['多选题']);
  assert.deepEqual(items.j1.tags, ['单选题']);
  assert.deepEqual(items.f1.tags, ['填空题']);
  assert.deepEqual(items.c1.tags, ['填空题']);
});

test('熟悉度覆盖、标签覆盖与恢复', async () => {
  // 没有答题进度的卡片也应能单独保存标签覆盖。
  const untouchedTags = await call('/api/decks/api_deck/items/c1/tags', {
    method: 'PUT',
    body: { tags: ['仅标签'] },
  });
  assert.equal(untouchedTags.status, 200);
  assert.deepEqual(untouchedTags.data.tags, ['填空题', '仅标签']);
  let untouchedDeck = await call('/api/decks/api_deck');
  assert.deepEqual(untouchedDeck.data.deck.items.find((item) => item.id === 'c1').tags, ['填空题', '仅标签']);
  const untouchedReset = await call('/api/decks/api_deck/items/c1/tags', { method: 'DELETE' });
  assert.equal(untouchedReset.status, 200);
  assert.deepEqual(untouchedReset.data.tags, ['填空题']);

  const first = await call('/api/decks/api_deck/items/s1/familiarity', {
    method: 'PUT',
    body: { familiarity: 'familiar' },
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.progress.familiarity, 'familiar');

  const second = await call('/api/decks/api_deck/items/s1/familiarity', {
    method: 'PUT',
    body: { familiarity: 'normal' },
  });
  assert.equal(second.data.progress.familiarity, 'normal');

  const clear = await call('/api/decks/api_deck/items/s1/familiarity', {
    method: 'PUT',
    body: { familiarity: null },
  });
  assert.equal(clear.data.progress.familiarity, null);

  const tags = await call('/api/decks/api_deck/items/s1/tags', {
    method: 'PUT',
    body: { tags: ['我的标签', '自定义'] },
  });
  assert.equal(tags.status, 200);
  assert.deepEqual(tags.data.tags, ['单选题', '我的标签', '自定义']);

  let deck = await call('/api/decks/api_deck');
  assert.deepEqual(deck.data.deck.items.find((item) => item.id === 's1').tags, ['单选题', '我的标签', '自定义']);

  // 顶级标签只读：客户端传入其他顶级标签会被忽略，题型对应的顶级标签保持不变。
  const tampered = await call('/api/decks/api_deck/items/s1/tags', {
    method: 'PUT',
    body: { tags: ['多选题', '我的标签', '自定义'] },
  });
  assert.equal(tampered.status, 200);
  assert.deepEqual(tampered.data.tags, ['单选题', '我的标签', '自定义']);

  // 只传顶级标签时，普通标签会被清空，但顶级标签仍然保留。
  const topOnly = await call('/api/decks/api_deck/items/s1/tags', {
    method: 'PUT',
    body: { tags: ['单选题'] },
  });
  assert.equal(topOnly.status, 200);
  assert.deepEqual(topOnly.data.tags, ['单选题']);

  const reset = await call('/api/decks/api_deck/items/s1/tags', { method: 'DELETE' });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.data.tags, ['单选题', '数学']);

  const invalid = await call('/api/decks/api_deck/items/s1/familiarity', {
    method: 'PUT',
    body: { familiarity: 'unknown' },
  });
  assert.equal(invalid.status, 400);

  const knowledgeAttempt = await call('/api/decks/api_deck/items/nope/attempt', {
    method: 'POST',
    body: { answer: [] },
  });
  assert.equal(knowledgeAttempt.status, 404);
});

test('管理接口：鉴权、概览与导入', async () => {
  const denied = await call('/api/admin/overview');
  assert.equal(denied.status, 401);

  const overview = await call('/api/admin/overview', { admin: adminKey });
  assert.equal(overview.status, 200);
  assert.equal(overview.data.counts.decks, 1);
  assert.equal(overview.data.counts.items, 5);

  const extraDeck = {
    id: 'api_deck_2',
    name: '导入卡组',
    category: 'card',
    items: [
      {
        id: 'k1',
        type: 'knowledge',
        title: '知识卡',
        content: '内容',
      },
    ],
  };
  const imported = await call('/api/admin/import', {
    method: 'POST',
    admin: adminKey,
    body: { decks: [extraDeck] },
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.data.report.totals.decks, 1);
  assert.equal(imported.data.report.totals.itemsCreated, 1);

  const invalid = await call('/api/admin/import', {
    method: 'POST',
    admin: adminKey,
    body: { decks: [{ id: 'bad', name: '坏卡组', category: 'question', items: [{ id: 'q', type: 'single', stem: 'x', options: [], answer: [] }] }] },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error.code, 'VALIDATION_FAILED');
});

test('后端静态站点回退（未构建时返回明确错误）', async () => {
  const response = await fetch(`${base}/some/spa/route`);
  assert.equal(response.status, 404);
  const data = await response.json();
  assert.equal(data.error.code, 'FRONTEND_NOT_BUILT');
});