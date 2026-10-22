# Changelog

本文件记录本项目的所有重要变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.2.2] - 2026-10-23

### 修复

- **无法通过插件管理器安装**：此前包里没有组合包 patch、`package.json` 也未声明 `dsh.bundle`，插件管理器在检查阶段会以 `not-a-bundle` 拒绝 `github:` / 本地目录安装（只能手工 junction + 手改 profile）。现在仓库根新增 `cordis.patch.yml`（把 `session-cleaner` 行插入 roster），`package.json` 增加 `dsh.bundle.patch`，安装后由组合包自动注册插件行。
- `files` 加入 `cordis.patch.yml`，保证打包时带上组合包 patch。

### 变更

- README 安装/卸载章节按组合包方式重写：插件页粘贴 `github:bbpeople/dsh-archived-session-cleaner` 或 `dsh plugin --profile <name> add ...` 即可，本地开发可用 `link:`。

## [1.2.1] - 2026-10-23

### 修复

- **「取消归档」点了没反应**（dsh 0.2.1-rc.2 上必现）：此前插件直接改写 `storages/workspace.json`、并试图 `splice` 内存里的归档数组，但 dsh 是以**内存快照**为准持久化这个文件的，而 `archivedSessionIds` 返回的是**冻结数组**——文件改动会被下一次快照回写覆盖，内存修改静默失败，于是界面上一切正常、会话却仍留在归档里。现在取消归档与删除都**优先调用 `workspaceRegistry.unarchiveSession(id)`**，由 dsh 自己更新内存并落盘（幂等，无副作用）；仅当宿主没有该 API 时才回退到直接改文件，并在响应里用 `via` 说明走了哪条路径。
- **磁盘占用恒显示 `0 B`**：会话日志的真实路径是 `sessions/<project>/<sessionId>/session.v4.jsonl.zstd`，旧代码只累加目录里扁平文件的 `size`，没有递归子目录，于是永远统计到 0。改为递归求和（深度上限 2，跳过读不到的条目）。

### 变更

- `POST /sclean/unarchive` 每条结果新增 `via`（`workspace-registry` | `workspace-json`）与 `alreadyUnarchived`（该 id 本来就不在归档集里时为 `true`，仍返回 `ok: true`）；`needsRestart` 现在只在兜底路径确实同步不了内存时才为 `true`，走 store 时总为 `false`，`memSynced` 同理。
- `POST /sclean/delete` 每条结果新增 `via`、`detachedFrom`（从几个工作区的 `sessionIds` 中摘除了该会话）与 `steps`（`workspace` / `projcache` / `projfile` / `feedback` 四步各自成败）；删除成功后还会调用工作区的 `detachSession`，避免留下指向已删数据的会话行。
- 删除后的写后校验收窄为「id 仍残留在 `workspace.json`」这一种并发覆盖情形，命中时会再调一次 store 或再清一次文件，结果里带 `resynced: true`。
- 客户端提示语随 `via` / `alreadyUnarchived` / `needsRestart` 变化：走 store 时提示「会话已回到会话列表」，命中幂等分支时提示「该会话已不在归档集中」，只有兜底且内存未同步时才提示重启。

## [1.2.0] - 2026-10-23

### 新增

- 界面形态对齐 dsh 自带的「已归档的聊天」页：**按项目分组**（组头显示项目名与「N 个会话」，组内每行之间用分隔线），每行显示**会话标题 + 最近活动时间 + 短会话 id**。
- **取消归档**：每行新增「取消归档」按钮，把会话移出归档集（只从 `workspace.json` 的 `global.archivedSessionIds` 移除该 id，不删任何数据，也不改动 `tables.workspaces[].sessionIds`——归档时 dsh 本来就没有把它移出）。
- **搜索框**：按标题 / 会话 id / 项目名即时过滤。
- **项目筛选下拉**：默认「全部项目」，可只看某个项目。
- 顶部统计行：归档总数、磁盘占用合计；筛选时附「已筛选出 N 个」。
- 分组为空时区分两种空态：「没有归档会话」与「没有符合搜索/筛选条件的会话」。

### 变更

- `GET /sclean/list` 的条目新增可选字段 `at`（最近活动时间，毫秒时间戳）、`project`（项目显示名）、`projectId`（项目 8 位短键）；响应新增 `projects`（项目清单与计数）、`totalDiskSize`、`noProject`。
- 时间取值优先级：`rows.sessionListMetadata.lastPromptAt`（与 dsh 列表一致）→ `identity.createdAt` → 会话目录 mtime。
- 项目名取 `tables.workspaces[*].title`，缺失时用 `path` 的最后一段目录名；`projectId` 取 workspace id 的 SHA-256 前 8 位，**不发送 workspace id 原文**。
- 新增 `POST /sclean/unarchive`；`/sclean` 前缀路由改为**按子路径分发**（此前任意 `POST` 都按删除处理）。
- 列表请求在解析投影缓存时同时取出标题与时间，聚合表命中后不再重复读单文件。

### 安全

- 取消归档与删除共用同源校验、会话 id 白名单、原子写与写后校验；取消归档不触碰任何会话数据。
- 响应仍不含任何本机绝对路径；项目只以显示名与 8 位短键出现。

## [1.1.0] - 2026-10-23

### 新增

- 列表项优先显示**会话标题**（此前只显示会话 id）。标题取自 dsh 的投影缓存，两条来源依次尝试：先查聚合文件 `storages/session_projcache.json` 的 `tables.sessions[id].rows.title.val`（一次读盘覆盖多数会话），未命中再查单会话投影文件 `storages/session_projcache/sessions/<id>.json` 的 `record.rows.title.val`（归档较久的会话常常只留该文件）；两者都没有时回退显示会话 id。
- 标题归一化：压掉换行/制表/控制字符与多余空白，超过 120 字符截断并加省略号。
- 只读取生成标题 `rows.title`，**不读取** `titleInput`（完整首条输入，过长且含无关内容）。
- 单条删除的二次确认弹窗带上会话标题，便于核对删除对象。

### 变更

- `GET /sclean/list` 的每个条目新增**可选**字段 `title`；取不到标题时不返回该字段，便于前端区分「无标题」与「空标题」。
- 响应依旧不含任何本机绝对路径（`dirPath` 未回归）。


## [1.0.0] - 2026-10-22

首个发布版本。

> 包名说明：本包原拟名 `dsh-session-cleaner`，该名称已被第三方包占用，为避免混淆改用 `dsh-archived-session-cleaner`；功能与命名无关。

### 分发

- 通过 Git 仓库分发：`dsh plugin --profile <profile 名> add github:bbpeople/dsh-archived-session-cleaner`，或在「设置 → 插件」的安装对话框中粘贴该地址。
- 不发布到 npm 注册表，因此没有 npm 版本记录；`package.json` 中面向 npm 发布的 `publishConfig` 字段已移除。

### 新增

- **设置 → 插件 → 会话清理** 标签页：列出全部已归档会话，展示会话 id、磁盘占用与状态徽标（磁盘数据／仅归档标记／运行中）。
- 单个删除与「删除全部归档」批量删除，运行中的会话自动跳过。
- 删除前的二次确认弹窗，明确提示不可恢复。
- host 侧 HTTP 路由：`GET /sclean/list`、`POST /sclean/delete`。
- 四步痕迹清理：会话目录、`workspace.json`（归档集 + 各工作区 `sessionIds`）、投影缓存（聚合 JSON + 单文件）、消息反馈记录。
- 写后校验与自动补清，避免并发写者覆盖导致归档标记残留。

### 安全

- **`/sclean` 同源校验**：拒绝跨源与 CSRF 调用——校验 `Sec-Fetch-Site`（存在时必须是 `same-origin` 或 `none`）与 `Origin`（存在时其 host 必须与请求 `Host` 一致，`Origin: null` 一律拒绝）。dsh 宿主的 `webServer` 不提供服务器级认证或来源策略，故由本插件自行拦截。
- **不再向接口调用方返回本机绝对路径**：`GET /sclean/list` 的响应移除了 `dirPath` 字段（前端从未使用该字段）。
- 仅允许删除归档集内的会话，非归档一律拒绝。
- 基于事件日志判定 turn 是否结束，运行中的会话拒绝删除。
- 会话 id 白名单校验（`^[A-Za-z0-9_-]{1,128}$`），防止路径穿越。
- JSON 痕迹原子写（临时文件 + `rename`）。
