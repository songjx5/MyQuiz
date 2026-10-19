import test from 'node:test';
import assert from 'node:assert/strict';
import { gradeItem, GradeError } from '../server/grade.mjs';

const single = {
  id: 's1',
  type: 'single',
  stem: '2 + 2 = ?',
  options: [
    { key: 'A', text: '3' },
    { key: 'B', text: '4' },
  ],
  answer: ['B'],
};

const multi = {
  id: 'm1',
  type: 'multi',
  stem: '选出偶数',
  options: [
    { key: 'A', text: '2' },
    { key: 'B', text: '3' },
    { key: 'C', text: '4' },
  ],
  answer: ['A', 'C'],
};

const judge = { id: 'j1', type: 'judge', stem: '判断', answer: ['正确'] };

const fill = {
  id: 'f1',
  type: 'fill',
  stem: '___ 和 ___',
  blanks: ['Hello', 'World'],
  caseSensitive: false,
};

const fillCase = {
  id: 'f2',
  type: 'fill',
  stem: '___',
  blanks: ['Hello'],
  caseSensitive: true,
};

const cloze = {
  id: 'c1',
  type: 'cloze',
  paragraphs: [
    {
      id: 'p1',
      segments: [
        { type: 'text', text: 'HTTP 默认端口是 ' },
        { type: 'blank', id: 'b1', answer: '80' },
        { type: 'text', text: '，传输层协议是 ' },
        {
          type: 'blank',
          id: 'b2',
          answer: 'TCP',
          alternatives: ['传输控制协议'],
          caseSensitive: false,
        },
      ],
    },
  ],
};

test('单选题判分', () => {
  assert.equal(gradeItem(single, ['B']).isCorrect, true);
  assert.equal(gradeItem(single, ['A']).isCorrect, false);
  assert.equal(gradeItem(single, []).isCorrect, false);
});

test('多选题忽略顺序且要求完全一致', () => {
  assert.equal(gradeItem(multi, ['C', 'A']).isCorrect, true);
  assert.equal(gradeItem(multi, ['A']).isCorrect, false);
  assert.equal(gradeItem(multi, ['A', 'B', 'C']).isCorrect, false);
});

test('判断题支持布尔值和中文', () => {
  assert.equal(gradeItem(judge, true).isCorrect, true);
  assert.equal(gradeItem(judge, ['正确']).isCorrect, true);
  assert.equal(gradeItem(judge, false).isCorrect, false);
  assert.equal(gradeItem(judge, ['错误']).isCorrect, false);
});

test('填空题默认忽略大小写和首尾空格', () => {
  const result = gradeItem(fill, [' hello ', 'WORLD ']);
  assert.equal(result.isCorrect, true);
  assert.equal(result.detail.blanks.length, 2);
});

test('填空题可开启大小写敏感', () => {
  assert.equal(gradeItem(fillCase, ['Hello']).isCorrect, true);
  assert.equal(gradeItem(fillCase, ['hello']).isCorrect, false);
});

test('完型填空支持同义答案', () => {
  const result = gradeItem(cloze, { b1: '80', b2: '传输控制协议' });
  assert.equal(result.isCorrect, true);
  assert.equal(result.detail.blanks.length, 2);
  assert.equal(gradeItem(cloze, { b1: '443', b2: 'TCP' }).isCorrect, false);
});

test('知识卡片不可判分', () => {
  assert.throws(
    () => gradeItem({ id: 'k1', type: 'knowledge', title: 't', content: 'c' }, []),
    (error) => error instanceof GradeError && error.code === 'NOT_GRADEABLE',
  );
});