export type DeckCategory = 'card' | 'question';
export type ItemType = 'single' | 'multi' | 'judge' | 'fill' | 'knowledge' | 'cloze';
export type Familiarity = 'familiar' | 'normal' | 'unfamiliar';
export type Status = 'draft' | 'published' | 'archived';

export interface SourceData {
  book?: string;
  author?: string;
  page?: number | string;
  edition?: string;
  publisher?: string;
  isbn?: string;
  url?: string;
  note?: string;
}

export interface OptionData {
  key: string;
  text: string;
}

export interface BaseItemData {
  id: string;
  type: ItemType;
  tags?: string[];
  difficulty?: number;
  chapter?: string;
  section?: string;
  analysis?: string;
  image?: string;
  assets?: string[];
  notes?: string;
  importance?: number;
  frequency?: number | string;
  source?: SourceData;
  status?: Status;
  language?: string;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface SingleItemData extends BaseItemData {
  type: 'single';
  stem: string;
  options: OptionData[];
  answer: string[];
}

export interface MultiItemData extends BaseItemData {
  type: 'multi';
  stem: string;
  options: OptionData[];
  answer: string[];
  partialCredit?: boolean;
}

export interface JudgeItemData extends BaseItemData {
  type: 'judge';
  stem: string;
  answer: string[];
}

export interface FillItemData extends BaseItemData {
  type: 'fill';
  stem: string;
  blanks: string[];
  caseSensitive?: boolean;
}

export interface KnowledgeItemData extends BaseItemData {
  type: 'knowledge';
  title: string;
  content: string;
}

export interface ClozeTextSegment {
  type: 'text';
  text: string;
}

export interface ClozeBlankSegment {
  type: 'blank';
  id: string;
  answer: string;
  alternatives?: string[];
  hint?: string;
  caseSensitive?: boolean;
}

export type ClozeSegment = ClozeTextSegment | ClozeBlankSegment;

export interface ClozeParagraph {
  id: string;
  segments: ClozeSegment[];
}

export interface ClozeItemData extends BaseItemData {
  type: 'cloze';
  title?: string;
  paragraphs: ClozeParagraph[];
  analysis?: string;
  wordBank?: string[];
  showWordBank?: boolean;
}

export type ItemData =
  | SingleItemData
  | MultiItemData
  | JudgeItemData
  | FillItemData
  | KnowledgeItemData
  | ClozeItemData;

export interface DeckData {
  id: string;
  name: string;
  category: DeckCategory;
  description?: string;
  color?: string;
  cover?: string;
  tags?: string[];
  source?: SourceData;
  version?: string;
  order?: number;
  createdAt?: string;
  updatedAt?: string;
  items: ItemData[];
}

export interface ItemProgressData {
  familiarity: Familiarity | null;
  lastAnswer: unknown;
  lastCorrect: boolean | null;
  lastDetail: unknown;
  attemptCount: number;
  correctCount: number;
  lastAttemptAt: string | null;
  updatedAt: string;
  userTags: string[] | null;
}

export interface DeckWithProgressData extends DeckData {
  items: ItemData[];
  progress: Record<string, ItemProgressData>;
}

export interface DeckSummaryData extends DeckData {
  items?: never;
  itemCount: number;
  byType: Partial<Record<ItemType, number>>;
  progress: {
    attempted: number;
    attempts: number;
    correct: number;
    marked: number;
  };
}

export interface UserData {
  id: number;
  label: string | null;
  keyPrefix: string;
  createdAt: string;
  lastSeenAt: string | null;
}

export interface SessionData {
  userKey: string;
  user: UserData;
  created?: boolean;
}

export interface AttemptResultData {
  isCorrect: boolean;
  correctAnswer: unknown;
  detail: unknown;
}

export interface AttemptResponseData {
  result: AttemptResultData;
  progress: ItemProgressData;
}

export interface FamiliarityResponseData {
  progress: ItemProgressData;
}

export interface StatsDeckData {
  id: string;
  name: string;
  category: DeckCategory;
  color: string | null;
  itemCount: number;
  attempted: number;
  attempts: number;
  correct: number;
  marked: number;
  familiarity: {
    familiar: number;
    normal: number;
    unfamiliar: number;
    total: number;
  };
}

export interface StatsData {
  attempts: {
    total: number;
    correct: number;
    incorrect: number;
    accuracy: number;
    itemsAttempted: number;
  };
  familiarity: {
    familiar: number;
    normal: number;
    unfamiliar: number;
    total: number;
  };
  decks: StatsDeckData[];
  recent: Array<{
    id: number;
    deckId: string;
    itemId: string;
    deckName: string;
    itemType: ItemType;
    isCorrect: boolean;
    createdAt: string;
  }>;
}