/**
 * 知识库（RAG）模块 v3 —— 三源结构
 *
 * 数据源（按检索优先级排序）：
 *   type=method  方法库（docs/07-论文库/方法库-*.md）       权重最高：新手"选方法"第一命中
 *   type=card    知识卡片（docs/07-论文库/知识卡片库-*.md）  权重中：新手"概念是什么"命中
 *   type=paper   论文全文（docs/07-论文库/优秀论文*.md）     权重低：需引述论文细节时兜底
 *
 * embedding：
 *   - 优先读取 server/.env.local 的千问 text-embedding-v3（语义检索）
 *   - 无 key / 失败时降级本地 n-gram 哈希向量（离线可用）
 *
 * 缓存：data/knowledge_cache.json（含 type 标签，指纹变化时重建）
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PAPER_DIR = path.join(__dirname, '..', 'docs', '07-论文库')
const CACHE_FILE = path.join(__dirname, '..', 'data', 'knowledge_cache.json')
const ENV_FILE = path.join(__dirname, '.env.local')

/* ---------- 读取本地 embedding 配置（不硬编码 key） ---------- */
function loadLocalConfig() {
  const cfg = { baseUrl: '', apiKey: '', embedModel: '' }
  try {
    if (fs.existsSync(ENV_FILE)) {
      // 用 /\r?\n/ 兼容 CRLF/LF；正则容忍行尾 \r（最后一行常无换行符）
      for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^([A-Z_]+)=(.*?)\r?$/)
        if (m) cfg[m[1]] = m[2].trim()
      }
    }
  } catch { /* ignore */ }
  // 字段映射：EMBED_API_KEY → apiKey, EMBED_MODEL → embedModel, EMBED_BASE_URL → baseUrl
  return {
    baseUrl: cfg.EMBED_BASE_URL || cfg.baseUrl || '',
    apiKey: cfg.EMBED_API_KEY || cfg.apiKey || '',
    embedModel: cfg.EMBED_MODEL || cfg.embedModel || '',
  }
}
const localCfg = loadLocalConfig()

/* ---------- 切块 ---------- */

/** 从 Markdown 文本中按标题切块。返回 [{file, section, text}] */
function splitChunks(text, file) {
  const lines = text.split('\n')
  const chunks = []
  let current = { file, section: '开头', lines: [] }
  const push = () => {
    const body = current.lines.join('\n').trim()
    if (body.length >= 40) chunks.push({ file, section: current.section, text: body })
    current = { file, section: current.section, lines: [] }
  }
  for (const line of lines) {
    const h = line.match(/^(#{2,4})\s+(.+)$/)
    if (h) {
      push()
      current.section = h[2].trim().slice(0, 60)
    } else {
      current.lines.push(line)
    }
    if (current.lines.join('\n').length > 700 && current.lines.length > 6) {
      push()
    }
  }
  push()
  return chunks.filter((c) => c.text.length > 40)
}

/** 判断文件属于哪个数据源 */
function sourceType(file) {
  if (/方法库/.test(file)) return 'method'
  if (/知识卡片库/.test(file)) return 'card'
  return 'paper'
}

/** 数据源优先级权重（检索打分时叠加） */
const TYPE_WEIGHT = { method: 0.15, card: 0.08, paper: 0 }

/** 扫描知识库，返回全部 chunks（带 type 标签） */
export function loadAllChunks() {
  if (!fs.existsSync(PAPER_DIR)) return []
  const files = fs.readdirSync(PAPER_DIR).filter((f) => /\.md$/.test(f) && !f.startsWith('_') && !f.startsWith('.'))
  const chunks = []
  for (const f of files) {
    const raw = fs.readFileSync(path.join(PAPER_DIR, f), 'utf8')
    let text = raw
      .replace(/^---[\s\S]*?---/m, '')
      .replace(/```[\s\S]*?```/g, (m) => m.slice(0, 120))
    // 论文全文才截断参考文献区；方法库/卡片库保留全文（结构化内容都有用）
    if (sourceType(f) === 'paper') {
      text = text.split(/\n\s*(?:十?[一二三四五六七八九]、)?参考文献\s*\n/)[0]
      text = text.replace(/^## Page \d+$/gm, '')
      text = text.replace(/^版权归全国大学生数学建模竞赛所有.*$/gm, '')
    }
    const type = sourceType(f)
    for (const c of splitChunks(text, f)) chunks.push({ ...c, type })
  }
  return chunks
}

/* ---------- embedding（千问 API 优先，本地哈希降级） ---------- */

/** 内置 n-gram 哈希向量（无外部服务时的降级方案） */
function localEmbed(text) {
  const dim = 512
  const vec = new Float64Array(dim)
  const norm = (s) => {
    let h = 2166136261
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }
  const grams = new Set()
  const clean = text.toLowerCase().replace(/\s+/g, '')
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2)
    if (/[\u4e00-\u9fffA-Za-z0-9]/.test(g)) grams.add(g)
  }
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []) grams.add(w)
  for (const g of grams) {
    vec[norm(g) % dim] += 1
  }
  let sum = 0
  for (let i = 0; i < dim; i++) sum += vec[i] * vec[i]
  const len = Math.sqrt(sum) || 1
  for (let i = 0; i < dim; i++) vec[i] /= len
  return Array.from(vec)
}

/**
 * 生成 embedding：优先千问 API（.env.local），失败降级本地。
 * 传入的 provider（浏览器 settings）作为第二优先（用户可在产品设置里配）。
 */
async function embedText(text, provider = {}) {
  // 优先级：本地 .env.local 千问 > 浏览器传入 provider > 本地哈希
  const candidates = []
  if (localCfg.apiKey && localCfg.baseUrl) candidates.push({ baseUrl: localCfg.baseUrl, apiKey: localCfg.apiKey, model: localCfg.embedModel })
  if (provider.baseUrl && provider.apiKey) candidates.push({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: provider.embedModel })
  for (const c of candidates) {
    const base = (c.baseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
    try {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
        body: JSON.stringify({ model: c.model || 'text-embedding-v3', input: text.slice(0, 6000), dimensions: 512 }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        const json = await res.json()
        const vec = json?.data?.[0]?.embedding
        if (Array.isArray(vec) && vec.length > 0) return { vector: vec, source: 'api' }
      }
    } catch { /* try next */ }
  }
  return { vector: localEmbed(text), source: 'local' }
}

/** 余弦相似度 */
function cosine(a, b) {
  const n = Math.min(a.length, b.length)
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

/* ---------- 知识库构建与缓存 ---------- */

let kb = null
const CACHE_VERSION = 'v3'

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'))
  } catch { /* ignore */ }
  return null
}

function saveCache(data) {
  try {
    const dir = path.dirname(CACHE_FILE)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data))
  } catch { /* ignore */ }
}

/** 构建/加载知识库（带缓存）。embedding 来源：.env.local 千问 > 浏览器 provider > 本地 */
export async function ensureKnowledgeBase(provider) {
  if (kb && kb.chunks.length > 0) return kb
  const chunks = loadAllChunks()
  if (chunks.length === 0) return { chunks: [], vecs: [], source: 'none', builtAt: null }

  const cached = loadCache()
  const fingerprint = `${CACHE_VERSION}|` + chunks.map((c) => `${c.file}#${c.type}`).join('|')
  if (cached && cached.fingerprint === fingerprint && Array.isArray(cached.vecs) && cached.vecs.length === chunks.length) {
    kb = { chunks, vecs: cached.vecs, source: cached.source || 'local', builtAt: cached.builtAt }
    return kb
  }

  const vecs = new Array(chunks.length)
  let usedApi = false
  const CONC = 4
  let idx = 0
  async function worker() {
    while (idx < chunks.length) {
      const i = idx++
      const r = await embedText(chunks[i].text, provider || {})
      vecs[i] = r.vector
      if (r.source === 'api') usedApi = true
    }
  }
  await Promise.all(Array.from({ length: CONC }, worker))
  kb = { chunks, vecs, source: usedApi ? 'api' : 'local', builtAt: new Date().toISOString() }
  saveCache({ fingerprint, vecs, source: kb.source, builtAt: kb.builtAt })
  return kb
}

/** 检索 top-k 相关片段（方法库 > 卡片 > 论文 优先级 + 关键词命中） */
export async function searchKnowledge(query, provider, topK = 4) {
  const k = await ensureKnowledgeBase(provider)
  if (k.chunks.length === 0) return []
  const { vector } = await embedText(query, provider || {})

  // 查询关键词
  const qGrams = new Set()
  const clean = query.toLowerCase().replace(/\s+/g, '')
  for (let i = 0; i < clean.length - 1; i++) qGrams.add(clean.slice(i, i + 2))
  for (const w of query.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []) qGrams.add(w)

  const scored = k.chunks.map((c, i) => {
    const sim = cosine(vector, k.vecs[i])
    const cClean = c.text.toLowerCase().replace(/\s+/g, '')
    let hit = 0
    for (const g of qGrams) if (cClean.includes(g)) hit++
    const kw = qGrams.size > 0 ? hit / qGrams.size : 0
    const typeBoost = TYPE_WEIGHT[c.type] || 0
    return { ...c, score: 0.7 * sim + 0.3 * kw + typeBoost }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK).map((c) => ({
    file: c.file.replace(/\.md$/, ''),
    type: c.type,
    section: c.section,
    text: c.text.slice(0, 1200),
    score: Number(c.score.toFixed(4)),
  }))
}

/** 知识库统计 */
export function knowledgeStats() {
  const chunks = loadAllChunks()
  const byType = { method: 0, card: 0, paper: 0 }
  for (const c of chunks) byType[c.type] = (byType[c.type] || 0) + 1
  return {
    paperFiles: fs.existsSync(PAPER_DIR) ? fs.readdirSync(PAPER_DIR).filter((f) => /\.md$/.test(f) && !f.startsWith('_') && !f.startsWith('.')).length : 0,
    chunkCount: chunks.length,
    byType,
    source: kb ? kb.source : '未构建',
    builtAt: kb ? kb.builtAt : null,
    embedConfig: localCfg.apiKey ? 'qwen-api' : 'local-hash',
  }
}
