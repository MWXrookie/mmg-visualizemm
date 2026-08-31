// 用 server/.env.local 里的通义 key 测试 chat 接口可用性
const fs = await import('fs')
const env = fs.readFileSync('server/.env.local', 'utf-8')
const key = env.match(/EMBED_API_KEY=(.+)/)?.[1]?.trim()
const base = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
console.log('key 前缀:', key?.slice(0, 10) + '…', '长度:', key?.length)
const res = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
  body: JSON.stringify({ model: 'qwen-plus', messages: [{ role: 'user', content: 'ping，只回复 pong' }], max_tokens: 10, temperature: 0.4, stream: false }),
  signal: AbortSignal.timeout(30000),
})
console.log('HTTP', res.status)
const j = await res.json().catch(() => ({}))
console.log('响应:', JSON.stringify(j).slice(0, 300))
