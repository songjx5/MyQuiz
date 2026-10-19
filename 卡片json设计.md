# 卡片 JSON 设计

适用于「刷题 + 辅助背诵」场景。推荐用一个卡组（Deck）包裹若干卡片/题目；也支持直接导入单张卡片。

约定：

- **必填字段**缺失会导致导入失败；**可选字段**可省略。
- 所有 `id` 在卡组内应唯一，建议用前缀区分类型，如 `q_`、`j_`、`k_`、`c_`。
- 文本字段支持换行；如需 Markdown 渲染，由前端决定。
- 图片、音频等资源可使用相对路径或完整 URL。

---

## 1. 卡组结构（可选）

```json
{
  "id": "deck_network",
  "name": "计算机网络",
  "category": "question",
  "description": "HTTP、TCP、DNS 等基础题",
  "color": "#0CA678",
  "tags": ["计算机网络"],
  "source": {
    "book": "计算机网络（第8版）",
    "author": "谢希仁",
    "publisher": "电子工业出版社"
  },
  "items": []
}
```

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | string | 卡组唯一 ID |
| `name` | 是 | string | 卡组名称 |
| `category` | 是 | `"card"` \| `"question"` | 背诵卡组 / 刷题卡组 |
| `items` | 是 | Item[] | 卡片或题目列表 |
| `description` | 否 | string | 卡组简介 |
| `color` | 否 | string | 主题色，如 `#0CA678` |
| `cover` | 否 | string | 封面图地址 |
| `tags` | 否 | string[] | 卡组标签 |
| `source` | 否 | Source | 卡组来源，如教材、题库 |
| `version` | 否 | string | 数据版本 |
| `order` | 否 | number | 卡组排序 |
| `createdAt` | 否 | string | 创建时间，ISO 8601 |
| `updatedAt` | 否 | string | 更新时间，ISO 8601 |

---

## 2. 卡片公共字段

每张卡片/题目都包含以下字段。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | string | 卡片唯一 ID |
| `type` | 是 | string | 卡片类型，见下方题型总览 |
| `tags` | 否 | string[] | 普通标签；可省略顶级标签，导入时会自动补全 |
| `difficulty` | 否 | number | 难度，1–5，默认 3 |
| `chapter` | 否 | string | 所属章节 |
| `section` | 否 | string | 所属小节 |
| `analysis` | 否 | string | 题目解析；题目类和完型建议填写 |
| `image` | 否 | string | 单张配图地址 |
| `assets` | 否 | string[] | 多张图片、音频、附件等资源 |
| `notes` | 否 | string | 个人笔记、易错点、记忆口诀 |
| `importance` | 否 | number | 重要程度，1–5 |
| `frequency` | 否 | number \| string | 考频，如 `5`、`"high"`、`"low"` |
| `source` | 否 | Source | 来源信息，见第 3 节 |
| `status` | 否 | `"draft"` \| `"published"` \| `"archived"` | 数据状态 |
| `language` | 否 | string | 语言，如 `zh-CN` |
| `order` | 否 | number | 卡片排序 |
| `createdAt` | 否 | string | 创建时间，ISO 8601 |
| `updatedAt` | 否 | string | 更新时间，ISO 8601 |

### 题型总览

| `type` | 说明 | 专属必填字段 |
| --- | --- | --- |
| `single` | 单选题 | `stem`、`options`、`answer` |
| `multi` | 多选题（可选扩展） | `stem`、`options`、`answer` |
| `judge` | 判断题 | `stem`、`answer` |
| `fill` | 填空题（可选扩展） | `stem`、`blanks` |
| `knowledge` | 知识展示卡 | `title`、`content` |
| `cloze` | 完型填空卡 | `paragraphs` |

### 顶级标签

每张卡片有且只有一个顶级标签，由 `type` 自动决定，并始终排在 `tags` 数组第一位：

| `type` | 顶级标签 |
| --- | --- |
| `single` | `单选题` |
| `multi` | `多选题` |
| `judge` | `单选题`（判断题归入单选） |
| `fill` | `填空题` |
| `cloze` | `填空题`（完型填空归入填空） |
| `knowledge` | `记忆卡片` |

规则：

- JSON 中可以省略顶级标签；校验/导入时会自动补全并给出提示。
- 如果 `tags` 中出现两个顶级标签，或顶级标签与 `type` 不匹配，校验失败。
- 顶级标签由系统维护，前端不能新增、修改或删除；用户标签覆盖只保存普通标签。
- 建议在题库 JSON 中显式写出顶级标签，方便阅读和导出；顺序不要求，导入后会统一移到第一位。

---

## 3. 来源字段 Source（全部可选）

`source` 可放在卡组或单张卡片上；卡片上的 `source` 优先于卡组。书籍、页码等均属于非必要信息。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `book` | 否 | string | 书名 |
| `author` | 否 | string | 作者 |
| `page` | 否 | number \| string | 页码，如 `45` 或 `"45-48"` |
| `edition` | 否 | string | 版次 |
| `publisher` | 否 | string | 出版社 |
| `isbn` | 否 | string | ISBN |
| `url` | 否 | string | 在线来源链接 |
| `note` | 否 | string | 来源备注 |

---

## 4. 单选题 `single`

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `stem` | 是 | string | 题干 |
| `options` | 是 | Option[] | 选项列表，至少 2 项 |
| `options[].key` | 是 | string | 选项标识，建议使用 `A`、`B`、`C` |
| `options[].text` | 是 | string | 选项内容 |
| `answer` | 是 | string[] | 正确答案，有且仅有一个选项 `key` |
| `analysis` | 否 | string | 解析 |

```json
{
  "id": "q_001",
  "type": "single",
  "stem": "以下哪个是 HTTP 默认端口？",
  "options": [
    { "key": "A", "text": "21" },
    { "key": "B", "text": "80" },
    { "key": "C", "text": "443" }
  ],
  "answer": ["B"],
  "analysis": "HTTP 默认端口是 80。",
  "chapter": "网络基础",
  "section": "HTTP",
  "tags": ["单选题", "HTTP", "端口"],
  "difficulty": 2,
  "source": {
    "book": "计算机网络（第8版）",
    "author": "谢希仁",
    "page": 45,
    "edition": "8",
    "publisher": "电子工业出版社",
    "isbn": "978-7-121-XXXXX-X"
  },
  "notes": "易与 HTTPS 的 443 端口混淆。"
}
```

---

## 5. 多选题 `multi`（可选扩展）

字段与单选题一致，区别是 `answer` 可以包含多个选项 `key`。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `stem` | 是 | string | 题干 |
| `options` | 是 | Option[] | 选项列表 |
| `answer` | 是 | string[] | 正确答案，至少 2 个选项 `key` |
| `analysis` | 否 | string | 解析 |
| `partialCredit` | 否 | boolean | 是否支持部分得分，默认 `false` |

```json
{
  "id": "m_001",
  "type": "multi",
  "stem": "以下哪些是 HTTP/1.1 的标准请求方法？（多选）",
  "options": [
    { "key": "A", "text": "GET" },
    { "key": "B", "text": "POST" },
    { "key": "C", "text": "FETCH" },
    { "key": "D", "text": "DELETE" }
  ],
  "answer": ["A", "B", "D"],
  "analysis": "FETCH 是浏览器 Web API，不是 HTTP 标准方法。",
  "tags": ["多选题", "HTTP", "协议"],
  "difficulty": 3
}
```

---

## 6. 判断题 `judge`

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `stem` | 是 | string | 题干 |
| `answer` | 是 | string[] | `["正确"]` 或 `["错误"]`；也兼容布尔值 `true` / `false` |
| `analysis` | 否 | string | 解析 |

```json
{
  "id": "j_001",
  "type": "judge",
  "stem": "HTTP 默认端口是 80。",
  "answer": ["正确"],
  "analysis": "正确。HTTP 默认端口为 80，HTTPS 为 443。",
  "chapter": "网络基础",
  "tags": ["单选题", "HTTP", "端口"],
  "difficulty": 1
}
```

---

## 7. 填空题 `fill`（可选扩展）

使用连续三个下划线 `___` 表示空位，`blanks` 按出现顺序一一对应。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `stem` | 是 | string | 题干，空位用 `___` 表示 |
| `blanks` | 是 | string[] | 各空位答案，顺序与 `___` 一致 |
| `caseSensitive` | 否 | boolean | 是否区分大小写，默认 `false` |
| `analysis` | 否 | string | 解析 |

```json
{
  "id": "f_001",
  "type": "fill",
  "stem": "HTTP 默认端口___，HTTPS 默认端口___。",
  "blanks": ["80", "443"],
  "analysis": "HTTP 默认 80，HTTPS 默认 443。",
  "caseSensitive": false,
  "tags": ["填空题", "HTTP", "端口"],
  "difficulty": 1
}
```

---

## 8. 知识展示卡 `knowledge`

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `title` | 是 | string | 卡片标题，通常作为正面 |
| `content` | 是 | string | 知识正文，通常作为背面 |
| `assets` | 否 | string[] | 配图、音频等资源 |
| `tags` | 否 | string[] | 普通标签；顶级标签自动补全为 `记忆卡片` |

```json
{
  "id": "k_001",
  "type": "knowledge",
  "title": "HTTP 与 HTTPS 的区别",
  "content": "HTTPS 是 HTTP 加上 TLS 加密，默认端口为 443；HTTP 默认端口为 80。",
  "assets": ["images/http_vs_https.png"],
  "tags": ["记忆卡片", "HTTP", "HTTPS"],
  "chapter": "网络基础",
  "source": {
    "book": "计算机网络（第8版）",
    "page": "46-47"
  }
}
```

---

## 9. 完型填空 `cloze`

适合在段落中挖空，用于背诵原文或知识点。

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `title` | 否 | string | 标题 |
| `paragraphs` | 是 | Paragraph[] | 段落列表 |
| `paragraphs[].id` | 是 | string | 段落 ID |
| `paragraphs[].segments` | 是 | Segment[] | 段落内容片段 |
| `analysis` | 否 | string | 整体解析 |
| `wordBank` | 否 | string[] | 可选词库 |
| `showWordBank` | 否 | boolean | 是否显示词库，默认 `false` |

### Segment 字段

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `type` | 是 | `"text"` \| `"blank"` | 片段类型 |
| `text` | 条件 | string | `type` 为 `text` 时必填 |
| `id` | 条件 | string | `type` 为 `blank` 时必填，空位唯一 ID |
| `answer` | 条件 | string | `type` 为 `blank` 时必填，标准答案 |
| `alternatives` | 否 | string[] | 可接受的同义答案 |
| `hint` | 否 | string | 空位提示 |
| `caseSensitive` | 否 | boolean | 该空是否区分大小写，默认 `false` |

```json
{
  "id": "c_001",
  "type": "cloze",
  "title": "HTTP 基础完型",
  "paragraphs": [
    {
      "id": "p1",
      "segments": [
        { "type": "text", "text": "HTTP 默认端口是 " },
        { "type": "blank", "id": "b1", "answer": "80", "hint": "数字" },
        { "type": "text", "text": "，HTTPS 默认端口是 " },
        { "type": "blank", "id": "b2", "answer": "443" },
        { "type": "text", "text": "。" }
      ]
    },
    {
      "id": "p2",
      "segments": [
        { "type": "text", "text": "HTTP 是无状态协议，通常基于 " },
        { "type": "blank", "id": "b3", "answer": "TCP", "alternatives": ["传输控制协议"] },
        { "type": "text", "text": " 传输。" }
      ]
    }
  ],
  "analysis": "HTTP 默认 80，HTTPS 默认 443，HTTP 通常基于 TCP。",
  "chapter": "网络基础",
  "tags": ["填空题", "HTTP", "端口"],
  "source": {
    "book": "计算机网络（第8版）",
    "page": 45
  }
}
```

---

## 10. 字段约定

1. `single` 的 `answer` 必须恰好包含一个 `options[].key`。
2. `multi` 的 `answer` 至少包含两个 `options[].key`，且不能重复。
3. `judge` 的 `answer` 只允许 `"正确"` / `"错误"`，或布尔值。
4. `fill` 和 `cloze` 的答案默认忽略首尾空格；可通过 `caseSensitive` 控制大小写。
5. `difficulty`、`importance` 使用 1–5 的整数，数值越大表示越难/越重要。
6. `tags` 用于筛选和统计，建议普通标签控制在 3–6 个，避免同义标签重复；顶级标签由 `type` 自动决定，不能手工指定为其他值。
7. `source` 为可选信息，缺失时不影响刷题和背诵；书籍、页码、版次等按需填写。
8. 未列出的扩展字段可由前端忽略，便于后续兼容。
