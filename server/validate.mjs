import fs from 'node:fs';
import path from 'node:path';
import { TOP_TAGS, isTopTag, topTagForType } from './topTags.mjs';

export const ITEM_TYPES = ['single', 'multi', 'judge', 'fill', 'knowledge', 'cloze'];
export const DECK_CATEGORIES = ['card', 'question'];
export const STATUSES = ['draft', 'published', 'archived'];
export const FAMILIARITIES = ['familiar', 'normal', 'unfamiliar'];
export const TABLE_ALIGNS = ['left', 'center', 'right'];

const MAX_TABLE_COLUMNS = 20;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_CELL_LENGTH = 2000;

const SOURCE_KEYS = ['book', 'author', 'page', 'edition', 'publisher', 'isbn', 'url', 'note'];
const COMMON_ITEM_KEYS = [
  'tags',
  'difficulty',
  'chapter',
  'section',
  'analysis',
  'image',
  'assets',
  'notes',
  'importance',
  'frequency',
  'source',
  'status',
  'language',
  'order',
  'createdAt',
  'updatedAt',
];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addError(errors, pathName, message) {
  errors.push({ path: pathName, message });
}

function addWarning(warnings, pathName, message) {
  warnings.push({ path: pathName, message });
}

function nonEmptyString(value, pathName, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    addError(errors, pathName, '必须是非空字符串');
    return null;
  }
  return value.trim();
}

function optionalString(value, pathName, errors) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    addError(errors, pathName, '必须是字符串');
    return undefined;
  }
  return value;
}

function normalizeStringArray(value, pathName, errors, options = {}) {
  const { max = 100, maxLength = 200 } = options;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    addError(errors, pathName, '必须是字符串数组');
    return [];
  }
  const result = [];
  const seen = new Set();
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      addError(errors, `${pathName}[${i}]`, '必须是字符串');
      continue;
    }
    const text = value[i].trim();
    if (!text) continue;
    if (text.length > maxLength) {
      addError(errors, `${pathName}[${i}]`, `长度不能超过 ${maxLength} 个字符`);
      continue;
    }
    if (seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  if (result.length > max) {
    addError(errors, pathName, `最多允许 ${max} 项`);
    return result.slice(0, max);
  }
  return result;
}

function normalizeSource(value, pathName, errors) {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) {
    addError(errors, pathName, '必须是对象');
    return undefined;
  }
  const source = {};
  for (const key of SOURCE_KEYS) {
    if (value[key] === undefined || value[key] === null) continue;
    if (key === 'page') {
      if (typeof value[key] !== 'number' && typeof value[key] !== 'string') {
        addError(errors, `${pathName}.page`, '必须是数字或字符串');
      } else {
        source.page = value[key];
      }
      continue;
    }
    if (typeof value[key] !== 'string') {
      addError(errors, `${pathName}.${key}`, '必须是字符串');
    } else {
      source[key] = value[key];
    }
  }
  return Object.keys(source).length > 0 ? source : undefined;
}

function normalizeNumberInRange(value, pathName, errors, { min, max, integer = true }) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    addError(errors, pathName, '必须是数字');
    return undefined;
  }
  if (integer && !Number.isInteger(value)) {
    addError(errors, pathName, '必须是整数');
    return undefined;
  }
  if (value < min || value > max) {
    addError(errors, pathName, `必须在 ${min}–${max} 之间`);
    return undefined;
  }
  return value;
}

function normalizeBoolean(value, pathName, errors) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    addError(errors, pathName, '必须是布尔值');
    return undefined;
  }
  return value;
}

function normalizeIsoDate(value, pathName, warnings) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    addWarning(warnings, pathName, '不是字符串，已忽略');
    return undefined;
  }
  if (Number.isNaN(Date.parse(value))) {
    addWarning(warnings, pathName, '不是可解析的 ISO 时间，已忽略');
    return undefined;
  }
  return value;
}

function normalizeJudgeAnswer(value, pathName, errors) {
  let raw = value;
  if (Array.isArray(raw)) {
    if (raw.length !== 1) {
      addError(errors, pathName, '判断题答案数组必须且只能包含一个值');
      return null;
    }
    raw = raw[0];
  }
  if (typeof raw === 'string') {
    const text = raw.trim().toLowerCase();
    if (['正确', '对', 'true', '1', 'yes', 'y'].includes(text)) return ['正确'];
    if (['错误', '错', 'false', '0', 'no', 'n'].includes(text)) return ['错误'];
  }
  if (typeof raw === 'boolean') return [raw ? '正确' : '错误'];
  if (raw === 1 || raw === 0) return [raw === 1 ? '正确' : '错误'];
  addError(errors, pathName, '必须是 ["正确"] / ["错误"]，或 true / false');
  return null;
}

function normalizeOptions(value, pathName, errors) {
  if (!Array.isArray(value)) {
    addError(errors, pathName, '必须是选项数组');
    return [];
  }
  if (value.length < 2) addError(errors, pathName, '至少需要 2 个选项');
  const options = [];
  const keys = new Set();
  value.forEach((option, index) => {
    const optionPath = `${pathName}[${index}]`;
    if (!isObject(option)) {
      addError(errors, optionPath, '必须是对象');
      return;
    }
    const key = nonEmptyString(option.key, `${optionPath}.key`, errors);
    const text = nonEmptyString(option.text, `${optionPath}.text`, errors);
    if (!key || !text) return;
    if (keys.has(key)) {
      addError(errors, `${optionPath}.key`, `选项 key "${key}" 重复`);
      return;
    }
    keys.add(key);
    options.push({ key, text });
  });
  return options;
}

function normalizeTable(value, pathName, errors) {
  if (!isObject(value)) {
    addError(errors, pathName, '必须是表格对象');
    return null;
  }

  const table = {};
  if (value.caption !== undefined) {
    const caption = optionalString(value.caption, `${pathName}.caption`, errors);
    if (caption !== undefined) table.caption = caption;
  }
  if (value.footnote !== undefined) {
    const footnote = optionalString(value.footnote, `${pathName}.footnote`, errors);
    if (footnote !== undefined) table.footnote = footnote;
  }
  if (value.header !== undefined) {
    const header = normalizeBoolean(value.header, `${pathName}.header`, errors);
    if (header !== undefined) table.header = header;
  }

  if (!Array.isArray(value.columns) || value.columns.length === 0) {
    addError(errors, `${pathName}.columns`, '必须是非空字符串数组');
    return null;
  }
  if (value.columns.length > MAX_TABLE_COLUMNS) {
    addError(errors, `${pathName}.columns`, `最多允许 ${MAX_TABLE_COLUMNS} 列`);
  }

  const columns = [];
  value.columns.forEach((column, index) => {
    const label = nonEmptyString(column, `${pathName}.columns[${index}]`, errors);
    if (label) columns.push(label);
  });
  if (columns.length === 0) return null;
  table.columns = columns;

  if (value.align !== undefined) {
    if (!Array.isArray(value.align)) {
      addError(errors, `${pathName}.align`, '必须是字符串数组');
    } else if (value.align.length !== columns.length) {
      addError(
        errors,
        `${pathName}.align`,
        `对齐方式有 ${value.align.length} 项，但表格有 ${columns.length} 列`,
      );
    } else {
      const align = [];
      value.align.forEach((entry, index) => {
        if (!TABLE_ALIGNS.includes(entry)) {
          addError(
            errors,
            `${pathName}.align[${index}]`,
            `必须是 ${TABLE_ALIGNS.join(' / ')}`,
          );
          return;
        }
        align.push(entry);
      });
      if (align.length === columns.length) table.align = align;
    }
  }

  if (!Array.isArray(value.rows) || value.rows.length === 0) {
    addError(errors, `${pathName}.rows`, '必须是非空数组');
    return table;
  }
  if (value.rows.length > MAX_TABLE_ROWS) {
    addError(errors, `${pathName}.rows`, `最多允许 ${MAX_TABLE_ROWS} 行`);
  }

  const rows = [];
  value.rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      addError(errors, `${pathName}.rows[${rowIndex}]`, '必须是单元格数组');
      return;
    }
    if (row.length !== columns.length) {
      addError(
        errors,
        `${pathName}.rows[${rowIndex}]`,
        `第 ${rowIndex + 1} 行有 ${row.length} 个单元格，但表头有 ${columns.length} 列`,
      );
    }
    const cells = [];
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      const raw = row[columnIndex];
      if (raw === undefined || raw === null) {
        cells.push('');
        continue;
      }
      if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
        addError(
          errors,
          `${pathName}.rows[${rowIndex}][${columnIndex}]`,
          '单元格必须是字符串、数字或布尔值',
        );
        cells.push('');
        continue;
      }
      const text = String(raw).trim();
      if (text.length > MAX_TABLE_CELL_LENGTH) {
        addError(
          errors,
          `${pathName}.rows[${rowIndex}][${columnIndex}]`,
          `单元格不能超过 ${MAX_TABLE_CELL_LENGTH} 个字符`,
        );
        cells.push(text.slice(0, MAX_TABLE_CELL_LENGTH));
        continue;
      }
      cells.push(text);
    }
    rows.push(cells);
  });
  table.rows = rows;
  return table;
}

function normalizeAnswerKeys(value, options, type, pathName, errors) {
  if (!Array.isArray(value)) {
    addError(errors, pathName, '必须是字符串数组');
    return [];
  }
  const keys = new Set(options.map((option) => option.key));
  const answer = [];
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      addError(errors, `${pathName}[${i}]`, '必须是选项 key 字符串');
      continue;
    }
    const key = value[i].trim();
    if (!keys.has(key)) {
      addError(errors, `${pathName}[${i}]`, `答案 key "${key}" 不在 options 中`);
      continue;
    }
    if (answer.includes(key)) {
      addError(errors, `${pathName}[${i}]`, `答案 key "${key}" 重复`);
      continue;
    }
    answer.push(key);
  }
  if (type === 'single' && answer.length !== 1) {
    addError(errors, pathName, '单选题必须恰好有 1 个正确答案');
  }
  if (type === 'multi' && answer.length < 2) {
    addError(errors, pathName, '多选题至少需要 2 个正确答案');
  }
  return answer;
}

function normalizeCloze(raw, item, pathName, errors, warnings) {
  if (!Array.isArray(raw.paragraphs) || raw.paragraphs.length === 0) {
    addError(errors, `${pathName}.paragraphs`, '必须是非空数组');
    return;
  }
  const paragraphIds = new Set();
  const blankIds = new Set();
  let blankCount = 0;
  const paragraphs = [];

  raw.paragraphs.forEach((paragraph, pIndex) => {
    const pPath = `${pathName}.paragraphs[${pIndex}]`;
    if (!isObject(paragraph)) {
      addError(errors, pPath, '必须是对象');
      return;
    }
    const id = nonEmptyString(paragraph.id, `${pPath}.id`, errors);
    if (id) {
      if (paragraphIds.has(id)) addError(errors, `${pPath}.id`, `段落 id "${id}" 重复`);
      paragraphIds.add(id);
    }
    if (!Array.isArray(paragraph.segments) || paragraph.segments.length === 0) {
      addError(errors, `${pPath}.segments`, '必须是非空数组');
      return;
    }
    const segments = [];
    paragraph.segments.forEach((segment, sIndex) => {
      const sPath = `${pPath}.segments[${sIndex}]`;
      if (!isObject(segment)) {
        addError(errors, sPath, '必须是对象');
        return;
      }
      if (segment.type === 'text') {
        if (typeof segment.text !== 'string') {
          addError(errors, `${sPath}.text`, '文本片段必须提供字符串 text');
          return;
        }
        segments.push({ type: 'text', text: segment.text });
        return;
      }
      if (segment.type === 'blank') {
        const blankId = nonEmptyString(segment.id, `${sPath}.id`, errors);
        const answer = nonEmptyString(segment.answer, `${sPath}.answer`, errors);
        if (!blankId || !answer) return;
        if (blankIds.has(blankId)) {
          addError(errors, `${sPath}.id`, `空位 id "${blankId}" 重复`);
          return;
        }
        blankIds.add(blankId);
        blankCount += 1;
        const blank = { type: 'blank', id: blankId, answer };
        if (segment.alternatives !== undefined) {
          blank.alternatives = normalizeStringArray(segment.alternatives, `${sPath}.alternatives`, errors, {
            max: 20,
            maxLength: 500,
          });
        }
        if (segment.hint !== undefined) {
          const hint = optionalString(segment.hint, `${sPath}.hint`, errors);
          if (hint !== undefined) blank.hint = hint;
        }
        if (segment.caseSensitive !== undefined) {
          const flag = normalizeBoolean(segment.caseSensitive, `${sPath}.caseSensitive`, errors);
          if (flag !== undefined) blank.caseSensitive = flag;
        }
        segments.push(blank);
        return;
      }
      addError(errors, `${sPath}.type`, '必须是 "text" 或 "blank"');
    });
    paragraphs.push({ id: id ?? '', segments });
  });

  if (blankCount === 0) addWarning(warnings, `${pathName}.paragraphs`, '没有任何空位');
  item.paragraphs = paragraphs;
  if (raw.title !== undefined) {
    const title = optionalString(raw.title, `${pathName}.title`, errors);
    if (title !== undefined) item.title = title;
  }
  if (raw.wordBank !== undefined) {
    item.wordBank = normalizeStringArray(raw.wordBank, `${pathName}.wordBank`, errors, {
      max: 200,
      maxLength: 200,
    });
  }
  if (raw.showWordBank !== undefined) {
    item.showWordBank = normalizeBoolean(raw.showWordBank, `${pathName}.showWordBank`, errors) ?? false;
  }
}

function normalizeItem(raw, deck, pathName, errors, warnings) {
  if (!isObject(raw)) {
    addError(errors, pathName, '必须是对象');
    return null;
  }
  const id = nonEmptyString(raw.id, `${pathName}.id`, errors);
  const type = nonEmptyString(raw.type, `${pathName}.type`, errors);
  if (!id || !type) return null;
  if (!ITEM_TYPES.includes(type)) {
    addError(errors, `${pathName}.type`, `未知题型 "${type}"，允许：${ITEM_TYPES.join(', ')}`);
    return null;
  }

  const item = { id, type };
  for (const key of COMMON_ITEM_KEYS) {
    if (raw[key] === undefined) continue;
    switch (key) {
      case 'tags':
        item.tags = normalizeStringArray(raw.tags, `${pathName}.tags`, errors, { max: 30, maxLength: 60 });
        break;
      case 'difficulty':
      case 'importance': {
        const value = normalizeNumberInRange(raw[key], `${pathName}.${key}`, errors, { min: 1, max: 5 });
        if (value !== undefined) item[key] = value;
        break;
      }
      case 'assets':
        item.assets = normalizeStringArray(raw.assets, `${pathName}.assets`, errors, {
          max: 50,
          maxLength: 1000,
        });
        break;
      case 'source':
        item.source = normalizeSource(raw.source, `${pathName}.source`, errors);
        break;
      case 'status':
        if (!STATUSES.includes(raw.status)) {
          addError(errors, `${pathName}.status`, `必须是 ${STATUSES.join(' / ')}`);
        } else {
          item.status = raw.status;
        }
        break;
      case 'order':
      case 'createdAt':
      case 'updatedAt':
      case 'chapter':
      case 'section':
      case 'analysis':
      case 'image':
      case 'notes':
      case 'language':
        if (key === 'order') {
          if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
            addError(errors, `${pathName}.order`, '必须是数字');
          } else item.order = raw.order;
        } else if (key === 'createdAt' || key === 'updatedAt') {
          const value = normalizeIsoDate(raw[key], `${pathName}.${key}`, warnings);
          if (value !== undefined) item[key] = value;
        } else {
          const value = optionalString(raw[key], `${pathName}.${key}`, errors);
          if (value !== undefined) item[key] = value;
        }
        break;
      case 'frequency':
        if (typeof raw.frequency !== 'number' && typeof raw.frequency !== 'string') {
          addError(errors, `${pathName}.frequency`, '必须是数字或字符串');
        } else item.frequency = raw.frequency;
        break;
      default:
        break;
    }
  }

  // 兼容旧前端字段 explanation。
  if (item.analysis === undefined && typeof raw.explanation === 'string') {
    item.analysis = raw.explanation;
    addWarning(warnings, `${pathName}.explanation`, '已作为 analysis 处理，建议改用 analysis');
  }

  // 表格是所有题型都可选的内容呈现方式，例如带数据表的题目或对比表知识卡。
  if (raw.table !== undefined) {
    const table = normalizeTable(raw.table, `${pathName}.table`, errors);
    if (table) item.table = table;
  }

  if (type === 'single' || type === 'multi') {
    item.stem = nonEmptyString(raw.stem, `${pathName}.stem`, errors) ?? '';
    item.options = normalizeOptions(raw.options, `${pathName}.options`, errors);
    item.answer = normalizeAnswerKeys(raw.answer, item.options, type, `${pathName}.answer`, errors);
    if (type === 'multi' && raw.partialCredit !== undefined) {
      item.partialCredit = normalizeBoolean(raw.partialCredit, `${pathName}.partialCredit`, errors) ?? false;
    }
  } else if (type === 'judge') {
    item.stem = nonEmptyString(raw.stem, `${pathName}.stem`, errors) ?? '';
    const answer = normalizeJudgeAnswer(raw.answer, `${pathName}.answer`, errors);
    if (answer) item.answer = answer;
  } else if (type === 'fill') {
    item.stem = nonEmptyString(raw.stem, `${pathName}.stem`, errors) ?? '';
    item.blanks = normalizeStringArray(raw.blanks, `${pathName}.blanks`, errors, {
      max: 100,
      maxLength: 1000,
    });
    if (item.blanks.length === 0) addError(errors, `${pathName}.blanks`, '至少需要 1 个空位答案');
    const blankCount = (item.stem.match(/___/g) || []).length;
    if (blankCount !== item.blanks.length) {
      addError(
        errors,
        `${pathName}.stem`,
        `题干中有 ${blankCount} 个 ___，但 blanks 有 ${item.blanks.length} 项`,
      );
    }
    if (raw.caseSensitive !== undefined) {
      item.caseSensitive = normalizeBoolean(raw.caseSensitive, `${pathName}.caseSensitive`, errors) ?? false;
    }
  } else if (type === 'knowledge') {
    item.title = nonEmptyString(raw.title, `${pathName}.title`, errors) ?? '';
    item.content = nonEmptyString(raw.content, `${pathName}.content`, errors) ?? '';
  } else if (type === 'cloze') {
    normalizeCloze(raw, item, pathName, errors, warnings);
  }

  // 检查题目类卡片是否缺解析（仅提示）。
  if (type !== 'knowledge' && type !== 'cloze' && !item.analysis) {
    addWarning(warnings, `${pathName}.analysis`, '题目未填写解析');
  }

  // 顶级标签由题型决定：每张卡片有且只有一个，并始终排在标签数组第一位。
  const expectedTopTag = topTagForType(type);
  const rawTags = item.tags ?? [];
  const presentTopTags = rawTags.filter(isTopTag);
  if (presentTopTags.length > 1) {
    addError(
      errors,
      `${pathName}.tags`,
      `顶级标签只能有一个（${TOP_TAGS.join(' / ')}），当前包含：${presentTopTags.join('、')}`,
    );
  } else if (presentTopTags.length === 1 && presentTopTags[0] !== expectedTopTag) {
    addError(
      errors,
      `${pathName}.tags`,
      `题型 ${type} 的顶级标签必须是 "${expectedTopTag}"，不能是 "${presentTopTags[0]}"`,
    );
  } else if (presentTopTags.length === 0) {
    addWarning(warnings, `${pathName}.tags`, `缺少顶级标签，已自动补充 "${expectedTopTag}"`);
  }
  item.tags = [expectedTopTag, ...rawTags.filter((tag) => !isTopTag(tag))];

  item.__deckId = deck.id;
  return item;
}

export function validateDeck(raw, source = '') {
  const errors = [];
  const warnings = [];
  const prefix = source ? `${source}: ` : '';

  if (!isObject(raw)) {
    addError(errors, prefix || 'deck', '卡组必须是对象');
    return { ok: false, deck: null, errors, warnings };
  }

  const id = nonEmptyString(raw.id, 'deck.id', errors);
  const name = nonEmptyString(raw.name, 'deck.name', errors);
  const category = nonEmptyString(raw.category, 'deck.category', errors);
  if (category && !DECK_CATEGORIES.includes(category)) {
    addError(errors, 'deck.category', `必须是 ${DECK_CATEGORIES.join(' / ')}`);
  }

  const deck = {
    id: id ?? '',
    name: name ?? '',
    category: category ?? 'card',
  };

  if (raw.description !== undefined) {
    const value = optionalString(raw.description, 'deck.description', errors);
    if (value !== undefined) deck.description = value;
  }
  if (raw.color !== undefined) {
    const value = optionalString(raw.color, 'deck.color', errors);
    if (value !== undefined) deck.color = value;
  }
  if (raw.cover !== undefined) {
    const value = optionalString(raw.cover, 'deck.cover', errors);
    if (value !== undefined) deck.cover = value;
  }
  if (raw.tags !== undefined) {
    deck.tags = normalizeStringArray(raw.tags, 'deck.tags', errors, { max: 30, maxLength: 60 });
  }
  if (raw.source !== undefined) {
    const value = normalizeSource(raw.source, 'deck.source', errors);
    if (value !== undefined) deck.source = value;
  }
  if (raw.version !== undefined) {
    const value = optionalString(raw.version, 'deck.version', errors);
    if (value !== undefined) deck.version = value;
  }
  if (raw.order !== undefined) {
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) {
      addError(errors, 'deck.order', '必须是数字');
    } else deck.order = raw.order;
  }
  if (raw.createdAt !== undefined) {
    const value = normalizeIsoDate(raw.createdAt, 'deck.createdAt', warnings);
    if (value !== undefined) deck.createdAt = value;
  }
  if (raw.updatedAt !== undefined) {
    const value = normalizeIsoDate(raw.updatedAt, 'deck.updatedAt', warnings);
    if (value !== undefined) deck.updatedAt = value;
  }

  if (!Array.isArray(raw.items)) {
    addError(errors, 'deck.items', '必须是数组');
    deck.items = [];
  } else {
    const itemIds = new Set();
    deck.items = [];
    raw.items.forEach((rawItem, index) => {
      const item = normalizeItem(rawItem, deck, `deck.items[${index}]`, errors, warnings);
      if (!item) return;
      if (itemIds.has(item.id)) {
        addError(errors, `deck.items[${index}].id`, `卡片 id "${item.id}" 在卡组内重复`);
        return;
      }
      itemIds.add(item.id);
      deck.items.push(item);
    });
    if (deck.items.length === 0 && raw.items.length > 0) {
      addError(errors, 'deck.items', '没有有效的卡片');
    }
  }

  if (source) {
    for (const error of errors) {
      if (!error.path.startsWith(`${source}: `)) error.path = `${source}: ${error.path}`;
    }
    for (const warning of warnings) {
      if (!warning.path.startsWith(`${source}: `)) warning.path = `${source}: ${warning.path}`;
    }
  }

  return { ok: errors.length === 0, deck, errors, warnings };
}

/** 支持数组、{ decks: [] }、单卡组三种输入。 */
export function validateInput(raw, source = '') {
  let candidates;
  if (Array.isArray(raw)) candidates = raw;
  else if (isObject(raw) && Array.isArray(raw.decks)) candidates = raw.decks;
  else candidates = [raw];

  const decks = [];
  const errors = [];
  const warnings = [];
  const deckIds = new Set();

  candidates.forEach((candidate, index) => {
    const report = validateDeck(candidate, source);
    errors.push(...report.errors);
    warnings.push(...report.warnings);
    if (!report.ok || !report.deck) return;
    if (deckIds.has(report.deck.id)) {
      errors.push({
        path: `${source || 'input'}: deck[${index}].id`,
        message: `卡组 id "${report.deck.id}" 在同一批次中重复`,
      });
      return;
    }
    deckIds.add(report.deck.id);
    decks.push(report.deck);
  });

  return { ok: errors.length === 0, decks, errors, warnings };
}

export function readDeckFile(file) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) {
    return {
      ok: false,
      file: absolute,
      decks: [],
      errors: [{ path: absolute, message: '文件不存在' }],
      warnings: [],
    };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      file: absolute,
      decks: [],
      errors: [{ path: absolute, message: `JSON 解析失败：${error.message}` }],
      warnings: [],
    };
  }
  const report = validateInput(raw, path.basename(absolute));
  return { ...report, file: absolute };
}

/** 目录会展开为其下所有 .json 文件（不递归）。 */
export function expandJsonPaths(inputs) {
  const files = [];
  const errors = [];
  for (const input of inputs) {
    const absolute = path.resolve(input);
    if (!fs.existsSync(absolute)) {
      errors.push({ path: absolute, message: '路径不存在' });
      continue;
    }
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) {
      const entries = fs
        .readdirSync(absolute)
        .filter((name) => name.toLowerCase().endsWith('.json'))
        .sort((a, b) => a.localeCompare(b));
      if (entries.length === 0) {
        errors.push({ path: absolute, message: '目录中没有 .json 文件' });
      }
      for (const entry of entries) files.push(path.join(absolute, entry));
    } else if (stat.isFile()) {
      files.push(absolute);
    } else {
      errors.push({ path: absolute, message: '不是文件或目录' });
    }
  }
  return { files, errors };
}

export function formatIssues(issues) {
  return issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n');
}