import { readdir, readFile, writeFile, rm, stat, rename } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

// ---------- 路径 ----------

const homeRoot = process.env.DSH_HOME || join(homedir(), '.dsh')

function sessionsRoot() {
  return join(homeRoot, 'sessions')
}

// ---------- 工具 ----------

const SID_RE = /^[A-Za-z0-9_-]{1,128}$/

function idValid(id) {
  return typeof id === 'string' && SID_RE.test(id)
}

const TITLE_MAX = 120

/** 归一化会话标题：压掉控制字符与换行、限制长度；非字符串返回空串。 */
function cleanTitle(value) {
  if (typeof value !== 'string') return ''
  let s = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length > TITLE_MAX) s = `${s.slice(0, TITLE_MAX - 1)}…`
  return s
}

/** 短键：把内部标识（workspace uuid 等）压成 8 位十六进制，避免把内部 id 原样发给前端。 */
function shortKey(value) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, 8)
}

/**
 * 从投影记录里取「标题 + 最近活动时间」。
 * - 聚合表条目形如 { identity, rows }；单会话投影文件形如 { version, record: { identity, rows } }
 * - 标题只取生成的短标题 rows.title，绝不使用 titleInput（完整首条输入，过长且含无关内容）
 * - 时间优先 rows.sessionListMetadata.lastPromptAt（与 dsh 会话列表显示一致），退回 identity.createdAt
 */
function metaOf(doc) {
  const holder = doc && doc.record ? doc.record : doc
  const rows = holder && holder.rows
  const identity = holder && holder.identity
  const title = cleanTitle(rows && rows.title && rows.title.val)
  let at = 0
  try {
    const meta = rows && rows.sessionListMetadata
    const last = meta ? Number(meta.lastPromptAt) : 0
    if (last > 0) at = last
  } catch { /* 忽略 */ }
  if (!at) {
    try {
      const created = identity ? new Date(identity.createdAt).getTime() : 0
      if (created > 0) at = created
    } catch { /* 忽略 */ }
  }
  return { title, at }
}

/**
 * 批量取会话元信息（标题 + 活动时间）。dsh 把信息记在投影缓存两处：
 * - storages/session_projcache.json → tables.sessions[id]（一次读盘，覆盖大多数会话）
 * - storages/session_projcache/sessions/<id>.json → record（归档较久的会话常常只留单文件）
 */
async function readSessionMetas(ids) {
  const out = new Map()
  if (!Array.isArray(ids) || ids.length === 0) return out
  let table
  try {
    const doc = JSON.parse(await readFile(join(homeRoot, 'storages', 'session_projcache.json'), 'utf8'))
    table = doc && doc.tables && doc.tables.sessions
  } catch { table = undefined }
  for (const id of ids) {
    if (table && Object.prototype.hasOwnProperty.call(table, id)) {
      const m = metaOf(table[id])
      if (m.title || m.at) out.set(id, m)
    }
  }
  for (const id of ids) {
    if (out.has(id)) continue
    try {
      const raw = await readFile(join(homeRoot, 'storages', 'session_projcache', 'sessions', `${id}.json`), 'utf8')
      const m = metaOf(JSON.parse(raw))
      if (m.title || m.at) out.set(id, m)
    } catch { /* 无单文件投影 */ }
  }
  return out
}

/**
 * 会话 → 项目 归属表（给前端按项目分组/筛选用）。取 storages/workspace.json：
 * - 项目显示名用 workspace.title，缺失时用 workspace.path 的最后一段目录名
 * - 只发显示名与 8 位短键；workspace.path 这类本机绝对路径一律不出现在响应里
 * - 归档时 dsh 不会把会话从 workspace.sessionIds 移出，所以这张表能覆盖归档会话
 */
async function readProjectIndex() {
  const out = new Map()
  let doc
  try {
    doc = JSON.parse(await readFile(join(homeRoot, 'storages', 'workspace.json'), 'utf8'))
  } catch { return out }
  const table = doc && doc.tables && doc.tables.workspaces
  if (!table || typeof table !== 'object') return out
  for (const key of Object.keys(table)) {
    const ws = table[key]
    if (!ws || typeof ws !== 'object') continue
    let title = cleanTitle(ws.title)
    if (!title && typeof ws.path === 'string') title = cleanTitle(basename(ws.path))
    if (!title) title = '未命名项目'
    const pid = shortKey(key)
    const sid = Array.isArray(ws.sessionIds) ? ws.sessionIds : []
    for (const s of sid) {
      if (typeof s === 'string' && idValid(s)) out.set(s, { id: pid, title })
    }
  }
  return out
}
/**
 * 判断会话是否「正在运行」：
 * - sessions 服务的 get 只表示本进程存在会话实例（归档后实例仍在），不能当作使用中；
 * - 真正在用 = 事件日志处于 turn/start 之后且没有 turn/end（agent 正在执行或中断）。
 * 非当前连接会话、已归档的历史会话（turn 已结束）均可安全删除。
 */
function isBusySession(sess) {
  if (!sess) return false
  try {
    const evs = sess.events
    if (!Array.isArray(evs) || evs.length === 0) return false
    let open = false
    for (const e of evs) {
      if (!e || typeof e.type !== 'string') continue
      if (e.type === 'turn/start') open = true
      else if (e.type === 'turn/end') open = false
    }
    return open
  } catch { return false }
}

/** 在 sessions 根下所有 project 目录中定位该会话目录，找不到返回 undefined。 */
async function findSessionDir(root, id) {
  let projNames = []
  try {
    projNames = await readdir(root)
  } catch { return undefined }
  for (const proj of projNames) {
    const dir = join(root, proj)
    let info
    try { info = await stat(dir) } catch { continue }
    if (!info.isDirectory()) continue
    let entries = []
    try { entries = await readdir(dir) } catch { continue }
    if (entries.includes(id)) {
      const full = join(dir, id)
      try {
        const s = await stat(full)
        if (s.isDirectory()) return full
      } catch { /* ignore */ }
    }
  }
  return undefined
}

/** 递归累加目录下常规文件大小；会话日志文件名随格式版本变化（session.v4.jsonl.zstd 等）。 */
async function dirSize(dir, depth = 0) {
  if (depth > 2) return 0
  let entries = []
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return 0 }
  let total = 0
  for (const e of entries) {
    const full = join(dir, e.name)
    try {
      if (e.isDirectory()) total += await dirSize(full, depth + 1)
      else if (e.isFile()) total += (await stat(full)).size
    } catch { /* 跳过不可读条目 */ }
  }
  return total
}

/** 读取-修改-写回 JSON 文档；文件不存在或解析失败则跳过。返回是否发生变更。 */
async function scrubJson(file, mutate) {
  let raw
  try { raw = await readFile(file, 'utf8') } catch { return false }
  let doc
  try { doc = JSON.parse(raw) } catch { return false }
  let changed = false
  try { changed = !!mutate(doc) } catch { return false }
  if (!changed) return false
  // 原子写：tmp + rename（与 dsh-storage-json 的 publish 同款，避免与存储层并发写竞争产生半写文件）
  const tmp = join(dirname(file), `.${basename(file)}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`)
  await writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8')
  await rename(tmp, file)
  return true
}

/** 从 workspace spec 中移除会话：归档集 + 各工作区 sessionIds 槽。 */
function scrubWorkspace(doc, id) {
  let changed = false
  if (Array.isArray(doc.global?.archivedSessionIds)) {
    const next = doc.global.archivedSessionIds.filter((x) => x !== id)
    if (next.length !== doc.global.archivedSessionIds.length) {
      doc.global.archivedSessionIds = next
      changed = true
    }
  }
  const tables = doc.tables?.workspaces
  if (tables && typeof tables === 'object') {
    for (const ws of Object.values(tables)) {
      if (ws && Array.isArray(ws.sessionIds) && ws.sessionIds.includes(id)) {
        ws.sessionIds = ws.sessionIds.filter((x) => x !== id)
        changed = true
      }
    }
  }
  return changed
}

/** 从投影缓存中移除会话条目：聚合 JSON（tables.sessions）+ 单文件（sessions/<id>.json）。 */
function scrubProjectionCache(doc, id) {
  const sessions = doc.tables?.sessions
  if (sessions && typeof sessions === 'object' && Object.prototype.hasOwnProperty.call(sessions, id)) {
    delete sessions[id]
    return true
  }
  return false
}

async function removeProjectionFile(id) {
  const file = join(homeRoot, 'storages', 'session_projcache', 'sessions', `${id}.json`)
  try {
    await rm(file, { force: true })
    return true
  } catch { return false }
}

/** 从消息反馈（点赞/点踩）中移除会话条目。 */
function scrubFeedback(doc, id) {
  const sessions = doc.tables?.sessions
  if (sessions && typeof sessions === 'object' && Object.prototype.hasOwnProperty.call(sessions, id)) {
    delete sessions[id]
    return true
  }
  return false
}

/**
 * 同源校验：/sclean 只接受来自 dsh 页面自身的调用。
 * 宿主 webServer 不提供服务器级认证或来源策略（见 @deepseek-ai/dsh-host-webserver 的
 * README「已知限制」），命名路由会被直接交给 handler，因此由本插件自行拦截跨源/CSRF 请求：
 * - Sec-Fetch-Site 存在时必须是 same-origin（页面自身发起的 fetch）或 none（地址栏直达）；
 * - Origin 存在时其 host 必须与请求 Host 一致；"null"（沙箱 iframe / file://）一律拒绝；
 * - 两个头都不存在（curl 等非浏览器客户端）时放行——CSRF 必须由浏览器发起，
 *   而浏览器不会省略 Origin / Sec-Fetch-Site。
 */
function sameOrigin(req) {
  const headers = (req && req.headers) || {}
  const host = headers.host
  if (typeof host !== 'string' || host === '') return false
  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') return false
  const origin = headers.origin
  if (origin === undefined) return true
  if (typeof origin !== 'string' || origin === 'null') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

// ---------- 端点 ----------

function apply(ctx) {
  // GET /sclean/list —— 归档会话清单（含磁盘状态）
  const handleList = async (req, res) => {
    const out = { archived: [] }
    try {
      const root = sessionsRoot()
      // 磁盘上现有的全部会话目录（id → { size, mtime }）
      const onDisk = new Map()
      {
        let projs = []
        try { projs = await readdir(root) } catch { /* root 不存在 */ }
        for (const proj of projs) {
          const projDir = join(root, proj)
          let st
          try { st = await stat(projDir) } catch { continue }
          if (!st.isDirectory()) continue
          let entries = []
          try { entries = await readdir(projDir) } catch { continue }
          for (const name of entries) {
            if (!idValid(name)) continue
            const full = join(projDir, name)
            try {
              const s = await stat(full)
              if (!s.isDirectory()) continue
              // 会话占用（日志文件名随格式版本变化，统一按目录递归累加）
              const size = await dirSize(full)
              onDisk.set(name, { size, mtime: s.mtimeMs, dir: full })
            } catch { /* ignore */ }
          }
        }
      }
      // 归档集（workspace spec 权威）
      const archived = Array.isArray(ctx.workspaceRegistry.archivedSessionIds)
        ? [...ctx.workspaceRegistry.archivedSessionIds]
        : []
      for (const id of archived) {
        const d = onDisk.get(id)
        const live = isBusySession(ctx.sessions.get(id))
        out.archived.push({
          id,
          live,
          onDisk: !!d,
          diskSize: d ? d.size : 0
        })
      }
      // 磁盘上有但不在归档集的会话也算展示项？不——只管归档，告诉用户总数
      const metas = await readSessionMetas(out.archived.map((it) => it.id))
      const projects = await readProjectIndex()
      for (const it of out.archived) {
        const m = metas.get(it.id)
        if (m && m.title) it.title = m.title
        if (m && m.at) it.at = m.at
        const d = onDisk.get(it.id)
        if (!it.at && d && d.mtime) it.at = Math.round(d.mtime)
        const p = projects.get(it.id)
        if (p) { it.projectId = p.id; it.project = p.title }
      }
      out.totalArchived = out.archived.length
      out.totalDiskSize = out.archived.reduce((sum, it) => sum + (it.diskSize || 0), 0)
      const byProject = new Map()
      for (const it of out.archived) {
        if (!it.projectId) continue
        const cur = byProject.get(it.projectId)
        if (cur) cur.count += 1
        else byProject.set(it.projectId, { id: it.projectId, title: it.project, count: 1 })
      }
      out.projects = [...byProject.values()].sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh'))
      out.noProject = out.archived.filter((it) => !it.projectId).length
    } catch (err) {
      out.error = String(err && err.stack || err)
    }
    const payload = JSON.stringify(out, null, 2)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(payload)
  }

  // ---- 与 dsh 存储层协作的助手 ------------------------------------------------
  // dsh 以内存快照为准持久化 workspace.json：绕开 store 直接改文件，会被下一次
  // 快照回写覆盖；直接 splice 归档数组则会因状态对象被冻结而静默失效。
  // 因此取消归档、删除都优先调用 workspaceRegistry 的公开 API。
  const registryApiAvailable = () => !!ctx.workspaceRegistry && typeof ctx.workspaceRegistry.unarchiveSession === 'function'
  const readArchivedIds = () => {
    try {
      const arr = ctx.workspaceRegistry && ctx.workspaceRegistry.archivedSessionIds
      return Array.isArray(arr) ? [...arr] : []
    } catch { return [] }
  }
  // 把会话从所有工作区的 sessionIds 里摘掉，避免删掉数据后留下指向空数据的会话行
  const detachFromWorkspaces = async (id) => {
    const reg = ctx.workspaceRegistry
    if (!reg || typeof reg.list !== 'function') return 0
    let count = 0
    for (const ws of reg.list()) {
      try {
        const ids = ws && ws.sessionIds
        if (Array.isArray(ids) && ids.includes(id) && typeof ws.detachSession === 'function') {
          await ws.detachSession(id)
          count += 1
        }
      } catch { /* 单个工作区失败不影响其余 */ }
    }
    return count
  }

  // POST /sclean/delete —— body { ids: string[] }
  const handleDelete = async (req, res) => {
    const out = { results: [] }
    try {
      let bodyText = ''
      for await (const chunk of req) bodyText += chunk
      let body = {}
      try { body = JSON.parse(bodyText || '{}') } catch { /* 默认空 */ }
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids)] : []
      const viaStore = registryApiAvailable()
      const archivedSet = new Set(readArchivedIds())
      for (const id of ids) {
        const r = { id, ok: false }
        try {
          if (!idValid(id)) throw new Error('非法会话 id')
          if (!archivedSet.has(id)) throw new Error('该会话不在归档集中，拒绝删除')
          if (isBusySession(ctx.sessions.get(id))) throw new Error('会话正在运行中（turn 未结束），拒绝删除')
          const dir = await findSessionDir(sessionsRoot(), id)
          if (dir) {
            await rm(dir, { recursive: true, force: true })
            r.diskRemoved = true
          } else {
            r.diskRemoved = false
          }
          // 各痕迹清理步骤独立 try/catch：一步失败不再跳过其余步骤，结果记入 r.steps
          r.steps = {}
          const step = async (name, fn) => {
            try { await fn(); r.steps[name] = 'ok' } catch (e) { r.steps[name] = 'failed: ' + String(e && e.message || e) }
          }
          // 1) 归档标记：优先走 store（dsh 自己落盘并广播变更），旧版没有 API 才直接改文件
          if (viaStore) {
            await step('workspace', () => ctx.workspaceRegistry.unarchiveSession(id))
          } else {
            await step('workspace', () => scrubJson(join(homeRoot, 'storages', 'workspace.json'), (doc) => scrubWorkspace(doc, id)))
          }
          // 2) 工作区登记：从 sessionIds 里摘掉该会话
          try { r.detachedFrom = await detachFromWorkspaces(id) } catch { r.detachedFrom = 0 }
          // 3) 缓存与反馈等不归 store 管的痕迹，直接清文件
          await step('projcache', () => scrubJson(join(homeRoot, 'storages', 'session_projcache.json'), (doc) => scrubProjectionCache(doc, id)))
          await step('projfile', () => removeProjectionFile(id))
          await step('feedback', () => scrubJson(join(homeRoot, 'storages', 'message_feedback.json'), (doc) => scrubFeedback(doc, id)))
          // 4) 写后校验：只处理「id 仍残留在 workspace.json」一种情况（被并发写者覆盖）
          try {
            const docNow = JSON.parse(await readFile(join(homeRoot, 'storages', 'workspace.json'), 'utf8'))
            const cur = Array.isArray(docNow.global?.archivedSessionIds) ? docNow.global.archivedSessionIds : []
            const workspaces = docNow.tables && docNow.tables.workspaces
            const stillListed = cur.includes(id) || (workspaces && typeof workspaces === 'object'
              ? Object.values(workspaces).some((w) => w && Array.isArray(w.sessionIds) && w.sessionIds.includes(id))
              : false)
            if (stillListed) {
              if (viaStore) {
                await ctx.workspaceRegistry.unarchiveSession(id)
                r.detachedFrom = (r.detachedFrom || 0) + await detachFromWorkspaces(id)
              } else {
                await scrubJson(join(homeRoot, 'storages', 'workspace.json'), (d) => scrubWorkspace(d, id))
              }
              r.resynced = true
            }
          } catch { /* 校验失败不阻断删除结果 */ }
          r.via = viaStore ? 'workspace-registry' : 'workspace-json'
          r.ok = true
        } catch (err) {
          r.error = String(err && err.message || err)
        }
        out.results.push(r)
      }
      out.deleted = out.results.filter((r) => r.ok).length
      out.skipped = out.results.length - out.deleted
    } catch (err) {
      out.error = String(err && err.stack || err)
    }
    const payload = JSON.stringify(out, null, 2)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(payload)
  }

  // POST /sclean/unarchive —— body { ids: string[] }
  // 取消归档：只把 id 从归档集移除。dsh 归档时没动 workspace.sessionIds，
  // 所以取消归档不需要补回登记。优先走 workspaceRegistry 的公开 API。
  const handleUnarchive = async (req, res) => {
    const out = { results: [] }
    try {
      let bodyText = ''
      for await (const chunk of req) bodyText += chunk
      let body = {}
      try { body = JSON.parse(bodyText || '{}') } catch { /* 默认空 */ }
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids)] : []
      const viaStore = registryApiAvailable()
      const archivedSet = new Set(readArchivedIds())
      for (const id of ids) {
        const r = { id, ok: false }
        try {
          if (!idValid(id)) throw new Error('非法会话 id')
          if (viaStore) {
            // store 的写入是 durable 的：落盘并广播变更，原生界面与本插件列表一起刷新
            await ctx.workspaceRegistry.unarchiveSession(id)
            const still = readArchivedIds().includes(id)
            r.stillArchived = still
            if (still) {
              r.error = '取消归档未生效：该会话仍在归档集中，请重试'
            } else {
              r.ok = true
              r.memSynced = true
              r.via = 'workspace-registry'
              if (!archivedSet.has(id)) r.alreadyUnarchived = true
            }
          } else {
            // 兼容没有该 API 的旧版 dsh：直接改 workspace.json，再尽力同步内存
            if (!archivedSet.has(id)) throw new Error('该会话不在归档集中')
            // scrubJson 只在 mutate 返回 true 时才落盘，所以这里必须显式报告是否发生变更
            await scrubJson(join(homeRoot, 'storages', 'workspace.json'), (doc) => {
              if (!doc || !doc.global || !Array.isArray(doc.global.archivedSessionIds)) return false
              const cur = doc.global.archivedSessionIds
              const next = cur.filter((x) => x !== id)
              if (next.length === cur.length) return false
              doc.global.archivedSessionIds = next
              return true
            })
            // 写后校验：只针对「被并发写者又加回来」这一种情况
            try {
              const docNow = JSON.parse(await readFile(join(homeRoot, 'storages', 'workspace.json'), 'utf8'))
              const cur = Array.isArray(docNow.global?.archivedSessionIds) ? docNow.global.archivedSessionIds : []
              r.stillArchived = cur.includes(id)
              if (r.stillArchived) r.error = '写入后被并发覆盖，请重试'
              else r.ok = true
            } catch { r.ok = true }
            // 内存同步（只读或冻结的数组会抛错，忽略即可）
            try {
              const mem = ctx.workspaceRegistry.archivedSessionIds
              const before = mem.length
              const mi = mem.indexOf(id)
              if (mi >= 0) mem.splice(mi, 1)
              r.memSynced = mem.length === before - (mi >= 0 ? 1 : 0)
            } catch { r.memSynced = false }
            r.via = 'workspace-json'
          }
        } catch (err) {
          r.error = String(err && err.message || err)
        }
        out.results.push(r)
      }
      out.unarchived = out.results.filter((r) => r.ok).length
      out.skipped = out.results.length - out.unarchived
      out.needsRestart = out.results.some((r) => r.ok && r.memSynced === false)
    } catch (err) {
      out.error = String(err && err.stack || err)
    }
    const payload = JSON.stringify(out, null, 2)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(payload)
  }

  const registerRoute = (target) => {
    ctx.effect(() => target.register({ kind: 'prefix', path: '/sclean', handler: (req, res) => {
      if (!sameOrigin(req)) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '跨源请求被拒绝：/sclean 只接受同源调用' }, null, 2))
        return
      }
      const url = String(req.url || '')
      const qAt = url.indexOf('?')
      const sub = (qAt >= 0 ? url.slice(0, qAt) : url).replace(/^\/sclean/, '').replace(/\/+$/, '')
      if (req.method === 'POST') {
        if (sub === '/unarchive') return handleUnarchive(req, res)
        return handleDelete(req, res)
      }
      return handleList(req, res)
    } }), 'session-cleaner: http route')
  }
  const ws = ctx.get('webServer')
  if (ws) {
    registerRoute(ws)
  } else {
    ctx.on('webServer', (sctx) => registerRoute(sctx.webServer))
  }
}

export { apply }
