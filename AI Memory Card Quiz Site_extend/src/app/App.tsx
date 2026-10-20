import { useState, useMemo, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  BookOpen,
  ListChecks,
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  BarChart2,
  Brain,
  Tag,
  X,
  Pencil,
  Check,
  Plus,
  Monitor,
  Laptop,
  Smartphone,
  ArrowRight,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

// ─────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────

type Familiarity = "familiar" | "normal" | "unfamiliar";
type MobileTab = "list" | "card" | "stats";
type LayoutOverride = "auto" | "desktop" | "mobile";

type Item =
  | { id: string; kind: "display";   front: string; back: string; tags?: string[]; image?: string }
  | { id: string; kind: "fill-card"; template: string; blanks: string[]; tags?: string[]; image?: string }
  | { id: string; kind: "single";    content: string; options: string[]; answer: number;   explanation: string; tags?: string[]; image?: string }
  | { id: string; kind: "multi";     content: string; options: string[]; answer: number[]; explanation: string; tags?: string[]; image?: string }
  | { id: string; kind: "truefalse"; content: string; answer: boolean;                     explanation: string; tags?: string[]; image?: string }
  | { id: string; kind: "fill-q";    content: string; blanks: string[];                    explanation: string; tags?: string[]; image?: string };

interface Deck {
  id: string;
  name: string;
  category: "card" | "question";
  color: string;
  items: Item[];
}

interface SubmitRecord {
  isCorrect: boolean;
  singleSel?: number;
  multiSel?: number[];
  tfSel?: boolean;
  fillSel?: string[];
}

// ─────────────────────────────────────────────────────────
// Sample Data
// ─────────────────────────────────────────────────────────

const DECKS: Deck[] = [
  {
    id: "d1",
    name: "Python 基础",
    category: "card",
    color: "#3B5BDB",
    items: [
      {
        id: "c1", kind: "display",
        front: "Python 列表 (List)",
        back: "列表是有序的可变序列，支持增删改查。\n\n• 创建：lst = [1, 2, 3]\n• 追加：lst.append(4)\n• 切片：lst[1:3]\n• 长度：len(lst)\n• 排序：lst.sort() 或 sorted(lst)",
        tags: ["数据类型", "容器"],
      },
      {
        id: "c2", kind: "display",
        front: "Python 字典 (Dict)",
        back: "字典是键值对集合（Python 3.7+ 保持插入顺序）。\n\n• 创建：d = {'key': 'value'}\n• 访问：d['key'] 或 d.get('key', default)\n• 遍历：for k, v in d.items():\n• 存在检查：'key' in d\n• 删除：del d['key']",
        tags: ["数据类型", "容器"],
      },
      {
        id: "c3", kind: "fill-card",
        template: "Python 列表切片语法：\nlst[___:___:___]\n\n第一个是___索引，第二个是___索引（不含），第三个是___（默认为1）。",
        blanks: ["start", "end", "起始", "终止", "步长"],
        tags: ["数据类型", "语法"],
      },
      {
        id: "c4", kind: "display",
        front: "Python 函数定义",
        back: "使用 def 关键字定义函数：\n\ndef greet(name, greeting='Hello'):\n    \"\"\"函数文档字符串\"\"\"\n    return f\"{greeting}, {name}!\"\n\n支持：默认参数、关键字参数\n*args（可变位置参数）、**kwargs（可变关键字参数）",
        tags: ["函数", "语法"],
      },
      {
        id: "c5", kind: "fill-card",
        template: "Python 类定义：\n\nclass Animal(___):\n    def ___(self, name):\n        ___.name = name\n\nclass Dog(Animal):\n    def speak(self):\n        return f\"{self.name}: 汪！\"",
        blanks: ["object", "__init__", "self"],
        tags: ["面向对象", "语法"],
      },
      {
        id: "c6", kind: "display",
        front: "列表推导式 & 生成器",
        back: "列表推导式（一次性生成）：\n[x**2 for x in range(10) if x % 2 == 0]\n\n生成器表达式（惰性求值，节省内存）：\n(x**2 for x in range(10) if x % 2 == 0)\n\n字典推导式：\n{k: v for k, v in zip(keys, values)}",
        image: "https://images.unsplash.com/photo-1555949963-ff9fe0c870eb?w=560&h=200&fit=crop&auto=format",
        tags: ["数据类型", "高级特性"],
      },
    ],
  },
  {
    id: "d2",
    name: "计算机网络",
    category: "question",
    color: "#0CA678",
    items: [
      {
        id: "q1", kind: "single",
        content: "在 OSI 七层参考模型中，传输层是第几层？",
        options: ["第三层（网络层）", "第四层（传输层）", "第五层（会话层）", "第六层（表示层）"],
        answer: 1,
        explanation: "传输层是 OSI 模型的第四层，负责端到端的通信，提供可靠数据传输。主要协议：TCP（面向连接、可靠）和 UDP（无连接、高效）。",
        tags: ["OSI模型", "基础概念"],
      },
      {
        id: "q2", kind: "multi",
        content: "以下哪些是 HTTP/1.1 的标准请求方法？（多选）",
        options: ["GET", "POST", "FETCH", "DELETE", "PATCH", "LOAD"],
        answer: [0, 1, 3, 4],
        explanation: "HTTP/1.1 标准方法：GET、POST、PUT、DELETE、PATCH、HEAD、OPTIONS、CONNECT、TRACE。FETCH 是浏览器 Web API，LOAD 不是 HTTP 方法。",
        tags: ["HTTP", "协议"],
      },
      {
        id: "q3", kind: "truefalse",
        content: "HTTP 协议是无状态协议，每次请求都是独立的，服务器不会自动记住之前的请求信息。",
        answer: true,
        explanation: "正确。HTTP 是无状态协议。为维持用户状态，需借助 Cookie（客户端存储）、Session（服务端存储）或 JWT Token 等机制。",
        tags: ["HTTP", "协议"],
      },
      {
        id: "q4", kind: "fill-q",
        content: "HTTP 默认端口___，HTTPS 默认端口___。DNS 使用___端口，SSH 使用___端口。",
        blanks: ["80", "443", "53", "22"],
        explanation: "常用端口：HTTP(80)、HTTPS(443)、DNS(53)、SSH(22)、FTP(21)、SMTP(25)、MySQL(3306)、Redis(6379)。",
        tags: ["协议", "基础概念"],
      },
      {
        id: "q5", kind: "single",
        content: "TCP 三次握手中，第一次握手客户端发送的报文标志位是？",
        options: ["SYN=1, ACK=0", "SYN=1, ACK=1", "SYN=0, ACK=1", "FIN=1, ACK=0"],
        answer: 0,
        explanation: "第一次握手：Client → Server，发送 SYN=1 表示请求建立连接，ACK=0（还未收到需确认内容），同时生成初始序列号 ISN。",
        tags: ["TCP", "协议"],
      },
      {
        id: "q6", kind: "multi",
        content: "关于 DNS，下列说法正确的是？（多选）",
        options: [
          "DNS 可将域名解析为 IP 地址",
          "DNS 支持反向解析（IP → 域名）",
          "DNS 默认使用 TCP 协议传输",
          "DNS 可通过多条 A 记录实现简单负载均衡",
          "DNSSEC 可防止 DNS 缓存中毒",
        ],
        answer: [0, 1, 3, 4],
        explanation: "DNS 通常用 UDP(53)，响应超过 512 字节时用 TCP。DNS 支持正向/反向解析、简单负载均衡，DNSSEC 通过数字签名防止记录篡改。",
        tags: ["DNS", "协议"],
      },
    ],
  },
  {
    id: "d3",
    name: "操作系统",
    category: "card",
    color: "#E67700",
    items: [
      {
        id: "os1", kind: "display",
        front: "进程 vs 线程",
        back: "进程：资源分配基本单位，拥有独立的地址空间\n线程：CPU 调度基本单位，共享进程的地址空间\n\n区别：\n• 进程间通信（IPC）较复杂，线程通信简单\n• 进程切换开销大，线程切换开销小\n• 一个进程可包含多个线程\n• 一个线程崩溃可能导致整个进程终止",
        image: "https://images.unsplash.com/photo-1518770660439-4636190af475?w=560&h=200&fit=crop&auto=format",
        tags: ["进程管理", "并发"],
      },
      {
        id: "os2", kind: "display",
        front: "内存分页机制",
        back: "将物理内存分成固定大小的页框 (Frame)\n将逻辑地址空间分成同样大小的页 (Page)\n\n优点：\n• 消除外部碎片\n• 支持虚拟内存与内存共享\n• 实现内存保护\n\n逻辑地址 = 页号(p) + 页内偏移(d)\n物理地址 = 页表[p] × 页大小 + d",
        tags: ["内存管理"],
      },
      {
        id: "os3", kind: "fill-card",
        template: "死锁产生的四个必要条件：\n1. ___条件：资源不能被强制剥夺\n2. ___条件：进程持有资源同时等待新资源\n3. ___条件：同一资源只能被一进程使用\n4. ___等待条件：进程间形成环形等待链",
        blanks: ["不可剥夺", "占有并等待", "互斥", "循环"],
        tags: ["进程管理", "死锁"],
      },
      {
        id: "os4", kind: "display",
        front: "CPU 调度算法",
        back: "• FCFS（先来先服务）：实现简单，平均等待时间长\n• SJF（最短作业优先）：最优平均等待时间，可能产生饥饿\n• Round Robin（时间片轮转）：公平，适合交互式系统\n• 优先级调度：高优先级优先，低优先级可能饥饿\n• MLFQ（多级反馈队列）：综合以上，现代 OS 常用",
        tags: ["进程管理", "调度"],
      },
    ],
  },
  {
    id: "d4",
    name: "数据结构",
    category: "question",
    color: "#AE3EC9",
    items: [
      {
        id: "ds1", kind: "single",
        content: "快速排序（Quick Sort）的平均时间复杂度是？",
        options: ["O(n)", "O(n log n)", "O(n²)", "O(log n)"],
        answer: 1,
        explanation: "快速排序平均 O(n log n)。每次选基准将数组分两半分别递归。最坏情况 O(n²)（每次选到最大/最小值），随机化选取基准可避免。",
        tags: ["排序", "算法复杂度"],
      },
      {
        id: "ds2", kind: "truefalse",
        content: "二叉搜索树（BST）的中序遍历（左 → 根 → 右）结果是从小到大有序的。",
        answer: true,
        explanation: "正确。BST 性质：左子树所有值 < 根节点值 < 右子树所有值。中序遍历按升序访问所有节点，可用于树排序。",
        tags: ["树", "二叉树"],
      },
      {
        id: "ds3", kind: "multi",
        content: "以下数据结构中，可以用来实现队列（Queue）的有？（多选）",
        options: ["数组（循环队列）", "链表", "两个栈", "双端队列（Deque）", "二叉树"],
        answer: [0, 1, 2, 3],
        explanation: "队列可用：数组（循环队列避免假溢出）、链表（动态扩展）、两个栈（一进一出模拟）、双端队列（限制一端操作）。二叉树不具备 FIFO 特性。",
        tags: ["队列", "基础结构"],
      },
      {
        id: "ds4", kind: "fill-q",
        content: "哈希表平均查找时间复杂度___，最坏情况___。解决冲突的两种方法：___法（每槽维护链表）和___法（探测下一个空槽）。",
        blanks: ["O(1)", "O(n)", "链地址", "开放地址"],
        explanation: "哈希表通过哈希函数将键映射到数组索引，平均 O(1)。冲突解决：链地址法（拉链法）将冲突元素存入链表；开放地址法在表内寻找下一个空位。",
        tags: ["哈希表", "算法复杂度"],
      },
      {
        id: "ds5", kind: "single",
        content: "含 n 个节点的完全二叉树，其高度为（根节点高度为 1）？",
        options: ["⌊log₂n⌋", "⌊log₂n⌋ + 1", "⌈log₂n⌉", "⌈log₂(n+1)⌉"],
        answer: 3,
        explanation: "完全二叉树高度为 ⌈log₂(n+1)⌉。例：n=7（满二叉树），高度=3=⌈log₂8⌉；n=8，高度=4=⌈log₂9⌉。与 ⌊log₂n⌋+1 等价。",
        tags: ["树", "算法复杂度"],
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

const KIND_META: Record<string, { label: string; bg: string; text: string }> = {
  display:     { label: "知识卡片", bg: "bg-blue-100",    text: "text-blue-700" },
  "fill-card": { label: "填空卡片", bg: "bg-indigo-100",  text: "text-indigo-700" },
  single:      { label: "单选题",   bg: "bg-emerald-100", text: "text-emerald-700" },
  multi:       { label: "多选题",   bg: "bg-teal-100",    text: "text-teal-700" },
  truefalse:   { label: "判断题",   bg: "bg-amber-100",   text: "text-amber-700" },
  "fill-q":    { label: "填空题",   bg: "bg-purple-100",  text: "text-purple-700" },
};

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];

const FAM_CONFIG = {
  familiar:   { label: "熟悉",   active: "bg-emerald-500 text-white border-emerald-500",  inactive: "text-emerald-600 border-emerald-300 hover:bg-emerald-50" },
  normal:     { label: "一般",   active: "bg-amber-400 text-white border-amber-400",      inactive: "text-amber-600 border-amber-300 hover:bg-amber-50" },
  unfamiliar: { label: "不熟悉", active: "bg-red-500 text-white border-red-500",          inactive: "text-red-500 border-red-300 hover:bg-red-50" },
} as const;

const FAM_COLORS = { familiar: "#10B981", normal: "#F59E0B", unfamiliar: "#EF4444" };

// ─────────────────────────────────────────────────────────
// Helper Components
// ─────────────────────────────────────────────────────────

function FillInContent({
  content, blanks, answers, onChangeAnswer, submitted,
}: {
  content: string; blanks: string[]; answers: string[];
  onChangeAnswer: (i: number, val: string) => void; submitted: boolean;
}) {
  const parts = content.split("___");
  return (
    <span className="text-sm leading-9">
      {parts.map((part, i) => (
        <span key={i}>
          <span className="whitespace-pre-wrap">{part}</span>
          {i < parts.length - 1 && (
            submitted ? (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 mx-1 rounded text-xs font-mono font-semibold border ${
                  (answers[i] ?? "").trim().toLowerCase() === (blanks[i] ?? "").toLowerCase()
                    ? "bg-green-100 text-green-800 border-green-300"
                    : "bg-red-100 text-red-800 border-red-300"
                }`}
              >
                <span>{answers[i] || "（空）"}</span>
                {(answers[i] ?? "").trim().toLowerCase() !== (blanks[i] ?? "").toLowerCase() && (
                  <span className="text-green-700 font-bold border-l border-green-300 pl-1">→ {blanks[i]}</span>
                )}
              </span>
            ) : (
              <input
                type="text"
                value={answers[i] ?? ""}
                onChange={(e) => onChangeAnswer(i, e.target.value)}
                className="inline-block border-b-2 border-primary bg-transparent px-2 w-20 text-center text-sm font-mono focus:outline-none focus:border-primary/70 transition-colors mx-1"
                placeholder="填写"
              />
            )
          )}
        </span>
      ))}
    </span>
  );
}

function DeckListItem({
  deck, isActive, onClick, familiarityMap,
}: {
  deck: Deck; isActive: boolean; onClick: () => void;
  familiarityMap: Record<string, Familiarity>;
}) {
  const markedCount = deck.items.filter((it) => familiarityMap[it.id]).length;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 rounded-xl transition-all border ${
        isActive
          ? "border-primary/25 bg-primary/8 text-primary shadow-sm"
          : "border-transparent hover:bg-muted text-foreground"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: deck.color }} />
          <span className="text-sm font-medium truncate">{deck.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-xs font-mono px-1.5 py-0.5 rounded-md ${
              isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
            }`}
          >
            {deck.items.length}
          </span>
          {isActive && (
            <ArrowRight className="w-3.5 h-3.5 text-primary/60" />
          )}
        </div>
      </div>
      {markedCount > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${(markedCount / deck.items.length) * 100}%`, backgroundColor: deck.color, opacity: 0.5 }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{markedCount}/{deck.items.length}</span>
        </div>
      )}
    </button>
  );
}

function DeckTagList({
  deck, selectedTags, onToggleTag, onClearTags, customTagsMap, onGoToCard,
}: {
  deck: Deck; selectedTags: Set<string>;
  onToggleTag: (tag: string) => void; onClearTags: () => void;
  customTagsMap: Record<string, string[]>;
  onGoToCard?: () => void;
}) {
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    deck.items.forEach((it) => {
      const tags = customTagsMap[it.id] ?? it.tags ?? [];
      tags.forEach((t) => { counts[t] = (counts[t] ?? 0) + 1; });
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [deck, customTagsMap]);
  if (tagCounts.length === 0) return null;

  const isFiltered = selectedTags.size > 0;
  const filteredCount = isFiltered
    ? deck.items.filter((it) => {
        const tags = customTagsMap[it.id] ?? it.tags ?? [];
        return tags.some((t) => selectedTags.has(t));
      }).length
    : deck.items.length;

  return (
    <div className="mt-0.5 mb-2 ml-3 mr-1">
      <button
        onClick={onClearTags}
        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
          !isFiltered
            ? "bg-muted/80 text-foreground font-semibold"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${!isFiltered ? "bg-foreground" : "bg-muted-foreground/40"}`} />
          <span>全部</span>
        </div>
        <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
          !isFiltered ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground"
        }`}>
          {filteredCount}
        </span>
      </button>

      <div className="mt-0.5 border-l-2 border-border ml-[5px] pl-2 space-y-0.5">
        {tagCounts.map(([tag, count]) => {
          const isSelected = selectedTags.has(tag);
          return (
            <button
              key={tag}
              onClick={() => onToggleTag(tag)}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors ${
                isSelected
                  ? "bg-primary/10 text-primary font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <Tag className={`w-3 h-3 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground/50"}`} />
                <span className="truncate">{tag}</span>
              </div>
              <span className={`shrink-0 font-mono px-1.5 py-0.5 rounded text-xs ${
                isSelected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {onGoToCard && (
        <button
          onClick={onGoToCard}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          查看卡片 <ArrowRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

function StatRow({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold font-mono ${color}`}>
        {value}<span className="text-xs font-normal ml-0.5">{unit}</span>
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Layout Toggle Button
// ─────────────────────────────────────────────────────────

function LayoutToggle({
  override, onCycle, compact,
}: {
  override: LayoutOverride; onCycle: () => void; compact?: boolean;
}) {
  const Icon = override === "auto" ? Monitor : override === "desktop" ? Laptop : Smartphone;
  const label = override === "auto" ? "自动" : override === "desktop" ? "桌面" : "移动";
  const hint = override === "auto" ? "当前: 自动适配" : override === "desktop" ? "当前: 桌面布局" : "当前: 移动布局";

  if (compact) {
    return (
      <button
        onClick={onCycle}
        title={hint}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border/60"
      >
        <Icon className="w-3.5 h-3.5" />
        <span>{label}</span>
      </button>
    );
  }

  return (
    <button
      onClick={onCycle}
      title={hint}
      className="flex items-center gap-1 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// App
// ─────────────────────────────────────────────────────────

export default function App() {
  const [selectedDeckId, setSelectedDeckId] = useState(DECKS[0].id);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [customTagsMap, setCustomTagsMap] = useState<Record<string, string[]>>({});
  const [tagEditMode, setTagEditMode] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");
  const [familiarityMap, setFamiliarityMap] = useState<Record<string, Familiarity>>({});
  const [submitMap, setSubmitMap] = useState<Record<string, SubmitRecord>>({});

  // Transient answer state
  const [singleSel, setSingleSel] = useState<number | null>(null);
  const [multiSel, setMultiSel] = useState<Set<number>>(new Set());
  const [tfSel, setTfSel] = useState<boolean | null>(null);
  const [fillSel, setFillSel] = useState<string[]>([]);
  const [flipped, setFlipped] = useState(false);

  // Layout state
  const [mobileTab, setMobileTab] = useState<MobileTab>("card");
  const [screenIsMobile, setScreenIsMobile] = useState(false);
  const [layoutOverride, setLayoutOverride] = useState<LayoutOverride>("auto");

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setScreenIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setScreenIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const isMobile =
    layoutOverride === "auto" ? screenIsMobile : layoutOverride === "mobile";

  const cycleLayout = () => {
    setLayoutOverride((prev) =>
      prev === "auto" ? "desktop" : prev === "desktop" ? "mobile" : "auto"
    );
  };

  const deck = DECKS.find((d) => d.id === selectedDeckId)!;

  const filteredItems = useMemo(() => {
    if (selectedTags.size === 0) return deck.items;
    return deck.items.filter((it) => {
      const tags = customTagsMap[it.id] ?? it.tags ?? [];
      return tags.some((t) => selectedTags.has(t));
    });
  }, [deck, selectedTags, customTagsMap]);

  const item = filteredItems[currentIndex] ?? filteredItems[0];
  const submitRecord = item ? submitMap[item.id] : undefined;
  const isSubmitted = !!submitRecord;

  const getItemTags = (it: Item): string[] => customTagsMap[it.id] ?? it.tags ?? [];

  const restoreState = (nextItem: Item, rec?: SubmitRecord) => {
    setFlipped(false);
    setTagEditMode(false);
    setNewTagInput("");
    if (rec) {
      setSingleSel(rec.singleSel !== undefined ? rec.singleSel : null);
      setMultiSel(rec.multiSel ? new Set(rec.multiSel) : new Set());
      setTfSel(rec.tfSel !== undefined ? rec.tfSel : null);
      setFillSel(rec.fillSel ?? (nextItem.kind === "fill-q" ? Array(nextItem.blanks.length).fill("") : []));
    } else {
      setSingleSel(null);
      setMultiSel(new Set());
      setTfSel(null);
      setFillSel(nextItem.kind === "fill-q" ? Array(nextItem.blanks.length).fill("") : []);
    }
  };

  const selectDeck = (id: string) => {
    const d = DECKS.find((x) => x.id === id)!;
    setSelectedDeckId(id);
    setSelectedTags(new Set());
    setCurrentIndex(0);
    restoreState(d.items[0], submitMap[d.items[0].id]);
  };

  const toggleTag = (tag: string) => {
    const newTags = new Set(selectedTags);
    if (newTags.has(tag)) newTags.delete(tag); else newTags.add(tag);
    setSelectedTags(newTags);

    const newFiltered = newTags.size === 0
      ? deck.items
      : deck.items.filter((it) => it.tags?.some((t) => newTags.has(t)) ?? false);
    setCurrentIndex(0);
    if (newFiltered.length > 0) restoreState(newFiltered[0], submitMap[newFiltered[0].id]);
  };

  const clearTags = () => {
    setSelectedTags(new Set());
    setCurrentIndex(0);
    restoreState(deck.items[0], submitMap[deck.items[0].id]);
  };

  const itemTags = item ? getItemTags(item) : [];

  const addTag = (raw: string) => {
    if (!item) return;
    const tag = raw.trim();
    if (!tag || itemTags.includes(tag)) return;
    setCustomTagsMap((prev) => ({ ...prev, [item.id]: [...itemTags, tag] }));
    setNewTagInput("");
  };

  const removeTag = (tag: string) => {
    if (!item) return;
    setCustomTagsMap((prev) => ({ ...prev, [item.id]: itemTags.filter((t) => t !== tag) }));
  };

  const navigate = (dir: 1 | -1) => {
    const next = currentIndex + dir;
    if (next < 0 || next >= filteredItems.length) return;
    setCurrentIndex(next);
    restoreState(filteredItems[next], submitMap[filteredItems[next].id]);
  };

  const jumpTo = (idx: number) => {
    if (idx === currentIndex) return;
    setCurrentIndex(idx);
    restoreState(filteredItems[idx], submitMap[filteredItems[idx].id]);
  };

  const jumpToAndGoCard = (idx: number) => {
    jumpTo(idx);
    setMobileTab("card");
  };

  const handleSubmit = () => {
    if (!item || isSubmitted) return;
    let isCorrect = false;
    let record: SubmitRecord = { isCorrect: false };

    if (item.kind === "single") {
      if (singleSel === null) return;
      isCorrect = singleSel === item.answer;
      record = { isCorrect, singleSel };
    } else if (item.kind === "multi") {
      if (multiSel.size === 0) return;
      isCorrect = JSON.stringify(Array.from(multiSel).sort()) === JSON.stringify([...item.answer].sort());
      record = { isCorrect, multiSel: Array.from(multiSel) };
    } else if (item.kind === "truefalse") {
      if (tfSel === null) return;
      isCorrect = tfSel === item.answer;
      record = { isCorrect, tfSel };
    } else if (item.kind === "fill-q") {
      isCorrect = item.blanks.every((blank, i) => (fillSel[i] ?? "").trim().toLowerCase() === blank.toLowerCase());
      record = { isCorrect, fillSel: [...fillSel] };
    }
    setSubmitMap((prev) => ({ ...prev, [item.id]: record }));
  };

  const canSubmit = () => {
    if (!item || isSubmitted) return false;
    if (item.kind === "single") return singleSel !== null;
    if (item.kind === "multi") return multiSel.size > 0;
    if (item.kind === "truefalse") return tfSel !== null;
    if (item.kind === "fill-q") return fillSel.some((s) => s.trim().length > 0);
    return false;
  };

  const allQuestionIds = useMemo(
    () => new Set(DECKS.filter((d) => d.category === "question").flatMap((d) => d.items.map((i) => i.id))),
    []
  );

  const sessionStats = useMemo(() => {
    const entries = Object.entries(submitMap).filter(([id]) => allQuestionIds.has(id));
    const attempted = entries.length;
    const correct = entries.filter(([, r]) => r.isCorrect).length;
    const incorrect = attempted - correct;
    const accuracy = attempted > 0 ? Math.round((correct / attempted) * 100) : 0;
    return { attempted, correct, incorrect, accuracy };
  }, [submitMap, allQuestionIds]);

  const famStats = useMemo(() => {
    const vals = Object.values(familiarityMap);
    const counts = { familiar: 0, normal: 0, unfamiliar: 0 };
    vals.forEach((f) => counts[f]++);
    return {
      total: vals.length,
      data: [
        { name: "熟悉",   value: counts.familiar,   color: FAM_COLORS.familiar },
        { name: "一般",   value: counts.normal,     color: FAM_COLORS.normal },
        { name: "不熟悉", value: counts.unfamiliar, color: FAM_COLORS.unfamiliar },
      ],
    };
  }, [familiarityMap]);

  const kindMeta = item ? KIND_META[item.kind] : KIND_META["display"];
  const isQuestionItem = item && (item.kind === "single" || item.kind === "multi" || item.kind === "truefalse" || item.kind === "fill-q");
  const isFiltered = selectedTags.size > 0;
  const activeTags = Array.from(selectedTags);

  // ── Option rendering ──────────────────────────────────

  const optionClass = (isCorrectAnswer: boolean, isUserSelected: boolean) => {
    const base = "w-full text-left px-4 py-3 rounded-lg text-sm transition-colors flex items-start gap-3";
    if (!isSubmitted) return `${base} border ${isUserSelected ? "border-primary bg-primary/5 text-primary" : "border-border bg-card hover:bg-muted/60"}`;
    if (isCorrectAnswer) return `${base} border-2 border-green-500 bg-green-50 text-green-900`;
    if (isUserSelected) return `${base} border-2 border-red-400 bg-red-50 text-red-900`;
    return `${base} border border-border bg-card text-muted-foreground`;
  };

  const renderOptions = () => {
    if (!item || (item.kind !== "single" && item.kind !== "multi")) return null;
    const isSingle = item.kind === "single";
    return (
      <div className="space-y-2.5 mt-5">
        {item.options.map((opt, i) => {
          const isUserSelected = isSingle ? singleSel === i : multiSel.has(i);
          const isCorrectAnswer = isSingle ? i === item.answer : item.answer.includes(i);
          return (
            <button
              key={i} disabled={isSubmitted}
              onClick={() => {
                if (isSubmitted) return;
                if (isSingle) { setSingleSel(i); } else {
                  setMultiSel((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
                }
              }}
              className={optionClass(isCorrectAnswer, isUserSelected)}
            >
              <span className={`shrink-0 w-5 h-5 text-xs font-mono font-bold rounded flex items-center justify-center mt-0.5 ${isUserSelected ? "bg-current/15" : "bg-muted"}`}>
                {OPTION_LABELS[i]}
              </span>
              <span className="flex-1">{opt}</span>
              {isSubmitted && isCorrectAnswer && <CheckCircle2 className="shrink-0 w-4 h-4 text-green-500 mt-0.5" />}
              {isSubmitted && isUserSelected && !isCorrectAnswer && <XCircle className="shrink-0 w-4 h-4 text-red-500 mt-0.5" />}
            </button>
          );
        })}
      </div>
    );
  };

  const renderTrueFalse = () => {
    if (!item || item.kind !== "truefalse") return null;
    return (
      <div className="flex gap-4 mt-6">
        {([true, false] as const).map((val) => {
          const isUserSelected = tfSel === val;
          const isCorrectAnswer = val === item.answer;
          let cls = "flex-1 py-4 rounded-xl font-semibold flex items-center justify-center gap-2 transition-colors border";
          if (!isSubmitted) cls += isUserSelected ? " border-primary bg-primary/5 text-primary border-2" : " border-border bg-card hover:bg-muted/60 text-foreground";
          else if (isCorrectAnswer) cls += " border-2 border-green-500 bg-green-50 text-green-800";
          else if (isUserSelected) cls += " border-2 border-red-400 bg-red-50 text-red-800";
          else cls += " border-border bg-card text-muted-foreground";
          return (
            <button key={String(val)} disabled={isSubmitted} onClick={() => !isSubmitted && setTfSel(val)} className={cls}>
              {val ? <><CheckCircle2 className="w-5 h-5" />正确</> : <><XCircle className="w-5 h-5" />错误</>}
            </button>
          );
        })}
      </div>
    );
  };

  const renderFillQ = () => {
    if (!item || item.kind !== "fill-q") return null;
    const displayAnswers = isSubmitted && submitRecord?.fillSel ? submitRecord.fillSel : fillSel;
    return (
      <div className="mt-5 p-4 bg-muted/40 rounded-xl border border-border">
        <FillInContent
          content={item.content} blanks={item.blanks} answers={displayAnswers}
          onChangeAnswer={(i, val) => setFillSel((prev) => { const n = [...prev]; n[i] = val; return n; })}
          submitted={isSubmitted}
        />
      </div>
    );
  };

  const renderFillCard = () => {
    if (!item || item.kind !== "fill-card") return null;
    if (!flipped) {
      return (
        <>
          <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed p-4 bg-muted/40 rounded-xl border border-border">
            {item.template.replace(/___/g, "　　　　")}
          </pre>
          <button onClick={() => setFlipped(true)} className="mt-5 flex items-center gap-2 px-5 py-2.5 rounded-lg border-2 border-primary/30 text-primary hover:bg-primary/5 font-medium text-sm transition-colors">
            <Eye className="w-4 h-4" />查看答案
          </button>
        </>
      );
    }
    const parts = item.template.split("___");
    return (
      <>
        <div className="text-sm leading-loose p-4 bg-muted/40 rounded-xl border border-border whitespace-pre-wrap">
          {parts.map((p, i) => (
            <span key={i}>{p}{i < parts.length - 1 && (
              <span className="inline-flex items-center px-2 py-0.5 mx-1 rounded bg-primary/10 text-primary font-semibold text-sm border border-primary/20">
                {item.blanks[i] ?? "?"}
              </span>
            )}</span>
          ))}
        </div>
        <button onClick={() => setFlipped(false)} className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <EyeOff className="w-3.5 h-3.5" />收起答案
        </button>
      </>
    );
  };

  const itemTitle = (it: Item): string => {
    if (it.kind === "display") return it.front.slice(0, 18);
    if (it.kind === "fill-card") return it.template.slice(0, 18) + "…";
    if ("content" in it) return it.content.slice(0, 18) + "…";
    return "";
  };

  if (!item) {
    return (
      <div className="h-screen flex items-center justify-center text-muted-foreground text-sm">
        当前筛选无匹配卡片
      </div>
    );
  }

  // ─────────────────────────────────────────────────────
  // Shared card content (used in both layouts)
  // ─────────────────────────────────────────────────────

  const cardContent = (
    <div className="max-w-[640px] mx-auto">
      {/* Item tags — view / edit */}
      <div className="flex items-start gap-1.5 mb-3 flex-wrap min-h-[24px]">
        {itemTags.map((t) =>
          tagEditMode ? (
            <span
              key={t}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium"
            >
              # {t}
              <button
                onClick={() => removeTag(t)}
                className="ml-0.5 rounded-full hover:bg-red-100 hover:text-red-600 transition-colors p-0.5"
                title="移除标签"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </span>
          ) : (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                selectedTags.has(t)
                  ? "bg-primary/10 text-primary border-primary/25 font-medium"
                  : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:text-primary"
              }`}
            >
              # {t}
            </button>
          )
        )}

        {tagEditMode && (
          <form
            onSubmit={(e) => { e.preventDefault(); addTag(newTagInput); }}
            className="inline-flex items-center gap-1"
          >
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Escape") { setTagEditMode(false); setNewTagInput(""); } }}
              placeholder="添加标签…"
              autoFocus
              className="text-xs px-2 py-0.5 rounded-full border border-dashed border-primary/50 bg-transparent text-foreground focus:outline-none focus:border-primary w-24 placeholder:text-muted-foreground/60"
            />
            {newTagInput.trim() && (
              <button
                type="submit"
                className="w-4 h-4 rounded-full bg-primary text-white flex items-center justify-center hover:bg-primary/80 transition-colors"
              >
                <Check className="w-2.5 h-2.5" />
              </button>
            )}
          </form>
        )}

        <button
          onClick={() => { setTagEditMode((v) => !v); setNewTagInput(""); }}
          title={tagEditMode ? "完成编辑" : "编辑标签"}
          className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors shrink-0 ${
            tagEditMode
              ? "bg-primary text-white hover:bg-primary/80"
              : "bg-muted text-muted-foreground hover:bg-muted-foreground/20 hover:text-foreground"
          }`}
        >
          {tagEditMode ? <Check className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
        </button>

        {itemTags.length === 0 && !tagEditMode && (
          <button
            onClick={() => setTagEditMode(true)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-muted-foreground border border-dashed border-muted-foreground/25 hover:border-muted-foreground/50 px-2 py-0.5 rounded-full transition-colors"
          >
            <Plus className="w-3 h-3" />添加标签
          </button>
        )}
      </div>

      {/* Card */}
      <div className="bg-card rounded-2xl border border-border shadow-sm overflow-hidden">
        {item.image && (
          <div className="w-full h-44 bg-muted overflow-hidden">
            <img src={item.image} alt="卡片图片" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="p-5 sm:p-7">
          {item.kind === "display" && (
            <>
              <h2 className="text-lg font-bold text-foreground mb-4">{item.front}</h2>
              {!flipped ? (
                <button onClick={() => setFlipped(true)} className="flex items-center gap-2 px-5 py-2.5 rounded-lg border-2 border-primary/30 text-primary hover:bg-primary/5 font-medium text-sm transition-colors">
                  <Eye className="w-4 h-4" />查看背面
                </button>
              ) : (
                <div className="pt-4 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">背面</p>
                  <pre className="text-sm text-foreground whitespace-pre-wrap font-sans leading-relaxed">{item.back}</pre>
                  <button onClick={() => setFlipped(false)} className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <EyeOff className="w-3.5 h-3.5" />收起
                  </button>
                </div>
              )}
            </>
          )}
          {item.kind === "fill-card" && (
            <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">填空卡片</p>
              {renderFillCard()}
            </>
          )}
          {(item.kind === "single" || item.kind === "multi") && (
            <>
              <p className="text-base font-medium text-foreground leading-relaxed">{item.content}</p>
              {item.kind === "multi" && <p className="text-xs text-muted-foreground mt-1.5">可多选</p>}
              {renderOptions()}
            </>
          )}
          {item.kind === "truefalse" && (
            <>
              <p className="text-base font-medium text-foreground leading-relaxed">{item.content}</p>
              {renderTrueFalse()}
            </>
          )}
          {item.kind === "fill-q" && (
            <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">填空题</p>
              {renderFillQ()}
            </>
          )}

          {isQuestionItem && (
            <div className="mt-6">
              {!isSubmitted ? (
                <button onClick={handleSubmit} disabled={!canSubmit()} className="px-6 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold transition-colors hover:bg-primary/90 disabled:opacity-35 disabled:cursor-not-allowed">
                  提交答案
                </button>
              ) : (
                <div className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold border ${submitRecord!.isCorrect ? "bg-green-50 text-green-800 border-green-200" : "bg-red-50 text-red-800 border-red-200"}`}>
                  {submitRecord!.isCorrect
                    ? <><CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />回答正确！</>
                    : <><XCircle className="w-5 h-5 text-red-500 shrink-0" />回答错误</>
                  }
                </div>
              )}
            </div>
          )}

          {isSubmitted && "explanation" in item && (
            <div className="mt-4 p-4 rounded-xl bg-secondary/60 border border-border">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">解析</p>
              <p className="text-sm text-foreground leading-relaxed">{item.explanation}</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation + Familiarity */}
      <div className="flex items-center justify-between mt-5">
        <button
          onClick={() => navigate(-1)} disabled={currentIndex === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />上一个
        </button>

        <div className="flex items-center gap-1.5">
          {(["familiar", "normal", "unfamiliar"] as Familiarity[]).map((f) => {
            const cfg = FAM_CONFIG[f];
            const isActive = familiarityMap[item.id] === f;
            return (
              <button
                key={f}
                onClick={() => setFamiliarityMap((prev) => ({ ...prev, [item.id]: f }))}
                className={`px-2.5 sm:px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${isActive ? cfg.active : `bg-transparent border ${cfg.inactive}`}`}
              >
                {cfg.label}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => navigate(1)} disabled={currentIndex === filteredItems.length - 1}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          下一个<ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────
  // Shared stats content
  // ─────────────────────────────────────────────────────

  const statsContent = (
    <>
      {/* Question stats */}
      <div className="px-5 py-4 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">题目答题</p>
        <div className="space-y-2.5">
          <StatRow label="已作答" value={sessionStats.attempted} unit="题" color="text-foreground" />
          <StatRow label="答对"   value={sessionStats.correct}   unit="题" color="text-emerald-600" />
          <StatRow label="答错"   value={sessionStats.incorrect} unit="题" color="text-red-500" />
          <div className="pt-2">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-xs text-muted-foreground">正确率</span>
              <span className="text-sm font-bold font-mono text-primary">{sessionStats.accuracy}%</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${sessionStats.accuracy}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Familiarity chart */}
      <div className="px-5 py-4 border-b border-border">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">熟悉度分布</p>
        {famStats.total > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={130}>
              <PieChart>
                <Pie
                  data={famStats.data.filter((d) => d.value > 0)}
                  cx="50%" cy="50%" innerRadius={35} outerRadius={54}
                  paddingAngle={3} dataKey="value" strokeWidth={0}
                >
                  {famStats.data.filter((d) => d.value > 0).map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: "12px", borderRadius: "8px", border: "1px solid var(--border)", background: "white", boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }}
                  formatter={(v: number, name: string) => [`${v} 个`, name]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-1">
              {famStats.data.map((d) => (
                <div key={d.name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.color }} />
                    <span className="text-xs text-muted-foreground">{d.name}</span>
                  </div>
                  <span className="text-xs font-mono font-semibold text-foreground">
                    {d.value}
                    <span className="text-muted-foreground ml-1">
                      ({famStats.total > 0 ? Math.round((d.value / famStats.total) * 100) : 0}%)
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="text-center py-6">
            <Brain className="w-8 h-8 mx-auto mb-2 text-muted-foreground/30" />
            <p className="text-xs text-muted-foreground">在卡片下方标记熟悉度</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">统计将在此显示</p>
          </div>
        )}
      </div>

      {/* Current deck progress */}
      <div className="px-5 py-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {deck.name} · 进度
          </p>
          {isFiltered && (
            <span className="text-xs text-primary font-mono">{filteredItems.length} 题</span>
          )}
        </div>
        <div className="space-y-1">
          {filteredItems.map((it, idx) => {
            const isActive = idx === currentIndex;
            const fam = familiarityMap[it.id];
            const sub = submitMap[it.id];
            return (
              <button
                key={it.id}
                onClick={() => isMobile ? jumpToAndGoCard(idx) : jumpTo(idx)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  isActive ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <span className="font-mono w-4 text-center shrink-0 text-muted-foreground">{idx + 1}</span>
                <span className="flex-1 text-left truncate">{itemTitle(it)}</span>
                {fam && <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: FAM_COLORS[fam] }} />}
                {sub && (sub.isCorrect
                  ? <CheckCircle2 className="w-3 h-3 text-green-500 shrink-0" />
                  : <XCircle className="w-3 h-3 text-red-400 shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  // ─────────────────────────────────────────────────────
  // Shared deck list content
  // ─────────────────────────────────────────────────────

  const deckListContent = (mobile: boolean) => (
    <>
      <div className="px-2 mb-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          <BookOpen className="w-3.5 h-3.5" />知识卡片
        </div>
        {DECKS.filter((d) => d.category === "card").map((d) => (
          <div key={d.id}>
            <DeckListItem
              deck={d} isActive={selectedDeckId === d.id}
              onClick={() => {
                if (mobile && selectedDeckId === d.id) {
                  setMobileTab("card");
                } else {
                  selectDeck(d.id);
                }
              }}
              familiarityMap={familiarityMap}
            />
            {selectedDeckId === d.id && (
              <DeckTagList
                deck={d} selectedTags={selectedTags}
                onToggleTag={toggleTag} onClearTags={clearTags}
                customTagsMap={customTagsMap}
                onGoToCard={mobile ? () => setMobileTab("card") : undefined}
              />
            )}
          </div>
        ))}
      </div>

      <div className="mx-2 border-t border-border my-3" />

      <div className="px-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          <ListChecks className="w-3.5 h-3.5" />题库
        </div>
        {DECKS.filter((d) => d.category === "question").map((d) => (
          <div key={d.id}>
            <DeckListItem
              deck={d} isActive={selectedDeckId === d.id}
              onClick={() => {
                if (mobile && selectedDeckId === d.id) {
                  setMobileTab("card");
                } else {
                  selectDeck(d.id);
                }
              }}
              familiarityMap={familiarityMap}
            />
            {selectedDeckId === d.id && (
              <DeckTagList
                deck={d} selectedTags={selectedTags}
                onToggleTag={toggleTag} onClearTags={clearTags}
                customTagsMap={customTagsMap}
                onGoToCard={mobile ? () => setMobileTab("card") : undefined}
              />
            )}
          </div>
        ))}
      </div>
    </>
  );

  // ─────────────────────────────────────────────────────
  // Mobile layout
  // ─────────────────────────────────────────────────────

  if (isMobile) {
    return (
      <>
        <style>{`
          .scrollbar-hide { scrollbar-width: none; }
          .scrollbar-hide::-webkit-scrollbar { display: none; }
          .bg-primary\\/8 { background-color: color-mix(in srgb, var(--primary) 8%, transparent); }
        `}</style>
        <div className="h-screen bg-background flex flex-col overflow-hidden">

          {/* Mobile top bar */}
          <header className="shrink-0 bg-card border-b border-border px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <Brain className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm font-bold tracking-tight leading-none">MemoQuiz</h1>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {deck.name}
                  <span className="mx-1 opacity-40">·</span>
                  {currentIndex + 1}/{filteredItems.length}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Active tag pills */}
              {isFiltered && (
                <button
                  onClick={clearTags}
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium"
                >
                  <Tag className="w-3 h-3" />
                  {activeTags.length}
                  <X className="w-3 h-3" />
                </button>
              )}
              <LayoutToggle override={layoutOverride} onCycle={cycleLayout} compact />
            </div>
          </header>

          {/* Progress bar */}
          <div className="h-[3px] bg-muted shrink-0">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${((currentIndex + 1) / filteredItems.length) * 100}%` }}
            />
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {/* List tab */}
            <div className={`h-full overflow-y-auto scrollbar-hide py-3 px-3 ${mobileTab === "list" ? "block" : "hidden"}`}>
              {deckListContent(true)}
            </div>

            {/* Card tab */}
            <div className={`h-full overflow-y-auto scrollbar-hide ${mobileTab === "card" ? "block" : "hidden"}`}>
              {/* Deck sub-header */}
              <div className="px-4 py-2.5 border-b border-border bg-card/60 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: deck.color }} />
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${kindMeta.bg} ${kindMeta.text}`}>
                  {kindMeta.label}
                </span>
              </div>
              <div className="px-4 py-5">
                {cardContent}
              </div>
            </div>

            {/* Stats tab */}
            <div className={`h-full overflow-y-auto scrollbar-hide ${mobileTab === "stats" ? "block" : "hidden"}`}>
              {statsContent}
            </div>
          </div>

          {/* Bottom navigation */}
          <nav className="shrink-0 bg-card border-t border-border flex">
            {(
              [
                { id: "list" as MobileTab, label: "题库",  Icon: BookOpen },
                { id: "card" as MobileTab, label: "卡片",  Icon: Brain },
                { id: "stats" as MobileTab, label: "统计", Icon: BarChart2 },
              ] as const
            ).map(({ id, label, Icon }) => {
              const isActive = mobileTab === id;
              return (
                <button
                  key={id}
                  onClick={() => setMobileTab(id)}
                  className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-colors ${
                    isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <div className={`relative ${isActive ? "after:absolute after:-bottom-0.5 after:left-1/2 after:-translate-x-1/2 after:w-4 after:h-0.5 after:rounded-full after:bg-primary" : ""}`}>
                    <Icon className={`w-5 h-5 transition-transform ${isActive ? "scale-110" : ""}`} />
                  </div>
                  <span className={`text-[10px] font-medium leading-none ${isActive ? "font-semibold" : ""}`}>{label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </>
    );
  }

  // ─────────────────────────────────────────────────────
  // Desktop layout
  // ─────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        .scrollbar-hide { scrollbar-width: none; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .bg-primary\\/8 { background-color: color-mix(in srgb, var(--primary) 8%, transparent); }
      `}</style>
      <div className="h-screen bg-background flex overflow-hidden">

        {/* ── Left Panel ──────────────────────────────────── */}
        <aside className="w-[272px] shrink-0 border-r border-border flex flex-col bg-card">
          <div className="px-5 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <Brain className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-sm font-bold tracking-tight leading-none">MemoQuiz</h1>
                <p className="text-xs text-muted-foreground mt-0.5">AI 记忆卡片 · 刷题系统</p>
              </div>
              <LayoutToggle override={layoutOverride} onCycle={cycleLayout} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-3 px-3 scrollbar-hide">
            {deckListContent(false)}
          </div>
        </aside>

        {/* ── Center Panel ────────────────────────────────── */}
        <main className="flex-1 flex flex-col overflow-hidden min-w-0">
          {/* Progress bar */}
          <div className="h-[3px] bg-muted shrink-0">
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${((currentIndex + 1) / filteredItems.length) * 100}%` }}
            />
          </div>

          {/* Deck header */}
          <div className="px-7 py-3 border-b border-border flex items-center justify-between shrink-0 bg-card/60">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: deck.color }} />
              <span className="font-semibold text-sm shrink-0">{deck.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${kindMeta.bg} ${kindMeta.text}`}>
                {kindMeta.label}
              </span>
              {isFiltered && (
                <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                  <span className="text-xs text-muted-foreground shrink-0">筛选:</span>
                  <div className="flex gap-1 overflow-hidden">
                    {activeTags.slice(0, 2).map((t) => (
                      <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium truncate max-w-[80px] shrink-0">
                        {t}
                      </span>
                    ))}
                    {activeTags.length > 2 && (
                      <span className="text-xs text-muted-foreground shrink-0">+{activeTags.length - 2}</span>
                    )}
                  </div>
                  <button onClick={clearTags} className="shrink-0 p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
            <span className="text-xs text-muted-foreground font-mono tabular-nums shrink-0 ml-3">
              {currentIndex + 1} / {filteredItems.length}
            </span>
          </div>

          {/* Card area */}
          <div className="flex-1 overflow-y-auto px-7 py-6 scrollbar-hide">
            {cardContent}
          </div>
        </main>

        {/* ── Right Panel ─────────────────────────────────── */}
        <aside className="w-[248px] shrink-0 border-l border-border flex flex-col bg-card overflow-y-auto scrollbar-hide">
          <div className="px-5 py-4 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-primary" />
              <h2 className="text-sm font-bold">本次统计</h2>
            </div>
          </div>
          {statsContent}
        </aside>
      </div>
    </>
  );
}
