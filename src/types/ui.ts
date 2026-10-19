import type {
  ClozeParagraph,
  Familiarity,
  ItemData,
  SourceData,
} from './deck';

export type UiKind = 'display' | 'single' | 'multi' | 'truefalse' | 'fill-q' | 'cloze';

/** 顶级标签由题型决定，每张卡片有且只有一个，前端不可编辑或删除。 */
// 后端镜像定义在 server/topTags.mjs，修改时请同步。
export const TOP_TAGS = ['单选题', '多选题', '填空题', '记忆卡片'] as const;
export type TopTag = (typeof TOP_TAGS)[number];

const TOP_TAG_SET = new Set<string>(TOP_TAGS);

export const TOP_TAG_BY_KIND: Record<UiKind, TopTag> = {
  display: '记忆卡片',
  single: '单选题',
  multi: '多选题',
  truefalse: '单选题',
  'fill-q': '填空题',
  cloze: '填空题',
};

export function isTopTag(tag: string): tag is TopTag {
  return TOP_TAG_SET.has(tag);
}

export function topTagForKind(kind: UiKind): TopTag {
  return TOP_TAG_BY_KIND[kind];
}

/** 保证前台标签数组以正确的顶级标签开头，并移除其他顶级标签。 */
export function withTopTag(tags: string[], kind: UiKind): string[] {
  const top = topTagForKind(kind);
  return [top, ...tags.filter((tag) => !isTopTag(tag))];
}

export interface UiBaseItem {
  /** 全局唯一键：`${deckId}::${rawId}`，用于跨卡组进度存储。 */
  id: string;
  rawId: string;
  deckId: string;
  kind: UiKind;
  tags: string[];
  difficulty?: number;
  chapter?: string;
  section?: string;
  image?: string;
  analysis?: string;
  explanation?: string;
  source?: SourceData;
}

export interface UiDisplayItem extends UiBaseItem {
  kind: 'display';
  front: string;
  back: string;
}

export interface UiSingleItem extends UiBaseItem {
  kind: 'single';
  content: string;
  options: string[];
  optionKeys: string[];
  answer: number;
  explanation: string;
}

export interface UiMultiItem extends UiBaseItem {
  kind: 'multi';
  content: string;
  options: string[];
  optionKeys: string[];
  answer: number[];
  explanation: string;
}

export interface UiTrueFalseItem extends UiBaseItem {
  kind: 'truefalse';
  content: string;
  answer: boolean;
  explanation: string;
}

export interface UiFillItem extends UiBaseItem {
  kind: 'fill-q';
  content: string;
  blanks: string[];
  caseSensitive: boolean;
  explanation: string;
}

export interface UiClozeItem extends UiBaseItem {
  kind: 'cloze';
  title?: string;
  paragraphs: ClozeParagraph[];
  wordBank?: string[];
  showWordBank: boolean;
  blankCount: number;
  explanation: string;
}

export type UiItem =
  | UiDisplayItem
  | UiSingleItem
  | UiMultiItem
  | UiTrueFalseItem
  | UiFillItem
  | UiClozeItem;

export interface UiDeck {
  id: string;
  name: string;
  category: 'card' | 'question';
  color: string;
  description?: string;
  tags: string[];
  items: UiItem[];
}

export interface SubmitRecord {
  isCorrect: boolean;
  singleSel?: number;
  multiSel?: number[];
  tfSel?: boolean;
  fillSel?: string[];
  clozeSel?: Record<string, string>;
  clozeResults?: Record<string, boolean>;
  attemptCount?: number;
  correctCount?: number;
}

export interface UiState {
  decks: UiDeck[];
  familiarityMap: Record<string, Familiarity>;
  submitMap: Record<string, SubmitRecord>;
}

/** 把设计文档中的题型转换为现有 UI 的渲染类型。 */
export function toUiKind(item: ItemData): UiKind {
  switch (item.type) {
    case 'knowledge':
      return 'display';
    case 'judge':
      return 'truefalse';
    case 'fill':
      return 'fill-q';
    default:
      return item.type;
  }
}

export function uiItemId(deckId: string, rawId: string) {
  return `${deckId}::${rawId}`;
}

export function normalizeJudgeAnswer(raw: unknown): boolean {
  let value = raw;
  if (Array.isArray(value)) value = value[0];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    if (['正确', '对', 'true', '1', 'yes', 'y'].includes(text)) return true;
    if (['错误', '错', 'false', '0', 'no', 'n'].includes(text)) return false;
  }
  return value === 1;
}

export function answerKeyToIndex(keys: string[], key: string): number {
  return keys.findIndex((candidate) => candidate === key);
}

export function gradeClozeLocal(
  paragraphs: ClozeParagraph[],
  answers: Record<string, string>,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const paragraph of paragraphs) {
    for (const segment of paragraph.segments) {
      if (segment.type !== 'blank') continue;
      const actual = (answers[segment.id] ?? '').trim();
      const caseSensitive = Boolean(segment.caseSensitive);
      const expected = caseSensitive ? actual : actual.toLowerCase();
      result[segment.id] = [segment.answer, ...(segment.alternatives ?? [])].some((candidate) => {
        const value = String(candidate).trim();
        return (caseSensitive ? value : value.toLowerCase()) === expected;
      });
    }
  }
  return result;
}

export function clozeAnswersFromUnknown(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    result[key] = typeof raw === 'string' ? raw : String(raw ?? '');
  }
  return result;
}