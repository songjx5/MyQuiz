import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDeck, validateInput, ITEM_TYPES } from '../server/validate.mjs';
import { TOP_TAG_BY_TYPE } from '../server/topTags.mjs';

function deckWith(items, extra = {}) {
  return {
    id: 'deck_test',
    name: '测试卡组',
    category: 'question',
    items,
    ...extra,
  };
}

test('接受设计文档中的合法单选题', () => {
  const report = validateDeck(
    deckWith([
      {
        id: 'q1',
        type: 'single',
        stem: 'HTTP 默认端口？',
        options: [
          { key: 'A', text: '21' },
          { key: 'B', text: '80' },
        ],
        answer: ['B'],
        analysis: 'HTTP 默认 80。',
      },
    ]),
  );
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.deck.items[0].answer[0], 'B');
});

test('单选题答案 key 必须存在于 options', () => {
  const report = validateDeck(
    deckWith([
      {
        id: 'q1',
        type: 'single',
        stem: '题干',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: ['C'],
      },
    ]),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.message.includes('不在 options')));
});

test('多选题至少需要两个答案', () => {
  const report = validateDeck(
    deckWith([
      {
        id: 'm1',
        type: 'multi',
        stem: '题干',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: ['A'],
      },
    ]),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.message.includes('至少需要 2 个')));
});

test('判断题布尔值会归一化', () => {
  const report = validateDeck(
    deckWith([{ id: 'j1', type: 'judge', stem: '天空是蓝的', answer: true }]),
  );
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.deck.items[0].answer, ['正确']);
});

test('填空题 ___ 数量必须与 blanks 一致', () => {
  const report = validateDeck(
    deckWith([{ id: 'f1', type: 'fill', stem: '___ 和 ___', blanks: ['a'] }]),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.message.includes('2 个 ___')));
});

test('完型填空空位 id 必须唯一', () => {
  const report = validateDeck(
    deckWith([
      {
        id: 'c1',
        type: 'cloze',
        paragraphs: [
          {
            id: 'p1',
            segments: [
              { type: 'blank', id: 'b1', answer: 'a' },
              { type: 'blank', id: 'b1', answer: 'b' },
            ],
          },
        ],
      },
    ]),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.message.includes('空位 id')));
});

test('卡组内卡片 id 不可重复', () => {
  const report = validateDeck(
    deckWith([
      { id: 'same', type: 'judge', stem: 'A', answer: true },
      { id: 'same', type: 'judge', stem: 'B', answer: false },
    ]),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.message.includes('在卡组内重复')));
});

test('同一批输入中的卡组 id 不可重复', () => {
  const report = validateInput([
    deckWith([], { id: 'dup' }),
    deckWith([], { id: 'dup' }),
  ]);
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.message.includes('同一批次中重复')));
});

test('允许不同卡组使用相同的卡片 id（复合键）', () => {
  const report = validateInput([
    {
      id: 'a',
      name: 'A',
      category: 'question',
      items: [{ id: 'x', type: 'judge', stem: 'A', answer: true }],
    },
    {
      id: 'b',
      name: 'B',
      category: 'question',
      items: [{ id: 'x', type: 'judge', stem: 'B', answer: false }],
    },
  ]);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.decks.length, 2);
});

test('顶级标签按题型自动补全并排在标签第一位', () => {
  const report = validateDeck(
    deckWith([
      {
        id: 's1',
        type: 'single',
        stem: '单选',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: ['A'],
      },
      {
        id: 'm1',
        type: 'multi',
        stem: '多选',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
          { key: 'C', text: '3' },
        ],
        answer: ['A', 'B'],
      },
      { id: 'j1', type: 'judge', stem: '判断', answer: true },
      { id: 'f1', type: 'fill', stem: '___', blanks: ['答案'] },
      { id: 'k1', type: 'knowledge', title: '知识', content: '内容' },
      {
        id: 'c1',
        type: 'cloze',
        paragraphs: [
          {
            id: 'p1',
            segments: [{ type: 'blank', id: 'b1', answer: '答案' }],
          },
        ],
      },
    ]),
  );
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  const tags = Object.fromEntries(report.deck.items.map((item) => [item.id, item.tags]));
  assert.deepEqual(tags.s1, ['单选题']);
  assert.deepEqual(tags.m1, ['多选题']);
  assert.deepEqual(tags.j1, ['单选题']);
  assert.deepEqual(tags.f1, ['填空题']);
  assert.deepEqual(tags.k1, ['记忆卡片']);
  assert.deepEqual(tags.c1, ['填空题']);
  assert.equal(report.warnings.filter((warning) => warning.path.endsWith('.tags')).length, 6);
});

test('顶级标签只能有一个', () => {
  const report = validateDeck(
    deckWith([
      {
        id: 'm1',
        type: 'multi',
        stem: '多选',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: ['A', 'B'],
        tags: ['单选题', '多选题'],
      },
    ]),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.message.includes('顶级标签只能有一个')));
});

test('顶级标签必须与题型匹配', () => {
  const report = validateDeck(
    deckWith([
      {
        id: 's1',
        type: 'single',
        stem: '单选',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: ['A'],
        tags: ['多选题'],
      },
    ]),
  );
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.message.includes('顶级标签必须是')));
});

test('正确的顶级标签会保留、去重并移到第一位', () => {
  const report = validateDeck(
    deckWith([
      {
        id: 's1',
        type: 'single',
        stem: '单选',
        options: [
          { key: 'A', text: '1' },
          { key: 'B', text: '2' },
        ],
        answer: ['A'],
        tags: ['数学', '单选题', '单选题'],
      },
    ]),
  );
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.deck.items[0].tags, ['单选题', '数学']);
  assert.equal(report.warnings.filter((warning) => warning.path.endsWith('.tags')).length, 0);
});

test('每个支持的题型都有顶级标签映射', () => {
  for (const type of ITEM_TYPES) {
    assert.ok(TOP_TAG_BY_TYPE[type], `题型 ${type} 缺少顶级标签映射`);
  }
});