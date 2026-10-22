# dsh-archived-session-cleaner

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）插件：在「设置 → 插件」页新增一个 **会话清理** 标签页，按项目分组列出已归档的会话（标题、最近活动时间、磁盘占用），支持**搜索**、**项目筛选**、**取消归档**与**永久删除**——删除时磁盘数据、归档标记、投影缓存、消息反馈一并清理干净。

dsh 自带的删除通常只把会话移出列表，磁盘上的 `sessions/` 目录与 `storages/` 里的关联记录仍会残留。本插件用一套「先定位、再清除、后校验」的流程把这些痕迹真正抹掉，并对运行中的会话设了硬护栏。

> **关于命名**：另有一个第三方包 `dsh-session-cleaner`（作者 fountunt，见 [npm](https://www.npmjs.com/package/dsh-session-cleaner)）。本包与之**没有关联**，是各自独立的实现；本包为避免混淆而定名为 `dsh-archived-session-cleaner`。

## 功能

- 列出当前全部已归档会话，界面形态对齐 dsh 自带的「已归档的聊天」页：**按项目分组**，组头显示项目名与「N 个会话」，组内每行之间用分隔线隔开
- 每行展示：**会话标题**（取不到时回退显示会话 id）、**最近活动时间**、短会话 id、磁盘占用与状态徽标
  - `磁盘数据` — 磁盘上存在会话目录
  - `仅归档标记` — 只剩归档标记，磁盘数据已不存在（幽灵条目）
  - `运行中` — turn 尚未结束，不可删除
- **搜索**：按标题 / 会话 id / 项目名即时过滤
- **项目筛选**：下拉框默认「全部项目」，可只看某个项目
- 顶部统计行：归档总数、磁盘占用合计；筛选时附「已筛选出 N 个」
- **取消归档**：把会话移出归档集，让它回到普通会话列表（不删数据）
- 支持**单个删除**与**一键删除全部归档**（自动跳过运行中的会话）
- 删除前弹二次确认，明确告知不可恢复
- 会话标题取自 dsh 的投影缓存（`storages/session_projcache.json` 聚合表优先，缺失时读 `storages/session_projcache/sessions/<id>.json` 单文件），归一化后最长 120 字符
- 时间取值优先级：`rows.sessionListMetadata.lastPromptAt`（与 dsh 列表一致）→ `identity.createdAt` → 会话目录 mtime

## 取消归档做了什么

「取消归档」只改一处：把该会话 id 从归档集（`global.archivedSessionIds`）里移出，并且**优先调用 dsh 的 `workspaceRegistry.unarchiveSession(id)`**，由宿主自己更新内存快照并落盘。直接改 `storages/workspace.json` 在 dsh 0.2.1-rc.2 上会被内存快照回写覆盖（`archivedSessionIds` 还是冻结数组，`splice` 只会静默失败），因此只有在宿主没有该 API 时才回退到文件路径——响应里的 `via` 会写明实际走了哪条。

- **不删数据**：`sessions/<project>/<id>/`、投影缓存、消息反馈一律不动；会话回到普通会话列表后仍可正常打开。
- **不补 `sessionIds`**：dsh 归档时并没有把会话从 `tables.workspaces[].sessionIds` 中移出（实测归档中的会话仍在那里），所以无需补回；插件也不会为了取消归档去改写这部分。
- **走 store 时无需重启**：接口返回 `via: "workspace-registry"`，dsh 的内存与磁盘同时更新，会话立刻回到会话列表。只有旧版宿主走到文件兜底、内存副本同步不了时才返回 `needsRestart: true`，界面提示「重启后生效」。插件自己的列表每次都从磁盘读，所以无论如何都会立刻少掉这一条。
- 与其他写操作一样走同源校验、会话 id 白名单、原子写与写后校验。
## 删除会清理哪些痕迹

以 `$DSH_HOME`（默认 `~/.dsh`）为根：

| 位置 | 清理内容 |
|---|---|
| `sessions/<project>/<id>/` | 整个会话数据目录 |
| `storages/workspace.json` | `global.archivedSessionIds` 中的该项，以及各 `tables.workspaces[].sessionIds` 中的该项 |
| `storages/session_projcache.json` | `tables.sessions[id]` 条目 |
| `storages/session_projcache/sessions/<id>.json` | 单会话投影文件 |
| `storages/message_feedback.json` | 该会话的点赞／点踩记录 |

删除完成后还会调用各工作区的 `detachSession`，把该会话从 `tables.workspaces[].sessionIds` 里摘掉，避免留下点不开的空行；响应里的 `detachedFrom` 表示影响到了几个工作区。

## 安全护栏

发布到公共环境前值得逐条知道的行为约束：

- **`/sclean` 同源校验（CSRF 防护）**：dsh 宿主的 `webServer` 不提供服务器级认证或来源策略，命名路由会被直接交给 handler；因此本插件自行校验来源——`Sec-Fetch-Site` 存在时必须是 `same-origin` 或 `none`，`Origin` 存在时其 host 必须与请求 `Host` 一致，`Origin: null` 一律拒绝。跨源请求返回 `403`。
  - **已知限制**：该校验拦的是**跨源 CSRF**；**DNS rebinding 不在覆盖范围内**——攻击者域名解析到本机时，其 `Host` 与 `Origin` 彼此自洽，仅凭请求头无法与正常访问区分。若要防这一类，必须依赖外层访问控制。
  - **若把 dsh 绑定到非回环地址，请自行在外层加访问控制**（宿主不会代劳）。
- **不返回本机绝对路径**：`GET /sclean/list` 只返回会话 id、标题、最近活动时间、项目显示名、状态与占用大小，不含目录路径。其中 `title` 是你自己的会话内容（可能本身写有路径文字），由 dsh 写入投影缓存，本插件不额外拼装任何路径信息；`project` 取 workspace 的 `title`（缺失时退回 `path` 的最后一段目录名，只是一段名字），`projectId` 是 workspace id 的 SHA-256 前 8 位——**workspace id 与 `path` 原文都不会出现在响应里**。
- **只删归档集内的会话**：id 不在 `global.archivedSessionIds` 中一律拒绝，避免误删活跃会话。
- **取消归档同样受护栏约束**：只接受归档集内的 id，需要同源、通过 id 白名单校验，写盘走原子写并做写后校验；不触碰任何会话数据。
- **运行中的会话拒绝删除**：判定依据是事件日志——最后一个 `turn/start` 之后没有 `turn/end`，即视为 agent 正在执行或已中断，直接跳过。仅凭 `sessions.get(id)` 是否存在**不**作为「使用中」判据（归档后实例仍在，会造成误判）。
- **会话 id 白名单**：`^[A-Za-z0-9_-]{1,128}$`，杜绝路径穿越。
- **原子写**：JSON 痕迹采用「写临时文件 + `rename`」，与存储层并发写竞争时不会产生半写文件。
- **写后校验**：删除后若发现 id 仍残留在 `workspace.json`（被并发写者覆盖），会自动再清一次；且**绝不**把内存数组整体写回，避免只读内存同步失败时反而把归档标记写活。

## 安装

> **分发方式**：本插件不从 npm 注册表分发，请用下面的 Git 方式安装。本包无构建步骤（`lib/` 即产物），git 安装不会触发 pnpm 的构建放行（`allowBuilds`）提示。

### 通过 Git 安装（推荐）

在 dsh 的 **设置 → 插件 → 安装插件** 对话框中粘贴：

```
github:bbpeople/dsh-archived-session-cleaner
```

命令行等价形式（`--profile` 为必填参数，取值通常是 `desktop` 或 `web`，即 `~/.dsh/profiles/` 下的目录名）：

```bash
dsh plugin --profile desktop add github:bbpeople/dsh-archived-session-cleaner
```

安装后确认 profile 的 `cordis.patch.yml` 中有这一行（`name` 必须与实际安装的包名一致）：

```yaml
- id: session-cleaner
  name: dsh-archived-session-cleaner
```

然后重启 dsh。

### 本地开发（junction 软链）

```powershell
New-Item -ItemType Junction `
  -Path "$HOME\.dsh\profiles\node_modules\dsh-archived-session-cleaner" `
  -Target "<本仓库目录>"
```

同样在 `cordis.patch.yml` 里加上上面那段配置行（此时 `name` 用 junction 的名字），然后重启 dsh。

## 使用

打开 **设置 → 插件 → 会话清理**：列表自动加载并按项目分组；顶部搜索框可按标题 / id / 项目名过滤，右侧下拉框可按项目筛选；点「刷新」重新读取。

- 「取消归档」— 把该会话移出归档集、回到普通会话列表（不删数据；若 dsh 内存里的归档集同步不到，按提示重启 dsh）
- 「删除」— 永久删除该会话（二次确认，不可恢复）
- 「全部删除」— 批量删除所有非运行中的归档会话

删除／取消归档的结果（成功／失败条数与原因）显示在列表下方。

## HTTP 接口

host 侧在 `webServer` 上注册前缀路由 `/sclean`（相对当前页面路径），供 client 侧调用：

| 方法与路径 | 说明 | 响应 |
|---|---|---|
| `GET /sclean/list` | 归档会话清单（含磁盘状态、标题、时间、项目归属） | `{ archived: [{ id, live, onDisk, diskSize, title?, at?, project?, projectId? }], projects: [{ id, title, count }], totalArchived, totalDiskSize, noProject }` |
| `POST /sclean/unarchive` | body `{ "ids": ["<会话id>", …] }` | `{ results: [{ id, ok, via?, alreadyUnarchived?, memSynced?, needsRestart?, error? }], unarchived, skipped, needsRestart }` |
| `POST /sclean/delete` | body `{ "ids": ["<会话id>", …] }` | `{ results: [{ id, ok, via?, diskRemoved?, detachedFrom?, resynced?, steps?, error? }], deleted, skipped }` |

路由按子路径分发：`POST /sclean/unarchive` 走取消归档，其余 `POST` 走删除。`title` / `at` / `project` / `projectId` 均为**可选**字段——取不到就不下发；`at` 是毫秒时间戳。

`POST` 的每一条结果都带独立状态：`via` 说明归档标记是走 `workspace-registry`（dsh 公开 API，优先）还是 `workspace-json`（旧版兜底）；`diskRemoved` 表示磁盘目录是否被删；`detachedFrom` 是从几个工作区的 `sessionIds` 中摘除；`steps` 逐项记录 `workspace` / `projcache` / `projfile` / `feedback` 四步的成败——**某一步失败不会跳过其余步骤**；`alreadyUnarchived` 表示该 id 本来就不在归档集里（幂等成功）；`needsRestart` 为 `true` 仅出现在兜底路径内存未同步时，界面需重启后才一致。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DSH_HOME` | `~/.dsh` | dsh 数据目录根；`sessions/` 与 `storages/` 都从这里解析 |

## 卸载

1. 从 profile 的 `cordis.patch.yml` 中删掉 `session-cleaner` 那一行；
2. 移除已安装的包：`dsh plugin --profile desktop remove dsh-archived-session-cleaner`（或在「设置 → 插件」里卸载）；以 junction 方式本地安装的直接删掉那个 junction；
3. 重启 dsh。

卸载插件**不会**动你的会话数据。

## 兼容性

- 客户端（`lib/client.js`）是 web 平台模块包，通过 `window.__ModuleLoader__.load` 注册，挂载到 `settings.plugins.tab` 插槽（`order: 50`，标签名「会话清理」）。
- 客户端 fiber 必须声明 `inject: ["slots"]`——新版本 dsh 只向客户端 fiber 注入已声明的服务，`slots` 属硬依赖。
- host 侧（`lib/index.js`）兼容 `webServer` 尚未就绪的情况：取不到服务时通过 `ctx.on('webServer', …)` 延迟注册路由。
- 本包无构建步骤，`lib/` 即交付产物。

## 开发说明

本包无构建步骤，`lib/` 即交付产物。提交前可用 `npm pack --dry-run` 核对会进入 tarball 的文件清单（本项目不发布到 npm，该命令仅用于核对内容）：

```bash
npm pack --dry-run
```

## License

MIT © bbpeople

---

### English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that adds a **Session Cleaner** tab under *Settings → Plugins*. It lists archived sessions grouped by project (title, last-activity time, on-disk size), with search, project filtering, unarchive and permanent delete. Deleting removes the on-disk session directory, the archived marker in `workspace.json`, the projection cache and the message-feedback entries; unarchiving only drops the archived marker.

Distributed via Git — `dsh plugin --profile <name> add github:bbpeople/dsh-archived-session-cleaner` — and not published to the npm registry. It is unrelated to the third-party `dsh-session-cleaner` package on npm.

Safety: `/sclean` enforces a same-origin check (CSRF protection) and never returns local absolute paths (the project label is a display title, the project id is a SHA-256 prefix); only sessions in the archived set can be deleted or unarchived; sessions with an unterminated turn are skipped; session ids are validated against `^[A-Za-z0-9_-]{1,128}$`; JSON edits are written atomically and verified afterwards.

Host routes: `GET /sclean/list`, `POST /sclean/unarchive`, `POST /sclean/delete`. Licensed under MIT.
