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
