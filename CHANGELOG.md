# Changelog

本文件记录本项目的所有重要变更，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
