import type {
  ClozeItemData,
  DeckWithProgressData,
  Familiarity,
  FillItemData,
  ItemData,
  JudgeItemData,
  KnowledgeItemData,
  MultiItemData,
  SingleItemData,
} from '../types/deck';
import type { SubmitRecord, UiDeck, UiItem, UiState } from '../types/ui';
import {
  answerKeyToIndex,
  normalizeJudgeAnswer,
  toUiKind,
  uiItemId,
  withTopTag,
} from '../types/ui';

const FALLBACK_COLORS: Record<string, string> = {
  card: '#3B5BDB',
  question: '#0CA678',
};

function baseItem(item: ItemData, deckId: string) {
  return {
    id: uiItemId(deckId, item.id),
    rawId: item.id,
    deckId,
    tags: withTopTag(item.tags ?? [], toUiKind(item)),
    difficulty: item.difficulty ?? 3,
    chapter: item.chapter,
    section: item.section,
    image: item.image,
    analysis: item.analysis,
    source: item.source,
  };
}

function toUiItem(item: ItemData, deckId: string): UiItem {
  const base = baseItem(item, deckId);

  if (item.type === 'knowledge') {
    const knowledge = item as KnowledgeItemData;
    return {
      ...base,
      kind: 'display',
      front: knowledge.title || '未命名卡片',
      back: knowledge.content || '',
    };
  }

  if (item.type === 'single') {
    const single = item as SingleItemData;
    const optionKeys = single.options.map((option) => option.key);
    const answer = answerKeyToIndex(optionKeys, single.answer[0] ?? '');
    return {
      ...base,
      kind: 'single',
      content: single.stem,
      options: single.options.map((option) => option.text),
      optionKeys,
      answer: answer >= 0 ? answer : 0,
      explanation: single.analysis ?? '',
    };
  }

  if (item.type === 'multi') {
    const multi = item as MultiItemData;
    const optionKeys = multi.options.map((option) => option.key);
    const answer = multi.answer
      .map((key) => answerKeyToIndex(optionKeys, key))
      .filter((index) => index >= 0);
    return {
      ...base,
      kind: 'multi',
      content: multi.stem,
      options: multi.options.map((option) => option.text),
      optionKeys,
      answer,
      explanation: multi.analysis ?? '',
    };
  }

  if (item.type === 'judge') {
    const judge = item as JudgeItemData;
    return {
      ...base,
      kind: 'truefalse',
      content: judge.stem,
      answer: normalizeJudgeAnswer(judge.answer),
      explanation: judge.analysis ?? '',
    };
  }

  if (item.type === 'fill') {
    const fill = item as FillItemData;
    return {
      ...base,
      kind: 'fill-q',
      content: fill.stem,
      blanks: fill.blanks,
      caseSensitive: Boolean(fill.caseSensitive),
      explanation: fill.analysis ?? '',
    };
  }

  const cloze = item as ClozeItemData;
  let blankCount = 0;
  for (const paragraph of cloze.paragraphs ?? []) {
    for (const segment of paragraph.segments ?? []) {
      if (segment.type === 'blank') blankCount += 1;
    }
  }
  return {
    ...base,
    kind: 'cloze',
    title: cloze.title,
    paragraphs: cloze.paragraphs ?? [],
    wordBank: cloze.wordBank,
    showWordBank: Boolean(cloze.showWordBank),
    blankCount,
    explanation: cloze.analysis ?? '',
  };
}

export function buildUiState(deckData: DeckWithProgressData[]): UiState {
  const decks: UiDeck[] = [];
  const familiarityMap: Record<string, Familiarity> = {};
  const submitMap: Record<string, SubmitRecord> = {};

  for (const deck of deckData) {
    const items = (deck.items ?? []).map((item) => toUiItem(item, deck.id));
    decks.push({
      id: deck.id,
      name: deck.name,
      category: deck.category,
      color: deck.color ?? FALLBACK_COLORS[deck.category] ?? '#2C4AB5',
      description: deck.description,
      tags: deck.tags ?? [],
      items,
    });

    for (const item of items) {
      const progress = deck.progress?.[item.rawId];
      if (!progress?.familiarity) continue;
      familiarityMap[item.id] = progress.familiarity;
    }
  }

  return { decks, familiarityMap, submitMap };
}

export function formatItemTitle(item: UiItem): string {
  if (item.kind === 'display') return item.front.slice(0, 22);
  if (item.kind === 'cloze') {
    const text = item.title
      ? item.title
      : (item.paragraphs[0]?.segments.find((segment) => segment.type === 'text') as
          | { text: string }
          | undefined)?.text ?? '完形填空';
    return text.slice(0, 22);
  }
  return item.content.slice(0, 22) + (item.content.length > 22 ? '…' : '');
}

export function itemTagsOf(item: UiItem): string[] {
  return item.tags ?? [];
}