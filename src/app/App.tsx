import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart2,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  KeyRound,
  ListChecks,
  Loader2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Shuffle,
  Tag,
  WifiOff,
  X,
  XCircle,
} from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Toaster, toast } from "sonner";
import { SyncDialog } from "./components/SyncDialog";
import { DataTable } from "./components/DataTable";
import { RichText } from "./components/RichText";
import { LayoutToggle } from "./components/LayoutToggle";
import { buildUiState, formatItemTitle } from "../lib/adapters";
import { useLayoutMode } from "../lib/useLayoutMode";
import {
  ApiError,
  clearStoredUserKey,
  createSession,
  deleteItemTags,
  fetchDecksWithItems,
  fetchStats,
  getApiBase,
  putFamiliarity,
  putItemTags,
  readStoredUserKey,
  resumeSession,
  saveStoredUserKey,
  submitAttempt,
} from "../lib/api";
import type { Familiarity, StatsData } from "../types/deck";
import type { SubmitRecord, UiClozeItem, UiDeck, UiFillItem, UiItem } from "../types/ui";
import { TOP_TAGS, gradeClozeLocal, isTopTag, withTopTag } from "../types/ui";

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const KIND_META: Record<string, { label: string; bg: string; text: string }> = {
  display: { label: "知识卡片", bg: "bg-blue-100", text: "text-blue-700" },
  single: { label: "单选题", bg: "bg-emerald-100", text: "text-emerald-700" },
  multi: { label: "多选题", bg: "bg-teal-100", text: "text-teal-700" },
  truefalse: { label: "判断题", bg: "bg-amber-100", text: "text-amber-700" },
  "fill-q": { label: "填空题", bg: "bg-purple-100", text: "text-purple-700" },
  cloze: { label: "完型填空", bg: "bg-cyan-100", text: "text-cyan-700" },
};

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const FAM_CONFIG = {
  familiar: {
    label: "熟悉",
    active: "bg-emerald-500 text-white border-emerald-500",
    inactive: "text-emerald-600 border-emerald-300 hover:bg-emerald-50",
  },
  normal: {
    label: "一般",
    active: "bg-amber-400 text-white border-amber-400",
    inactive: "text-amber-600 border-amber-300 hover:bg-amber-50",
  },
  unfamiliar: {
    label: "不熟悉",
    active: "bg-red-500 text-white border-red-500",
    inactive: "text-red-500 border-red-300 hover:bg-red-50",
  },
} as const;

const FAM_COLORS = { familiar: "#10B981", normal: "#F59E0B", unfamiliar: "#EF4444" };

type BootState = "loading" | "ready" | "error";
type MobileTab = "decks" | "card" | "stats";

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function normalizeForCompare(value: string, caseSensitive: boolean) {
  const text = value.trim();
  return caseSensitive ? text : text.toLowerCase();
}

function clozeBlankIds(item: UiClozeItem): string[] {
  const ids: string[] = [];
  for (const paragraph of item.paragraphs) {
    for (const segment of paragraph.segments) {
      if (segment.type === "blank") ids.push(segment.id);
    }
  }
  return ids;
}

/** Fisher–Yates 洗牌；若结果与上一次完全相同则轮转一位，避免“看起来没生效”。 */
function shuffledItemIds(items: UiItem[], previous?: string[]): string[] {
  const ids = items.map((candidate) => candidate.id);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  if (
    ids.length > 1 &&
    previous &&
    previous.length === ids.length &&
    ids.every((id, index) => id === previous[index])
  ) {
    return [...ids.slice(1), ids[0]];
  }
  return ids;
}

/** 按本次会话的顺序排列卡片；顺序里缺失的新卡片追加在末尾。 */
function orderItems(items: UiItem[], order?: string[]): UiItem[] {
  if (!order || order.length === 0) return items;
  const remaining = new Map(items.map((candidate) => [candidate.id, candidate]));
  const ordered: UiItem[] = [];
  for (const id of order) {
    const found = remaining.get(id);
    if (!found) continue;
    ordered.push(found);
    remaining.delete(id);
  }
  for (const extra of remaining.values()) ordered.push(extra);
  return ordered;
}

/** 记忆卡片与完型填空共用的“翻到背面”按钮。 */
function RevealButton({
  revealed,
  onToggle,
  showLabel,
  hideLabel,
}: {
  revealed: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 rounded-lg border-2 border-primary/30 px-5 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5"
    >
      {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      {revealed ? hideLabel : showLabel}
    </button>
  );
}

function FillInContent({
  content,
  blanks,
  answers,
  onChangeAnswer,
  submitted,
  caseSensitive,
}: {
  content: string;
  blanks: string[];
  answers: string[];
  onChangeAnswer: (index: number, value: string) => void;
  submitted: boolean;
  caseSensitive: boolean;
}) {
  const parts = content.split("___");
  return (
    <span className="text-sm leading-9">
      {parts.map((part, index) => (
        <span key={index}>
          <span className="whitespace-pre-wrap">{part}</span>
          {index < parts.length - 1 &&
            (submitted ? (
              <span
                className={`mx-1 inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs font-semibold ${
                  normalizeForCompare(answers[index] ?? "", caseSensitive) ===
                  normalizeForCompare(blanks[index] ?? "", caseSensitive)
                    ? "border-green-300 bg-green-100 text-green-800"
                    : "border-red-300 bg-red-100 text-red-800"
                }`}
              >
                <span>{answers[index] || "（空）"}</span>
                {normalizeForCompare(answers[index] ?? "", caseSensitive) !==
                  normalizeForCompare(blanks[index] ?? "", caseSensitive) && (
                  <span className="border-l border-green-300 pl-1 font-bold text-green-700">
                    → {blanks[index]}
                  </span>
                )}
              </span>
            ) : (
              <input
                type="text"
                value={answers[index] ?? ""}
                onChange={(event) => onChangeAnswer(index, event.target.value)}
                className="mx-1 inline-block w-24 rounded-sm border-b-2 border-primary bg-transparent px-2 text-center font-mono text-sm transition-colors focus:border-primary/70 focus:outline-none"
                placeholder="填写"
                style={{ width: `${Math.max(80, Math.min(240, (blanks[index]?.length ?? 4) * 14 + 32))}px` }}
              />
            ))}
        </span>
      ))}
    </span>
  );
}

/** Deck header row — clicking selects the deck */
function DeckListItem({
  deck,
  isActive,
  onClick,
  familiarityMap,
}: {
  deck: UiDeck;
  isActive: boolean;
  onClick: () => void;
  familiarityMap: Record<string, Familiarity>;
}) {
  const markedCount = deck.items.filter((item) => familiarityMap[item.id]).length;
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-xl border px-3 py-2.5 text-left transition-all ${
        isActive
          ? "border-primary/25 bg-primary/8 text-primary shadow-sm"
          : "border-transparent text-foreground hover:bg-muted"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: deck.color }} />
          <span className="truncate text-sm font-medium">{deck.name}</span>
        </div>
        <span
          className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs ${
            isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {deck.items.length}
        </span>
      </div>
      {markedCount > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(markedCount / Math.max(1, deck.items.length)) * 100}%`,
                backgroundColor: deck.color,
                opacity: 0.5,
              }}
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {markedCount}/{deck.items.length}
          </span>
        </div>
      )}
    </button>
  );
}

/** Tag sub-list rendered below the active deck header */
function DeckTagList({
  deck,
  selectedTags,
  onToggleTag,
  onClearTags,
  onGoToCard,
}: {
  deck: UiDeck;
  selectedTags: Set<string>;
  onToggleTag: (tag: string) => void;
  onClearTags: () => void;
  onGoToCard?: () => void;
}) {
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    deck.items.forEach((item) => {
      (item.tags ?? []).forEach((tag) => {
        counts[tag] = (counts[tag] ?? 0) + 1;
      });
    });
    const topOrder = new Map<string, number>(
      TOP_TAGS.map((tag, index) => [tag, index] as const),
    );
    return Object.entries(counts).sort((a, b) => {
      const aTop = topOrder.get(a[0]);
      const bTop = topOrder.get(b[0]);
      if (aTop !== undefined || bTop !== undefined) {
        if (aTop === undefined) return 1;
        if (bTop === undefined) return -1;
        return aTop - bTop;
      }
      return b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN");
    });
  }, [deck]);

  if (tagCounts.length === 0) return null;

  const isFiltered = selectedTags.size > 0;
  const filteredCount = isFiltered
    ? deck.items.filter((item) => item.tags.some((tag) => selectedTags.has(tag))).length
    : deck.items.length;

  return (
    <div className="mb-2 ml-3 mr-1 mt-0.5">
      <button
        onClick={onClearTags}
        className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
          !isFiltered
            ? "bg-muted/80 font-semibold text-foreground"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${!isFiltered ? "bg-foreground" : "bg-muted-foreground/40"}`} />
          <span>全部</span>
        </div>
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-xs ${
            !isFiltered ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground"
          }`}
        >
          {filteredCount}
        </span>
      </button>

      <div className="ml-[5px] mt-0.5 space-y-0.5 border-l-2 border-border pl-2">
        {tagCounts.map(([tag, count]) => {
          const isSelected = selectedTags.has(tag);
          const top = isTopTag(tag);
          const Icon = top ? Lock : Tag;
          return (
            <button
              key={tag}
              onClick={() => onToggleTag(tag)}
              title={top ? "顶级标签：由题型自动决定，不能修改或删除" : undefined}
              className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-xs transition-colors ${
                isSelected
                  ? "bg-primary/10 font-semibold text-primary"
                  : top
                    ? "text-primary/75 hover:bg-primary/5 hover:text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <Icon
                  className={`h-3 w-3 shrink-0 ${
                    isSelected ? "text-primary" : top ? "text-primary/60" : "text-muted-foreground/50"
                  }`}
                />
                <span className="truncate">{tag}</span>
                {top && (
                  <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold leading-none text-primary">
                    顶级
                  </span>
                )}
              </div>
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-xs ${
                  isSelected
                    ? "bg-primary/15 text-primary"
                    : top
                      ? "bg-primary/10 text-primary/75"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {onGoToCard && (
        <button
          type="button"
          onClick={onGoToCard}
          className="mt-2 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80"
        >
          查看卡片
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function StatRow({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-sm font-bold ${color}`}>
        {value}
        <span className="ml-0.5 text-xs font-normal">{unit}</span>
      </span>
    </div>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="flex app-viewport items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin text-primary" />
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-1 text-xs text-muted-foreground">API: {getApiBase()}</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────

export default function App() {
  const [decks, setDecks] = useState<UiDeck[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);
  /** 每个卡组本次会话的乱序结果（卡片 id 数组）。 */
  const [orderByDeck, setOrderByDeck] = useState<Record<string, string[]>>({});
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [tagEditMode, setTagEditMode] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const [familiarityMap, setFamiliarityMap] = useState<Record<string, Familiarity>>({});
  const [submitMap, setSubmitMap] = useState<Record<string, SubmitRecord>>({});

  // 布局：auto 按视口 / 触控 / UA 特征隐式切换，也可用按钮手动覆盖。
  const { isMobile, override: layoutOverride, cycleLayout, profile: deviceProfile } = useLayoutMode();
  const [mobileTab, setMobileTab] = useState<MobileTab>("card");

  // Transient answer state
  const [singleSel, setSingleSel] = useState<number | null>(null);
  const [multiSel, setMultiSel] = useState<Set<number>>(new Set());
  const [tfSel, setTfSel] = useState<boolean | null>(null);
  const [fillSel, setFillSel] = useState<string[]>([]);
  const [clozeSel, setClozeSel] = useState<Record<string, string>>({});
  const [clozeRevealed, setClozeRevealed] = useState(false);

  const [userKey, setUserKey] = useState("");
  const [userLabel, setUserLabel] = useState<string | null>(null);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [bootState, setBootState] = useState<BootState>("loading");
  const [bootError, setBootError] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const deck = decks.find((candidate) => candidate.id === selectedDeckId) ?? null;

  const orderedItems = useMemo(() => {
    if (!deck) return [];
    return orderItems(deck.items, orderByDeck[deck.id]);
  }, [deck, orderByDeck]);

  const filteredItems = useMemo(() => {
    if (selectedTags.size === 0) return orderedItems;
    return orderedItems.filter((item) => item.tags.some((tag) => selectedTags.has(tag)));
  }, [orderedItems, selectedTags]);

  const completedInView = useMemo(() => {
    return filteredItems.filter((candidate) =>
      candidate.kind === "display"
        ? Boolean(familiarityMap[candidate.id])
        : Boolean(submitMap[candidate.id]),
    ).length;
  }, [filteredItems, familiarityMap, submitMap]);

  const item = filteredItems[currentIndex] ?? filteredItems[0] ?? null;
  const submitRecord = item ? submitMap[item.id] : undefined;
  const isSubmitted = Boolean(submitRecord);
  const itemTags = item?.tags ?? [];
  const editableTags = itemTags.filter((tag) => !isTopTag(tag));
  const topTagTitle = `顶级标签：由题型自动决定，不能修改或删除${
    item?.kind === "truefalse"
      ? "（判断题归入单选题）"
      : item?.kind === "cloze"
        ? "（完型填空归入填空题）"
        : item?.kind === "display"
          ? "（知识卡片归入记忆卡片）"
          : ""
  }`;

  const refreshStats = useCallback(async () => {
    if (!userKey) return;
    try {
      setStats(await fetchStats(userKey));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        toast.error("同步码已失效，请重新同步");
      }
    }
  }, [userKey]);

  function restoreStateEmpty() {
    setClozeRevealed(false);
    setTagEditMode(false);
    setNewTagInput("");
    setSingleSel(null);
    setMultiSel(new Set());
    setTfSel(null);
    setFillSel([]);
    setClozeSel({});
  }

  function restoreState(nextItem: UiItem, record?: SubmitRecord) {
    setClozeRevealed(false);
    setTagEditMode(false);
    setNewTagInput("");
    if (record) {
      setSingleSel(record.singleSel ?? null);
      setMultiSel(new Set(record.multiSel ?? []));
      setTfSel(record.tfSel ?? null);
      setFillSel(
        nextItem.kind === "fill-q"
          ? nextItem.blanks.map((_, index) => record.fillSel?.[index] ?? "")
          : [],
      );
      setClozeSel(record.clozeSel ?? {});
    } else {
      setSingleSel(null);
      setMultiSel(new Set());
      setTfSel(null);
      setFillSel(nextItem.kind === "fill-q" ? Array(nextItem.blanks.length).fill("") : []);
      setClozeSel({});
    }
  }

  const seedState = (
    nextDecks: UiDeck[],
    nextFamiliarity: Record<string, Familiarity>,
    nextSubmit: Record<string, SubmitRecord>,
  ) => {
    setDecks(nextDecks);
    setFamiliarityMap(nextFamiliarity);
    setSubmitMap(nextSubmit);
    const nextOrderByDeck: Record<string, string[]> = {};
    for (const candidateDeck of nextDecks) {
      nextOrderByDeck[candidateDeck.id] = shuffledItemIds(candidateDeck.items);
    }
    setOrderByDeck(nextOrderByDeck);
    const firstDeck = nextDecks[0];
    setSelectedDeckId(firstDeck?.id ?? "");
    setSelectedTags(new Set());
    setCurrentIndex(0);
    const firstItem = firstDeck ? orderItems(firstDeck.items, nextOrderByDeck[firstDeck.id])[0] : undefined;
    if (firstItem) {
      restoreState(firstItem, nextSubmit[firstItem.id]);
    } else {
      restoreStateEmpty();
    }
  };

  const loadData = async (key: string) => {
    const [deckResponse, statsData] = await Promise.all([fetchDecksWithItems(key), fetchStats(key)]);
    const ui = buildUiState(deckResponse.decks);
    seedState(ui.decks, ui.familiarityMap, ui.submitMap);
    setStats(statsData);
  };

  const bootstrap = async () => {
    setBootState("loading");
    setBootError("");
    try {
      const stored = readStoredUserKey();
      let session;
      if (stored) {
        try {
          session = await resumeSession(stored);
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            clearStoredUserKey();
            session = await createSession();
            toast.warning("原同步码已失效，已创建新的本地身份");
          } else {
            throw error;
          }
        }
      } else {
        session = await createSession();
      }

      saveStoredUserKey(session.userKey);
      setUserKey(session.userKey);
      setUserLabel(session.user.label);
      await loadData(session.userKey);
      setBootState("ready");
    } catch (error) {
      setBootError(error instanceof Error ? error.message : "加载失败");
      setBootState("error");
    }
  };

  useEffect(() => {
    void bootstrap();
    // 仅在首次挂载时初始化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从桌面布局切到移动布局时，默认落在当前卡片上。
  useEffect(() => {
    if (isMobile) setMobileTab("card");
  }, [isMobile]);

  useEffect(() => {
    if (filteredItems.length > 0 && currentIndex >= filteredItems.length) {
      setCurrentIndex(0);
    }
  }, [filteredItems.length, currentIndex]);

  const currentItemId = item?.id ?? "";
  useEffect(() => {
    if (!item) return;
    restoreState(item, submitMap[item.id]);
    // 只在当前卡片发生变化时恢复临时作答状态；submitMap 的变化由提交逻辑自行处理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItemId]);

  const selectDeck = (id: string) => {
    const nextDeck = decks.find((candidate) => candidate.id === id);
    if (!nextDeck) return;
    const existingOrder = orderByDeck[id];
    const isSameDeck = selectedDeckId === id;
    const discardAnswers = !isSameDeck || selectedTags.size > 0;
    const nextOrder =
      isSameDeck && existingOrder && existingOrder.length === nextDeck.items.length
        ? existingOrder
        : shuffledItemIds(nextDeck.items, existingOrder);
    if (nextOrder !== existingOrder) {
      setOrderByDeck((previous) => ({ ...previous, [id]: nextOrder }));
    }
    if (discardAnswers) setSubmitMap({});
    setSelectedDeckId(id);
    setSelectedTags(new Set());
    setCurrentIndex(0);
    const firstItem = orderItems(nextDeck.items, nextOrder)[0];
    if (firstItem) restoreState(firstItem, discardAnswers ? undefined : submitMap[firstItem.id]);
    else restoreStateEmpty();
  };

  /** 移动端从卡组列表选中卡组后直接进入卡片页。 */
  const selectDeckAndOpen = (id: string) => {
    if (selectedDeckId !== id) selectDeck(id);
    setMobileTab("card");
  };

  const toggleTag = (tag: string) => {
    const nextTags = new Set(selectedTags);
    if (nextTags.has(tag)) nextTags.delete(tag);
    else nextTags.add(tag);
    setSubmitMap({});
    setSelectedTags(nextTags);

    const nextFiltered =
      nextTags.size === 0
        ? orderedItems
        : orderedItems.filter((candidate) =>
            candidate.tags.some((candidateTag) => nextTags.has(candidateTag)),
          );
    setCurrentIndex(0);
    if (nextFiltered[0]) restoreState(nextFiltered[0]);
    else restoreStateEmpty();
  };

  const clearTags = () => {
    const hadActiveTags = selectedTags.size > 0;
    if (hadActiveTags) setSubmitMap({});
    setSelectedTags(new Set());
    setCurrentIndex(0);
    if (orderedItems[0]) {
      restoreState(orderedItems[0], hadActiveTags ? undefined : submitMap[orderedItems[0].id]);
    } else {
      restoreStateEmpty();
    }
  };

  /** 保持当前筛选，只把本卡组的呈现顺序重新打乱并回到第一张。 */
  const reshuffle = () => {
    if (!deck || filteredItems.length < 2) return;
    const nextOrder = shuffledItemIds(deck.items, orderByDeck[deck.id]);
    setOrderByDeck((previous) => ({ ...previous, [deck.id]: nextOrder }));
    const nextFiltered = orderItems(deck.items, nextOrder).filter(
      (candidate) => selectedTags.size === 0 || candidate.tags.some((tag) => selectedTags.has(tag)),
    );
    setCurrentIndex(0);
    if (nextFiltered[0]) restoreState(nextFiltered[0], submitMap[nextFiltered[0].id]);
    else restoreStateEmpty();
  };

  const updateItemTags = (target: UiItem, nextTags: string[]) => {
    const normalizedTags = withTopTag(nextTags, target.kind);
    setDecks((previous) =>
      previous.map((candidateDeck) =>
        candidateDeck.id !== target.deckId
          ? candidateDeck
          : {
              ...candidateDeck,
              items: candidateDeck.items.map((candidateItem) =>
                candidateItem.id === target.id
                  ? { ...candidateItem, tags: normalizedTags }
                  : candidateItem,
              ),
            },
      ),
    );
  };

  const addTag = async (raw: string) => {
    if (!item) return;
    const tag = raw.trim();
    if (!tag) return;
    if (tag.length > 60) {
      toast.error("标签不能超过 60 个字符");
      return;
    }
    if (isTopTag(tag)) {
      toast.error("顶级标签由题型自动决定，不能手动添加");
      setNewTagInput("");
      return;
    }
    if (itemTags.includes(tag)) {
      setNewTagInput("");
      return;
    }
    const nextTags = [...itemTags, tag];
    updateItemTags(item, nextTags);
    setNewTagInput("");
    try {
      const response = await putItemTags(userKey, item.deckId, item.rawId, nextTags);
      updateItemTags(item, response.tags);
      void refreshStats();
    } catch (error) {
      updateItemTags(item, itemTags);
      toast.error(error instanceof Error ? error.message : "标签保存失败");
    }
  };

  const removeTag = async (tag: string) => {
    if (!item || isTopTag(tag)) return;
    const nextTags = itemTags.filter((candidate) => candidate !== tag);
    updateItemTags(item, nextTags);
    try {
      const response = await putItemTags(userKey, item.deckId, item.rawId, nextTags);
      updateItemTags(item, response.tags);
      void refreshStats();
    } catch (error) {
      updateItemTags(item, itemTags);
      toast.error(error instanceof Error ? error.message : "标签保存失败");
    }
  };

  const restoreTags = async () => {
    if (!item) return;
    try {
      const response = await deleteItemTags(userKey, item.deckId, item.rawId);
      updateItemTags(item, response.tags);
      setTagEditMode(false);
      void refreshStats();
      toast.success("已恢复卡组原始标签（顶级标签保持不变）");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "恢复标签失败");
    }
  };

  const navigate = (direction: 1 | -1) => {
    const next = currentIndex + direction;
    if (next < 0 || next >= filteredItems.length) return;
    setCurrentIndex(next);
    restoreState(filteredItems[next], submitMap[filteredItems[next].id]);
  };

  const jumpTo = (index: number) => {
    if (index === currentIndex) return;
    setCurrentIndex(index);
    restoreState(filteredItems[index], submitMap[filteredItems[index].id]);
  };

  const jumpToAndGoCard = (index: number) => {
    jumpTo(index);
    setMobileTab("card");
  };

  const handleRetry = () => {
    if (!item) return;
    setSubmitMap((previous) => {
      const next = { ...previous };
      delete next[item.id];
      return next;
    });
    restoreState(item);
  };

  const handleSubmit = async () => {
    if (!item || isSubmitted || submitting) return;
    let answer: unknown;
    let record: SubmitRecord;

    if (item.kind === "single") {
      if (singleSel === null) return;
      answer = [item.optionKeys[singleSel] ?? OPTION_LABELS[singleSel]];
      record = { isCorrect: false, singleSel };
    } else if (item.kind === "multi") {
      if (multiSel.size === 0) return;
      answer = Array.from(multiSel)
        .sort((a, b) => a - b)
        .map((index) => item.optionKeys[index] ?? OPTION_LABELS[index]);
      record = { isCorrect: false, multiSel: Array.from(multiSel) };
    } else if (item.kind === "truefalse") {
      if (tfSel === null) return;
      answer = [tfSel ? "正确" : "错误"];
      record = { isCorrect: false, tfSel };
    } else if (item.kind === "fill-q") {
      if (!item.blanks.every((_, index) => (fillSel[index] ?? "").trim().length > 0)) return;
      answer = [...fillSel];
      record = { isCorrect: false, fillSel: [...fillSel] };
    } else if (item.kind === "cloze") {
      const ids = clozeBlankIds(item);
      if (!ids.every((id) => (clozeSel[id] ?? "").trim().length > 0)) return;
      answer = { ...clozeSel };
      record = {
        isCorrect: false,
        clozeSel: { ...clozeSel },
        clozeResults: gradeClozeLocal(item.paragraphs, clozeSel),
      };
    } else {
      return;
    }

    setSubmitting(true);
    try {
      const response = await submitAttempt(userKey, item.deckId, item.rawId, answer);
      const nextRecord: SubmitRecord = {
        ...record,
        isCorrect: response.result.isCorrect,
        attemptCount: response.progress.attemptCount,
        correctCount: response.progress.correctCount,
      };
      if (item.kind === "cloze") {
        nextRecord.clozeResults = gradeClozeLocal(item.paragraphs, record.clozeSel ?? {});
      }
      setSubmitMap((previous) => ({ ...previous, [item.id]: nextRecord }));
      if (response.result.isCorrect) toast.success("回答正确！");
      else toast.error("回答错误，看看解析吧");
      void refreshStats();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  const markFamiliarity = async (value: Familiarity) => {
    if (!item) return;
    const previous = familiarityMap[item.id];
    const next = previous === value ? null : value;
    setFamiliarityMap((current) => {
      const copy = { ...current };
      if (next === null) delete copy[item.id];
      else copy[item.id] = next;
      return copy;
    });
    try {
      await putFamiliarity(userKey, item.deckId, item.rawId, next);
      void refreshStats();
    } catch (error) {
      setFamiliarityMap((current) => {
        const copy = { ...current };
        if (previous) copy[item.id] = previous;
        else delete copy[item.id];
        return copy;
      });
      toast.error(error instanceof Error ? error.message : "熟悉度保存失败");
    }
  };

  const handleUseKey = async (key: string) => {
    const session = await resumeSession(key);
    await loadData(session.userKey);
    saveStoredUserKey(session.userKey);
    setUserKey(session.userKey);
    setUserLabel(session.user.label);
    setSyncOpen(false);
    toast.success("已切换到新的同步码");
  };

  const canSubmit = () => {
    if (!item || isSubmitted) return false;
    if (item.kind === "single") return singleSel !== null;
    if (item.kind === "multi") return multiSel.size > 0;
    if (item.kind === "truefalse") return tfSel !== null;
    if (item.kind === "fill-q") return item.blanks.every((_, index) => (fillSel[index] ?? "").trim().length > 0);
    if (item.kind === "cloze") return clozeBlankIds(item).every((id) => (clozeSel[id] ?? "").trim().length > 0);
    return false;
  };

  const kindMeta = item ? KIND_META[item.kind] : KIND_META.display;
  const isQuestionItem =
    item &&
    (item.kind === "single" ||
      item.kind === "multi" ||
      item.kind === "truefalse" ||
      item.kind === "fill-q" ||
      item.kind === "cloze");

  const attempts = stats?.attempts ?? {
    total: 0,
    correct: 0,
    incorrect: 0,
    accuracy: 0,
    itemsAttempted: 0,
  };
  const familiarityStats = stats?.familiarity ?? { familiar: 0, normal: 0, unfamiliar: 0, total: 0 };
  const famData = [
    { name: "熟悉", value: familiarityStats.familiar, color: FAM_COLORS.familiar },
    { name: "一般", value: familiarityStats.normal, color: FAM_COLORS.normal },
    { name: "不熟悉", value: familiarityStats.unfamiliar, color: FAM_COLORS.unfamiliar },
  ];
  const famTotal = familiarityStats.total;
  const revealExplanation = isSubmitted || (item?.kind === "cloze" && clozeRevealed);

  // ── Option rendering ──────────────────────────────────

  const optionClass = (isCorrectAnswer: boolean, isUserSelected: boolean) => {
    const base = "w-full text-left px-4 py-3 rounded-lg text-sm transition-colors flex items-start gap-3";
    if (!isSubmitted) {
      return `${base} border ${
        isUserSelected ? "border-primary bg-primary/5 text-primary" : "border-border bg-card hover:bg-muted/60"
      }`;
    }
    if (isCorrectAnswer) return `${base} border-2 border-green-500 bg-green-50 text-green-900`;
    if (isUserSelected) return `${base} border-2 border-red-400 bg-red-50 text-red-900`;
    return `${base} border border-border bg-card text-muted-foreground`;
  };

  const renderOptions = () => {
    if (!item || (item.kind !== "single" && item.kind !== "multi")) return null;
    const isSingle = item.kind === "single";
    return (
      <div className="mt-5 space-y-2.5">
        {item.options.map((option, index) => {
          const isUserSelected = isSingle ? singleSel === index : multiSel.has(index);
          const isCorrectAnswer = isSingle ? index === item.answer : item.answer.includes(index);
          return (
            <button
              key={`${item.id}-${index}`}
              disabled={isSubmitted}
              onClick={() => {
                if (isSubmitted) return;
                if (isSingle) setSingleSel(index);
                else {
                  setMultiSel((previous) => {
                    const next = new Set(previous);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  });
                }
              }}
              className={optionClass(isCorrectAnswer, isUserSelected)}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-xs font-bold ${
                  isUserSelected ? "bg-current/15" : "bg-muted"
                }`}
              >
                {item.optionKeys[index] ?? OPTION_LABELS[index]}
              </span>
              <span className="flex-1">{option}</span>
              {isSubmitted && isCorrectAnswer && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />}
              {isSubmitted && isUserSelected && !isCorrectAnswer && (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const renderTrueFalse = () => {
    if (!item || item.kind !== "truefalse") return null;
    return (
      <div className="mt-6 flex gap-4">
        {([true, false] as const).map((value) => {
          const isUserSelected = tfSel === value;
          const isCorrectAnswer = value === item.answer;
          let className =
            "flex-1 py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors border";
          if (!isSubmitted) {
            className += isUserSelected
              ? " border-primary bg-primary/5 text-primary border-2"
              : " border-border bg-card hover:bg-muted/60 text-foreground";
          } else if (isCorrectAnswer) {
            className += " border-2 border-green-500 bg-green-50 text-green-800";
          } else if (isUserSelected) {
            className += " border-2 border-red-400 bg-red-50 text-red-800";
          } else {
            className += " border-border bg-card text-muted-foreground";
          }
          return (
            <button
              key={String(value)}
              disabled={isSubmitted}
              onClick={() => !isSubmitted && setTfSel(value)}
              className={className}
            >
              {value ? (
                <>
                  <CheckCircle2 className="h-5 w-5" />正确
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5" />错误
                </>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  const renderFillQ = () => {
    if (!item || item.kind !== "fill-q") return null;
    const fillItem = item as UiFillItem;
    const displayAnswers = isSubmitted && submitRecord?.fillSel ? submitRecord.fillSel : fillSel;
    return (
      <div className="mt-5 rounded-xl border border-border bg-muted/40 p-4">
        <FillInContent
          content={fillItem.content}
          blanks={fillItem.blanks}
          answers={displayAnswers}
          onChangeAnswer={(index, value) =>
            setFillSel((previous) => {
              const next = [...previous];
              next[index] = value;
              return next;
            })
          }
          submitted={isSubmitted}
          caseSensitive={fillItem.caseSensitive}
        />
      </div>
    );
  };

  const renderCloze = () => {
    if (!item || item.kind !== "cloze") return null;
    const clozeItem = item as UiClozeItem;
    const answers = isSubmitted && submitRecord?.clozeSel ? submitRecord.clozeSel : clozeSel;
    const revealed = clozeRevealed && !isSubmitted;
    return (
      <div className="mt-2">
        {clozeItem.title && <h2 className="mb-4 text-lg font-bold text-foreground">{clozeItem.title}</h2>}
        {clozeItem.showWordBank && clozeItem.wordBank && clozeItem.wordBank.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">词库：</span>
            {clozeItem.wordBank.map((word) => (
              <span key={word} className="rounded bg-card px-2 py-0.5 font-mono text-xs text-foreground">
                {word}
              </span>
            ))}
          </div>
        )}
        {clozeItem.table && <DataTable table={clozeItem.table} />}
        {revealed && (
          <div className="mb-3 flex items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary">
            <Eye className="h-3.5 w-3.5 shrink-0" />
            已显示背面答案，本次不计入作答
          </div>
        )}
        <div className="space-y-4 rounded-xl border border-border bg-muted/30 p-4">
          {clozeItem.paragraphs.map((paragraph) => (
            <p key={paragraph.id} className="text-sm leading-10 text-foreground">
              {paragraph.segments.map((segment, index) => {
                if (segment.type === "text") return <span key={index}>{segment.text}</span>;
                const value = answers[segment.id] ?? "";
                const correct = submitRecord?.clozeResults?.[segment.id] ?? false;
                if (isSubmitted) {
                  return (
                    <span
                      key={index}
                      className={`mx-1 inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-xs font-semibold ${
                        correct
                          ? "border-green-300 bg-green-100 text-green-800"
                          : "border-red-300 bg-red-100 text-red-800"
                      }`}
                    >
                      {value || "（空）"}
                      {!correct && (
                        <span className="border-l border-green-300 pl-1 text-green-700">→ {segment.answer}</span>
                      )}
                    </span>
                  );
                }
                if (revealed) {
                  return (
                    <span
                      key={index}
                      title={
                        segment.alternatives && segment.alternatives.length > 0
                          ? `也接受：${segment.alternatives.join(" / ")}`
                          : undefined
                      }
                      className="mx-1 inline-flex items-center rounded border border-primary/30 bg-primary/5 px-2 py-0.5 font-mono text-xs font-semibold text-primary"
                    >
                      {segment.answer}
                    </span>
                  );
                }
                return (
                  <input
                    key={index}
                    type="text"
                    value={value}
                    onChange={(event) =>
                      setClozeSel((previous) => ({ ...previous, [segment.id]: event.target.value }))
                    }
                    placeholder={segment.hint ?? "填写"}
                    className="mx-1 inline-block w-24 rounded-sm border-b-2 border-primary bg-transparent px-2 text-center font-mono text-sm transition-colors focus:border-primary/70 focus:outline-none"
                    style={{ width: `${Math.max(80, Math.min(240, (segment.answer?.length ?? 4) * 14 + 32))}px` }}
                  />
                );
              })}
            </p>
          ))}
        </div>
      </div>
    );
  };

  // ── Loading / error / empty states ─────────────────────

  if (bootState === "loading") {
    return <LoadingScreen label="正在连接后端并加载题库…" />;
  }

  if (bootState === "error") {
    return (
      <div className="flex app-viewport items-center justify-center bg-background px-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-7 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500">
            <WifiOff className="h-5 w-5" />
          </div>
          <h2 className="text-base font-bold text-foreground">无法连接后端</h2>
          <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">{bootError}</p>
          <p className="mt-3 rounded-lg bg-muted/60 p-2 font-mono text-[11px] text-muted-foreground">
            API: {getApiBase()}
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            请先运行 <span className="font-mono">npm run dev:server</span>，或使用{" "}
            <span className="font-mono">npm run dev</span> 同时启动前后端。
          </p>
          <button
            onClick={() => void bootstrap()}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" />
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!deck) {
    return (
      <div className="flex app-viewport items-center justify-center bg-background px-6">
        <div className="text-center">
          <Brain className="mx-auto mb-3 h-9 w-9 text-muted-foreground/30" />
          <p className="text-sm font-medium text-foreground">数据库里还没有卡组</p>
          <p className="mt-1 text-xs text-muted-foreground">
            运行 <span className="font-mono">npm run db:seed</span> 导入 data/decks 下的示例数据。
          </p>
          <button
            onClick={() => void bootstrap()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-xs font-medium hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" /> 重新加载
          </button>
        </div>
      </div>
    );
  }

  if (!item) {
    return (
      <>
        <div className="flex app-viewport flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
          <p>当前筛选无匹配卡片</p>
          <button onClick={clearTags} className="rounded-lg border border-border px-4 py-2 text-xs hover:bg-muted">
            清除筛选
          </button>
        </div>
        <Toaster position="top-center" richColors />
        <SyncDialog open={syncOpen} userKey={userKey} onClose={() => setSyncOpen(false)} onUseKey={handleUseKey} />
      </>
    );
  }

  // ── Shared content for desktop / mobile ────────────────

  const syncEntry = () => (
    <button
      type="button"
      onClick={() => setSyncOpen(true)}
      className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted active:bg-muted"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <KeyRound className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">跨设备同步</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">
            {userKey ? `${userKey.slice(0, 9)}…` : "未登录"}
            {userLabel ? ` · ${userLabel}` : ""}
          </p>
        </div>
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );

  const deckListContent = (mobile: boolean) => (
    <>
      <div className="mb-1 px-2">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5" />知识卡片
        </div>
        {decks
          .filter((candidate) => candidate.category === "card")
          .map((candidate) => (
            <div key={candidate.id}>
              <DeckListItem
                deck={candidate}
                isActive={selectedDeckId === candidate.id}
                onClick={() => (mobile ? selectDeckAndOpen(candidate.id) : selectDeck(candidate.id))}
                familiarityMap={familiarityMap}
              />
              {selectedDeckId === candidate.id && (
                <DeckTagList
                  deck={candidate}
                  selectedTags={selectedTags}
                  onToggleTag={toggleTag}
                  onClearTags={clearTags}
                  onGoToCard={mobile ? () => setMobileTab("card") : undefined}
                />
              )}
            </div>
          ))}
      </div>

      <div className="mx-2 my-3 border-t border-border" />

      <div className="px-2">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <ListChecks className="h-3.5 w-3.5" />题库
        </div>
        {decks
          .filter((candidate) => candidate.category === "question")
          .map((candidate) => (
            <div key={candidate.id}>
              <DeckListItem
                deck={candidate}
                isActive={selectedDeckId === candidate.id}
                onClick={() => (mobile ? selectDeckAndOpen(candidate.id) : selectDeck(candidate.id))}
                familiarityMap={familiarityMap}
              />
              {selectedDeckId === candidate.id && (
                <DeckTagList
                  deck={candidate}
                  selectedTags={selectedTags}
                  onToggleTag={toggleTag}
                  onClearTags={clearTags}
                  onGoToCard={mobile ? () => setMobileTab("card") : undefined}
                />
              )}
            </div>
          ))}
      </div>

      {mobile && (
        <div className="mt-4 border-t border-border px-2 pt-3">
          {syncEntry()}
        </div>
      )}
    </>
  );

  const cardContent = (
    <div className="mx-auto w-full max-w-[640px]">
      {/* Item tags — view / edit */}
      <div className="mb-3 flex min-h-[24px] flex-wrap items-start gap-1.5">
        {itemTags.map((tag) => {
          const top = isTopTag(tag);
          if (tagEditMode) {
            return (
              <span
                key={tag}
                title={top ? topTagTitle : undefined}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  top
                    ? "border-primary/30 bg-primary/10 font-semibold text-primary"
                    : "border-primary/20 bg-primary/10 font-medium text-primary"
                }`}
              >
                {top ? <Lock className="h-2.5 w-2.5" /> : "#"}
                {tag}
                {!top && (
                  <button
                    onClick={() => void removeTag(tag)}
                    className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-red-100 hover:text-red-600"
                    title="移除标签"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                )}
              </span>
            );
          }
          return (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              title={top ? topTagTitle : undefined}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors ${
                top
                  ? selectedTags.has(tag)
                    ? "border-primary bg-primary/15 font-semibold text-primary"
                    : "border-primary/30 bg-primary/5 font-medium text-primary/80 hover:bg-primary/10"
                  : selectedTags.has(tag)
                    ? "border-primary/25 bg-primary/10 font-medium text-primary"
                    : "border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-primary"
              }`}
            >
              {top ? <Lock className="h-2.5 w-2.5" /> : "#"}
              {tag}
            </button>
          );
        })}

        {tagEditMode && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void addTag(newTagInput);
            }}
            className="inline-flex items-center gap-1"
          >
            <input
              type="text"
              value={newTagInput}
              onChange={(event) => setNewTagInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setTagEditMode(false);
                  setNewTagInput("");
                }
              }}
              placeholder="添加标签…"
              autoFocus
              className="w-24 rounded-full border border-dashed border-primary/50 bg-transparent px-2 py-0.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
            />
            {newTagInput.trim() && (
              <button
                type="submit"
                className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-primary/80"
              >
                <Check className="h-2.5 w-2.5" />
              </button>
            )}
          </form>
        )}

        {tagEditMode && (
          <button
            onClick={() => void restoreTags()}
            title="恢复卡组原始标签"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/30 px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-muted-foreground/60 hover:text-foreground"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            恢复默认
          </button>
        )}

        <button
          onClick={() => {
            setTagEditMode((value) => !value);
            setNewTagInput("");
          }}
          title={tagEditMode ? "完成编辑" : "编辑标签"}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full transition-colors ${
            tagEditMode
              ? "bg-primary text-white hover:bg-primary/80"
              : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
          }`}
        >
          {tagEditMode ? <Check className="h-3 w-3" /> : <Pencil className="h-3 w-3" />}
        </button>

        {editableTags.length === 0 && !tagEditMode && (
          <button
            onClick={() => setTagEditMode(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/25 px-2 py-0.5 text-xs text-muted-foreground/60 transition-colors hover:border-muted-foreground/50 hover:text-muted-foreground"
          >
            <Plus className="h-3 w-3" />添加标签
          </button>
        )}
      </div>

      {/* Card */}
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        {item.image && (
          <div className="h-40 w-full overflow-hidden bg-muted sm:h-44">
            <img src={item.image} alt="卡片图片" className="h-full w-full object-cover" />
          </div>
        )}
        <div className="p-5 sm:p-7">
          {item.kind === "display" && (
            <>
              <h2 className="mb-4 text-lg font-bold text-foreground">{item.front}</h2>
              <RichText
                text={item.back}
                className="font-sans text-sm leading-relaxed text-foreground"
              />
              {item.table && <DataTable table={item.table} className="mt-4" />}
            </>
          )}

          {(item.kind === "single" || item.kind === "multi") && (
            <>
              <RichText
                text={item.content}
                className="text-base font-medium leading-relaxed text-foreground"
              />
              {item.kind === "multi" && <p className="mt-1.5 text-xs text-muted-foreground">可多选</p>}
              {item.table && <DataTable table={item.table} />}
              {renderOptions()}
            </>
          )}

          {item.kind === "truefalse" && (
            <>
              <RichText
                text={item.content}
                className="text-base font-medium leading-relaxed text-foreground"
              />
              {item.table && <DataTable table={item.table} />}
              {renderTrueFalse()}
            </>
          )}

          {item.kind === "fill-q" && (
            <>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">填空题</p>
              {item.table && <DataTable table={item.table} />}
              {renderFillQ()}
            </>
          )}

          {item.kind === "cloze" && renderCloze()}

          {/* Meta */}
          {(item.chapter || item.section || item.difficulty) && (
            <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
              {item.chapter && <span>章节：{item.chapter}</span>}
              {item.section && <span>小节：{item.section}</span>}
              {item.difficulty && <span>难度：{item.difficulty}/5</span>}
            </div>
          )}

          {/* Submit / Result */}
          {isQuestionItem && (
            <div className="mt-6">
              {!isSubmitted ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit() || submitting || (item.kind === "cloze" && clozeRevealed)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-35"
                  >
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    提交答案
                  </button>
                  {item.kind === "cloze" && (
                    <>
                      <RevealButton
                        revealed={clozeRevealed}
                        onToggle={() => setClozeRevealed((value) => !value)}
                        showLabel="显示背面"
                        hideLabel="收起答案"
                      />
                      {clozeRevealed && (
                        <span className="text-xs text-muted-foreground">收起答案后可提交</span>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div
                    className={`flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold ${
                      submitRecord!.isCorrect
                        ? "border-green-200 bg-green-50 text-green-800"
                        : "border-red-200 bg-red-50 text-red-800"
                    }`}
                  >
                    {submitRecord!.isCorrect ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />回答正确！
                      </>
                    ) : (
                      <>
                        <XCircle className="h-5 w-5 shrink-0 text-red-500" />回答错误
                      </>
                    )}
                  </div>
                  <button
                    onClick={handleRetry}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    重新作答
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Explanation */}
          {revealExplanation && item.explanation && (
            <div className="mt-4 rounded-xl border border-border bg-secondary/60 p-4">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">解析</p>
              <RichText text={item.explanation} className="text-sm leading-relaxed text-foreground" />
            </div>
          )}
        </div>
      </div>
    </div>
  );

  /** 上一张 / 熟悉度 / 下一张。移动端作为固定操作条放在滚动区外。 */
  const cardActions = (
    <div className="mx-auto grid w-full max-w-[640px] grid-cols-2 gap-2 sm:flex sm:items-center sm:justify-between">
      <button
        onClick={() => navigate(-1)}
        disabled={currentIndex === 0}
        className="order-1 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm transition-colors hover:bg-muted active:bg-muted disabled:cursor-not-allowed disabled:opacity-30 sm:w-auto"
      >
        <ChevronLeft className="h-4 w-4" />上一个
      </button>

      <div className="order-3 col-span-2 flex items-center justify-center gap-1.5 sm:order-2 sm:col-span-1">
        {(["familiar", "normal", "unfamiliar"] as Familiarity[]).map((value) => {
          const config = FAM_CONFIG[value];
          const isActive = familiarityMap[item.id] === value;
          return (
            <button
              key={value}
              onClick={() => void markFamiliarity(value)}
              className={`min-h-[38px] flex-1 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all sm:flex-none ${
                isActive ? config.active : `border bg-transparent ${config.inactive}`
              }`}
              title={isActive ? "再次点击取消标记" : undefined}
            >
              {config.label}
            </button>
          );
        })}
      </div>

      <button
        onClick={() => navigate(1)}
        disabled={currentIndex === filteredItems.length - 1}
        className="order-2 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm transition-colors hover:bg-muted active:bg-muted disabled:cursor-not-allowed disabled:opacity-30 sm:order-3 sm:w-auto"
      >
        下一个<ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );

  const statsContent = (
    <>
      <div className="shrink-0 border-b border-border px-5 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">题目答题</p>
        <div className="space-y-2.5">
          <StatRow label="已作答" value={attempts.itemsAttempted} unit="题" color="text-foreground" />
          <StatRow label="累计作答" value={attempts.total} unit="次" color="text-foreground" />
          <StatRow label="答对" value={attempts.correct} unit="次" color="text-emerald-600" />
          <StatRow label="答错" value={attempts.incorrect} unit="次" color="text-red-500" />
          <div className="pt-2">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">正确率</span>
              <span className="font-mono text-sm font-bold text-primary">{attempts.accuracy}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${attempts.accuracy}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-border px-5 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">熟悉度分布</p>
        {famTotal > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={130}>
              <PieChart>
                <Pie
                  data={famData.filter((entry) => entry.value > 0)}
                  cx="50%"
                  cy="50%"
                  innerRadius={35}
                  outerRadius={54}
                  paddingAngle={3}
                  dataKey="value"
                  strokeWidth={0}
                >
                  {famData
                    .filter((entry) => entry.value > 0)
                    .map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    fontSize: "12px",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "white",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  }}
                  formatter={(value: number, name: string) => [`${value} 个`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-1 space-y-1.5">
              {famData.map((entry) => (
                <div key={entry.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
                    <span className="text-xs text-muted-foreground">{entry.name}</span>
                  </div>
                  <span className="font-mono text-xs font-semibold text-foreground">
                    {entry.value}
                    <span className="ml-1 text-muted-foreground">
                      ({famTotal > 0 ? Math.round((entry.value / famTotal) * 100) : 0}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="py-6 text-center">
            <Brain className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">在卡片下方标记熟悉度</p>
            <p className="mt-0.5 text-xs text-muted-foreground/60">统计将在此显示</p>
          </div>
        )}
      </div>

      <div className="px-5 py-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {deck.name} · 本次顺序
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
              <Shuffle className="h-3 w-3 shrink-0" />
              <span>乱序</span>
              <span className="text-muted-foreground/50">·</span>
              <span>
                已完成 {completedInView}/{filteredItems.length}
              </span>
              {selectedTags.size > 0 && <span className="text-primary">· 已筛选</span>}
            </p>
          </div>
          <button
            type="button"
            onClick={reshuffle}
            disabled={filteredItems.length < 2}
            title="重新乱序，并回到第 1 张"
            aria-label="重新乱序"
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Shuffle className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-1">
          {filteredItems.map((candidate, index) => {
            const isActive = index === currentIndex;
            const familiarity = familiarityMap[candidate.id];
            const submitted = submitMap[candidate.id];
            return (
              <button
                key={candidate.id}
                onClick={() => (isMobile ? jumpToAndGoCard(index) : jumpTo(index))}
                title={`第 ${index + 1} / ${filteredItems.length} 张（本次乱序顺序）`}
                className={`flex min-h-[40px] w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition-colors ${
                  isActive
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span className="w-4 shrink-0 text-center font-mono tabular-nums text-muted-foreground">{index + 1}</span>
                <span className="flex-1 truncate text-left">{formatItemTitle(candidate)}</span>
                {familiarity && (
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: FAM_COLORS[familiarity] }} />
                )}
                {submitted &&
                  (submitted.isCorrect ? (
                    <CheckCircle2 className="h-3 w-3 shrink-0 text-green-500" />
                  ) : (
                    <XCircle className="h-3 w-3 shrink-0 text-red-400" />
                  ))}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  // ─────────────────────────────────────────────────────────
  // Mobile layout
  // ─────────────────────────────────────────────────────────

  if (isMobile) {
    const mobileTabs = [
      { id: "decks" as MobileTab, label: "卡组", Icon: BookOpen },
      { id: "card" as MobileTab, label: "卡片", Icon: Brain },
      { id: "stats" as MobileTab, label: "统计", Icon: BarChart2 },
    ];

    return (
      <>
        <style>{`
          .scrollbar-hide { scrollbar-width: none; }
          .scrollbar-hide::-webkit-scrollbar { display: none; }
          .bg-primary\\/8 { background-color: color-mix(in srgb, var(--primary) 8%, transparent); }
        `}</style>
        <Toaster position="top-center" richColors />
        <SyncDialog open={syncOpen} userKey={userKey} onClose={() => setSyncOpen(false)} onUseKey={handleUseKey} />

        <div className="mobile-app app-viewport mx-auto flex w-full max-w-[640px] flex-col overflow-hidden bg-background shadow-xl md:border-x md:border-border">
          <header
            className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-card px-4 pb-2.5"
            style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
                <Brain className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-bold leading-none tracking-tight">MemoQuiz</h1>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">
                  {mobileTab === "decks"
                    ? "选择卡组"
                    : mobileTab === "stats"
                      ? "学习进度"
                      : `${deck.name} · ${currentIndex + 1}/${Math.max(1, filteredItems.length)}`}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {selectedTags.size > 0 && (
                <button
                  type="button"
                  onClick={clearTags}
                  title="清除标签筛选"
                  className="flex min-h-[40px] items-center gap-1 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                >
                  <Tag className="h-3 w-3" />
                  {selectedTags.size}
                  <X className="h-3 w-3" />
                </button>
              )}
              <LayoutToggle
                override={layoutOverride}
                autoIsMobile={deviceProfile.isMobile}
                onCycle={cycleLayout}
                compact
              />
            </div>
          </header>

          <div className="h-[3px] shrink-0 bg-muted">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${((currentIndex + 1) / Math.max(1, filteredItems.length)) * 100}%` }}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            <div
              data-mobile-tab="decks"
              className={`scrollbar-hide h-full overflow-y-auto px-3 pb-6 pt-3 ${
                mobileTab === "decks" ? "block" : "hidden"
              }`}
            >
              {deckListContent(true)}
            </div>

            <div
              data-mobile-tab="card"
              className={`scrollbar-hide h-full overflow-y-auto ${
                mobileTab === "card" ? "block" : "hidden"
              }`}
            >
              <div className="flex items-center gap-2 border-b border-border bg-card/60 px-4 py-2.5">
                <div className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: deck.color }} />
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${kindMeta.bg} ${kindMeta.text}`}>
                  {kindMeta.label}
                </span>
                {selectedTags.size > 0 && (
                  <span className="text-[11px] text-primary">筛选中</span>
                )}
                <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
                  {currentIndex + 1} / {filteredItems.length}
                </span>
              </div>
              <div className="px-4 pb-8 pt-4">{cardContent}</div>
            </div>

            <div
              data-mobile-tab="stats"
              className={`scrollbar-hide h-full overflow-y-auto pb-8 ${
                mobileTab === "stats" ? "block" : "hidden"
              }`}
            >
              <div className="flex items-center gap-2 border-b border-border px-5 py-4">
                <BarChart2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold">累计统计</h2>
              </div>
              {statsContent}
            </div>
          </div>

          {mobileTab === "card" && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-2">
              {cardActions}
            </div>
          )}

          <nav
            className="flex shrink-0 border-t border-border bg-card"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            aria-label="移动端导航"
          >
            {mobileTabs.map(({ id, label, Icon }) => {
              const active = mobileTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMobileTab(id)}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 py-2 transition-colors ${
                    active ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary" />}
                  <Icon className={`h-5 w-5 transition-transform ${active ? "scale-110" : ""}`} />
                  <span className={`text-[10px] leading-none ${active ? "font-semibold" : "font-medium"}`}>
                    {label}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </>
    );
  }

  // ─────────────────────────────────────────────────────────
  // Desktop layout
  // ─────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        .scrollbar-hide { scrollbar-width: none; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .bg-primary\\/8 { background-color: color-mix(in srgb, var(--primary) 8%, transparent); }
      `}</style>
      <Toaster position="top-center" richColors />
      <SyncDialog open={syncOpen} userKey={userKey} onClose={() => setSyncOpen(false)} onUseKey={handleUseKey} />

      {/* 手动选择桌面布局时，窄屏设备可以横向滚动，避免三栏被裁切。 */}
      <div className="app-viewport w-full overflow-x-auto overflow-y-hidden bg-background">
        <div className="flex h-full min-w-[1024px] overflow-hidden">
          {/* ── Left Panel ──────────────────────────────────── */}
          <aside className="flex w-[272px] shrink-0 flex-col border-r border-border bg-card">
            <div className="shrink-0 border-b border-border px-5 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary">
                  <Brain className="h-4 w-4 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-sm font-bold leading-none tracking-tight">MemoQuiz</h1>
                  <p className="mt-0.5 text-xs text-muted-foreground">AI 记忆卡片 · 刷题系统</p>
                </div>
                <LayoutToggle
                  override={layoutOverride}
                  autoIsMobile={deviceProfile.isMobile}
                  onCycle={cycleLayout}
                />
              </div>
            </div>

            <div className="scrollbar-hide flex-1 overflow-y-auto px-3 py-3">
              {deckListContent(false)}
            </div>

            <div className="shrink-0 border-t border-border px-3 py-3">{syncEntry()}</div>
          </aside>

          {/* ── Center Panel ────────────────────────────────── */}
          <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="h-[3px] shrink-0 bg-muted">
              <div
                className="h-full bg-primary transition-all duration-300 ease-out"
                style={{ width: `${((currentIndex + 1) / Math.max(1, filteredItems.length)) * 100}%` }}
              />
            </div>

            <div className="flex shrink-0 items-center justify-between border-b border-border bg-card/60 px-7 py-3">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: deck.color }} />
                <span className="shrink-0 text-sm font-semibold">{deck.name}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${kindMeta.bg} ${kindMeta.text}`}>
                  {kindMeta.label}
                </span>
                {selectedTags.size > 0 && (
                  <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                    <span className="shrink-0 text-xs text-muted-foreground">筛选:</span>
                    <div className="flex gap-1 overflow-hidden">
                      {Array.from(selectedTags)
                        .slice(0, 2)
                        .map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex max-w-[80px] shrink-0 items-center gap-0.5 truncate rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary"
                          >
                            {isTopTag(tag) && <Lock className="h-2.5 w-2.5 shrink-0" />}
                            <span className="truncate">{tag}</span>
                          </span>
                        ))}
                      {selectedTags.size > 2 && (
                        <span className="shrink-0 text-xs text-muted-foreground">+{selectedTags.size - 2}</span>
                      )}
                    </div>
                    <button
                      onClick={clearTags}
                      className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              <span className="ml-3 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {currentIndex + 1} / {filteredItems.length}
              </span>
            </div>

            <div className="scrollbar-hide flex-1 overflow-y-auto px-7 py-6">
              {cardContent}
              <div className="mt-4">{cardActions}</div>
            </div>
          </main>

          {/* ── Right Panel ─────────────────────────────────── */}
          <aside className="scrollbar-hide flex w-[248px] shrink-0 flex-col overflow-y-auto border-l border-border bg-card">
            <div className="shrink-0 border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-bold">累计统计</h2>
              </div>
            </div>
            {statsContent}
          </aside>
        </div>
      </div>
    </>
  );
}
