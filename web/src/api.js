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

/** 生成附件摘要（供 AI 读题联动解读） */
export function attachSummary(attachments) {
  const parts = []
  for (const a of attachments) {
    if (a.status !== 'done') continue
    if (a.type === 'table') {
      const head = a.headers.join(' | ')
      const sample = a.rows.slice(0, 3).map((r) => r.join(' | ')).join('\n    ')
      parts.push(`【${a.name}】表头：${head}\n    示例数据：\n    ${sample}`)
    } else if (a.type === 'text') {
      parts.push(`【${a.name}】文本摘要：${a.text.slice(0, 500)}`)
    }
  }
  return parts.join('\n\n')
}
