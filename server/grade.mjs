export class GradeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'GradeError';
    this.code = code;
  }
}

export const QUESTION_TYPES = ['single', 'multi', 'judge', 'fill', 'cloze'];

export function isGradeable(item) {
  return Boolean(item && QUESTION_TYPES.includes(item.type));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function normalizeText(value, caseSensitive = false) {
  const text = String(value ?? '').trim();
  return caseSensitive ? text : text.toLowerCase();
}

export function normalizeJudge(value) {
  let raw = value;
  if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['正确', '对', 'true', '1', 'yes', 'y'].includes(text)) return true;
    if (['错误', '错', 'false', '0', 'no', 'n'].includes(text)) return false;
  }
  if (raw === 1 || raw === 0) return raw === 1;
  return null;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => String(value).trim()))].sort();
}

function sameSet(left, right) {
  const a = uniqueSorted(left);
  const b = uniqueSorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function gradeItem(item, answer) {
  if (!item) throw new GradeError('ITEM_NOT_FOUND', '卡片不存在');
  if (!isGradeable(item)) {
    throw new GradeError('NOT_GRADEABLE', '该卡片不是可作答题目');
  }

  if (item.type === 'single') {
    const selected = asArray(answer).map((value) => String(value).trim()).filter(Boolean);
    const expected = item.answer;
    const isCorrect = selected.length === 1 && selected[0] === expected[0];
    return {
      isCorrect,
      correctAnswer: expected,
      detail: { selected, expected },
    };
  }

  if (item.type === 'multi') {
    const selected = asArray(answer).map((value) => String(value).trim()).filter(Boolean);
    const expected = item.answer;
    const isCorrect = sameSet(selected, expected);
    return {
      isCorrect,
      correctAnswer: expected,
      detail: { selected: uniqueSorted(selected), expected: uniqueSorted(expected) },
    };
  }

  if (item.type === 'judge') {
    const selected = normalizeJudge(answer);
    const expected = normalizeJudge(item.answer);
    return {
      isCorrect: selected !== null && selected === expected,
      correctAnswer: [expected ? '正确' : '错误'],
      detail: { selected, expected },
    };
  }

  if (item.type === 'fill') {
    const values = asArray(answer);
    const caseSensitive = Boolean(item.caseSensitive);
    const blanks = item.blanks.map((expected, index) => {
      const actual = values[index] ?? '';
      const isCorrect = normalizeText(actual, caseSensitive) === normalizeText(expected, caseSensitive);
      return { index, expected, actual: String(actual), correct: isCorrect };
    });
    return {
      isCorrect: blanks.length > 0 && blanks.every((blank) => blank.correct),
      correctAnswer: item.blanks,
      detail: { blanks },
    };
  }

  // cloze
  const answers = {};
  if (Array.isArray(answer)) {
    const blankIds = [];
    for (const paragraph of item.paragraphs ?? []) {
      for (const segment of paragraph.segments ?? []) {
        if (segment.type === 'blank') blankIds.push(segment.id);
      }
    }
    blankIds.forEach((id, index) => {
      answers[id] = answer[index] ?? '';
    });
  } else if (answer && typeof answer === 'object') {
    for (const [key, value] of Object.entries(answer)) {
      answers[key] = typeof value === 'string' ? value : String(value ?? '');
    }
  }

  const blanks = [];
  for (const paragraph of item.paragraphs ?? []) {
    for (const segment of paragraph.segments ?? []) {
      if (segment.type !== 'blank') continue;
      const actual = answers[segment.id] ?? '';
      const caseSensitive = Boolean(segment.caseSensitive);
      const accepted = [segment.answer, ...(segment.alternatives ?? [])];
      const isCorrect = accepted.some(
        (expected) => normalizeText(actual, caseSensitive) === normalizeText(expected, caseSensitive),
      );
      blanks.push({
        id: segment.id,
        expected: segment.answer,
        actual: String(actual),
        correct: isCorrect,
      });
    }
  }

  return {
    isCorrect: blanks.length > 0 && blanks.every((blank) => blank.correct),
    correctAnswer: Object.fromEntries(blanks.map((blank) => [blank.id, blank.expected])),
    detail: { blanks },
  };
}