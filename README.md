# MemoQuiz · AI 记忆卡片刷题系统

跨设备、跨浏览器的长期记忆卡片与题库系统。前端使用 React + Vite，后端使用 Node 原生 HTTP 服务，数据保存在 SQLite（WAL 模式）中。用户只需要保存一串同步码，就能在另一台设备或另一个浏览器继续学习。

## 功能

- 知识卡片：正面 / 背面翻阅，适合概念记忆。
- 题库：单选、多选、判断、填空、完型填空五种题型。
- 乱序练习：每次进入卡组都会重新打乱卡片顺序；右下角列表展示本次顺序，可随时重新洗牌。
- 完型填空：除「提交答案」外，也可点「显示背面」直接查看空位答案与解析（仅查看，不计入作答）。
- 长期统计：累计作答、答对 / 答错、正确率、已作答卡片数、熟悉度分布。
- 熟悉度：每张卡片可标记「熟悉 / 一般 / 不熟悉」，再次点击可取消。
- 标签：按卡组标签筛选；也可以给单张卡片添加自己的普通标签（覆盖原始普通标签，可恢复）。
- 顶级标签：每张卡片自动带有且仅带有一个顶级标签（`单选题` / `多选题` / `填空题` / `记忆卡片`），由题型决定，前端只读、不能修改或删除。
- 跨设备同步：同步码即身份，答题记录、熟悉度、标签全部保存在服务端。
- 题库更新：JSON 文件可增删改，命令行校验后导入；导入是幂等的。
- 数据库后门：用户 / 管理 key 生成与校验、进度管理、导入导出、备份、只读 SQL 查询等。

## 技术栈与目录

- Node.js **24+**（使用内置 `node:sqlite`、`node:http`、`node:crypto`，没有 Express / better-sqlite3 等原生依赖）
- React 18 + TypeScript + Vite 6 + Tailwind CSS 4 + Radix / shadcn 风格组件
- SQLite：WAL、外键、复合主键 `(deck_id, id)`

```text
server/
  index.mjs        API 入口
  api.mjs          HTTP 路由、鉴权、静态站点
  schema.sql       SQLite schema
  db.mjs           连接、事务、备份、重置
  auth.mjs         同步码 / 管理 key 的生成、哈希、校验、轮换
  validate.mjs     题库 JSON 校验与归一化
  topTags.mjs      顶级标签定义、题型映射与只读合并
  grade.mjs        各题型判分
  importer.mjs     事务化导入 / 导出
  queries.mjs      卡组、进度、统计查询
  cli.mjs          数据库后门 CLI
  config.mjs       环境变量与路径
src/
  app/App.tsx              主界面（API 驱动）
  app/components/SyncDialog.tsx
  lib/api.ts               fetch 客户端与 key 存储
  lib/adapters.ts          API 数据 → UI 数据
  types/deck.ts            题库 / API 类型
  types/ui.ts              UI 类型与本地判分辅助
data/decks/*.json          题库源文件
data/app.db                SQLite 数据库（运行时生成，已被 .gitignore 忽略）
scripts/dev.mjs            同时启动 API 与 Vite
tests/                     后端测试
卡片json设计.md            题库 JSON 设计说明
```

## 快速开始

```bash
npm install
npm run db:seed     # 初始化数据库并导入 data/decks 下的示例题库
npm run dev         # 同时启动 API(8787) 与 Vite(5173)
```

打开 <http://localhost:5173>。首次打开会自动创建一个匿名用户，同步码保存在浏览器 `localStorage` 的 `memoquiz.userKey` 中。

也可以分开启动：

```bash
npm run dev:server  # 只启动 API
npm run dev:web     # 只启动 Vite；/api 会代理到 127.0.0.1:8787
```

生产模式：

```bash
npm run build
npm start           # API 同时托管 dist，打开 http://127.0.0.1:8787
```

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改。默认值即可本地运行。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DB_PATH` | `data/app.db` | SQLite 文件路径 |
| `HOST` | `127.0.0.1` | API 监听地址；局域网访问可设 `0.0.0.0` |
| `PORT` | `8787` | API 端口 |
| `CORS_ORIGIN` | `*` | 允许的前端来源；生产环境建议改成具体域名 |
| `VITE_API_BASE` | 空 | 前端请求的 API 绝对地址；留空使用同源 / Vite 代理 |
| `VITE_API_PROXY` | `http://127.0.0.1:8787` | Vite 开发代理目标 |

注意：`VITE_*` 在 Vite 启动或构建时读取；修改后需要重启开发服务器或重新构建。

## 跨设备同步

1. 在设备 A 左下角点击「跨设备同步」，复制同步码（`mck_...`）。
2. 在设备 B 打开同一站点，点击「跨设备同步」，粘贴同步码并确认。
3. 设备 B 会加载同一用户的答题记录、熟悉度和标签。

同步码只显示一次，数据库只保存它的 SHA-256 哈希。丢失同步码无法找回；可以创建新身份重新开始，旧进度仍保留在旧用户下。管理员可以用 CLI 轮换用户的同步码（旧码立即失效）。

## 数据库设计

内容与用户进度分离：

| 表 | 作用 |
| --- | --- |
| `decks` | 卡组元数据 |
| `items` | 卡片内容；主键 `(deck_id, id)`，不同卡组可以使用相同卡片 id |
| `item_tags` | 卡片原始标签（含由题型派生的顶级标签） |
| `users` | 用户；只保存同步码哈希与前缀 |
| `progress` | 每用户 / 每卡片的熟悉度、最近一次作答、累计次数 |
| `attempts` | 追加式答题历史（每次提交一行） |
| `user_item_tags` | 用户对普通标签的覆盖；顶级标签不在此表，读取时由题型补回 |
| `admin_keys` | 管理 key 哈希 |
| `meta` | schema 版本等元信息 |

- 导入题库时，`decks` / `items` 按 id UPSERT；`--prune` 会删除 JSON 中已不存在的卡片，并级联删除相关进度和答题记录。
- 用户进度是唯一不可从 JSON 重建的数据，请定期备份。
- SQLite 使用 WAL；备份使用 `VACUUM INTO` 生成一致性快照。

## 题库 JSON

格式说明见 [卡片json设计.md](./卡片json设计.md)，示例见 `data/decks/`。支持的题型：

| 类型 | 说明 | 关键字段 |
| --- | --- | --- |
| `single` | 单选 | `options`、`answer`（1 个 key） |
| `multi` | 多选 | `options`、`answer`（至少 2 个 key） |
| `judge` | 判断 | `answer`：`["正确"]` / `["错误"]`，也接受布尔值 |
| `fill` | 填空 | `stem` 中的 `___` 数量必须与 `blanks` 一致；`caseSensitive` 可选 |
| `knowledge` | 知识卡片 | `title`、`content` |
| `cloze` | 完型填空 | `paragraphs[].segments[]`；空位 `answer` 可配 `alternatives`、`caseSensitive` |

前端展示映射：`knowledge → 知识卡片`、`judge → 判断题`、`fill → 填空题`，其余同名。

### 顶级标签

每张卡片有且只有一个顶级标签，由题型自动决定并始终排在 `tags` 数组第一位：

| `type` | 顶级标签 |
| --- | --- |
| `single` | `单选题` |
| `multi` | `多选题` |
| `judge` | `单选题`（判断题归入单选） |
| `fill` | `填空题` |
| `cloze` | `填空题`（完型填空归入填空） |
| `knowledge` | `记忆卡片` |

- JSON 中可以省略顶级标签，导入时会自动补全并给出提示。
- 如果显式写入两个顶级标签，或顶级标签与题型不匹配，校验会失败。
- 顶级标签在前端以锁定样式展示，不能新增、修改或删除；用户添加标签时传入顶级标签会被忽略。
- 用户标签覆盖只保存普通标签；清除覆盖或空标签列表都不会移除顶级标签。

常用命令：

```bash
npm run db:validate                         # 只校验，不写库
npm run db:import                           # 校验并导入 data/decks
npm run db:import -- data/decks --prune     # 删除 JSON 中已移除的卡片（会级联删进度）
npm run db:import -- data/decks --dry-run   # 完整执行后回滚，只预览
npm run db:export                           # 导出到 data/export/*.json
```

> `npm run db:import -- --prune` 中间的 `--` 用于把参数传给脚本。`--prune` 会删除进度，执行前建议先 `npm run db:backup`。

## API

所有业务接口都要求用户 key：

```http
X-User-Key: mck_...
```

也支持 `Authorization: Bearer mck_...`。管理接口使用：

```http
X-Admin-Key: adm_...
```

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/health` | 公开 | 健康检查与计数 |
| POST | `/api/auth/session` | 公开 | 创建用户；body 带 `userKey` 时恢复会话 |
| GET | `/api/auth/me` | 用户 | 当前用户 |
| GET | `/api/decks?include=items` | 用户 | 全部卡组；带 items 时含完整题目与进度 |
| GET | `/api/decks/:deckId` | 用户 | 单个卡组 |
| PUT | `/api/decks/:deckId/items/:itemId/familiarity` | 用户 | body `{familiarity: "familiar"\|"normal"\|"unfamiliar"\|null}` |
| POST | `/api/decks/:deckId/items/:itemId/attempt` | 用户 | body `{answer}`；服务端判分并写入历史 |
| PUT | `/api/decks/:deckId/items/:itemId/tags` | 用户 | body `{tags: string[]}`，覆盖普通标签；顶级标签由题型决定，传入会被忽略 |
| DELETE | `/api/decks/:deckId/items/:itemId/tags` | 用户 | 删除覆盖，恢复原始普通标签（顶级标签保留） |
| GET | `/api/stats` | 用户 | 长期统计 |
| GET | `/api/admin/overview` | 管理 | 数据库计数 |
| POST | `/api/admin/import` | 管理 | body `{decks, prune?, dryRun?}` |

错误统一为：

```json
{ "error": { "code": "AUTH_INVALID", "message": "同步码无效或已失效" } }
```

校验失败时 `error.details` 包含逐条错误路径。

## 数据库后门 CLI

```bash
npm run cli -- <命令> [参数] [选项]
# 等价于
node server/cli.mjs <命令> [参数] [选项]
```

### 内容与备份

```bash
npm run db:init
npm run db:seed
npm run db:validate -- data/decks
npm run db:import -- data/decks --prune
npm run db:export -- --out data/export
npm run db:backup -- --out backups/manual.db
npm run cli -- stats --json
npm run cli -- decks show d2 --json
```

### 用户与同步码

```bash
npm run cli -- users list
npm run cli -- users create --label "我的设备"
npm run cli -- users show 1
npm run cli -- users key-check mck_xxx
npm run cli -- users rotate 1          # 旧 key 立即失效，打印新 key
npm run cli -- users delete 1 --yes    # 级联删除进度与答题记录
```

同步码只在创建 / 轮换时打印一次，请立即保存。

### 管理 key

```bash
npm run cli -- admin-key create --label "运维"
npm run cli -- admin-key list
npm run cli -- admin-key check adm_xxx
npm run cli -- admin-key revoke 1
```

管理 key 用于 `POST /api/admin/import` 和 `GET /api/admin/overview`。系统没有公开的管理 key 自举接口，必须通过本机 CLI 创建。

### 进度与答题

```bash
npm run cli -- progress get --user 1 --deck d2
npm run cli -- progress set --user 1 --deck d2 --item q1 --familiarity familiar
npm run cli -- progress clear --user 1 --deck d2 --yes
npm run cli -- attempts --user 1 --limit 50
```

### SQL 与 key 哈希

```bash
npm run cli -- sql "SELECT id, name FROM decks" --json
npm run cli -- sql "UPDATE decks SET name = '新名字' WHERE id = 'd1'" --write
npm run cli -- hash-key mck_xxx
```

`sql` 默认只允许 `SELECT` / `WITH` / `PRAGMA` / `EXPLAIN` 等读语句；写操作必须显式加 `--write`。这是本机后门命令，不要暴露给不可信用户。

### 测试用独立数据库

所有命令都支持 `--db`，可以指向临时数据库，避免污染正式数据：

```bash
npm run cli -- init --db .tmp/test.db
npm run cli -- seed --db .tmp/test.db
npm run cli -- stats --json --db .tmp/test.db
```

## 备份与恢复

```bash
npm run db:backup
# 默认生成 backups/app-<时间>.db
```

恢复步骤：

1. 停止 API 进程。
2. 把备份文件复制为 `data/app.db`。
3. 删除 `data/app.db-wal`、`data/app.db-shm`（如果有）。
4. 重新启动 API。

`reset` 会删除整个数据库，必须显式确认：

```bash
npm run cli -- reset --yes
```

## 测试

```bash
npm test
npm run build
```

测试覆盖：题库校验、五种题型判分、事务导入与幂等、复合主键隔离、进度覆盖、标签覆盖与恢复、顶级标签只读、统计、API 鉴权、管理接口、静态站点回退等。当前共 31 个后端测试。

## 安全与部署建议

- 同步码和管理 key 都是 bearer token；不要写入日志、截图或公开仓库。
- 对外部署时使用 HTTPS 反向代理（Nginx / Caddy），并设置具体的 `CORS_ORIGIN`。
- 管理 key 只保存在服务端和本机 CLI 环境；不要放进前端代码。
- `data/app.db`、`.env`、`backups/*.db` 已被 `.gitignore` 忽略。
- 如果需要多人使用，建议每个用户一个同步码；不要共用同一个 key。
- 当前没有登录密码、邮箱找回或限流；这是单机 / 小团队工具，不建议直接暴露在公网而不加反向代理保护。

## 常见问题

**提示 `Cannot find module 'node:sqlite'`**

需要 Node.js 24+；Node 22.5–23.x 可能需要 `--experimental-sqlite`。推荐直接使用 Node 24 LTS。

**前端显示「无法连接后端」**

先确认 API 已启动：`npm run dev:server`。开发模式下 Vite 会把 `/api` 代理到 `127.0.0.1:8787`；如果改了端口，同步修改 `VITE_API_PROXY`。

**端口被占用**

```bash
PORT=8790 npm run dev:server
VITE_API_PROXY=http://127.0.0.1:8790 npm run dev:web
```

Windows PowerShell 可使用 `$env:PORT=8790`。

**同步码丢了**

无法从哈希恢复。用 CLI 创建新用户会得到新同步码，但旧进度不会自动迁移；如果只是浏览器 localStorage 丢失，可以通过「跨设备同步」重新输入之前保存的同步码。

**导入后卡片消失**

`--prune` 会按 JSON 当前内容删除数据库里多出的卡片。先运行 `--dry-run` 检查，或先备份。

**数据库被锁**

停止所有 API / CLI 进程再执行 reset、恢复或直接替换数据库文件。WAL 模式下不要只复制 `app.db` 而忽略 `-wal` 文件；请使用 `npm run db:backup`。