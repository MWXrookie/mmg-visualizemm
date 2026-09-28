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
import { Readable } from 'stream'
import { createRequire } from 'module'
import { randomUUID } from 'node:crypto'
import ExcelJS from 'exceljs'
import { formatNetworkError, requestUpstream, responseText } from './upstream.js'

// pdf-parse 2.x：导出 { PDFParse } 类（ESM 下用 createRequire 加载）
const require = createRequire(import.meta.url)
const pdfParseMod = require('pdf-parse')
const { PDFParse } = pdfParseMod

// xlsx 流式解析依赖（exceljs 内部模块，绕开 WorkbookReader 的多 sheet 缺陷）
const unzipper = require('unzipper')
const iterateStream = require('exceljs/lib/utils/iterate-stream.js')
const parseSax = require('exceljs/lib/utils/parse-sax.js')
const WorkbookXform = require('exceljs/lib/xlsx/xform/book/workbook-xform.js')
const WorksheetReader = require('exceljs/lib/stream/xlsx/worksheet-reader.js')

/** 解析 PDF 提取文本（pdf-parse 2.x API；解析完销毁实例，避免连续上传累积 pdfjs 文档对象） */
async function parsePdfText(buffer) {
  const parser = new PDFParse({ data: buffer })
  try {
    await parser.load()
    const info = await parser.getInfo({ parsePageInfo: true }).catch(() => null)
    const result = await parser.getText({ lineEnforce: true, pageJoiner: '\n\n-- page_number of total_number --\n\n' })
    return {
      text: (result && result.text) || '',
      pages: Array.isArray(result?.pages)
        ? result.pages.map((p) => ({ num: p.num, text: String(p.text || '').trim() }))
        : [],
      total: Number(result?.total || info?.total || 0),
      info: info?.info || null,
    }
  } finally {
    await parser.destroy().catch(() => {})
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3088

app.disable('x-powered-by') // 隐藏 Express 版本号
app.use(express.json({ limit: '100mb' })) // base64 上传放大 ~33%，100mb ≈ 75MB 文件

/* ---------- AI 中继 ---------- */

// 归一化 baseUrl：允许用户填 https://api.deepseek.com、带 /v1 或完整 /chat/completions 端点
function normalizeBase(baseUrl) {
  const u = (baseUrl || '').trim().replace(/\/+$/, '')
  if (!u) return null
  return u.replace(/\/chat\/completions$/, '') // 去掉完整端点后缀，由调用方统一拼 /chat/completions
}

async function callChat({ baseUrl, apiKey, model, messages, maxTokens, proxyUrl }) {
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
    max_tokens: maxTokens || 16384,
    temperature: 0.4,
    stream: false,
  }
  const requestBody = JSON.stringify(body)
  let res
  try {
    const upstream = await requestUpstream({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
      proxyUrl,
      signal: AbortSignal.timeout(300000),
      timeout: 300000,
    })
    res = { ok: upstream.statusCode >= 200 && upstream.statusCode < 300, status: upstream.statusCode, text: await responseText(upstream) }
  } catch (e) {
    const err = e.code === 'BAD_CONFIG' || e.code === 'PROXY_BAD_CONFIG'
      ? e
      : formatNetworkError(e, url)
    throw err
  }
  const text = res.text
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
  const msg = json.choices[0].message || {}
  const content = msg.content ?? ''
  const reasoning = msg.reasoning_content ?? ''
  // 推理模型思考耗尽：content 空但思考有内容 → 明确报错而不是静默空返回
  if (!content && reasoning) {
    const err = new Error('模型思考时间过长、未生成正式内容（max_tokens 被思考过程耗尽）。请重试，或在「模型设置」中换用非推理模型。')
    err.code = 'EMPTY_REASONING'
    throw err
  }
  return {
    content,
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
  const { baseUrl, apiKey, model, proxyUrl } = req.body || {}
  try {
    const r = await callChat({
      baseUrl, apiKey, model: model || 'qwen-plus', proxyUrl,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 5,
    })
    res.json({ ok: true, message: '连接成功', model: r.model })
  } catch (e) {
    res.status(400).json({ ok: false, code: e.code, message: e.message })
  }
})

app.post('/api/chat', async (req, res) => {
  const { baseUrl, apiKey, model, messages, proxyUrl } = req.body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, message: 'messages 不能为空' })
  }
  try {
    const r = await callChat({ baseUrl, apiKey, model, messages, proxyUrl })
    res.json({ ok: true, content: r.content, model: r.model })
  } catch (e) {
    res.status(400).json({ ok: false, code: e.code, message: e.message })
  }
})

/* ---------- AI 流式中继（SSE，首字 <3s 验收项） ---------- */

app.post('/api/chat/stream', async (req, res) => {
  const { baseUrl, apiKey, model, messages, proxyUrl } = req.body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ ok: false, message: 'messages 不能为空' })
  }
  const base = normalizeBase(baseUrl)
  if (!base || !apiKey || !model) {
    return res.status(400).json({ ok: false, code: 'BAD_CONFIG', message: '缺少 baseUrl / apiKey / model' })
  }
  const controller = new AbortController()
  const url = `${base}/chat/completions`
  // 客户端断开（而非请求体读完）时才中止上游请求
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  try {
    const upstream = await requestUpstream({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: 16384, temperature: 0.4, stream: true }),
      proxyUrl,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(300000)]),
      timeout: 300000,
    })
    if (!upstream || upstream.statusCode < 200 || upstream.statusCode >= 300) {
      const text = await responseText(upstream).catch(() => '')
      let json = null
      try { json = text ? JSON.parse(text) : null } catch { /* ignore */ }
      const err = new Error(formatError(upstream.statusCode, json, text))
      err.code = statusToCode(upstream.statusCode)
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
    let sseLen = 0 // 诊断：统计本次流式转发的总字符数
    let reasoningLen = 0 // 推理模型：统计 reasoning_content 字符数（思考过程，不转发给前端）
    for await (const chunk of upstream) {
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
          // 诊断：首次打印 chunk 结构，确认 delta 字段（content / reasoning_content / delta 等）
          if (process.env.DBG_SSE && !process.env.DBG_SSE_DONE) {
            console.log('[sse] 首个 chunk:', JSON.stringify(obj).slice(0, 400))
            process.env.DBG_SSE_DONE = '1'
          }
          const d = obj.choices?.[0]?.delta || {}
          const delta = d.content ?? ''
          const reasoning = d.reasoning_content ?? ''
          if (reasoning) reasoningLen += reasoning.length
          if (delta) {
            sseLen += delta.length
            res.write(`data: ${JSON.stringify({ delta })}\n\n`)
          }
        } catch { /* 忽略无法解析的 chunk */ }
      }
    }
    console.log(`[stream] model=${model} 转发 ${sseLen} 字符，思考 ${reasoningLen} 字符`)
    // 推理模型思考耗尽（content 为空但思考有内容）：明确告知前端，避免"空输出"困惑
    if (sseLen === 0 && reasoningLen > 0) {
      res.write(`data: ${JSON.stringify({ error: '模型思考时间过长、未生成正式内容（max_tokens 被思考过程耗尽）。请重试，或在「模型设置」中换用非推理模型。' })}\n\n`)
      res.end()
      return
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    res.end()
  } catch (e) {
    const error = e.code === 'MODEL_ERROR' || e.code === 'INVALID_KEY' || e.code === 'QUOTA' || e.code === 'NOT_FOUND' || e.code === 'BAD_CONFIG' || e.code === 'PROXY_BAD_CONFIG'
      ? e
      : formatNetworkError(e, url)
    if (!res.headersSent) {
      return res.status(400).json({ ok: false, code: error.code, message: error.message })
    }
    // 已开始流式输出：以 SSE error 事件告知前端（保留已展示的部分内容）
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`)
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

/**
 * 解析 xlsx（两遍流式，只读取每个 sheet 前 MAX_ROWS 行做预览）。
 *
 * 为什么不用 exceljs 的 wb.xlsx.load() 或 WorkbookReader：
 * - load() 会把整个工作表（含上万行）全量解析进内存，大文件极慢（10 万行 ≈ 9s）甚至超时；
 * - WorkbookReader 要求 zip 中 workbook.xml 出现在 worksheets 之前，但很多文件（含 exceljs
 *   自己生成的多 sheet 文件）顺序相反，会在解析 worksheet 时崩溃（model 未就绪）。
 *
 * 方案：用 unzipper 直接流式解压 xlsx（zip）：
 * 第一遍：读 xl/workbook.xml 拿 sheet 名/rId；读 xl/sharedStrings.xml 拿共享字符串表；
 * 第二遍：对每个 sheet 的 XML 流，用 exceljs 的 WorksheetReader 按行解析，取前若干行即止。
 * 只解压需要读取的行，内存占用恒定；10 万行大表全程 ≈ 1.5s。
 * 注：流式提前 break 拿不到准确 totalRows，且前端并未使用该字段，故不再返回。
 */
async function parseXlsx(buffer) {
  const sheets = [] // [{ name, headers, rows }]

  /* 第一遍：sheet 元信息 + 共享字符串表 */
  let sheetMeta = [] // [{ id, name }]
  let sharedStrings = null
  {
    const zip = unzipper.Parse({ forceStream: true })
    Readable.from(buffer).pipe(zip)
    for await (const entry of iterateStream(zip)) {
      if (entry.path === 'xl/workbook.xml') {
        const xform = new WorkbookXform()
        await xform.parseStream(iterateStream(entry))
        sheetMeta = (xform.model.sheets || []).map((s) => ({ id: s.id, name: s.name })).sort((a, b) => a.id - b.id)
      } else if (entry.path === 'xl/sharedStrings.xml') {
        sharedStrings = []
        for await (const events of parseSax(iterateStream(entry))) {
          for (const { eventType, value } of events) {
            if (eventType === 'opentag' && value.name === 'si') sharedStrings.push(null)
            else if (eventType === 'text') {
              const idx = sharedStrings.length - 1
              const cur = sharedStrings[idx]
              sharedStrings[idx] = cur === null ? value : cur + value
            }
          }
        }
      } else entry.autodrain()
    }
  }

  /* 第二遍：解析每个 sheet 前 MAX_ROWS 行 */
  {
    const zip = unzipper.Parse({ forceStream: true })
    Readable.from(buffer).pipe(zip)
    for await (const entry of iterateStream(zip)) {
      const m = entry.path.match(/xl\/worksheets\/sheet(\d+)[.]xml/)
      if (m) {
        const id = Number(m[1])
        const wsr = new WorksheetReader({
          workbook: {
            sharedStrings,
            styles: { getStyleModel: () => null },
            properties: { model: {} },
          },
          id,
          iterator: iterateStream(entry),
          options: { worksheets: 'emit', hyperlinks: 'ignore', styles: 'ignore' },
        })
        const raw = []
        for await (const row of wsr) {
          if (raw.length >= MAX_ROWS + 5) break // 只取前若干行做预览，其余行丢弃
          raw.push(row.values.slice(1).map(normalizeCell))
        }
        entry.autodrain() // 提前 break 后必须排干 entry，否则 zip 流卡住
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
        const meta = sheetMeta.find((s) => s.id === id)
        sheets.push({ name: meta ? meta.name : `Sheet${id}`, headers, rows })
      } else entry.autodrain()
    }
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
      const pdf = await parsePdfText(buf)
      const text = String(pdf.text || '').trim()
      if (!text) return res.status(400).json({ ok: false, message: 'PDF 未能提取到文本（可能是扫描件，暂不支持 OCR）' })
      return res.json({
        ok: true,
        type: 'text',
        text: text.slice(0, 20000),
        name,
        sourceKind: 'pdf',
        pages: Array.isArray(pdf.pages) ? pdf.pages.slice(0, 40) : [],
        totalPages: pdf.total || (Array.isArray(pdf.pages) ? pdf.pages.length : 0),
      })
    }
    if (ext === '.txt' || ext === '.md') {
      const text = buf.toString('utf-8').trim()
      return res.json({ ok: true, type: 'text', text: text.slice(0, 20000), name, sourceKind: 'text' })
    }
    return res.status(400).json({ ok: false, message: `暂不支持 ${ext} 格式（支持 xlsx/csv/pdf/txt）` })
  } catch (e) {
    console.error('[parse] error', e)
    res.status(500).json({ ok: false, message: `解析失败：${e.message}` })
  }
})

/* ---------- 工作区存储（三台共用数据层，SQLite，零依赖 node:sqlite） ---------- */
import { DatabaseSync } from 'node:sqlite'

// 测试和隔离部署可显式指定数据目录；默认行为仍保持为仓库根目录下的 data/。
const dataDir = process.env.MMG_DATA_DIR
  ? path.resolve(process.env.MMG_DATA_DIR)
  : path.join(__dirname, '..', 'data')
fs.mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(path.join(dataDir, 'mmg.db'))
const WORKSPACE_BACKUP_FORMAT = 'mmg-workspace-backup'
const WORKSPACE_SCHEMA_VERSION = 1
const currentDbSchemaVersion = Number(db.prepare('PRAGMA user_version').get()?.user_version || 0)
if (currentDbSchemaVersion > WORKSPACE_SCHEMA_VERSION) {
  throw new Error(`数据库 schema 版本 ${currentDbSchemaVersion} 高于当前程序支持的版本 ${WORKSPACE_SCHEMA_VERSION}`)
}
db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    title TEXT DEFAULT '',
    problem_text TEXT DEFAULT '',
    problem_source_kind TEXT DEFAULT '',
    problem_pages TEXT DEFAULT '[]',
    attachments TEXT DEFAULT '[]',
    breakdown TEXT DEFAULT '[]',
    code TEXT DEFAULT '',
    created_at INTEGER,
    updated_at INTEGER
  )
`)
// 轻量迁移：旧库补充 overview 列（整体解读缓存）
const wsCols = db.prepare(`PRAGMA table_info(workspaces)`).all().map((c) => c.name)
if (!wsCols.includes('overview')) {
  db.exec(`ALTER TABLE workspaces ADD COLUMN overview TEXT DEFAULT ''`)
}
if (!wsCols.includes('problem_source_kind')) {
  db.exec(`ALTER TABLE workspaces ADD COLUMN problem_source_kind TEXT DEFAULT ''`)
}
if (!wsCols.includes('problem_pages')) {
  db.exec(`ALTER TABLE workspaces ADD COLUMN problem_pages TEXT DEFAULT '[]'`)
}
if (currentDbSchemaVersion < WORKSPACE_SCHEMA_VERSION) {
  db.exec(`PRAGMA user_version = ${WORKSPACE_SCHEMA_VERSION}`)
}

function parseJsonField(s) {
  try { return JSON.parse(s || '[]') } catch { return [] }
}

function newWorkspaceId() {
  return `ws-${Date.now()}-${randomUUID().slice(0, 8)}`
}

function workspaceFromRow(row) {
  return {
    id: row.id,
    title: row.title,
    problemText: row.problem_text,
    problemSourceKind: row.problem_source_kind || '',
    problemPages: parseJsonField(row.problem_pages),
    attachments: parseJsonField(row.attachments),
    breakdown: parseJsonField(row.breakdown),
    code: row.code,
    overview: row.overview || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) {
    const error = new Error('备份内容不是有效的 JSON 对象')
    error.code = 'BACKUP_INVALID'
    throw error
  }
  if (backup.format !== WORKSPACE_BACKUP_FORMAT) {
    const error = new Error('不是 MMG 工作区备份文件')
    error.code = 'BACKUP_FORMAT'
    throw error
  }
  const version = Number(backup.schemaVersion)
  if (!Number.isInteger(version) || version < 1) {
    const error = new Error('备份缺少有效的 schemaVersion')
    error.code = 'BACKUP_VERSION_INVALID'
    throw error
  }
  if (version > WORKSPACE_SCHEMA_VERSION) {
    const error = new Error(`备份版本 ${version} 高于当前支持的版本 ${WORKSPACE_SCHEMA_VERSION}，请升级 MMG 后再导入`)
    error.code = 'BACKUP_VERSION_NEWER'
    throw error
  }
  if (version !== WORKSPACE_SCHEMA_VERSION) {
    const error = new Error(`暂不支持 schemaVersion ${version}`)
    error.code = 'BACKUP_VERSION_UNSUPPORTED'
    throw error
  }
  const source = backup.workspace
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    const error = new Error('备份中缺少 workspace 对象')
    error.code = 'BACKUP_WORKSPACE_MISSING'
    throw error
  }
  for (const field of ['problemPages', 'attachments', 'breakdown']) {
    if (source[field] !== undefined && !Array.isArray(source[field])) {
      const error = new Error(`备份字段 ${field} 必须是数组`)
      error.code = 'BACKUP_FIELD_INVALID'
      throw error
    }
  }
  return {
    title: String(source.title || '导入的工作区').slice(0, 200),
    problemText: String(source.problemText || ''),
    problemSourceKind: String(source.problemSourceKind || ''),
    problemPages: source.problemPages || [],
    attachments: source.attachments || [],
    breakdown: source.breakdown || [],
    code: String(source.code || ''),
    overview: String(source.overview || ''),
  }
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
    const id = typeof b.id === 'string' && b.id ? b.id : newWorkspaceId()
    const now = Date.now()
    const existing = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
    const has = (k) => Object.prototype.hasOwnProperty.call(b, k)
    const merged = {
      title: has('title') ? String(b.title ?? '') : (existing?.title ?? ''),
      problem_text: has('problemText') ? String(b.problemText ?? '') : (existing?.problem_text ?? ''),
      problem_source_kind: has('problemSourceKind') ? String(b.problemSourceKind ?? '') : (existing?.problem_source_kind ?? ''),
      problem_pages: has('problemPages')
        ? JSON.stringify(Array.isArray(b.problemPages) ? b.problemPages : [])
        : (existing?.problem_pages ?? '[]'),
      attachments: has('attachments') ? JSON.stringify(Array.isArray(b.attachments) ? b.attachments : []) : (existing?.attachments ?? '[]'),
      breakdown: has('breakdown')
        ? (typeof b.breakdown === 'string' ? b.breakdown : JSON.stringify(Array.isArray(b.breakdown) ? b.breakdown : []))
        : (existing?.breakdown ?? '[]'),
      code: has('code') ? String(b.code ?? '') : (existing?.code ?? ''),
      overview: has('overview') ? String(b.overview ?? '') : (existing?.overview ?? ''),
    }
    const createdAt = existing ? existing.created_at : now
    db.prepare(`
      INSERT INTO workspaces (id, title, problem_text, problem_source_kind, problem_pages, attachments, breakdown, code, overview, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, problem_text=excluded.problem_text, problem_source_kind=excluded.problem_source_kind, problem_pages=excluded.problem_pages,
        attachments=excluded.attachments, breakdown=excluded.breakdown,
        code=excluded.code, overview=excluded.overview, updated_at=excluded.updated_at
    `).run(id, merged.title, merged.problem_text, merged.problem_source_kind, merged.problem_pages, merged.attachments, merged.breakdown, merged.code, merged.overview, createdAt, now)
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
    res.json({ ok: true, workspace: workspaceFromRow(row) })
  } catch (e) {
    res.status(500).json({ ok: false, message: `读取失败：${e.message}` })
  }
})

// 导出单个工作区：仅含业务数据，不包含浏览器内的 API Key、模型设置或会话偏好。
app.get('/api/workspaces/:id/backup', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ ok: false, message: '工作区不存在' })
    const workspace = workspaceFromRow(row)
    res.setHeader('Content-Disposition', `attachment; filename="mmg-workspace-${encodeURIComponent(row.id)}.json"`)
    res.json({
      format: WORKSPACE_BACKUP_FORMAT,
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      workspace,
    })
  } catch (e) {
    res.status(500).json({ ok: false, message: `导出失败：${e.message}` })
  }
})

// 安全导入：校验完整备份后始终创建新工作区，不覆盖现有 ID。
app.post('/api/workspaces/import', (req, res) => {
  try {
    const data = validateBackup(req.body?.backup)
    const id = newWorkspaceId()
    const now = Date.now()
    db.prepare(`
      INSERT INTO workspaces (id, title, problem_text, problem_source_kind, problem_pages, attachments, breakdown, code, overview, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.title,
      data.problemText,
      data.problemSourceKind,
      JSON.stringify(data.problemPages),
      JSON.stringify(data.attachments),
      JSON.stringify(data.breakdown),
      data.code,
      data.overview,
      now,
      now,
    )
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id)
    res.status(201).json({ ok: true, id, schemaVersion: WORKSPACE_SCHEMA_VERSION, workspace: workspaceFromRow(row) })
  } catch (e) {
    if (e.code?.startsWith('BACKUP_')) {
      return res.status(400).json({ ok: false, code: e.code, message: e.message })
    }
    res.status(500).json({ ok: false, message: `导入失败：${e.message}` })
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

/* ---------- 数据→代码注入（B3：附件表数据转 CSV，供编程台一键取用） ---------- */

function rowsToCsv(headers, rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const lines = [headers.map(esc).join(',')]
  for (const r of rows) lines.push(headers.map((_, i) => esc(r[i])).join(','))
  return lines.join('\n')
}

// GET /api/workspaces/:id/attachments/:idx/data.csv —— 附件表数据转 CSV（编程台注入用）
app.get('/api/workspaces/:id/attachments/:idx/data.csv', (req, res) => {
  try {
    const row = db.prepare('SELECT attachments FROM workspaces WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ ok: false, message: '工作区不存在' })
    const attachments = parseJsonField(row.attachments)
    const att = attachments[Number(req.params.idx)]
    if (!att || att.type !== 'table') return res.status(404).json({ ok: false, message: '附件不存在或非表格' })
    const csv = rowsToCsv(att.headers || [], att.rows || [])
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="data-${req.params.idx}.csv"`)
    res.send('\uFEFF' + csv) // BOM 兼容 Excel
  } catch (e) {
    res.status(500).json({ ok: false, message: `导出失败：${e.message}` })
  }
})

// GET /api/workspaces/:id/attachments/:idx/data.json —— 结构化 JSON（前端/Pyodide 直用）
app.get('/api/workspaces/:id/attachments/:idx/data.json', (req, res) => {
  try {
    const row = db.prepare('SELECT attachments FROM workspaces WHERE id = ?').get(req.params.id)
    if (!row) return res.status(404).json({ ok: false, message: '工作区不存在' })
    const attachments = parseJsonField(row.attachments)
    const att = attachments[Number(req.params.idx)]
    if (!att || att.type !== 'table') return res.status(404).json({ ok: false, message: '附件不存在或非表格' })
    res.json({ ok: true, name: att.name, headers: att.headers || [], rows: att.rows || [] })
  } catch (e) {
    res.status(500).json({ ok: false, message: `导出失败：${e.message}` })
  }
})

/* ---------- 健康检查 ---------- */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, name: 'mmg-visualizemm', time: new Date().toISOString() })
})

/* ---------- 知识库（RAG） ---------- */
import { ensureKnowledgeBase, searchKnowledge, knowledgeStats } from './knowledge.js'

// 知识库状态：论文数 / 分块数（按类型）/ embedding 来源
app.get('/api/knowledge/stats', async (_req, res) => {
  try {
    const provider = { baseUrl: String(_req.query.baseUrl || ''), apiKey: String(_req.query.apiKey || ''), embedModel: String(_req.query.embedModel || ''), proxyUrl: String(_req.query.proxyUrl || '') }
    const kb = await ensureKnowledgeBase(provider)
    res.json({ ok: true, ...knowledgeStats(), vecsReady: !!kb && kb.vecs.length === kb.chunks.length })
  } catch (e) {
    res.status(500).json({ ok: false, message: `知识库状态获取失败：${e.message}` })
  }
})

// 检索：POST /api/knowledge/search { query, baseUrl, apiKey, embedModel, topK }
app.post('/api/knowledge/search', async (req, res) => {
  try {
    const { query, baseUrl, apiKey, embedModel, proxyUrl, topK } = req.body || {}
    if (!query || !query.trim()) return res.status(400).json({ ok: false, message: '缺少检索词 query' })
    const provider = { baseUrl: String(baseUrl || ''), apiKey: String(apiKey || ''), embedModel: String(embedModel || ''), proxyUrl: String(proxyUrl || '') }
    const hits = await searchKnowledge(query.trim(), provider, Math.min(Number(topK) || 4, 8))
    res.json({ ok: true, hits, count: hits.length })
  } catch (e) {
    res.status(500).json({ ok: false, message: `检索失败：${e.message}` })
  }
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
    return res.status(413).json({ ok: false, code: 'TOO_LARGE', message: '文件过大：单次上传请控制在 70MB 以内（可将大表拆分为多个附件）' })
  }
  next(err)
})

app.listen(PORT, () => {
  // 监听所有网卡（0.0.0.0）：本机用 127.0.0.1，局域网内其他人用本机局域网 IP
  const nets = require('os').networkInterfaces()
  const lanIps = []
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) lanIps.push(ni.address)
    }
  }
  const lan = lanIps.length > 0 ? lanIps.map((ip) => `http://${ip}:${PORT}`).join(' 或 ') : '（未检测到局域网 IP）'
  console.log(`[server] MMG_VisualizeMM 后端已启动`)
  console.log(`  · 本机访问: http://127.0.0.1:${PORT}`)
  console.log(`  · 局域网访问(同一网络的其他设备): ${lan}`)
})
