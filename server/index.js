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

// pdf-parse 是 CJS 模块，ESM 下用 createRequire 加载；2.x 导出结构不同，兼容处理
const require = createRequire(import.meta.url)
const pdfParseMod = require('pdf-parse')
const pdfParse = typeof pdfParseMod === 'function' ? pdfParseMod : pdfParseMod.default || pdfParseMod

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3088

app.use(express.json({ limit: '30mb' })) // base64 上传放大 ~33%，30mb ≈ 20MB 文件

/* ---------- AI 中继 ---------- */

// 归一化 baseUrl：允许用户填 https://api.deepseek.com 或带 /v1 或 /v1/chat/completions
function normalizeBase(baseUrl) {
  let u = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!u) return null
  if (/\/chat\/completions$/.test(u)) u = u.replace(/\/chat\/completions$/, '')
  if (/\/v\d+$/.test(u)) u = u
  else if (/\/compatible-mode$/.test(u)) u = u
  else u = u // 保持原样，由调用方拼 /chat/completions
  return u
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
      const r = await pdfParse(buf)
      const text = r.text.trim()
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

/* ---------- 健康检查 ---------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'mmg-visualizemm', time: new Date().toISOString() })
})

/* ---------- 静态托管 ---------- */
const distDir = path.join(__dirname, '..', 'web', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api\/).*/, (_req, res) => {
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
