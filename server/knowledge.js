/**
 * 知识库（RAG）模块 —— 把 docs/07-论文库 的获奖论文切块、向量化、检索
 *
 * 设计：
 *  - 切块：按 Markdown 标题（## / ###）边界切，每块 300~800 字符，保留来源文件
 *  - embedding：默认调用用户配置的 OpenAI 兼容 /embeddings 端点；
 *                失败时降级为内置 n-gram 哈希向量（无需外部服务，离线可用）
 *  - 缓存：向量缓存到 data/knowledge_cache.json，避免每次启动重复生成
 *  - 检索：余弦相似度 top-k，附带来源文件名与章节标题
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PAPER_DIR = path.join(__dirname, '..', 'docs', '07-论文库')
const CACHE_FILE = path.join(__dirname, '..', 'data', 'knowledge_cache.json')

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
    // 块过长（>700 字符）强制切：标题下内容太多时按行堆叠切
    if (current.lines.join('\n').length > 700 && current.lines.length > 6) {
      push()
    }
  }
  push()
  return chunks.filter((c) => c.text.length > 40)
}

/** 扫描论文库，返回全部 chunks（带文件来源） */
export function loadAllChunks() {
  if (!fs.existsSync(PAPER_DIR)) return []
  const files = fs.readdirSync(PAPER_DIR).filter((f) => /\.md$/.test(f) && !f.startsWith('_'))
  const chunks = []
  for (const f of files) {
    const raw = fs.readFileSync(path.join(PAPER_DIR, f), 'utf8')
    let text = raw
      .replace(/^---[\s\S]*?---/m, '') // 去掉 front-matter（若有）
      .replace(/```[\s\S]*?```/g, (m) => m.slice(0, 120)) // 代码块截断，避免向量被代码噪声污染
    // 参考文献区整体截断（从"参考文献"或"十、参考文献"起，正文之后的文献列表对检索无益）
    text = text.split(/\n\s*(?:十?[一二三四五六七八九]、)?参考文献\s*\n/)[0]
    // 去掉 OCR 页脚噪声（"## Page N" 后的版权行/孤立数字行）
    text = text.replace(/^## Page \d+$/gm, '')
    text = text.replace(/^版权归全国大学生数学建模竞赛所有.*$/gm, '')
    chunks.push(...splitChunks(text, f))
  }
  return chunks
}

/* ---------- embedding（远程 API 优先，本地哈希降级） ---------- */

/** 内置 n-gram 哈希向量（无外部服务时的降级方案，确定性） */
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
  // 字符 2-gram + 词片段（对中文按连续汉字/字母切）
  const grams = new Set()
  const clean = text.toLowerCase().replace(/\s+/g, '')
  for (let i = 0; i < clean.length - 1; i++) {
    const g = clean.slice(i, i + 2)
    if (/[\u4e00-\u9fffA-Za-z0-9]/.test(g)) grams.add(g)
  }
  // 英文词级
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []) grams.add(w)
  for (const g of grams) {
    vec[norm(g) % dim] += 1
  }
  // L2 归一化
  let sum = 0
  for (let i = 0; i < dim; i++) sum += vec[i] * vec[i]
  const len = Math.sqrt(sum) || 1
  for (let i = 0; i < dim; i++) vec[i] /= len
  return Array.from(vec)
}

/**
 * 生成一段文本的 embedding。
 * 优先：POST {base}/embeddings（OpenAI 兼容，如通义 text-embedding-v3 / OpenAI text-embedding-3-small）
 * 降级：本地 n-gram 哈希向量
 * @returns {Promise<{vector:number[], source:'api'|'local'}>}
 */
async function embedText(text, { baseUrl, apiKey, embedModel }) {
  if (baseUrl && apiKey) {
    const base = (baseUrl || '').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')
    try {
      const res = await fetch(`${base}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: embedModel || 'text-embedding-v3', input: text.slice(0, 6000) }),
        signal: AbortSignal.timeout(30000),
      })
      if (res.ok) {
        const json = await res.json()
        const vec = json?.data?.[0]?.embedding
        if (Array.isArray(vec) && vec.length > 0) return { vector: vec, source: 'api' }
      }
    } catch { /* fallthrough to local */ }
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

let kb = null // { chunks: [], vecs: [], source: 'api'|'local', builtAt }

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

/** 构建/加载知识库（带缓存）。provider 用于首次 embedding */
export async function ensureKnowledgeBase(provider) {
  if (kb && kb.chunks.length > 0) return kb
  const chunks = loadAllChunks()
  if (chunks.length === 0) return { chunks: [], vecs: [], source: 'none', builtAt: null }

  // 缓存命中（且 chunks 指纹一致）
  const cached = loadCache()
  const fingerprint = 'v2|' + chunks.map((c) => c.file).join('|')
  if (cached && cached.fingerprint === fingerprint && Array.isArray(cached.vecs) && cached.vecs.length === chunks.length) {
    kb = { chunks, vecs: cached.vecs, source: cached.source || 'api', builtAt: cached.builtAt }
    return kb
  }

  // 构建：批量 embedding（限制并发，避免打爆 API）
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

/** 检索 top-k 相关片段 */
export async function searchKnowledge(query, provider, topK = 4) {
  const k = await ensureKnowledgeBase(provider)
  if (k.chunks.length === 0) return []
  const { vector } = await embedText(query, provider || {})
  // 查询关键词（中文按 2-gram 提取 + 英文词）
  const qGrams = new Set()
  const clean = query.toLowerCase().replace(/\s+/g, '')
  for (let i = 0; i < clean.length - 1; i++) qGrams.add(clean.slice(i, i + 2))
  for (const w of query.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []) qGrams.add(w)
  // 混合打分：余弦相似度（权重 0.7）+ 关键词 2-gram 命中率（权重 0.3），弥补本地 embedding 对短查询的区分度不足
  const scored = k.chunks.map((c, i) => {
    const sim = cosine(vector, k.vecs[i])
    const cClean = c.text.toLowerCase().replace(/\s+/g, '')
    let hit = 0
    for (const g of qGrams) if (cClean.includes(g)) hit++
    const kw = qGrams.size > 0 ? hit / qGrams.size : 0
    return { ...c, score: 0.7 * sim + 0.3 * kw }
  })
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK).map((c) => ({
    file: c.file.replace(/\.md$/, ''),
    section: c.section,
    text: c.text.slice(0, 1200),
    score: Number(c.score.toFixed(4)),
  }))
}

/** 知识库统计 */
export function knowledgeStats() {
  const chunks = loadAllChunks()
  return {
    paperFiles: fs.existsSync(PAPER_DIR) ? fs.readdirSync(PAPER_DIR).filter((f) => /\.md$/.test(f) && !f.startsWith('_')).length : 0,
    chunkCount: chunks.length,
    source: kb ? kb.source : '未构建',
    builtAt: kb ? kb.builtAt : null,
  }
}
