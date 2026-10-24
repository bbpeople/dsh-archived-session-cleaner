# Changelog

本文件记录本项目的所有重要变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.2.9] - 2026-10-24

### 修复

- **归档中的会话删不掉**：只要这个会话在本轮 dsh 进程里被打开过（`GET /sclean/list` 里 `inMemory: true`），dsh 就会一直把它留在内存的会话表里；磁盘删掉之后它会随持久化刷盘或重新加载回到会话列表，看起来就是「删了还在」。1.2.8 里 evict 被「有 agent 就不摘」的条件挡住了，等于没生效。
- 现在删除会**先摘 agent 登记、再摘会话登记**（都用 `entry.detach()` —— 与各自属主 dispose 时完全同一条路径），然后才动磁盘文件；两条登记都摘不干净时**直接拒绝删除**并说明原因（第一个错误就是「这个会话还被 dsh 进程持有，关闭它或重启 dsh 后再删」），不再留下「磁盘已删、内存仍在」的半吊子状态。
## [1.2.8] - 2026-10-24

### 修复

- **删除后会话「复活」**（删完又出现在会话列表的「未分组」里）：dsh 的持久化层在会话被 disposed 时会把缓冲区里的实时事件**刷盘**（`dsh-session-persistence-jsonl` 的 `writer.close()` 先 `drainLive()` 再关句柄），原来的实现先删目录、后摘实例，刷盘就把目录又写了回来。现在删除顺序改成：① 先把会话从进程内的会话表摘掉（等价「关闭会话」，`entry.detach()`；有 agent 挂着的会话直接拒绝，避免影响在用的会话）② 等它落完盘 ③ 再删磁盘目录（失败等 400ms 重试一次）④ 清理归档标记 / 工作区登记 / 投影缓存 / 反馈记录 ⑤ 最后兜底再查一次目录是否被写回来，是就再清一次。
- 摘不掉内存实例时（dsh 内部结构变化等情况）结果里会带 `needsRestart`，界面提示「重启 dsh 后会从会话列表消失」，不再静默留下幽灵条目。

### 变更

- `GET /sclean/list` 每条记录新增 `inMemory` 字段（该会话是否还活在 dsh 进程的会话表里）；「仅归档标记」徽标的悬停说明区分「磁盘已无数据」与「实例仍在内存、重启即消失」。
## [1.2.7] - 2026-10-24

### 修复

- **确认弹窗可能不生效**：1.2.6 的弹窗依赖 dsh web 端共享模块 `@deepseek-ai/dsh-client-ui-primitives`，一旦该模块取不到就静默退回系统 `window.confirm`，看到的还是老弹窗。现在弹窗改由插件自绘，只用 `react` + `react-dom`（`createPortal` 挂到 `document.body`，避免被设置面板裁剪），不再依赖 dsh 内部模块表，任何版本都能显示。
- 顺带修好上一版补丁把 `var module = { exports: {} };` 挤到同一行的问题。

### 变更

- 自绘弹窗的几何与配色照搬 dsh 自带 `Modal` / `Button`：`--dsw-radius-panel` 圆角、`--dsw-alias-bg-layer-2` 底、`--dsw-elevation-prominent` 阴影、遮罩 `--dsw-alias-bg-mask-1` + 模糊、36px 高按钮（`--dsw-radius-md`、14px 字号）、「取消」toolbar 灰底 + `esc` 提示、「删除」危险色实心 + 白字。
- 交互：Esc 取消、点遮罩取消、默认焦点落在「删除」（Enter 直接确认）、删除中按钮禁用并显示「删除中…」。
## [1.2.6] - 2026-10-24

### 变更

- 删除确认不再用系统 `window.confirm`（那个 Electron 原生确认框样式与 dsh 界面不搭），改为调用 dsh web 端共享模块 `@deepseek-ai/dsh-client-ui-primitives` 的 `Modal` + `Button`：遮罩、Esc 取消、点击遮罩关闭、焦点陷阱与焦点归还都是原生行为。
- 弹窗按钮按原生规格：「取消」用 toolbar 变体（浅灰填充）并在右侧带 `esc` 提示；「删除」用 primary 几何 + 危险色填充（`--dsw-alias-state-error-primary`），默认焦点落在「删除」上，Enter 即确认；右上角关闭按钮按设计稿隐藏（Esc / 遮罩仍可取消）。
- 单个与批量删除分别措辞：标题「删除这个归档会话？」／「删除这 N 个归档会话？」，说明里写明「磁盘数据与关联记录会被彻底清除，删除后无法恢复」。
- 取不到 primitives 的旧版本 dsh 自动退回 `window.confirm`，功能不受影响。

## [1.2.5] - 2026-10-23

### 变更

- 左侧导航里的分区名由「会话清理」改为「已归档会话」，页内大标题同步改名（与 dsh 自带分区一样，导航名与页内标题保持一致）。
- 换掉外壳默认回落的「设置」齿轮图标：dsh 的左侧导航图标是按注册 id 硬编码的（`account` / `models` / `agent-presets` / `plugins` / `archived-sessions`），注册项也没有 icon 选项；插件保留自己的 id，改为隐藏齿轮、插入一枚 dsh 同款「归档箱」图标（16px 轮廓、stroke 1.3），并用 `MutationObserver` 在设置面板重渲染后自动重打补丁（失败则静默退回默认图标）。
- 图标补丁与分区注册一起挂在 `ctx.effect` 生命周期上，插件停用/重载时撤销 observer。

## [1.2.4] - 2026-10-23

### 变更

- 「会话清理」不再嵌在「设置 → 内置插件」的标签页里，改为**设置左侧导航栏里的独立分区**（注册到 `settings.section` 插槽，`order: 16`，排在「内置插件」之后）：打开设置左侧一列直接可见，少一次点击。
- 页面结构对齐 dsh 自带分区：18px 标题 + 右侧会话数胶囊，标题下方 13px 说明行（共 N 个会话 · 磁盘占用 · 筛选后 M 个），「刷新」「删除全部」两枚按钮移到标题右侧。
- 列表去掉内嵌滚动条（整页跟随设置面板滚动），空态/加载态不再重复标题，只保留一行提示；分组卡片、徽标、搜索与项目筛选保持不变。

## [1.2.3] - 2026-10-23

### 修复

- 「已归档的会话」标题、项目名、时间等文字在 Claude Style 主题下偏暗、几乎看不清：样式不再依赖未定义的 `--dsh-*` 变量，改为全部走 dsh 设计令牌 `--dsw-alias-*`，跟随主题明暗自动取色。

### 变更

- 头部重排：标题右侧加会话数胶囊徽标，统计行改为「共 N 个会话 · 磁盘占用 X · 筛选后 M 个」；「刷新」带图标，读取中图标旋转。
- 分组头显示组内会话数与整组磁盘占用，行内元信息用 3px 圆点分隔（时间 · 会话 ID · 大小），会话 ID 用等宽字体。
- 状态徽标改为圆形胶囊：磁盘数据（蓝）、仅归档标记（黄）、运行中（红）；行内操作调整为「取消归档」+ 红色文字「删除」。
- 搜索框内嵌放大镜图标，聚焦改用 dsh 焦点环；空状态、加载态、筛选无结果统一为居中提示卡，筛选无结果附「清除筛选条件」按钮。
- 内容宽度 760px 与设置页其他分区对齐；窄屏（≤560px）自动换行。

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