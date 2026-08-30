/** 后端 API 封装 */

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    throw new Error(json.message || `请求失败（HTTP ${res.status}）`)
  }
  return json
}

export function testKey(settings) {
  return post('/api/test-key', {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
  })
}

export function chat(settings, messages) {
  return post('/api/chat', {
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    model: settings.model,
    messages,
  })
}

/**
 * SSE 流式对话：边收边回调 onDelta(累计内容)，返回最终完整内容。
 * 失败时抛出 Error（含 provider 的错误信息），调用方可降级为非流式重试。
 */
export async function streamChat(settings, messages, { onDelta } = {}) {
  const res = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages,
    }),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json.message || `请求失败（HTTP ${res.status}）`)
  }
  if (!res.body) throw new Error('浏览器不支持流式读取，已切换为整段输出')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let acc = ''
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      let obj
      try { obj = JSON.parse(data) } catch { continue }
      if (obj.error) throw new Error(obj.error)
      if (obj.delta) {
        acc += obj.delta
        onDelta?.(acc)
      }
      if (obj.done) return acc
    }
  }
  return acc
}

/** 上传文件并解析（返回 {ok,type,headers,rows,text,name}） */
export async function parseFile(file) {
  const b64 = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  const res = await fetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, data: b64 }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) {
    throw new Error(json.message || `解析失败（HTTP ${res.status}）`)
  }
  return json
}

/** 生成附件摘要（供 AI 读题联动解读，支持多 sheet） */
export function attachSummary(attachments) {
  const parts = []
  for (const a of attachments) {
    if (a.status !== 'done') continue
    if (a.type === 'table') {
      const tables = a.sheets && a.sheets.length > 0 ? a.sheets : [{ name: a.name, headers: a.headers, rows: a.rows }]
      for (const t of tables) {
        const head = t.headers.join(' | ')
        const sample = t.rows.slice(0, 3).map((r) => r.join(' | ')).join('\n    ')
        parts.push(`【${a.name}｜${t.name}】表头：${head}\n    示例数据：\n    ${sample}`)
      }
    } else if (a.type === 'text') {
      parts.push(`【${a.name}】文本摘要：${a.text.slice(0, 500)}`)
    }
  }
  return parts.join('\n\n')
}

/* ================= 工作区（三台共用，B1/B3） ================= */

/** 列出工作区（轻量：id/标题/时间） */
export async function listWorkspaces() {
  const res = await fetch('/api/workspaces')
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) throw new Error(json.message || '读取工作区失败')
  return json.workspaces || []
}

/** 新建/更新工作区（部分更新：只覆盖传入字段） */
export async function saveWorkspace(ws) {
  return post('/api/workspaces', ws)
}

/** 读取工作区（含题目/附件/拆解块/代码） */
export async function loadWorkspace(id) {
  const res = await fetch(`/api/workspaces/${id}`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) throw new Error(json.message || '读取工作区失败')
  return json.workspace
}

/** 删除工作区 */
export async function deleteWorkspace(id) {
  const res = await fetch(`/api/workspaces/${id}`, { method: 'DELETE' })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) throw new Error(json.message || '删除工作区失败')
  return json
}

/** 附件表数据 → CSV 下载/文本（B3 数据注入） */
export async function fetchAttachmentCsv(wsId, idx) {
  const res = await fetch(`/api/workspaces/${wsId}/attachments/${idx}/data.csv`)
  if (!res.ok) throw new Error('附件数据获取失败')
  return res.text()
}

/** 附件表数据 → JSON（Pyodide 直用） */
export async function fetchAttachmentJson(wsId, idx) {
  const res = await fetch(`/api/workspaces/${wsId}/attachments/${idx}/data.json`)
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.ok === false) throw new Error(json.message || '附件数据获取失败')
  return json
}

/* ================= 知识库（RAG） ================= */

/**
 * 从本地获奖论文知识库检索与 query 相关的片段。
 * 用用户配置的 provider 做 embedding（后端自动降级本地哈希向量）。
 * 返回 [{file, section, text, score}]；失败时返回 []（不阻塞主流程）。
 */
export async function retrieveKnowledge(query, settings, topK = 3) {
  if (!query || !query.trim()) return []
  try {
    const res = await fetch('/api/knowledge/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query.trim().slice(0, 200),
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        embedModel: settings.embedModel || '',
        topK,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json.ok === false) return []
    return json.hits || []
  } catch {
    return [] // 知识库不可用时静默降级，不打断主流程
  }
}

/** 把检索到的知识片段格式化为注入 system prompt 的上下文块 */
export function formatKnowledgeContext(hits, maxChars = 2200) {
  if (!hits || hits.length === 0) return ''
  let out = '\n\n【参考：本地获奖论文知识库（检索命中，可在回答中引用，注明论文来源）】\n'
  let used = 0
  for (const h of hits) {
    const block = `\n— 来自《${h.file}》${h.section ? `（${h.section}）` : ''} —\n${h.text}\n`
    if (used + block.length > maxChars) break
    out += block
    used += block.length
  }
  return out + '\n【知识库参考结束】\n'
}
