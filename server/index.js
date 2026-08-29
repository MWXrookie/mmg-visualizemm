/**
 * MMG_VisualizeMM 后端服务
 * - 静态托管前端构建产物 (web/dist)
 * - AI 中继：/api/test-key 与 /api/chat（BYOK：Key 由浏览器传入，服务器不持久化）
 * 启动：node --use-system-ca server/index.js
 */
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { createRequire } from 'module'
import ExcelJS from 'exceljs'

// pdf-parse 2.x：导出 { PDFParse } 类（ESM 下用 createRequire 加载）
const require = createRequire(import.meta.url)
const pdfParseMod = require('pdf-parse')
const { PDFParse } = pdfParseMod

/** 解析 PDF 提取文本（pdf-parse 2.x API；解析完销毁实例，避免连续上传累积 pdfjs 文档对象） */
async function parsePdfText(buffer) {
  const parser = new PDFParse({ data: buffer })
  try {
    await parser.load()
    const result = await parser.getText()
    return (result && result.text) || ''
  } finally {
    await parser.destroy().catch(() => {})
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3088

app.disable('x-powered-by') // 隐藏 Express 版本号
app.use(express.json({ limit: '30mb' })) // base64 上传放大 ~33%，30mb ≈ 20MB 文件

/* ---------- AI 中继 ---------- */

// 归一化 baseUrl：允许用户填 https://api.deepseek.com、带 /v1 或完整 /chat/completions 端点
function normalizeBase(baseUrl) {
  const u = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!u) return null
  return u.replace(/\/chat\/completions$/, '') // 去掉完整端点后缀，由调用方统一拼 /chat/completions
}

async function callChat({ baseUrl, apiKey, model, messages, maxTokens }) {
  const base = normalizeBase(baseUrl)
  if (!base || !apiKey || !model) {
    const err = new Error('缺少 baseUrl / apiKey / model')
    err.code = 'BAD_CONFIG'
    throw err
  }
  const url = `${base}/chat/completions`
  const body = {
    model,
    messages,
    max_tokens: maxTokens || 2048,
    temperature: 0.4,
    stream: false,
  }
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    })
  } catch (e) {
    const err = new Error(`网络请求失败：${e.message}`)
    err.code = 'NETWORK'
    throw err
  }
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* ignore */ }

  if (!res.ok) {
    const err = new Error(formatError(res.status, json, text))
    err.code = statusToCode(res.status)
    err.status = res.status
    throw err
  }
  if (!json || !json.choices || !json.choices[0]) {
    const err = new Error('模型返回格式异常')
    err.code = 'BAD_RESPONSE'
    throw err
  }
  return {
    content: json.choices[0].message?.content ?? '',
    model: json.model,
    usage: json.usage || null,
  }
}

function statusToCode(status) {
  if (status === 401 || status === 403) return 'INVALID_KEY'
  if (status === 402 || status === 429) return 'QUOTA'
  if (status === 404) return 'NOT_FOUND'
  return 'MODEL_ERROR'
}

function formatError(status, json, text) {
  const msg = json?.error?.message || json?.message || text?.slice(0, 200) || `HTTP ${status}`
  const map = {
    401: 'API Key 无效或已过期',
    403: '无权访问（Key 权限不足）',
    402: '余额不足或需要充值',
    429: '请求过于频繁或额度受限，请稍后再试',
    404: '接口地址或模型不存在（检查 Base URL 与模型名）',
  }
  return `${map[status] || `请求失败（HTTP ${status}）`}：${msg}`
}

app.post('/api/test-key', async (req, res) => {
  const { baseUrl, apiKey, model } = req.body || {}
  try {
    const r = await callChat({
      baseUrl, apiKey, model: model || 'qwen-plus',
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 5,
    })
    res.json({ ok: true, message: '连接成功', model: r.model })
  } catch (e) {
    res.status(400).json({ ok: false, code: e.code, message: e.message })
  }
})

app.post('/api/chat', async (req, res) => {
  const { baseUrl, apiKey, model, messages } = req.body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, message: 'messages 不能为空' })
  }
  try {
    const r = await callChat({ baseUrl, apiKey, model, messages })
    res.json({ ok: true, content: r.content, model: r.model })
  } catch (e) {
    res.status(400).json({ ok: false, code: e.code, message: e.message })
  }
})

/* ---------- AI 流式中继（SSE，首字 <3s 验收项） ---------- */

app.post('/api/chat/stream', async (req, res) => {
  const { baseUrl, apiKey, model, messages } = req.body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, message: 'messages 不能为空' })
  }
  const base = normalizeBase(baseUrl)
  if (!base || !apiKey || !model) {
    return res.status(400).json({ ok: false, code: 'BAD_CONFIG', message: '缺少 baseUrl / apiKey / model' })
  }
  const controller = new AbortController()
  // 客户端断开（而非请求体读完）时才中止上游请求
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: 2048, temperature: 0.4, stream: true }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
    })
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => '')
      let json = null
      try { json = text ? JSON.parse(text) : null } catch { /* ignore */ }
      const err = new Error(formatError(upstream.status, json, text))
      err.code = statusToCode(upstream.status)
      throw err
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') continue
        try {
          const obj = JSON.parse(data)
          const delta = obj.choices?.[0]?.delta?.content ?? ''
          if (delta) res.write(`data: ${JSON.stringify({ delta })}\n\n`)
        } catch { /* 忽略无法解析的 chunk */ }
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    res.end()
  } catch (e) {
    if (!res.headersSent) {
      return res.status(400).json({ ok: false, code: e.code, message: e.message })
    }
    // 已开始流式输出：以 SSE error 事件告知前端（保留已展示的部分内容）
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`)
    res.end()
  }
})

/* ---------- 文件解析 ---------- */

const MAX_ROWS = 100 // 表格最多解析前 100 行

function looksLikeHeader(row) {
  // 表头通常是短文本且非纯数字；空行不算
  if (!row || row.length === 0) return false
  const nonEmpty = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== '')
  if (nonEmpty.length === 0) return false
  const strCells = nonEmpty.filter((c) => isNaN(Number(c)))
  return strCells.length > 0
}

function normalizeCell(v) {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    // exceljs 富文本（如 SiO₂ 下标）、公式结果等
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text ?? '').join('')
    if (v.result !== undefined) return String(v.result)
    if (v.text !== undefined) return String(v.text)
    if (v.hyperlink !== undefined) return String(v.hyperlink)
    return JSON.stringify(v)
  }
  return String(v)
}

async function parseXlsx(buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const sheets = []
  for (const ws of wb.worksheets) {
    if (!ws.actualRowCount) continue
    const raw = []
    ws.eachRow({ includeEmpty: true }, (row) => {
      if (raw.length >= MAX_ROWS + 5) return
      raw.push(row.values.slice(1).map(normalizeCell))
    })
    if (raw.length === 0) continue
    // 第一行是表头（含文本）则作为 headers，否则自动列名
    let headers, rows
    if (looksLikeHeader(raw[0])) {
      headers = raw[0].map((h, i) => (String(h).trim() === '' ? `列${i + 1}` : String(h).trim()))
      rows = raw.slice(1).slice(0, MAX_ROWS)
    } else {
      headers = raw[0].map((_, i) => `列${i + 1}`)
      rows = raw.slice(0, MAX_ROWS)
    }
    rows = rows.filter((r) => r.some((c) => c.trim() !== ''))
    sheets.push({ name: ws.name, headers, rows, totalRows: ws.actualRowCount })
  }
  if (sheets.length === 0) return { ok: false, error: '表格为空' }
  // 兼容单表：展开第一个 sheet 字段；多表通过 sheets 提供
  return {
    ok: true,
    type: 'table',
    sheets,
    name: sheets[0].name,
    headers: sheets[0].headers,
    rows: sheets[0].rows,
    totalRows: sheets[0].totalRows,
  }
}

function parseCsv(text) {
  // 剥离 UTF-8 BOM（Excel 导出的 CSV 常带，会导致首列表头出现 \uFEFF）
  text = text.replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { ok: false, error: 'CSV 为空' }
  const split = (line) => {
    // 简单 CSV 拆分（支持引号包裹的逗号与转义引号 ""）
    const out = []
    let cur = ''
    let inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++ }
        else inQ = !inQ
      } else if (ch === ',' && !inQ) { out.push(cur); cur = '' }
      else cur += ch
    }
    out.push(cur)
    return out.map((c) => c.trim())
  }
  const raw = lines.map(split)
  let headers, rows
  if (looksLikeHeader(raw[0])) {
    headers = raw[0].map((h, i) => (h === '' ? `列${i + 1}` : h))
    rows = raw.slice(1).slice(0, MAX_ROWS)
  } else {
    headers = raw[0].map((_, i) => `列${i + 1}`)
    rows = raw.slice(0, MAX_ROWS)
  }
  return { ok: true, type: 'table', headers, rows, totalRows: raw.length }
}

app.post('/api/parse', async (req, res) => {
  const { name, data } = req.body || {}
  if (!name || !data) return res.status(400).json({ ok: false, message: '缺少文件名或数据' })
  const ext = path.extname(name).toLowerCase()
  let buf
  try {
    buf = Buffer.from(data, 'base64')
  } catch {
    return res.status(400).json({ ok: false, message: '数据格式错误' })
  }
  try {
    if (ext === '.xls') {
      // ExcelJS 仅支持 .xlsx；旧版 .xls 给出可操作提示而非 500
      return res.status(400).json({ ok: false, message: '暂不支持旧版 .xls 格式：请用 Excel/WPS 将文件「另存为 .xlsx」或转存 CSV 后重试' })
    }
    if (ext === '.xlsx') {
      const r = await parseXlsx(buf)
      if (!r.ok) return res.status(400).json({ ok: false, message: r.error })
      return res.json({ ok: true, ...r, name })
    }
    if (ext === '.csv') {
      const r = parseCsv(buf.toString('utf-8'))
      if (!r.ok) return res.status(400).json({ ok: false, message: r.error })
      return res.json({ ok: true, ...r, name })
    }
    if (ext === '.pdf') {
      const text = (await parsePdfText(buf)).trim()
      if (!text) return res.status(400).json({ ok: false, message: 'PDF 未能提取到文本（可能是扫描件，暂不支持 OCR）' })
      return res.json({ ok: true, type: 'text', text: text.slice(0, 20000), name })
    }
    if (ext === '.txt' || ext === '.md') {
      const text = buf.toString('utf-8').trim()
      return res.json({ ok: true, type: 'text', text: text.slice(0, 20000), name })
    }
    return res.status(400).json({ ok: false, message: `暂不支持 ${ext} 格式（支持 xlsx/csv/pdf/txt）` })
  } catch (e) {
    console.error('[parse] error', e)
    res.status(500).json({ ok: false, message: `解析失败：${e.message}` })
  }
})

/* ---------- 工作区存储（三台共用数据层，SQLite，零依赖 node:sqlite） ---------- */
import { DatabaseSync } from 'node:sqlite'

const dataDir = path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(path.join(dataDir, 'mmg.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    title TEXT DEFAULT '',
    problem_text TEXT DEFAULT '',
    attachments TEXT DEFAULT '[]',
    breakdown TEXT DEFAULT '[]',
    code TEXT DEFAULT '',
    created_at INTEGER,
    updated_at INTEGER
  )
`)

function parseJsonField(s) {
  try { return JSON.parse(s || '[]') } catch { return [] }
}

// 列表（不含正文，轻量）
app.get('/api/workspaces', (_req, res) => {
  try {
    const rows = db.prepare('SELECT id, title, updated_at FROM workspaces ORDER BY updated_at DESC').all()
    res.json({ ok: true, workspaces: rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })) })
  } catch (e) {
    res.status(500).json({ ok: false, message: `读取失败：${e.message}` })
  }
})

// 新建/更新（部分更新：只覆盖 body 中出现的字段，其余保留）
app.post('/api/workspaces', (req, res) => {
  try {
    const b = req.body || {}
    const id = typeof b.id === 'string' && b.id ? b.id : `ws-${Date.now()}`
    const now = Date.now()
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k)
    const merged = {
      title: has('title') ? String(b.title ?? '') : (existing?.title ?? ''),
      problem_text: has('problemText') ? String(b.problemText ?? '') : (existing?.problem_text ?? ''),
      attachments: has('attachments') ? JSON.stringify(Array.isArray(b.attachments) ? b.attachments : []) : (existing?.attachments ?? '[]'),
      breakdown: has('breakdown') ? JSON.stringify(Array.isArray(b.breakdown) ? b.breakdown : []) : (existing?.breakdown ?? '[]'),
      code: has('code') ? String(b.code ?? '') : (existing?.code ?? ''),
    }
    const createdAt = existing ? existing.created_at : now
    db.prepare(`
      INSERT INTO workspaces (id, title, problem_text, attachments, breakdown, code, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, problem_text=excluded.problem_text,
        attachments=excluded.attachments, breakdown=excluded.breakdown,
        code=excluded.code, updated_at=excluded.updated_at
    `).run(id, merged.title, merged.problem_text, merged.attachments, merged.breakdown, merged.code, createdAt, now)
    res.json({ ok: true, id })
  } catch (e) {
    res.status(500).json({ ok: false, message: `保存失败：${e.message}` })
  }
})

// 读取单个
app.get('/api/workspaces/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ ok: false, message: '工作区不存在' })
    res.json({
      ok: true,
      workspace: {
        id: row.id,
        title: row.title,
        problemText: row.problem_text,
        attachments: parseJsonField(row.attachments),
        breakdown: parseJsonField(row.breakdown),
        code: row.code,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    })
  } catch (e) {
    res.status(500).json({ ok: false, message: `读取失败：${e.message}` })
  }
})

// 删除
app.delete('/api/workspaces/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ ok: false, message: `删除失败：${e.message}` })
  }
})

/* ---------- 健康检查 ---------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'mmg-visualizemm', time: new Date().toISOString() })
})

/* ---------- 静态托管 ---------- */
const distDir = path.join(__dirname, '..', 'web', 'dist')
if (fs.existsSync(distDir)) {
  // Vite 产物带内容指纹，可长缓存；index.html 与 SPA 回退页不缓存
  app.use(express.static(distDir, {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
    },
  }))
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(distDir, 'index.html'))
  })
  console.log(`[static] 托管 ${distDir}`)
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .send('<h3>MMG_VisualizeMM 后端已运行</h3><p>前端未构建：先执行 <code>npm run build</code>，或开发时运行 <code>npm run dev</code>（Vite 代理到本服务）。</p>')
  })
}

/* ---------- 错误处理（413 超大请求体返回 JSON 而非默认 HTML） ---------- */
app.use((err, _req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ ok: false, code: 'TOO_LARGE', message: '文件过大：单次上传请控制在 20MB 以内（可将大表拆分为多个附件）' })
  }
  next(err)
})

app.listen(PORT, () => {
  console.log(`[server] MMG_VisualizeMM 后端已启动: http://127.0.0.1:${PORT}`)
})
