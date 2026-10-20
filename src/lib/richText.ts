import type { TableAlign, TableData } from '../types/deck';

export type RichTextBlock =
  | { type: 'text'; text: string }
  | { type: 'table'; table: TableData };

const SEPARATOR_CELL = /^:?-{3,}:?$/;

/**
 * 按 GFM 规则拆分一行管道表格。支持 `\|` 转义，首尾管道可省略。
 */
function splitRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);

  const cells: string[] = [];
  let current = '';
  let escaped = false;
  for (const char of text) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '|') {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlign(cell: string): TableAlign | null {
  const value = cell.trim();
  if (!SEPARATOR_CELL.test(value)) return null;
  const left = value.startsWith(':');
  const right = value.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  return 'left';
}

function tableHeadAt(lines: string[], index: number) {
  const headerLine = lines[index];
  const separatorLine = lines[index + 1];
  if (!headerLine?.includes('|') || !separatorLine?.includes('|')) return null;

  const columns = splitRow(headerLine);
  const separator = splitRow(separatorLine);
  if (columns.length === 0 || columns.length !== separator.length) return null;

  const align: TableAlign[] = [];
  for (const cell of separator) {
    const value = parseAlign(cell);
    if (!value) return null;
    align.push(value);
  }
  return { columns, align };
}

/**
 * 把纯文本切成「文本 / 表格」块。除 GFM 管道表格外，其余内容原样保留，
 * 前端仍以 `whitespace-pre-wrap` 展示换行，不引入完整 Markdown 依赖。
 */
export function parseRichText(input: string): RichTextBlock[] {
  const lines = String(input ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: RichTextBlock[] = [];
  let textLines: string[] = [];
  let inFence = false;

  const flushText = () => {
    if (textLines.length === 0) return;
    const text = textLines.join('\n');
    textLines = [];
    if (text.trim() === '') return;
    blocks.push({ type: 'text', text });
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      textLines.push(line);
      index += 1;
      continue;
    }
    if (inFence) {
      textLines.push(line);
      index += 1;
      continue;
    }

    const head = tableHeadAt(lines, index);
    if (!head) {
      textLines.push(line);
      index += 1;
      continue;
    }

    const rows: string[][] = [];
    let cursor = index + 2;
    while (cursor < lines.length && lines[cursor].trim() !== '' && lines[cursor].includes('|')) {
      const cells = splitRow(lines[cursor]);
      rows.push(head.columns.map((_, columnIndex) => cells[columnIndex] ?? ''));
      cursor += 1;
    }

    // 只有表头 + 分隔线、没有数据行时，不把它当成表格，避免误伤普通文本。
    if (rows.length === 0) {
      textLines.push(lines[index], lines[index + 1]);
      index += 2;
      continue;
    }

    flushText();
    blocks.push({
      type: 'table',
      table: {
        columns: head.columns,
        rows,
        align: head.align,
      },
    });
    index = cursor;
  }

  flushText();
  return blocks;
}
