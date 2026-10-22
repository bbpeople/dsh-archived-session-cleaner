import { readdir, readFile, writeFile, rm, stat, rename } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'

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

/** 从投影记录里取标题（聚合表条目在 .rows，单会话投影文件在 .record.rows）。 */
function titleOf(row) {
  const rows = row && (row.rows || (row.record && row.record.rows))
  const title = rows && rows.title
  return cleanTitle(title && title.val)
}

/**
 * 批量取会话标题。dsh 把标题记在投影缓存两处：
 * - storages/session_projcache.json → tables.sessions[id].rows.title.val（一次读盘，覆盖大多数）
 * - storages/session_projcache/sessions/<id>.json → record.rows.title.val（归档较久的会话常常只留单文件）
 * 只取 rows.title（生成的短标题），不碰 titleInput（完整首条输入，过长且含无关内容）。
 */
async function readTitles(ids) {
  const out = new Map()
  if (!Array.isArray(ids) || ids.length === 0) return out
  let table
  try {
    const doc = JSON.parse(await readFile(join(homeRoot, 'storages', 'session_projcache.json'), 'utf8'))
    table = doc && doc.tables && doc.tables.sessions
  } catch { table = undefined }
  for (const id of ids) {
    if (table && Object.prototype.hasOwnProperty.call(table, id)) {
      const t = titleOf(table[id])
      if (t) out.set(id, t)
    }
  }
  for (const id of ids) {
    if (out.has(id)) continue
    try {
      const raw = await readFile(join(homeRoot, 'storages', 'session_projcache', 'sessions', `${id}.json`), 'utf8')
      const t = titleOf(JSON.parse(raw))
      if (t) out.set(id, t)
    } catch { /* 无单文件投影 */ }
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
              // 会话文件大小（zstd 或 明文）
              let size = 0
              for (const f of ['session.jsonl.zstd', 'session.jsonl']) {
                try { size = (await stat(join(full, f))).size; break } catch { /* next */ }
              }
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
      const titles = await readTitles(out.archived.map((it) => it.id))
      for (const it of out.archived) {
        const t = titles.get(it.id)
        if (t) it.title = t
      }
      out.totalArchived = out.archived.length
    } catch (err) {
      out.error = String(err && err.stack || err)
    }
    const payload = JSON.stringify(out, null, 2)
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    res.end(payload)
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
      const archivedSet = new Set(Array.isArray(ctx.workspaceRegistry.archivedSessionIds) ? [...ctx.workspaceRegistry.archivedSessionIds] : [])
      for (const id of ids) {
        const r = { id, ok: false }
        try {
          if (!idValid(id)) throw new Error('非法会话 id')
          if (!archivedSet.has(id)) throw new Error('该会话不在归档集中，拒绝删除')
          if (isBusySession(ctx.sessions.get(id))) throw new Error('会话正在运行中（turn 未结束），拒绝删除')
          const root = sessionsRoot()
          const dir = await findSessionDir(root, id)
          if (dir) {
            await rm(dir, { recursive: true, force: true })
            r.diskRemoved = true
          } else {
            r.diskRemoved = false
          }
          // 内存归档集同步（rc.3 可能返回只读数组；失败不阻断后续步骤）
          let memSynced = false
          try {
            const mem = ctx.workspaceRegistry.archivedSessionIds
            const mi = mem.indexOf(id)
            if (mi >= 0) mem.splice(mi, 1)
            memSynced = true
          } catch { memSynced = false }
          // 各痕迹清理步骤独立 try/catch：一步失败不再跳过其余步骤，结果记入 r.steps
          r.steps = {}
          const step = async (name, fn) => {
            try { await fn(); r.steps[name] = 'ok' } catch (e) { r.steps[name] = 'failed: ' + String(e && e.message || e) }
          }
          await step('workspace', () => scrubJson(join(homeRoot, 'storages', 'workspace.json'), (doc) => scrubWorkspace(doc, id)))
          await step('projcache', () => scrubJson(join(homeRoot, 'storages', 'session_projcache.json'), (doc) => scrubProjectionCache(doc, id)))
          await step('projfile', () => removeProjectionFile(id))
          await step('feedback', () => scrubJson(join(homeRoot, 'storages', 'message_feedback.json'), (doc) => scrubFeedback(doc, id)))
          // 写后校验：只处理“id 仍残留在文件里”（被并发写者覆盖）一种情况；
          // 绝不把内存数组整体写回，避免只读内存同步失败时把归档标记复活
          try {
            const rawNow = await readFile(join(homeRoot, 'storages', 'workspace.json'), 'utf8')
            const docNow = JSON.parse(rawNow)
            const cur = Array.isArray(docNow.global?.archivedSessionIds) ? docNow.global.archivedSessionIds : []
            if (cur.includes(id)) {
              await scrubJson(join(homeRoot, 'storages', 'workspace.json'), (d) => scrubWorkspace(d, id))
              r.resynced = true
            }
          } catch { /* 校验失败不阻断删除结果 */ }
          r.memSynced = memSynced
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

  const registerRoute = (target) => {
    ctx.effect(() => target.register({ kind: 'prefix', path: '/sclean', handler: (req, res) => {
      if (!sameOrigin(req)) {
        res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: '跨源请求被拒绝：/sclean 只接受同源调用' }, null, 2))
        return
      }
      if (req.method === 'POST') return handleDelete(req, res)
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
