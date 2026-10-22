# dsh-archived-session-cleaner

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）插件：在「设置 → 插件」页新增一个 **会话清理** 标签页，列出已归档的会话并支持**永久删除**——磁盘数据、归档标记、投影缓存、消息反馈一并清理干净。

dsh 自带的删除通常只把会话移出列表，磁盘上的 `sessions/` 目录与 `storages/` 里的关联记录仍会残留。本插件用一套「先定位、再清除、后校验」的流程把这些痕迹真正抹掉，并对运行中的会话设了硬护栏。

> **关于命名**：npm 上另有一个第三方包 [`dsh-session-cleaner`](https://www.npmjs.com/package/dsh-session-cleaner)（作者 fountunt）。本包与之**没有关联**，是各自独立的实现；本包因名称已被占用而定名为 `dsh-archived-session-cleaner`。

## 功能

- 列出当前全部已归档会话，逐条展示：会话 id、磁盘占用、状态徽标
  - `磁盘数据` — 磁盘上存在会话目录
  - `仅归档标记` — 只剩归档标记，磁盘数据已不存在（幽灵条目）
  - `运行中` — turn 尚未结束，不可删除
- 支持**单个删除**与**一键删除全部归档**（自动跳过运行中的会话）
- 删除前弹二次确认，明确告知不可恢复

## 删除会清理哪些痕迹

以 `$DSH_HOME`（默认 `~/.dsh`）为根：

| 位置 | 清理内容 |
|---|---|
| `sessions/<project>/<id>/` | 整个会话数据目录 |
| `storages/workspace.json` | `global.archivedSessionIds` 中的该项，以及各 `tables.workspaces[].sessionIds` 中的该项 |
| `storages/session_projcache.json` | `tables.sessions[id]` 条目 |
| `storages/session_projcache/sessions/<id>.json` | 单会话投影文件 |
| `storages/message_feedback.json` | 该会话的点赞／点踩记录 |

## 安全护栏

发布到公共环境前值得逐条知道的行为约束：

- **`/sclean` 同源校验（CSRF 防护）**：dsh 宿主的 `webServer` 不提供服务器级认证或来源策略，命名路由会被直接交给 handler；因此本插件自行校验来源——`Sec-Fetch-Site` 存在时必须是 `same-origin` 或 `none`，`Origin` 存在时其 host 必须与请求 `Host` 一致，`Origin: null` 一律拒绝。跨源请求返回 `403`。
  - **已知限制**：该校验拦的是**跨源 CSRF**；**DNS rebinding 不在覆盖范围内**——攻击者域名解析到本机时，其 `Host` 与 `Origin` 彼此自洽，仅凭请求头无法与正常访问区分。若要防这一类，必须依赖外层访问控制。
  - **若把 dsh 绑定到非回环地址，请自行在外层加访问控制**（宿主不会代劳）。
- **不返回本机绝对路径**：`GET /sclean/list` 只返回会话 id、状态与占用大小，不含目录路径。
- **只删归档集内的会话**：id 不在 `global.archivedSessionIds` 中一律拒绝，避免误删活跃会话。
- **运行中的会话拒绝删除**：判定依据是事件日志——最后一个 `turn/start` 之后没有 `turn/end`，即视为 agent 正在执行或已中断，直接跳过。仅凭 `sessions.get(id)` 是否存在**不**作为「使用中」判据（归档后实例仍在，会造成误判）。
- **会话 id 白名单**：`^[A-Za-z0-9_-]{1,128}$`，杜绝路径穿越。
- **原子写**：JSON 痕迹采用「写临时文件 + `rename`」，与存储层并发写竞争时不会产生半写文件。
- **写后校验**：删除后若发现 id 仍残留在 `workspace.json`（被并发写者覆盖），会自动再清一次；且**绝不**把内存数组整体写回，避免只读内存同步失败时反而把归档标记写活。

## 安装

### 从 npm 安装

```bash
npm install dsh-archived-session-cleaner
```

然后在 profile 的 `cordis.patch.yml` 中增加一行（`name` 必须与实际安装的包名一致）：

```yaml
- id: session-cleaner
  name: dsh-archived-session-cleaner
```

### 本地开发（junction 软链）

```powershell
New-Item -ItemType Junction `
  -Path "$HOME\.dsh\profiles\node_modules\dsh-archived-session-cleaner" `
  -Target "<本仓库目录>"
```

同样在 `cordis.patch.yml` 里加上上面那段配置行（此时 `name` 用 junction 的名字），然后重启 dsh。

## 使用

打开 **设置 → 插件 → 会话清理**：列表会自动加载，点「刷新」重新读取；选中条目点「删除」，或点「删除全部归档」批量清理。删除结果（成功／失败条数与原因）会显示在列表下方。

## HTTP 接口

host 侧在 `webServer` 上注册前缀路由 `/sclean`（相对当前页面路径），供 client 侧调用：

| 方法与路径 | 说明 | 响应 |
|---|---|---|
| `GET /sclean/list` | 归档会话清单（含磁盘状态） | `{ archived: [{ id, live, onDisk, diskSize }], totalArchived }` |
| `POST /sclean/delete` | body `{ "ids": ["<会话id>", …] }` | `{ results: [{ id, ok, error?, diskRemoved?, memSynced?, resynced?, steps? }], deleted, skipped }` |

`POST` 的每一条结果都带独立状态：`diskRemoved` 表示磁盘目录是否被删；`steps` 逐项记录 `workspace` / `projcache` / `projfile` / `feedback` 四步的成败——**某一步失败不会跳过其余步骤**。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DSH_HOME` | `~/.dsh` | dsh 数据目录根；`sessions/` 与 `storages/` 都从这里解析 |

## 卸载

1. 从 profile 的 `cordis.patch.yml` 中删掉 `session-cleaner` 那一行；
2. 删除 `profiles/node_modules/dsh-archived-session-cleaner` 这个 junction（或 `npm uninstall dsh-archived-session-cleaner`）；
3. 重启 dsh。

卸载插件**不会**动你的会话数据。

## 兼容性

- 客户端（`lib/client.js`）是 web 平台模块包，通过 `window.__ModuleLoader__.load` 注册，挂载到 `settings.plugins.tab` 插槽（`order: 50`，标签名「会话清理」）。
- 客户端 fiber 必须声明 `inject: ["slots"]`——新版本 dsh 只向客户端 fiber 注入已声明的服务，`slots` 属硬依赖。
- host 侧（`lib/index.js`）兼容 `webServer` 尚未就绪的情况：取不到服务时通过 `ctx.on('webServer', …)` 延迟注册路由。
- 本包无构建步骤，`lib/` 即发布产物。

## 开发说明

```bash
# 检查将要发布的文件清单（不会真正发布）
npm pack --dry-run
```

## License

MIT © bbpeople

---

### English

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that adds a **Session Cleaner** tab under *Settings → Plugins*. It lists archived sessions and permanently deletes them, removing the on-disk session directory, the archived marker in `workspace.json`, the projection cache and the message-feedback entries.

Published as `dsh-archived-session-cleaner`; it is unrelated to the third-party `dsh-session-cleaner` package on npm.

Safety: `/sclean` enforces a same-origin check (CSRF protection) and never returns local absolute paths; only sessions in the archived set can be deleted; sessions with an unterminated turn are skipped; session ids are validated against `^[A-Za-z0-9_-]{1,128}$`; JSON edits are written atomically and verified afterwards.

Host routes: `GET /sclean/list`, `POST /sclean/delete`. Licensed under MIT.
